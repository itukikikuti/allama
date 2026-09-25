// 手（Claude Code のセッション）を動かす。
// 1ターンごとに `claude -p` を起動し、出力をファイルに書かせて、それを追いかける。
// プロセスはサーバーから切り離して起動するので、サーバーを再起動しても作業は止まらない。

import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import type { InputSource, SessionMeta, SessionStatus, Trigger, TurnInput } from '../shared/types.ts';
import type { App } from './app.ts';
import { APP_DIR, internalUrl, ollamaEnv } from './config.ts';
import { buildSystemPrompt } from './head.ts';
import { sessionDir, turnFile } from './transcript.ts';
import { firstLine, isAlive, newId, nowIso, readText, truncate } from './util.ts';

/** 対話前提で、画面なしでは使えない（または頭の道具と役割が重なる）ツール */
const DISALLOWED_TOOLS = [
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'CronCreate',
  'CronDelete',
  'CronList',
  'ScheduleWakeup',
  'PushNotification',
  'RemoteTrigger',
];

/** 結果を出した後、この時間を過ぎても終わらなければ止める */
const LINGER_MS = 15_000;

interface Tail {
  turn: number;
  offset: number;
  rest: Buffer;
  exited: boolean;
  exitCode?: number | null;
  child?: ChildProcess;
  lastResult?: any;
  resultAt?: number;
  /** 直近のAPI再試行（結果を出さずに終わったときの原因の手がかり） */
  lastRetry?: any;
  /** サーバーが止まっている間に終わっていた（中断された）ターン */
  interrupted?: boolean;
}

export interface CreateSessionOptions {
  message: string;
  trigger: Trigger;
  source?: InputSource;
  modelId?: string;
  cwd?: string;
  title?: string;
  parentId?: string;
}

function resolveCommand(command: string[]): string[] {
  return command.map((c, i) => {
    if (i === 0 && c === 'node') return process.execPath;
    if (c.startsWith('./') || c.startsWith('../')) return path.resolve(APP_DIR, c);
    return c;
  });
}

/** 利用者が自分で設定しうる CLAUDE_* は残す */
const KEEP_ENV = new Set([
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_GIT_BASH_PATH',
]);

/**
 * サーバー自体が Claude Code の中から起動されていると、「Claude Code の中にいる」ことを示す
 * 環境変数が手にまで引き継がれてしまう。手は独立したセッションなので、それらを取り除く。
 */
export function handEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    const inherited = k === 'CLAUDECODE' || k === 'AI_AGENT' || (k.startsWith('CLAUDE_') && !KEEP_ENV.has(k));
    if (!inherited) env[k] = v;
  }
  return env;
}

function mergeInputs(inputs: TurnInput[]): TurnInput {
  if (inputs.length === 1) return inputs[0];
  const same = inputs.every((i) => i.source === inputs[0].source);
  return {
    text: inputs.map((i) => i.text).join('\n\n---\n\n'),
    source: same ? inputs[0].source : 'system',
    at: nowIso(),
  };
}

export class Runner {
  app: App;
  private tails = new Map<string, Tail>();

  constructor(app: App) {
    this.app = app;
  }

  start(): void {
    // 前回サーバーが止まったときに動いていた手を、もう一度追いかける
    for (const s of this.app.store.sessions) {
      if (s.status !== 'running') continue;
      this.tails.set(s.id, {
        turn: s.turns,
        offset: 0,
        rest: Buffer.alloc(0),
        exited: !(s.pid && isAlive(s.pid)),
        interrupted: !(s.pid && isAlive(s.pid)),
      });
    }
    setInterval(() => this.poll(), 500);
  }

  createSession(opts: CreateSessionOptions): SessionMeta {
    const { config, store } = this.app;
    const modelId = config.models.some((m) => m.id === opts.modelId) ? opts.modelId! : config.defaultModelId;
    const cwd = opts.cwd?.trim() ? path.resolve(opts.cwd.trim()) : config.defaultCwd;
    if (!fs.existsSync(cwd)) throw new Error(`作業フォルダが存在しない: ${cwd}`);
    const now = nowIso();
    const meta: SessionMeta = {
      id: newId(),
      title: opts.title?.trim() || firstLine(opts.message, 40) || '（無題）',
      modelId,
      cwd,
      trigger: opts.trigger,
      parentId: opts.parentId,
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      turns: 0,
      queue: [],
      digested: false,
    };
    store.addSession(meta);
    const source: InputSource =
      opts.source ?? (opts.trigger === 'wakeup' ? 'wakeup' : opts.trigger === 'session' ? 'session' : 'user');
    this.startTurn(meta, { text: opts.message, source, at: now, fromSessionId: opts.parentId });
    return meta;
  }

