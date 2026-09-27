import { useEffect, useState } from 'react';
import type { AppState } from '../../shared/types.ts';
import { UnauthorizedError, api, connectEvents, onServerEvent, setToken } from './api.ts';
import { MindPage, parseMindRoute, type MindRoute } from './pages/MindPage.tsx';
import { SessionView } from './pages/SessionView.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { Settings as SettingsIcon } from 'lucide-react';
import { SessionsPage } from './pages/SessionsPage.tsx';
import { TasksPage } from './pages/TasksPage.tsx';
import { cx } from './util.ts';

function useHash(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return hash;
}

type Route =
  | { name: 'tasks' }
  | { name: 'sessions' }
  | { name: 'session'; id: string }
  | { name: 'mind'; mind: MindRoute }
  | { name: 'settings' };

function parseRoute(hash: string): Route {
  const m = hash.match(/^#\/sessions\/([\w-]+)/);
  if (m) return { name: 'session', id: m[1] };
  if (hash.startsWith('#/sessions')) return { name: 'sessions' };
  if (hash.startsWith('#/mind')) return { name: 'mind', mind: parseMindRoute(hash) };
  if (hash.startsWith('#/settings')) return { name: 'settings' };
  return { name: 'tasks' };
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [online, setOnline] = useState(false);
  const [needToken, setNeedToken] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const route = parseRoute(useHash());

  useEffect(() => {
    let alive = true;
    api
      .state()
      .then((s) => {
        if (!alive) return;
        setState(s);
        setNeedToken(false);
      })
      .catch((e) => {
        if (e instanceof UnauthorizedError) setNeedToken(true);
        else setError((e as Error).message);
      });
    const off = onServerEvent((ev) => {
      if (ev.type === 'state') setState(ev.state);
    });
    const close = connectEvents(setOnline);
    return () => {
      alive = false;
      off();
      close();
    };
  }, [attempt]);

  const openCount = state?.tasks.filter((t) => t.status === 'open').length ?? 0;
  const runningCount = state?.sessions.filter((s) => s.status === 'running').length ?? 0;

  useEffect(() => {
    document.title = openCount ? `(${openCount}) allama` : 'allama';
  }, [openCount]);

  useEffect(() => {
    if (route.name !== 'session') window.scrollTo(0, 0);
  }, [route.name, location.hash]);

  if (needToken) {
    return (
      <form
        className="token-form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = new FormData(e.currentTarget).get('token');
          setToken(String(v ?? ''));
          setAttempt((n) => n + 1);
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

  if (!state) return <div className="boot">{error ? `つながらない：${error}` : '起こしています…'}</div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/">
            <img src="/icon.svg" alt="" width={22} height={22} />
            <span>allama</span>
            <span className={cx('conn', online ? 'on' : 'off')} title={online ? 'つながっている' : '切れている（自動で繋ぎ直す）'} />
          </a>
          <nav className="tabs">
            <a href="#/" className={cx(route.name === 'tasks' && 'active')}>
              タスク{openCount > 0 && <span className="badge">{openCount}</span>}
            </a>
            <a href="#/sessions" className={cx((route.name === 'sessions' || route.name === 'session') && 'active')}>
              セッション{runningCount > 0 && <span className="badge live">{runningCount}</span>}
            </a>
            <a href="#/mind" className={cx(route.name === 'mind' && 'active')}>
              記憶
            </a>
          </nav>
          <a href="#/settings" className={cx('icon-btn', route.name === 'settings' && 'active')} title="設定">
            <SettingsIcon size={17} />
          </a>
        </div>
      </header>
      <main>
        {route.name === 'tasks' && <TasksPage state={state} />}
        {route.name === 'sessions' && <SessionsPage state={state} />}
        {route.name === 'session' && <SessionView key={route.id} id={route.id} state={state} />}
        {route.name === 'mind' && <MindPage route={route.mind} />}
        {route.name === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
