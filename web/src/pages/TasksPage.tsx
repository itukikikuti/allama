import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronRight,
  ClipboardCheck,
  FolderOpen,
  Lightbulb,
  ListTodo,
  Loader2,
  MessageCircleQuestion,
} from 'lucide-react';
import type { AppState, SessionMeta, Task, TaskKind } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { AttachButton, AttachChips, useAttachments } from '../components/Attachments.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { ago, cx, dateTime, loadPref, savePref } from '../util.ts';

const KIND: Record<TaskKind, { label: string; icon: typeof ListTodo }> = {
  question: { label: '質問', icon: MessageCircleQuestion },
  proposal: { label: '提案', icon: Lightbulb },
  report: { label: '報告', icon: ClipboardCheck },
  todo: { label: 'あなたのToDo', icon: ListTodo },
};

const GROUPS: { kind: TaskKind; title: string }[] = [
  { kind: 'question', title: '返事を待っている' },
  { kind: 'proposal', title: '提案' },
  { kind: 'todo', title: 'あなたのToDo' },
  { kind: 'report', title: '報告' },
];

/** テキスト欄を中身に合わせて伸ばす（幅が変わったときも測り直す） */
function useAutoGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 320)}px`;
  };
  useLayoutEffect(fit, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        fit();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return ref;
}

export function TasksPage({ state }: { state: AppState }) {
  const open = state.tasks.filter((t) => t.status === 'open');
  const closed = state.tasks.filter((t) => t.status === 'done').slice(0, 30);
  const sessionOf = (id: string) => state.sessions.find((s) => s.id === id);

  return (
    <div className="page">
      <Composer state={state} />

      {open.length === 0 && <div className="empty">いまは返事が必要なものは無い。</div>}

      {GROUPS.map(({ kind, title }) => {
        const list = open
          .filter((t) => t.kind === kind)
          .sort((a, b) =>
            kind === 'todo' ? (a.due ?? '9').localeCompare(b.due ?? '9') : b.createdAt.localeCompare(a.createdAt),
          );
        if (!list.length) return null;
        return (
          <section key={kind} className="task-group">
            <h2>
              {title} <span className="count">{list.length}</span>
            </h2>
            {list.map((t) => (
              <TaskCard key={t.id} task={t} session={sessionOf(t.sessionId)} />
            ))}
          </section>
        );
      })}

      {closed.length > 0 && (
        <details className="closed-tasks">
          <summary>
            <ChevronRight className="chev" size={14} /> 済んだもの
          </summary>
          {closed.map((t) => {
            const Icon = KIND[t.kind].icon;
            return (
              <div key={t.id} className="closed-task">
                <Icon size={14} />
                <div>
                  <div className="closed-title">{t.title}</div>
                  <div className="muted small">
                    {t.answer} · {ago(t.closedAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </details>
      )}
    </div>
  );
}

function Composer({ state }: { state: AppState }) {
  const [text, setText] = useState('');
  const [modelId, setModelId] = useState(() => {
    const saved = loadPref('model');
    return state.models.some((m) => m.id === saved) ? saved : state.defaultModelId;
  });
  const [cwd, setCwd] = useState('');
  const [showCwd, setShowCwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [started, setStarted] = useState<SessionMeta | null>(null);
  const up = useAttachments();
  const ref = useAutoGrow(text);
  const ready = Boolean(text.trim() || up.files.length);

  const submit = async () => {
    if (!ready || busy || up.busy) return;
    setBusy(true);
    setErr('');
    try {
      const s = await api.startSession({
        message: text,
        modelId,
        cwd: cwd.trim() || undefined,
        files: up.files.map((f) => f.path),
      });
      setText('');
      up.clear();
      setStarted(s);
      savePref('model', modelId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer">
      <AttachChips up={up} />
      <textarea
        ref={ref}
        value={text}
        rows={2}
        placeholder="頼みたいこと、話したいこと"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      {showCwd && (
        <input
          className="cwd-input"
          value={cwd}
          placeholder={`作業フォルダ（空なら ${state.defaultCwd}）`}
          onChange={(e) => setCwd(e.target.value)}
        />
      )}
      <div className="composer-bar">
        <select value={modelId} onChange={(e) => setModelId(e.target.value)} aria-label="モデル">
          {state.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={cx('icon-btn', showCwd && 'active')}
          onClick={() => setShowCwd(!showCwd)}
          title="作業フォルダを指定"
        >
          <FolderOpen size={16} />
        </button>
        <span className="spacer" />
        <AttachButton up={up} />
        <button type="button" className="send-btn" disabled={!ready || busy} onClick={submit} title="送る（Ctrl+Enter）">
          {busy ? <Loader2 className="spin" size={16} /> : <ArrowUp size={16} />}
        </button>
      </div>
      {err && <div className="form-error">{err}</div>}
      {started && (
        <a className="started" href={`#/sessions/${started.id}`} onClick={() => setStarted(null)}>
          手を動かし始めた：「{started.title}」 →
        </a>
      )}
    </div>
  );
}

