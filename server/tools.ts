// セッションから使う、この仕組みの道具（サーバーの中に置く MCP サーバー）と、タスク画面からの返事の処理。
// Claude Code の標準の道具ではできないことだけを置く：人に届ける・残り続けるセッション・目覚まし・思い出す・仕組みの再起動。

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Task, TaskKind } from '../shared/types.ts';
import type { App } from './app.ts';
import { Memory } from './memory/index.ts';
import { checkBody } from './self.ts';
import { attachmentNames, checkFiles, withAttachments } from './uploads.ts';
import { formatTime, nowIso, shortId } from './util.ts';

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });

function parseTime(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`時刻の形式が不正: ${s}`);
  return new Date(ms).toISOString();
}

/** あるセッションのための道具一式 */
export function createTools(app: App, sessionId: string) {
  const { store, runner, config, memory } = app;
  const me = () => store.session(sessionId)!;
  const t = (iso: string) => formatTime(iso, config.timezone);

  const addTask = (kind: TaskKind, title: string, body?: string, extra: Partial<Task> = {}) => {
    const now = nowIso();
    return store.addTask({
      id: shortId(),
      sessionId,
      kind,
      title: title.trim(),
      body: body?.trim() || undefined,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
  };

  return createSdkMcpServer({
    name: 'allama',
    version: '0.2.0',
    tools: [
      // ---- 人に届ける（タスク画面に載る） ----
      tool(
        'ask_user',
        '画面の向こうの人に質問する。タスク画面に載り、その人がこのセッションを見ていなくても届く。返事はこのセッションへのメッセージとして届く。',
        {
          question: z.string().describe('質問（短く）'),
          detail: z.string().optional().describe('補足。Markdown可'),
          options: z.array(z.string()).optional().describe('選択肢（任意）。自由回答もできる'),
        },
        async (a) => {
          const task = addTask('question', a.question, a.detail, { options: a.options?.length ? a.options : undefined });
          return text(`タスク画面に質問を載せた（task_id=${task.id}）。返事はこのセッションへのメッセージとして届く。`);
        },
      ),
      tool(
        'propose',
        '「これをやろうか？」という提案をタスク画面に載せる。「やって／やめて」とコメントが、このセッションに届く。',
        { title: z.string().describe('提案（短く）'), detail: z.string().optional().describe('中身。Markdown可') },
        async (a) => text(`タスク画面に提案を載せた（task_id=${addTask('proposal', a.title, a.detail).id}）。`),
      ),
      tool(
        'report',
        '報告をタスク画面に載せる。その人がコメントを書いたときだけ、このセッションに届く。',
        { title: z.string().describe('報告（短く）'), detail: z.string().optional().describe('詳細。Markdown可') },
        async (a) => text(`タスク画面に報告を載せた（task_id=${addTask('report', a.title, a.detail).id}）。`),
      ),
      tool(
        'add_user_todo',
        'その人自身がやるべきことを、タスク画面の「あなたのToDo」に載せる。このセッションの作業の段取り（TaskCreate など）とは別物。',
        {
          title: z.string().describe('やること'),
          detail: z.string().optional().describe('補足'),
          due: z.string().optional().describe('期限（ISO 8601。例: 2026-10-01T18:00:00+09:00）'),
        },
        async (a) => text(`ToDoを載せた（task_id=${addTask('todo', a.title, a.detail, { due: parseTime(a.due) }).id}）。`),
      ),

      // ---- 思い出す ----
      tool(
        'remember',
        '記憶をわざと探して思い出す。意味の近さと言葉の一致で探す。自然には浮かばなくなった薄れた記憶や、新しいことに置き換えられた古い記憶も見つかる。',
        {
          query: z.string().describe('思い出したいこと'),
          kind: z.enum(['episode', 'fact', 'procedure', 'reflection']).optional().describe('記憶の種類で絞る（任意）'),
          limit: z.number().optional().describe('最大件数（既定15）'),
        },
        async (a) => {
          const items = await memory.search(a.query, { limit: a.limit ?? 15, kind: a.kind, touch: true });
          if (!items.length) return text('思い出せなかった。');
          return text(
            items
              .map((m) => `${Memory.format([m], config.timezone)}${m.supersededBy ? '（以前のこと。今は置き換えられている）' : ''}`)
              .join('\n'),
          );
        },
      ),

      // ---- 残り続けるセッション ----
      tool(
        'start_session',
        '新しいセッションを始めて、並行して進める。Agent（サブエージェント）と違い、このターンが終わっても残り続け、セッション画面に並び、あとから続きを頼める。',
        {
          prompt: z.string().describe('そのセッションに渡すメッセージ'),
          title: z.string().optional().describe('題名'),
          cwd: z.string().optional().describe('作業フォルダ（絶対パス。省略時は既定）'),
          model_id: z.string().optional().describe('モデルID（省略時は既定）'),
        },
        async (a) => {
          const s = runner.createSession({
            message: `【セッション「${me().title}」（id=${sessionId}）から】\n${a.prompt}`,
            title: a.title,
            cwd: a.cwd,
            modelId: a.model_id,
            trigger: 'session',
            parentId: sessionId,
          });
          return text(`新しいセッションを始めた（session_id=${s.id}、題名「${s.title}」）。`);
        },
      ),
      tool(
        'send_to_session',
        'この仕組みの別のセッションにメッセージを送る（SendMessage はサブエージェント用で、こちらとは別物）。相手が作業中なら、区切りがついたときに届く。',
        { session_id: z.string().describe('セッションID'), message: z.string().describe('メッセージ') },
        async (a) => {
          const target = store.session(a.session_id);
          if (!target) return fail(`セッションが見つからない: ${a.session_id}`);
          if (target.id === sessionId) return fail('自分自身には送れない');
          const r = runner.send(target.id, {
            text: `【別のセッション「${me().title}」（id=${sessionId}）から】\n${a.message}`,
            source: 'session',
            at: nowIso(),
            fromSessionId: sessionId,
          });
          return text(r === 'queued' ? '相手は作業中なので、区切りがついたら届く。' : '届けた（相手が動き出した）。');
        },
      ),

      // ---- 時間 ----
      tool(
        'schedule_wakeup',
        '指定の時刻に起こしてもらう。このセッションが終わっていても鳴る。session_id を指定するとそのセッションの続きとして、省略すると新しいセッションとして起きる。',
        {
          prompt: z.string().describe('起きたときに届くメッセージ'),
          at: z.string().optional().describe('時刻（ISO 8601）'),
          in_minutes: z.number().optional().describe('今から何分後か（at の代わり）'),
          every_minutes: z.number().min(5).optional().describe('繰り返す間隔（分、5以上）。省略すると1回きり'),
          session_id: z.string().optional().describe('続きとして起こすセッション（任意）'),
          model_id: z.string().optional().describe('新しいセッションのモデル（任意）'),
        },
        async (a) => {
          if (!a.at === !a.in_minutes) return fail('at か in_minutes のどちらか一方だけを指定する');
          if (a.session_id && !store.session(a.session_id)) return fail(`セッションが見つからない: ${a.session_id}`);
          const at = a.at ? parseTime(a.at)! : new Date(Date.now() + a.in_minutes! * 60_000).toISOString();
          // 過去の時刻だとすぐに鳴ってしまう。時刻の計算違いのことが多いので、今の時刻を添えて返す
          if (Date.parse(at) < Date.now() - 60_000) return fail(`過去の時刻になっている: ${t(at)}（今は ${t(nowIso())}）`);
          const w = store.addWakeup({
            id: shortId(),
            at,
            prompt: a.prompt,
            everyMinutes: a.every_minutes,
            sessionId: a.session_id ? store.session(a.session_id)!.id : undefined,
            modelId: a.model_id,
            createdBy: sessionId,
            createdAt: nowIso(),
          });
          return text(`目覚ましを予定した: ${t(w.at)}${w.everyMinutes ? `（${w.everyMinutes}分ごと）` : ''}（wakeup_id=${w.id}）`);
        },
      ),
      tool('list_wakeups', '予定している目覚ましの一覧を見る。', {}, async () => {
        const ws = [...store.wakeups].sort((x, y) => x.at.localeCompare(y.at));
        if (!ws.length) return text('予定している目覚ましは無い。');
        return text(
          ws
            .map((w) => `- ${t(w.at)}${w.everyMinutes ? `（${w.everyMinutes}分ごと）` : ''} ／ wakeup_id=${w.id}\n  ${w.prompt.replace(/\n/g, '\n  ')}`)
            .join('\n'),
        );
      }),
      tool('cancel_wakeup', '目覚ましを取り消す。', { wakeup_id: z.string().describe('目覚ましID') }, async (a) =>
        text(store.removeWakeup(a.wakeup_id) ? '取り消した。' : 'その目覚ましは無い。'),
      ),

      // ---- 仕組み ----
      tool(
        'restart_self',
        'この仕組みのソースコードを書き換えたあと、変更を反映するために仕組みを再起動する。型チェック・画面のビルド・読み込みの確認がすべて通ったときだけ、動いているすべてのセッションが区切りに来たところで再起動する（このセッションもこのターンを終えてから）。',
        { reason: z.string().describe('何を変えたか（ログに残る）') },
        async (a) => {
          const r = await checkBody();
          if (!r.ok) return fail(`確認に失敗したので再起動しない。直してからもう一度呼んで。\n${r.log}`);
          runner.restartWhenIdle(a.reason);
          return text(`確認が通った。動いているセッションが区切りに来たら再起動する。\n${r.log}`);
        },
      ),
    ],
  });
}

export interface AnswerBody {
  action?: 'answer' | 'approve' | 'reject' | 'ack' | 'done';
  text?: string;
  /** 画面から預かったファイルのパス */
  files?: string[];
}

/** タスク画面からの返事。必要ならタスクに紐づくセッションへメッセージを送る */
export function answerTask(app: App, taskId: string, body: AnswerBody): Task {
  const { store, runner } = app;
  const task = store.task(taskId);
  if (!task) throw new Error('タスクが見つからない');
  if (task.status === 'done') throw new Error('このタスクはもう閉じている');
  const t = body.text?.trim() ?? '';
  const files = checkFiles(app.config, body.files);
  const names = attachmentNames(files);
  let answer: string;
  let message: string | undefined;

  switch (task.kind) {
    case 'question':
      if (!t && !files.length) throw new Error('返事を入力して');
      answer = t || `添付: ${names}`;
      message = withAttachments(`【タスク画面からの返事】\n質問: ${task.title}\n返事: ${answer}`, files);
      break;
    case 'proposal': {
      const verdict = body.action === 'reject' ? 'やめておいて' : 'やって';
      answer = verdict + (t ? `（${t}）` : '');
      message = withAttachments(
        `【提案への返事】\n提案: ${task.title}\n返事: ${verdict}${t ? `\nコメント: ${t}` : ''}`,
        files,
      );
      break;
    }
    case 'report':
      answer = t || '確認した';
      if (t || files.length) message = withAttachments(`【報告への返事】\n報告: ${task.title}\n返事: ${answer}`, files);
      break;
    case 'todo':
      answer = t || '完了';
      if (t || files.length)
        message = withAttachments(`【ToDoについて】\nToDo: ${task.title}\n完了した。${t ? `コメント: ${t}` : ''}`, files);
      break;
  }

  const updated = store.updateTask(task.id, { status: 'done', answer, closedAt: nowIso() });
  if (message && store.session(task.sessionId)) {
    runner.send(task.sessionId, { text: `${message}\n（task_id=${task.id}）`, source: 'answer', at: nowIso() });
  }
  return updated;
}
