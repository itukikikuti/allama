import { useState, type ReactNode } from 'react';
import {
  Activity,
  AlarmClock,
  AlarmClockOff,
  BookOpen,
  Bot,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  ClipboardCheck,
  Clock,
  Eye,
  FilePen,
  FilePlus,
  FileText,
  FolderSearch,
  Globe,
  Hand,
  History,
  Inbox,
  Layers,
  Lightbulb,
  ListTodo,
  Loader2,
  MessageCircleQuestion,
  NotebookPen,
  Pencil,
  Plug,
  Search,
  Send,
  Sparkles,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Item, ToolCall } from './build.ts';
import { Diff } from '../components/Diff.tsx';
import { ContentImages, Output, contentText } from '../components/Output.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { cx, dateTime, langFromPath, shortPath } from '../util.ts';

interface Desc {
  icon: LucideIcon;
  label: string;
  summary?: string;
  head?: boolean;
  /** コマンドやパスなど、等幅で見せるもの */
  mono?: boolean;
}

type HeadDesc = [LucideIcon, string, (i: any) => string | undefined];

/** 頭の道具（ユーザーとのやり取りや記憶）は目立たせる */
const HEAD_TOOLS: Record<string, HeadDesc> = {
  ask_user: [MessageCircleQuestion, '質問した', (i) => i.question],
  propose: [Lightbulb, '提案した', (i) => i.title],
  report: [ClipboardCheck, '報告した', (i) => i.title],
  add_user_todo: [ListTodo, 'ユーザーのToDoに追加', (i) => i.title],
  list_tasks: [Inbox, 'タスクを確認', () => undefined],
  close_task: [CircleCheck, 'タスクを閉じた', (i) => i.note ?? i.task_id],
  set_activity: [Activity, '今やっていること', (i) => i.text],
  set_title: [Pencil, '題名を変えた', (i) => i.title],
  list_sessions: [Layers, '手の様子を見た', () => undefined],
  start_session: [Hand, '新しい手を出した', (i) => i.title ?? i.prompt],
  send_to_session: [Send, '別の手に連絡', (i) => i.message],
  list_models: [Layers, 'モデルを確認', () => undefined],
  recall: [History, '思い出す', (i) => i.query],
  read_session: [BookOpen, '記録を読み返す', (i) => i.session_id],
  mark_digested: [NotebookPen, '記憶に整理した', (i) => `${i.session_ids?.length ?? 0}件`],
  schedule_wakeup: [
    AlarmClock,
    '目覚ましをセット',
    (i) => [i.at ? dateTime(i.at) : i.in_minutes ? `${i.in_minutes}分後` : '', i.prompt].filter(Boolean).join(' ／ '),
  ],
  list_wakeups: [Clock, '目覚ましを確認', () => undefined],
  cancel_wakeup: [AlarmClockOff, '目覚ましを取り消し', (i) => i.wakeup_id],
};

const firstString = (i: any): string | undefined => {
  if (!i || typeof i !== 'object') return undefined;
  const v = Object.values(i).find((x) => typeof x === 'string');
  return v as string | undefined;
};

const isAgent = (c: ToolCall) => c.name === 'Agent' || c.name === 'Task';