function TaskCard({ task, session }: { task: Task; session?: SessionMeta }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const up = useAttachments();
  const ref = useAutoGrow(text);
  const { icon: Icon, label } = KIND[task.kind];

  const send = async (action: string, value = text) => {
    setBusy(true);
    setErr('');
    try {
      await api.answer(task.id, { action, text: value, files: up.files.map((f) => f.path) });
      up.clear();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const overdue = task.due && Date.parse(task.due) < Date.now();
  const placeholder = {
    question: '返事を書く',
    proposal: 'コメント（任意）',
    report: '返事（任意）',
    todo: 'メモ（任意）',
  }[task.kind];

  return (
    <article className={`task-card kind-${task.kind}`}>
      <div className="task-meta">
        <Icon size={14} /> <span>{label}</span>
        <span className="dot">·</span>
        <time>{ago(task.createdAt)}</time>
        {task.due && <span className={cx('due', overdue && 'overdue')}>期限 {dateTime(task.due)}</span>}
      </div>
      <h3>{task.title}</h3>
      {task.body && <Markdown className="task-body" text={task.body} />}
      {session && (
        <a className="session-chip" href={`#/sessions/${session.id}`}>
          <span className={`status-dot ${session.status}`} />
          {session.title}
        </a>
      )}

      {task.kind === 'question' && task.options && task.options.length > 0 && (
        <div className="options">
          {task.options.map((o) => (
            <button key={o} type="button" className="option" disabled={busy} onClick={() => send('answer', o)}>
              {o}
            </button>
          ))}
        </div>
      )}

      <AttachChips up={up} />

      <div className="answer">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && task.kind === 'question' && (text.trim() || up.files.length)) {
              e.preventDefault();
              void send('answer');
            }
          }}
        />
        <div className="answer-actions">
          <AttachButton up={up} />
          {task.kind === 'question' && (
            <button
              type="button"
              className="primary"
              disabled={busy || (!text.trim() && !up.files.length)}
              onClick={() => send('answer')}
            >
              送る
            </button>
          )}
          {task.kind === 'proposal' && (
            <>
              <button type="button" disabled={busy} onClick={() => send('reject')}>
                やめて
              </button>
              <button type="button" className="primary" disabled={busy} onClick={() => send('approve')}>
                やって
              </button>
            </>
          )}
          {task.kind === 'report' && (
            <button type="button" className="primary" disabled={busy} onClick={() => send('ack')}>
              確認した
            </button>
          )}
          {task.kind === 'todo' && (
            <button type="button" className="primary" disabled={busy} onClick={() => send('done')}>
              完了
            </button>
          )}
        </div>
      </div>
      {err && <div className="form-error">{err}</div>}
    </article>
  );
}
