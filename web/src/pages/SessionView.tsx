import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronLeft, CircleAlert, Hand, Loader2, MessageCircleQuestion, Square } from 'lucide-react';
import type { AppState, ServerEvent, TurnData } from '../../../shared/types.ts';
import { api, onServerEvent } from '../api.ts';
import { Transcript } from '../transcript/Transcript.tsx';
import { dateTime, shortPath } from '../util.ts';

type LiveEvent = Exclude<ServerEvent, { type: 'state' }>;

function applyEvent(list: TurnData[], ev: LiveEvent): TurnData[] {
  if (ev.type === 'turn-start') {
    if (list.some((t) => t.turn === ev.turn)) return list;
    return [...list, { turn: ev.turn, input: ev.input, events: [] }];
  }
  const idx = list.findIndex((t) => t.turn === ev.turn);
  if (idx < 0) return [...list, { turn: ev.turn, input: { text: '', source: 'system', at: '' }, events: [ev.event] }];
  const t = list[idx];
  const uuid = ev.event?.uuid;
  if (uuid && t.events.some((e) => e.uuid === uuid)) return list;
  const copy = list.slice();
  copy[idx] = { ...t, events: [...t.events, ev.event] };
  return copy;
}

export function SessionView({ id, state }: { id: string; state: AppState }) {
  const meta = state.sessions.find((s) => s.id === id);
  const [turns, setTurns] = useState<TurnData[] | null>(null);
  const [err, setErr] = useState('');
  const [thinking, setThinking] = useState<number | null>(null);
  const nearBottom = useRef(true);
  const firstPaint = useRef(true);

  useEffect(() => {
    // 読み込み中に届いた知らせは貯めておき、読み込み後に重ねる
    let buffer: LiveEvent[] | null = [];
    setTurns(null);
    setErr('');
    firstPaint.current = true;
    const off = onServerEvent((ev) => {
      if (ev.type === 'state' || ev.sessionId !== id) return;
      if (ev.type === 'session-event' && ev.event?.type === 'system' && ev.event.subtype === 'thinking_tokens') {
        setThinking(ev.event.estimated_tokens ?? null);
        return;
      }
      if (ev.type === 'session-event' && ev.event?.type === 'assistant') setThinking(null);
      if (buffer) buffer.push(ev);
      else setTurns((prev) => (prev ? applyEvent(prev, ev) : prev));
    });
    api
      .transcript(id)
      .then((d) => {
        let list = d.turns;
        for (const ev of buffer ?? []) list = applyEvent(list, ev);
        buffer = null;
        setTurns(list);
      })
      .catch((e) => {
        buffer = null;
        setErr((e as Error).message);
      });
    return () => {
      off();
    };
  }, [id]);

  useEffect(() => {
    const onScroll = () => {
      nearBottom.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 下の方を見ているときは、新しい動きに合わせて追いかける
  useLayoutEffect(() => {
    if (!turns) return;
    if (firstPaint.current || nearBottom.current) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      firstPaint.current = false;
    }
  }, [turns, thinking]);

  if (!meta) {
    return (
      <div className="page">
        <a className="back-link" href="#/sessions">
          <ChevronLeft size={16} /> 一覧へ
        </a>
        <div className="empty">{err || 'このセッションは見つからない。'}</div>
      </div>
    );
  }

  const running = meta.status === 'running';
  const model = state.models.find((m) => m.id === meta.modelId)?.label ?? meta.modelId;
  const parent = meta.parentId ? state.sessions.find((s) => s.id === meta.parentId) : undefined;
  const waitingTasks = state.tasks.filter(
    (t) => t.sessionId === meta.id && t.status === 'open' && (t.kind === 'question' || t.kind === 'proposal'),
  );

  const stop = async () => {
    if (!confirm('この手を止める？')) return;
    await api.stop(meta.id).catch(() => {});
  };

  return (
    <div className="page session-page">
      <div className="session-header">
        <a className="back" href="#/sessions" aria-label="一覧へ">
          <ChevronLeft size={20} />
        </a>
        <div className="sh-main">
          <h1>{meta.title}</h1>
          <div className="sh-sub">
            <span className={`status-dot ${meta.status}`} />
            {running ? '動いている' : meta.status === 'error' ? 'エラー' : '待機中'}
            <span className="dot">·</span>
            {model}
            <span className="dot">·</span>
            <span title={meta.cwd}>{shortPath(meta.cwd, 2)}</span>
            <span className="dot">·</span>
            {dateTime(meta.createdAt)}
          </div>
        </div>
        {running && (
          <button type="button" className="stop-btn" onClick={stop}>
            <Square size={12} /> 止める
          </button>
        )}
      </div>

      {parent && (
        <a className="parent-link" href={`#/sessions/${parent.id}`}>
          <Hand size={13} /> 「{parent.title}」から出た手
        </a>
      )}

      {waitingTasks.map((t) => (
        <a key={t.id} className="waiting-banner" href="#/">
          <MessageCircleQuestion size={15} /> 返事を待っている：{t.title}
        </a>
      ))}

      {err && <div className="error-box">{err}</div>}
      {!turns && !err && <div className="loading-inline">読み込み中…</div>}
      {turns && <Transcript turns={turns} running={running} />}

      {running && (
        <div className="working">
          <Loader2 className="spin" size={15} />
          <span>{meta.activity ?? (thinking ? `考えている…（${thinking}トークン）` : '作業中…')}</span>
        </div>
      )}
      {meta.status === 'error' && meta.lastError && (
        <div className="error-box">
          <CircleAlert size={15} /> <span>{meta.lastError}</span>
        </div>
      )}
      {meta.queue.length > 0 && <div className="note">このあと届くメッセージが{meta.queue.length}件ある</div>}

      <ReplyBar sessionId={meta.id} running={running} />
    </div>
  );
}

/** セッションへの返信。作業中なら、区切りがついたときに届く */
function ReplyBar({ sessionId, running }: { sessionId: string; running: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 240)}px`;
  }, [text]);

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      await api.sendMessage(sessionId, text);
      setText('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reply-bar">
      <div className="reply-box">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          placeholder={running ? '返信（作業の区切りで届く）' : 'このセッションに返信'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" className="send-btn" disabled={!text.trim() || busy} onClick={send} title="送る（Ctrl+Enter）">
          {busy ? <Loader2 className="spin" size={16} /> : <ArrowUp size={16} />}
        </button>
      </div>
      {err && <div className="form-error">{err}</div>}
    </div>
  );
}
