import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Router, Switch, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { Settings as SettingsIcon } from 'lucide-react';
import { UnauthorizedError, api, connectEvents, onServerEvent, setToken } from './api.ts';
import { MemoryPage } from './pages/MemoryPage.tsx';
import { SessionView } from './pages/SessionView.tsx';
import { SessionsPage } from './pages/SessionsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { TasksPage } from './pages/TasksPage.tsx';
import { cx } from './util.ts';

/** 状態はサーバーからの知らせ（SSE）で更新し続ける */
function useAppState() {
  const qc = useQueryClient();
  const [online, setOnline] = useState(false);
  const query = useQuery({ queryKey: ['state'], queryFn: api.state, staleTime: Infinity, retry: false });
  useEffect(() => {
    const off = onServerEvent((ev) => {
      if (ev.type === 'state') qc.setQueryData(['state'], ev.state);
    });
    const close = connectEvents(setOnline);
    return () => {
      off();
      close();
    };
  }, [qc]);
  return { ...query, online };
}

export function App() {
  return (
    <Router hook={useHashLocation}>
      <Shell />
    </Router>
  );
}

function Shell() {
  const { data: state, error, online, refetch } = useAppState();
  const [location] = useLocation();
  const openCount = state?.tasks.filter((t) => t.status === 'open').length ?? 0;
  const runningCount = state?.sessions.filter((s) => s.status === 'running').length ?? 0;

  useEffect(() => {
    document.title = openCount ? `(${openCount}) allama` : 'allama';
  }, [openCount]);

  useEffect(() => {
    if (!location.startsWith('/sessions/')) window.scrollTo(0, 0);
  }, [location]);

  if (error instanceof UnauthorizedError) return <TokenForm onDone={() => refetch()} />;
  if (!state) return <div className="boot">{error ? `つながらない：${error.message}` : '起こしています…'}</div>;

  const tab = (href: string, active: boolean, label: React.ReactNode) => (
    <Link href={href} className={cx(active && 'active')}>
      {label}
    </Link>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/">
            <img src="/icon.svg" alt="" width={22} height={22} />
            <span>allama</span>
            <span className={cx('conn', online ? 'on' : 'off')} title={online ? 'つながっている' : '切れている（自動で繋ぎ直す）'} />
          </Link>
          <nav className="tabs">
            {tab('/', location === '/', <>タスク{openCount > 0 && <span className="badge">{openCount}</span>}</>)}
            {tab('/sessions', location.startsWith('/sessions'), <>セッション{runningCount > 0 && <span className="badge live">{runningCount}</span>}</>)}
            {tab('/memory', location.startsWith('/memory'), <>記憶{state.memory.busy && <span className="badge live">…</span>}</>)}
          </nav>
          <Link href="/settings" className={cx('icon-btn', location === '/settings' && 'active')} title="設定">
            <SettingsIcon size={17} />
          </Link>
        </div>
      </header>
      <main>
        <Switch>
          <Route path="/sessions/:id">{(p) => <SessionView key={p.id} id={p.id} state={state} />}</Route>
          <Route path="/sessions">
            <SessionsPage state={state} />
          </Route>
          <Route path="/memory">
            <MemoryPage state={state} />
          </Route>
          <Route path="/settings">
            <SettingsPage />
          </Route>
          <Route>
            <TasksPage state={state} />
          </Route>
        </Switch>
      </main>
    </div>
  );
}

function TokenForm({ onDone }: { onDone: () => void }) {
  return (
    <form
      className="token-form"
      onSubmit={(e) => {
        e.preventDefault();
        setToken(String(new FormData(e.currentTarget).get('token') ?? ''));
        onDone();
      }}
    >
      <img src="/icon.svg" alt="" width={48} height={48} />
      <label>
        合言葉
        <input name="token" type="password" autoFocus />
      </label>
      <button type="submit" className="primary">
        入る
      </button>
    </form>
  );
}

