// セッション（Claude Code）を動かす。1ターンごとに Agent SDK の query() を1回呼ぶ。
// ターンの前に記憶から思い出したことを添え、ターンが終わったらその体験を記憶に渡す。

import fs from 'node:fs';
import path from 'node:path';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import type { EffortLevel, InputSource, SessionMeta, SessionStatus, Trigger, TurnInput } from '../shared/types.ts';
import type { App } from './app.ts';
import { ollamaEnv } from './config.ts';
import { buildSystemPrompt } from './head.ts';
import { stopNudge } from './hooks.ts';
import { createTools } from './tools.ts';
import { readTurn, readTurns, sessionDir, turnFile, turnsToText } from './transcript.ts';
import { firstLine, newId, nowIso } from './util.ts';

/** 画面の無い実行では使えない（またはこの仕組みの道具と役割が重なる）標準の道具 */
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

/** サーバー自体が Claude Code の中から起動されたときに漏れてくる環境変数を取り除く */
export function handEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    const inherited = k === 'CLAUDECODE' || k === 'AI_AGENT' || (k.startsWith('CLAUDE_') && !KEEP_ENV.has(k));
    if (!inherited && v !== undefined) env[k] = v;
  }
  return env;
}

export interface CreateSessionOptions {
  message: string;
  trigger: Trigger;
  source?: InputSource;
  modelId?: string;
  cwd?: string;
  title?: string;
  parentId?: string;
  /** Claude のモデルのときだけ効く */
  effort?: EffortLevel;
}

function mergeInputs(inputs: TurnInput[]): TurnInput {
  if (inputs.length === 1) return inputs[0];
  const same = inputs.every((i) => i.source === inputs[0].source);
  return { text: inputs.map((i) => i.text).join('\n\n---\n\n'), source: same ? inputs[0].source : 'system', at: nowIso() };
}

export class Runner {
  app: App;
  private active = new Map<string, AbortController>();
  /** 動いているターンの Claude Code。エフォートの切り替えなど、途中で指示を送るのに使う */
  private live = new Map<string, Query>();
  private restartReason: string | null = null;

  constructor(app: App) {
    this.app = app;
  }

  start(): void {
    const { store, config } = this.app;
    for (const s of store.sessions) {
      // 読みやすい記録が無い古いセッションの分を作っておく
      const file = path.join(sessionDir(config.dataDir, s.id), 'transcript.md');
      if (s.turns > 0 && !fs.existsSync(file)) this.writeTranscript(s);
      // サーバーが止まったときに動いていたターンは、そこで途切れている
      if (s.status === 'running') store.updateSession(s.id, { status: 'error', lastError: 'サーバーの再起動で中断された' });
    }
    // 再起動を待つ間に届いたメッセージ（目覚ましなど）を、ここで渡す
    for (const s of store.sessions) {
      const queued = s.queue;
      if (!queued.length) continue;
      store.updateSession(s.id, { queue: [] });
      this.startTurn(s, mergeInputs(queued));
    }
  }

  createSession(opts: CreateSessionOptions): SessionMeta {
    const { config, store } = this.app;
    const modelId = config.models.some((m) => m.id === opts.modelId) ? opts.modelId! : config.defaultModelId;
    const cwd = opts.cwd?.trim() ? path.resolve(opts.cwd.trim()) : config.defaultCwd;
    if (!fs.existsSync(cwd)) throw new Error(`作業フォルダが存在しない: ${cwd}`);
    // エフォートは Claude のモデルのときだけ持たせる
    const isClaude = config.models.find((m) => m.id === modelId)?.claude !== undefined;
    const now = nowIso();
    const meta = store.addSession({
      id: newId(),
      title: opts.title?.trim() || firstLine(opts.message, 40) || '（無題）',
      modelId,
      cwd,
      effort: isClaude ? opts.effort : undefined,
      trigger: opts.trigger,
      parentId: opts.parentId,
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      turns: 0,
      queue: [],
    });
    const source: InputSource = opts.source ?? (opts.trigger === 'wakeup' ? 'wakeup' : opts.trigger === 'session' ? 'session' : 'user');
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
    this.app.store.updateSession(sessionId, { queue: [] });
    this.active.get(sessionId)?.abort();
  }

  /** 考える量を変える。動いている最中なら、そのターンの途中から切り替える（次のターンにも持ち越す） */
  setEffort(sessionId: string, effort: EffortLevel | null): SessionMeta {
    const { store } = this.app;
    const s = store.session(sessionId);
    if (!s) throw new Error(`セッションが見つからない: ${sessionId}`);
    const updated = store.updateSession(s.id, { effort: effort ?? undefined }, false);
    void this.live.get(s.id)?.applyFlagSettings({ effortLevel: effort }).catch(() => {});
    return updated;
  }

  /** 動いているセッションが全部区切りに来たら再起動する（systemd が起こし直す） */
  restartWhenIdle(reason: string): void {
    this.restartReason = reason;
    this.maybeRestart();
  }

  private maybeRestart(): void {
    if (this.restartReason === null || this.active.size) return;
    console.log(`[allama] 再起動する: ${this.restartReason}`);
    setTimeout(() => process.exit(0), 500);
  }