export function describe(call: ToolCall): Desc {
  const i = call.input ?? {};
  const mcp = call.name.match(/^mcp__(.+?)__(.+)$/);
  if (mcp) {
    const h = mcp[1] === 'allama' ? HEAD_TOOLS[mcp[2]] : undefined;
    if (h) return { icon: h[0], label: h[1], summary: h[2](i), head: true };
    return { icon: Plug, label: `${mcp[1]}: ${mcp[2]}`, summary: firstString(i) };
  }
  const inPath = i.path ? ` （${shortPath(i.path, 2)}）` : '';
  switch (call.name) {
    case 'Bash':
    case 'PowerShell':
      return { icon: Terminal, label: call.name === 'Bash' ? 'コマンド' : 'PowerShell', summary: i.description || i.command, mono: !i.description };
    case 'Read':
      return { icon: FileText, label: '読んだ', summary: shortPath(i.file_path) + (i.offset ? `（${i.offset}行目〜）` : ''), mono: true };
    case 'Write':
      return { icon: FilePlus, label: '書いた', summary: shortPath(i.file_path), mono: true };
    case 'Edit':
    case 'MultiEdit':
      return { icon: FilePen, label: '編集した', summary: shortPath(i.file_path), mono: true };
    case 'NotebookEdit':
      return { icon: FilePen, label: 'ノートブック編集', summary: shortPath(i.notebook_path), mono: true };
    case 'Glob':
      return { icon: FolderSearch, label: 'ファイルを探した', summary: `${i.pattern ?? ''}${inPath}`, mono: true };
    case 'Grep':
      return { icon: Search, label: '検索した', summary: `${i.pattern ?? ''}${inPath}`, mono: true };
    case 'WebFetch':
      return { icon: Globe, label: 'ページを読んだ', summary: i.url, mono: true };
    case 'WebSearch':
      return { icon: Globe, label: 'Web検索', summary: i.query };
    case 'Agent':
    case 'Task':
      return { icon: Bot, label: 'サブエージェント', summary: i.description };
    case 'TaskOutput':
      return { icon: Bot, label: 'サブエージェントを待った' };
    case 'TaskCreate':
      return { icon: ListTodo, label: 'タスクを作った', summary: i.subject };
    case 'TaskUpdate':
      return { icon: ListTodo, label: 'タスクを更新', summary: i.subject ?? i.status };
    case 'TaskList':
    case 'TaskGet':
      return { icon: ListTodo, label: 'タスクを確認' };
    case 'Skill':
      return { icon: Sparkles, label: 'スキル', summary: i.skill };
    case 'ToolSearch':
      return { icon: Wrench, label: 'ツールを探した', summary: i.query };
    case 'SendMessage':
      return { icon: Send, label: 'メッセージ', summary: i.summary ?? i.to };
    case 'Monitor':
      return { icon: Eye, label: '見張り', summary: i.description };
    default:
      return { icon: Wrench, label: call.name, summary: firstString(i) };
  }
}

function resultState(call: ToolCall): 'running' | 'done' | 'error' {
  if (call.result?.isError) return 'error';
  if (isAgent(call)) {
    if (call.agent?.status) return call.agent.status === 'completed' ? 'done' : 'error';
    const t = call.result ? contentText(call.result.content) : '';
    return call.result && !/^Async agent launched/i.test(t) ? 'done' : 'running';
  }
  return call.result ? 'done' : 'running';
}

export function ToolCallView({ call, live, renderItems }: { call: ToolCall; live: boolean; renderItems: (items: Item[], live: boolean) => ReactNode }) {
  const [open, setOpen] = useState(false);
  if (call.name === 'TodoWrite' && Array.isArray(call.input?.todos)) return <TodoCard todos={call.input.todos} />;

  const d = describe(call);
  const state = resultState(call);
  const spinning = state === 'running' && live;
  const Icon = d.icon;
  const agentSteps = isAgent(call) ? call.children.filter((c) => c.kind === 'tool').length : 0;

  return (
    <div className={cx('tool', d.head && 'tool-head', state === 'error' && 'is-error', open && 'open')}>
      <button type="button" className="tool-row" onClick={() => setOpen(!open)}>
        <Icon className="tool-icon" size={15} />
        <span className="tool-label">{d.label}</span>
        {d.summary && <span className={cx('tool-summary', d.mono && 'mono')}>{d.summary}</span>}
        {agentSteps > 0 && <span className="tool-count">{agentSteps}手</span>}
        <span className="tool-state">
          {spinning && <Loader2 className="spin" size={13} />}
          {state === 'error' && <CircleAlert size={13} />}
        </span>
        <ChevronRight className="chev" size={14} />
      </button>
      {spinning && isAgent(call) && call.agent?.progress && !open && (
        <div className="tool-progress">{call.agent.progress}</div>
      )}
      {open && (
        <div className="tool-detail">
          <Detail call={call} live={live} renderItems={renderItems} />
        </div>
      )}
    </div>
  );
}