  /** セッションにメッセージを届ける。作業中なら、ターンが終わってから渡す */
  send(sessionId: string, input: TurnInput): 'started' | 'queued' {
    const { store } = this.app;
    const s = store.session(sessionId);
    if (!s) throw new Error(`セッションが見つからない: ${sessionId}`);
    if (s.status === 'running') {
      store.updateSession(s.id, { queue: [...s.queue, input] });
      return 'queued';
    }
    this.startTurn(s, input);
    return 'started';
  }

  stop(sessionId: string): void {
    const s = this.app.store.session(sessionId);
    if (!s || s.status !== 'running' || !s.pid) return;
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(s.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      try {
        process.kill(-s.pid, 'SIGTERM');
      } catch {
        try {
          process.kill(s.pid, 'SIGTERM');
        } catch {
          // もう終わっている
        }
      }
    }
    this.app.store.updateSession(s.id, { queue: [] });
  }

  private startTurn(meta: SessionMeta, input: TurnInput): void {
    const { config, store } = this.app;
    const turn = meta.turns + 1;
    fs.mkdirSync(sessionDir(config.dataDir, meta.id), { recursive: true });
    const f = (kind: Parameters<typeof turnFile>[3]) => turnFile(config.dataDir, meta.id, turn, kind);

    fs.writeFileSync(f('in.json'), JSON.stringify(input, null, 2));
    fs.writeFileSync(f('in.txt'), input.text);
    fs.writeFileSync(f('sys.md'), buildSystemPrompt(this.app, meta, turn, input));

    const mcpPath = path.join(sessionDir(config.dataDir, meta.id), 'mcp.json');
    fs.writeFileSync(
      mcpPath,
      JSON.stringify(
        {
          mcpServers: {
            atama: {
              type: 'stdio',
              command: process.execPath,
              args: ['--no-warnings', path.join(APP_DIR, 'server', 'mcp.ts')],
              env: { ATAMA_URL: internalUrl(config), ATAMA_SESSION_ID: meta.id, ATAMA_TOKEN: config.authToken },
            },
          },
        },
        null,
        2,
      ),
    );

    const model = config.models.find((m) => m.id === meta.modelId) ?? config.models[0];
    const [cmd, ...pre] = resolveCommand(model.command ?? ['claude']);
    const args = [
      ...pre,
      ...(model.ollama ? ['--model', model.ollama] : []),
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
      '--append-system-prompt-file',
      f('sys.md'),
      '--mcp-config',
      mcpPath,
      '--disallowedTools',
      DISALLOWED_TOOLS.join(','),
      '--forward-subagent-text',
      ...(turn === 1 ? ['--session-id', meta.id] : ['--resume', meta.id]),
      ...config.extraClaudeArgs,
    ];

    const tail: Tail = { turn, offset: 0, rest: Buffer.alloc(0), exited: false };
    const inFd = fs.openSync(f('in.txt'), 'r');
    const outFd = fs.openSync(f('out.jsonl'), 'a');
    const errFd = fs.openSync(f('err.txt'), 'a');
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, {
        cwd: meta.cwd,
        detached: true,
        stdio: [inFd, outFd, errFd],
        env: {
          ...handEnv(process.env),
          ...(model.ollama ? ollamaEnv(config.ollamaHost, model.ollama) : {}),
          ...model.env,
          ATAMA_SESSION_ID: meta.id,
        },
        windowsHide: true,
      });
    } finally {
      fs.closeSync(inFd);
      fs.closeSync(outFd);
      fs.closeSync(errFd);
    }
    child.unref();
    child.on('exit', (code) => {
      tail.exited = true;
      tail.exitCode = code;
    });
    child.on('error', (e) => {
      tail.exited = true;
      tail.exitCode = -1;
      fs.appendFileSync(f('err.txt'), `起動に失敗: ${cmd} ${e.message}\n`);
    });
    tail.child = child;
    this.tails.set(meta.id, tail);

    store.updateSession(meta.id, {
      turns: turn,
      status: 'running',
      pid: child.pid,
      lastError: undefined,
      digested: false,
    });
    this.app.emit({ type: 'turn-start', sessionId: meta.id, turn, input });
  }

  private poll(): void {
    for (const [id, tail] of this.tails) {
      const meta = this.app.store.session(id);
      if (!meta) {
        this.tails.delete(id);
        continue;
      }
      this.drain(meta, tail);
      if (!tail.exited && !tail.child && !(meta.pid && isAlive(meta.pid))) tail.exited = true;
      if (!tail.exited && tail.resultAt && Date.now() - tail.resultAt > LINGER_MS) {
        this.stop(id);
        tail.exited = true;
      }
      if (tail.exited) {
        this.drain(meta, tail);
        this.finish(meta, tail);
      }
    }
  }

  /** 出力ファイルに増えた分を読み、イベントとして画面へ流す */
  private drain(meta: SessionMeta, tail: Tail): void {
    let fd: number;
    try {
      fd = fs.openSync(turnFile(this.app.config.dataDir, meta.id, tail.turn, 'out.jsonl'), 'r');
    } catch {
      return;
    }
    try {
      const size = fs.fstatSync(fd).size;
      if (size <= tail.offset) return;
      const chunk = Buffer.alloc(size - tail.offset);
      fs.readSync(fd, chunk, 0, chunk.length, tail.offset);
      tail.offset = size;
      const data = Buffer.concat([tail.rest, chunk]);
      const nl = data.lastIndexOf(0x0a);
      if (nl < 0) {
        tail.rest = data;
        return;
      }
      tail.rest = Buffer.from(data.subarray(nl + 1));
      let thinking: any;
      for (const line of data.subarray(0, nl).toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        // 「考え中のトークン数」は大量に出るので、まとめて最後の1件だけ流す
        if (ev.type === 'system' && ev.subtype === 'thinking_tokens') {
          thinking = ev;
          continue;
        }
        if (ev.type === 'result') {
          tail.lastResult = ev;
          tail.resultAt = Date.now();
        }
        if (ev.type === 'system' && ev.subtype === 'api_retry') tail.lastRetry = ev;
        if (ev.type === 'system' && ev.subtype === 'post_turn_summary' && ev.status_detail) {
          this.app.store.updateSession(meta.id, { summary: String(ev.status_detail) }, false);
        }
        this.app.emit({ type: 'session-event', sessionId: meta.id, turn: tail.turn, event: ev });
      }
      if (thinking) this.app.emit({ type: 'session-event', sessionId: meta.id, turn: tail.turn, event: thinking });
    } finally {
      fs.closeSync(fd);
    }
  }

  private finish(meta: SessionMeta, tail: Tail): void {
    const { store, config, mind } = this.app;
    this.tails.delete(meta.id);
    const r = tail.lastResult;
    let status: SessionStatus = 'idle';
    let lastError: string | undefined;
    if (r?.is_error) {
      status = 'error';
      lastError = String(r.result ?? r.subtype ?? 'エラー');
    } else if (!r) {
      status = 'error';
      const retry = tail.lastRetry
        ? `APIエラーで止まった（${tail.lastRetry.error_status ?? ''} ${tail.lastRetry.error ?? ''}）`
        : '';
      const err = readText(turnFile(config.dataDir, meta.id, tail.turn, 'err.txt')).trim();
      const reason = retry || err || `結果を返さずに終了した（終了コード ${tail.exitCode ?? '不明'}）`;
      lastError = truncate(tail.interrupted ? `サーバーの再起動で中断された（${reason}）` : reason, 2000);
    }
    store.updateSession(meta.id, {
      status,
      pid: undefined,
      activity: undefined,
      lastError,
      lastCostUsd: r?.total_cost_usd,
      digested: false,
    });
    void mind.backup(`${meta.title}（ターン${tail.turn}）`);

    const s = store.session(meta.id);
    if (s && s.queue.length) {
      const queued = s.queue;
      store.updateSession(s.id, { queue: [] });
      this.startTurn(s, mergeInputs(queued));
    }
  }
}