  private startTurn(meta: SessionMeta, input: TurnInput): void {
    const { config, store } = this.app;
    // 再起動が決まったあとは新しいターンを始めない（途中で切れてしまう）。待たせて、起き直してから渡す
    if (this.restartReason !== null) {
      store.updateSession(meta.id, { queue: [...(store.session(meta.id)?.queue ?? []), input] });
      return;
    }
    const turn = meta.turns + 1;
    fs.mkdirSync(sessionDir(config.dataDir, meta.id), { recursive: true });
    fs.writeFileSync(turnFile(config.dataDir, meta.id, turn, 'in.json'), JSON.stringify(input, null, 2));
    const abort = new AbortController();
    this.active.set(meta.id, abort);
    store.updateSession(meta.id, { turns: turn, status: 'running', lastError: undefined });
    this.app.emit({ type: 'turn-start', sessionId: meta.id, turn, input });
    void this.runTurn(meta, input, turn, abort);
  }

  private async runTurn(meta: SessionMeta, input: TurnInput, turn: number, abort: AbortController): Promise<void> {
    const { config, store, memory } = this.app;
    const f = (kind: Parameters<typeof turnFile>[3]) => turnFile(config.dataDir, meta.id, turn, kind);
    const model = config.models.find((m) => m.id === meta.modelId) ?? config.models[0];
    // ターンの途中で変えられているかもしれないので、いまの値を引き直す
    const effort = store.session(meta.id)?.effort;
    let result: any;
    let lastRetry: any;
    let error: string | undefined;
    const out = fs.openSync(f('out.jsonl'), 'a');
    try {
      // 思い出す：このメッセージを手がかりに、関係する記憶を添える
      const recalled = await memory.recallFor(input.text);
      const system = buildSystemPrompt(this.app, recalled);
      fs.writeFileSync(f('sys.md'), system);

      const q = query({
        prompt: input.text,
        options: {
          cwd: meta.cwd,
          model: model.ollama ?? (model.claude || undefined),
          // 考える量。Claude のモデルのときだけ渡す（Ollama には意味が無い）
          ...(model.claude !== undefined && effort ? { effort } : {}),
          ...(turn === 1 ? { sessionId: meta.id } : { resume: meta.id }),
          systemPrompt: { type: 'preset', preset: 'claude_code', append: system },
          mcpServers: { allama: createTools(this.app, meta.id) },
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          disallowedTools: DISALLOWED_TOOLS,
          // ターンの終わりに一度だけ止めて、届け忘れが無いか確かめさせる
          hooks: stopNudge(meta.id),
          settingSources: ['user', 'project', 'local'],
          // 記憶はこの仕組みが担う。Claude Code 自身の自動メモリ（Markdown のメモ）とその整理は使わない
          settings: { autoMemoryEnabled: false, autoDreamEnabled: false },
          forwardSubagentText: true,
          abortController: abort,
          env: { ...handEnv(process.env), ...(model.ollama ? ollamaEnv(config.ollamaHost, model.ollama) : {}) },
          stderr: (d) => fs.appendFileSync(f('err.txt'), d),
        },
      });
      this.live.set(meta.id, q);
      for await (const msg of q) {
        const ev = msg as any;
        // 「考え中のトークン数」は大量に出るので、画面に流すだけで残さない
        if (!(ev.type === 'system' && ev.subtype === 'thinking_tokens')) fs.writeSync(out, `${JSON.stringify(ev)}\n`);
        if (ev.type === 'result') result = ev;
        // Claude の契約で使える量の残りが届いたら、覚えておく
        if (ev.type === 'rate_limit_event') store.setRateLimit(ev.rate_limit_info ?? {});
        if (ev.type === 'system' && ev.subtype === 'api_retry') lastRetry = ev;
        if (ev.type === 'system' && ev.subtype === 'post_turn_summary' && ev.status_detail) {
          store.updateSession(meta.id, { summary: String(ev.status_detail) }, false);
        }
        this.app.emit({ type: 'session-event', sessionId: meta.id, turn, event: ev });
      }
    } catch (e) {
      error = abort.signal.aborted ? '止めた' : (e as Error).message;
    } finally {
      fs.closeSync(out);
      this.active.delete(meta.id);
      this.live.delete(meta.id);
    }

    let status: SessionStatus = 'idle';
    let lastError: string | undefined;
    if (result?.is_error) {
      status = 'error';
      lastError = String(result.result ?? result.subtype ?? 'エラー');
    } else if (!result) {
      status = 'error';
      lastError = error ?? (lastRetry ? `APIエラーで止まった（${lastRetry.error_status ?? ''} ${lastRetry.error ?? ''}）` : '結果を返さずに終わった');
    }
    store.updateSession(meta.id, { status, lastError, lastCostUsd: result?.total_cost_usd });

    const s = store.session(meta.id)!;
    this.writeTranscript(s);
    // 覚える：このターンの体験を記憶に渡す（裏で順番に処理される）
    void memory.encodeTurn(meta.id, readTurn(config.dataDir, meta.id, turn));

    if (s.queue.length) {
      const queued = s.queue;
      store.updateSession(s.id, { queue: [] });
      this.startTurn(s, mergeInputs(queued));
    }
    this.maybeRestart();
  }

  /** Grep や Read で読み返せる、読みやすい形の記録 */
  private writeTranscript(s: SessionMeta): void {
    const { dataDir } = this.app.config;
    fs.writeFileSync(path.join(sessionDir(dataDir, s.id), 'transcript.md'), `# ${s.title}\n${turnsToText(readTurns(dataDir, s))}\n`);
  }
}