function Detail({ call, live, renderItems }: { call: ToolCall; live: boolean; renderItems: (items: Item[], live: boolean) => ReactNode }) {
  const i = call.input ?? {};
  const r = call.result;
  const text = r ? contentText(r.content) : '';
  const error = r?.isError ? <Output text={text || 'エラー'} /> : null;
  const mcp = call.name.match(/^mcp__allama__(.+)$/);

  if (mcp) return <HeadDetail name={mcp[1]} input={i} resultText={text} isError={!!r?.isError} />;

  switch (call.name) {
    case 'Bash':
    case 'PowerShell':
      return (
        <>
          <pre className="cmd">
            <span className="prompt">{call.name === 'Bash' ? '$' : 'PS>'}</span> {i.command}
          </pre>
          {r && <Output text={text || '（出力なし）'} />}
        </>
      );
    case 'Read': {
      if (!r) return <div className="muted">{i.file_path}</div>;
      if (r.isError) return error;
      const file = r.meta?.file;
      return (
        <>
          <div className="path">{i.file_path}</div>
          {typeof file?.content === 'string' ? (
            <Output text={file.content} lang={langFromPath(i.file_path)} maxLines={30} />
          ) : (
            <>
              <Output text={text} />
              <ContentImages content={r.content} />
            </>
          )}
        </>
      );
    }
    case 'Write':
      return (
        <>
          <div className="path">{i.file_path}</div>
          <Output text={String(i.content ?? '')} lang={langFromPath(i.file_path)} maxLines={30} />
          {error}
        </>
      );
    case 'Edit':
      return (
        <>
          <div className="path">{i.file_path}</div>
          {r?.isError ? error : <Diff hunks={r?.meta?.structuredPatch} oldText={i.old_string} newText={i.new_string} />}
        </>
      );
    case 'MultiEdit':
      return (
        <>
          <div className="path">{i.file_path}</div>
          {r?.isError
            ? error
            : r?.meta?.structuredPatch?.length
              ? <Diff hunks={r.meta.structuredPatch} />
              : (i.edits ?? []).map((e: any, k: number) => <Diff key={k} oldText={e.old_string} newText={e.new_string} />)}
        </>
      );
    case 'Agent':
    case 'Task': {
      const final = call.agent?.summary ?? (resultState(call) === 'done' ? text : '');
      return (
        <>
          <details className="agent-prompt">
            <summary>頼んだ内容{i.subagent_type ? `（${i.subagent_type}）` : ''}</summary>
            <Markdown text={String(i.prompt ?? '')} />
          </details>
          {call.children.length > 0 && <div className="nested">{renderItems(call.children, live)}</div>}
          {final && (
            <div className="agent-final">
              <div className="label">結果</div>
              <Markdown text={final} />
            </div>
          )}
        </>
      );
    }
    case 'WebFetch':
      return (
        <>
          <a className="path" href={i.url} target="_blank" rel="noopener noreferrer">
            {i.url}
          </a>
          {i.prompt && <div className="muted small">{i.prompt}</div>}
          {r && <Output text={text} />}
        </>
      );
    default:
      return (
        <>
          <pre className="plain json">{JSON.stringify(i, null, 2)}</pre>
          {r && <Output text={text || '（結果なし）'} />}
          {r && <ContentImages content={r.content} />}
        </>
      );
  }
}

function HeadDetail({ name, input, resultText, isError }: { name: string; input: any; resultText: string; isError: boolean }) {
  const title = input.question ?? input.title ?? input.text ?? input.query ?? input.message ?? input.prompt;
  const body = input.detail;
  return (
    <div className="head-detail">
      {title && <div className="head-title">{String(title)}</div>}
      {body && <Markdown text={String(body)} />}
      {name === 'start_session' && input.prompt && input.title && <Markdown text={String(input.prompt)} />}
      {Array.isArray(input.options) && input.options.length > 0 && (
        <div className="chips">
          {input.options.map((o: string, k: number) => (
            <span key={k} className="chip">
              {o}
            </span>
          ))}
        </div>
      )}
      {input.due && <div className="muted small">期限 {dateTime(input.due)}</div>}
      {resultText && <div className={cx('head-result', isError && 'is-error')}>{resultText}</div>}
    </div>
  );
}

function TodoCard({ todos }: { todos: { content: string; status: string; activeForm?: string }[] }) {
  const done = todos.filter((t) => t.status === 'completed').length;
  return (
    <div className="todo-card">
      <div className="todo-head">
        <ListTodo size={15} /> やることリスト <span className="muted">
          {done}/{todos.length}
        </span>
      </div>
      <ul>
        {todos.map((t, k) => (
          <li key={k} className={`todo-${t.status}`}>
            <span className="box">{t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '●' : ''}</span>
            <span>{t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
