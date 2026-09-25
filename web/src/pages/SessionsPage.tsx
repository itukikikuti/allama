import { AlarmClock, ChevronRight, CircleAlert, Hand, Loader2, MessageCircleQuestion } from 'lucide-react';
import type { AppState, SessionMeta } from '../../../shared/types.ts';
import { ago, cx, dateTime } from '../util.ts';

export function SessionsPage({ state }: { state: AppState }) {
  const waiting = new Set(
    state.tasks
      .filter((t) => t.status === 'open' && (t.kind === 'question' || t.kind === 'proposal'))
      .map((t) => t.sessionId),
  );
  const modelLabel = (id: string) => state.models.find((m) => m.id === id)?.label ?? id;
  const running = state.sessions.filter((s) => s.status === 'running');
  const rest = state.sessions.filter((s) => s.status !== 'running');

  return (
    <div className="page">
      {running.length > 0 && (
        <section>
          <h2>
            いま動いている手 <span className="count">{running.length}</span>
          </h2>
          <div className="session-list">
            {running.map((s) => (
              <SessionRow key={s.id} s={s} waiting={waiting.has(s.id)} model={modelLabel(s.modelId)} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2>これまでの手</h2>
        {rest.length === 0 && <div className="empty">まだ何もしていない。</div>}
        <div className="session-list">
          {rest.map((s) => (
            <SessionRow key={s.id} s={s} waiting={waiting.has(s.id)} model={modelLabel(s.modelId)} />
          ))}
        </div>
      </section>

      {state.wakeups.length > 0 && (
        <details className="wakeups">
          <summary>
            <ChevronRight className="chev" size={14} />
            <AlarmClock size={14} /> 予定している目覚まし <span className="count">{state.wakeups.length}</span>
            <span className="muted small">次は{ago(state.wakeups[0].at)}</span>
          </summary>
          {state.wakeups.map((w) => (
            <div key={w.id} className="wakeup">
              <div className="wakeup-time">
                {dateTime(w.at)}
                {w.everyMinutes ? `（${w.everyMinutes}分ごと）` : ''}
              </div>
              <div className="wakeup-prompt">{w.prompt}</div>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function SessionRow({ s, waiting, model }: { s: SessionMeta; waiting: boolean; model: string }) {
  const sub = s.status === 'error' ? s.lastError : s.status === 'running' ? s.activity ?? s.summary : s.summary;
  return (
    <a className={cx('session-row', s.status)} href={`#/sessions/${s.id}`}>
      <span className="row-status">
        {s.status === 'running' ? (
          <Loader2 className="spin" size={15} />
        ) : s.status === 'error' ? (
          <CircleAlert size={15} />
        ) : waiting ? (
          <MessageCircleQuestion size={15} />
        ) : (
          <span className="status-dot idle" />
        )}
      </span>
      <span className="row-main">
        <span className="row-title">
          {s.trigger === 'wakeup' && <AlarmClock size={13} />}
          {s.trigger === 'session' && <Hand size={13} />}
          {s.title}
        </span>
        {(sub || waiting) && <span className={cx('row-sub', s.status === 'error' && 'is-error')}>{waiting ? '返事を待っている' : sub}</span>}
      </span>
      <span className="row-side">
        <time>{ago(s.updatedAt)}</time>
        <span>{model}</span>
      </span>
    </a>
  );
}
