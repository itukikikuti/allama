// 頭の道具の中身と、タスク画面からの返事の処理

import type { Task, TaskKind } from '../shared/types.ts';
import type { App } from './app.ts';
import { checkBody, restartSoon } from './self.ts';
import { formatTime, nowIso, shortId } from './util.ts';

function addTask(
  app: App,
  sessionId: string,
  kind: TaskKind,
  title: string,
  body?: string,
  extra: Partial<Task> = {},
): Task {
  if (!title?.trim()) throw new Error('title（または question）が空');
  const now = nowIso();
  return app.store.addTask({
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
}

function parseTime(s: string | undefined, label: string): string | undefined {
  if (!s) return undefined;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`${label} の形式が不正: ${s}`);
  return new Date(ms).toISOString();
}

export async function callTool(app: App, sessionId: string, name: string, a: any): Promise<string> {
  const { store, runner, config } = app;
  const me = store.session(sessionId);
  if (!me) throw new Error(`呼び出し元のセッションが不明: ${sessionId}`);
  const t = (iso: string) => formatTime(iso, config.timezone);
  const titleOf = (id: string) => store.session(id)?.title ?? '?';
  a = a ?? {};

  switch (name) {
    case 'ask_user': {
      const options = Array.isArray(a.options) ? a.options.map(String).filter(Boolean) : undefined;
      const task = addTask(app, me.id, 'question', a.question, a.detail, { options: options?.length ? options : undefined });
      return `タスク画面に質問を載せた（task_id=${task.id}）。返事はこのセッションへのメッセージとして届く。返事が無いと進めないなら、ここでいったん手を止めていい。`;
    }
    case 'propose': {
      const task = addTask(app, me.id, 'proposal', a.title, a.detail);
      return `タスク画面に提案を載せた（task_id=${task.id}）。返事はこのセッションに届く。`;
    }
    case 'report': {
      const task = addTask(app, me.id, 'report', a.title, a.detail);
      return `タスク画面に報告を載せた（task_id=${task.id}）。`;
    }
    case 'add_user_todo': {
      const task = addTask(app, me.id, 'todo', a.title, a.detail, { due: parseTime(a.due, 'due') });
      return `ToDoを載せた（task_id=${task.id}）。`;
    }
    case 'start_session': {
      const s = runner.createSession({
        message: `【セッション「${me.title}」（id=${me.id}）から】\n${a.prompt}`,
        title: a.title,
        cwd: a.cwd,
        modelId: a.model_id,
        trigger: 'session',
        parentId: me.id,
      });
      return `新しいセッションを始めた（session_id=${s.id}、題名「${s.title}」）。`;
    }
    case 'send_to_session': {
      const target = store.session(a.session_id);
      if (!target) throw new Error(`セッションが見つからない: ${a.session_id}`);
      if (target.id === me.id) throw new Error('自分自身には送れない');
      const r = runner.send(target.id, {
        text: `【別のセッション「${me.title}」（id=${me.id}）から】\n${a.message}`,
        source: 'session',
        at: nowIso(),
        fromSessionId: me.id,
      });
      return r === 'queued' ? '相手は作業中なので、区切りがついたら届く。' : '届けた（相手が動き出した）。';
    }
    case 'schedule_wakeup': {
      const at = a.at
        ? parseTime(a.at, 'at')!
        : new Date(Date.now() + (Number(a.in_minutes) || 0) * 60_000).toISOString();
      if (!a.at && !a.in_minutes) throw new Error('at か in_minutes のどちらかが必要');
      if (a.session_id && !store.session(a.session_id)) throw new Error(`セッションが見つからない: ${a.session_id}`);
      const every = Number(a.every_minutes) || undefined;
      if (every !== undefined && every < 5) throw new Error('every_minutes は5分以上にして');
      const w = store.addWakeup({
        id: shortId(),
        at,
        prompt: String(a.prompt ?? ''),
        everyMinutes: every,
        sessionId: a.session_id ? store.session(a.session_id)!.id : undefined,
        modelId: a.model_id,
        createdBy: me.id,
        createdAt: nowIso(),
      });
      return `目覚ましを予定した: ${t(w.at)}${every ? `（${every}分ごと）` : ''}（wakeup_id=${w.id}）`;
    }
    case 'list_wakeups': {
      const ws = [...store.wakeups].sort((x, y) => x.at.localeCompare(y.at));
      if (!ws.length) return '予定している目覚ましは無い。';
      return ws
        .map(
          (w) =>
            `- ${t(w.at)}${w.everyMinutes ? `（${w.everyMinutes}分ごと）` : ''} ／ wakeup_id=${w.id}` +
            (w.sessionId ? ` ／ 続き: 「${titleOf(w.sessionId)}」` : '') +
            `\n  ${w.prompt.replace(/\n/g, '\n  ')}`,
        )
        .join('\n');
    }
    case 'restart_self': {
      const r = await checkBody();
      if (!r.ok) return `確認に失敗したので再起動しない。直してからもう一度呼んで。\n${r.log}`;
      console.log(`[allama] 自分を再起動する: ${a.reason ?? ''}`);
      restartSoon();
      return `確認が通ったので、数秒後に再起動する（動いているセッションは止まらない。その間、道具は数秒使えない）。\n${r.log}`;
    }
    case 'cancel_wakeup':
      return store.removeWakeup(String(a.wakeup_id ?? '')) ? '取り消した。' : 'その目覚ましは無い。';
  }
  throw new Error(`知らない道具: ${name}`);
}

export interface AnswerBody {
  action?: 'answer' | 'approve' | 'reject' | 'ack' | 'done';
  text?: string;
}

/** タスク画面からの返事。必要ならタスクに紐づくセッションへメッセージを送る */
export function answerTask(app: App, taskId: string, body: AnswerBody): Task {
  const { store, runner } = app;
  const task = store.task(taskId);
  if (!task) throw new Error('タスクが見つからない');
  if (task.status === 'done') throw new Error('このタスクはもう閉じている');
  const text = body.text?.trim() ?? '';
  let answer: string;
  let message: string | undefined;

  switch (task.kind) {
    case 'question':
      if (!text) throw new Error('返事を入力して');
      answer = text;
      message = `【タスク画面からの返事】\n質問: ${task.title}\n返事: ${text}`;
      break;
    case 'proposal': {
      const verdict = body.action === 'reject' ? 'やめておいて' : 'やって';
      answer = verdict + (text ? `（${text}）` : '');
      message = `【提案への返事】\n提案: ${task.title}\n返事: ${verdict}${text ? `\nコメント: ${text}` : ''}`;
      break;
    }
    case 'report':
      answer = text || '確認した';
      if (text) message = `【報告への返事】\n報告: ${task.title}\n返事: ${text}`;
      break;
    case 'todo':
      answer = text || '完了';
      if (text) message = `【ToDoについて】\nToDo: ${task.title}\n完了した。コメント: ${text}`;
      break;
  }

  const updated = store.updateTask(task.id, { status: 'done', answer, closedAt: nowIso() });
  if (message && store.session(task.sessionId)) {
    runner.send(task.sessionId, { text: `${message}\n（task_id=${task.id}）`, source: 'answer', at: nowIso() });
  }
  return updated;
}
