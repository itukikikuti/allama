import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, FileText, Folder, GitCommitHorizontal } from 'lucide-react';
import { parsePatch } from 'diff';
import type { MindCommit, MindFile } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Diff } from '../components/Diff.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { ago, cx, dateTime } from '../util.ts';

export type MindRoute = { view: 'top' } | { view: 'file'; path: string } | { view: 'commit'; hash: string };

export function parseMindRoute(hash: string): MindRoute {
  const f = hash.match(/^#\/mind\/f\/(.+)$/);
  if (f) return { view: 'file', path: decodeURIComponent(f[1]) };
  const c = hash.match(/^#\/mind\/c\/([0-9a-f]+)$/);
  if (c) return { view: 'commit', hash: c[1] };
  return { view: 'top' };
}

const fileHref = (p: string) => `#/mind/f/${encodeURIComponent(p)}`;

/** 記憶フォルダのビューワー（見るだけ） */
export function MindPage({ route }: { route: MindRoute }) {
  if (route.view === 'file') return <FileView path={route.path} />;
  if (route.view === 'commit') return <CommitView hash={route.hash} />;
  return <MindTop />;
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data?: T; error?: string } {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    let alive = true;
    setState({});
    load()
      .then((data) => alive && setState({ data }))
      .catch((e) => alive && setState({ error: (e as Error).message }));
    return () => {
      alive = false;
    };
  }, deps);
  return state;
}

function MindTop() {
  const files = useLoad(api.mindFiles, []);
  const history = useLoad(api.mindHistory, []);

  // 直下のファイルを先に、フォルダごとにまとめる（日記などは新しい順）
  const groups = useMemo(() => {
    const map = new Map<string, MindFile[]>();
    for (const f of files.data ?? []) {
      if (f.path.endsWith('.gitkeep')) continue;
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
      map.set(dir, [...(map.get(dir) ?? []), f]);
    }
    return [...map.entries()]
      .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
      .map(([dir, list]) => [dir, dir ? [...list].sort((a, b) => b.path.localeCompare(a.path)) : list] as const);
  }, [files.data]);

  return (
    <div className="page">
      <h2>記憶フォルダ</h2>
      {files.error && <div className="error-box">{files.error}</div>}
      {!files.data && !files.error && <div className="loading-inline">読み込み中…</div>}
      {groups.map(([dir, list]) => (
        <section key={dir} className="mind-group">
          {dir && (
            <div className="mind-dir">
              <Folder size={14} /> {dir}/
            </div>
          )}
          <div className="session-list">
            {list.map((f) => (
              <a key={f.path} className="session-row" href={fileHref(f.path)}>
                <span className="row-status">
                  <FileText size={15} />
                </span>
                <span className="row-main">
                  <span className="row-title">{dir ? f.path.slice(dir.length + 1) : f.path}</span>
                </span>
                <span className="row-side">
                  <time>{ago(f.mtime)}</time>
                  <span>{(f.size / 1024).toFixed(1)}KB</span>
                </span>
              </a>
            ))}
          </div>
        </section>
      ))}

      <h2>変化の記録</h2>
      {history.error && <div className="error-box">{history.error}</div>}
      {history.data && history.data.length === 0 && <div className="empty">まだ記録は無い。</div>}
      <div className="session-list">
        {(history.data ?? []).slice(0, 50).map((c) => (
          <CommitRow key={c.hash} c={c} />
        ))}
      </div>
    </div>
  );
}

function CommitRow({ c }: { c: MindCommit }) {
  return (
    <a className="session-row" href={`#/mind/c/${c.hash}`}>
      <span className="row-status">
        <GitCommitHorizontal size={15} />
      </span>
      <span className="row-main">
        <span className="row-title">{c.message}</span>
        <span className="row-sub">{c.files.map((f) => f.path).join('、')}</span>
      </span>
      <span className="row-side">
        <time>{ago(c.date)}</time>
      </span>
    </a>
  );
}

function BackToMind() {
  return (
    <a className="back-link" href="#/mind">
      <ChevronLeft size={16} /> 記憶フォルダ
    </a>
  );
}

function FileView({ path }: { path: string }) {
  const file = useLoad(() => api.mindFile(path), [path]);
  const [raw, setRaw] = useState(false);
  const isMarkdown = path.endsWith('.md');
  return (
    <div className="page">
      <BackToMind />
      <div className="mind-file-head">
        <h1>{path}</h1>
        {isMarkdown && (
          <div className="seg">
            <button type="button" className={cx(!raw && 'active')} onClick={() => setRaw(false)}>
              表示
            </button>
            <button type="button" className={cx(raw && 'active')} onClick={() => setRaw(true)}>
              元の文字
            </button>
          </div>
        )}
      </div>
      {file.error && <div className="error-box">{file.error}</div>}
      {file.data &&
        (isMarkdown && !raw ? (
          <Markdown className="mind-doc" text={file.data.content} />
        ) : (
          <pre className="plain mind-raw">{file.data.content}</pre>
        ))}
    </div>
  );
}

function CommitView({ hash }: { hash: string }) {
  const history = useLoad(api.mindHistory, []);
  const diff = useLoad(() => api.mindCommit(hash), [hash]);
  const commit = history.data?.find((c) => c.hash === hash);
  const files = useMemo(() => (diff.data ? parsePatch(diff.data.diff) : []), [diff.data]);
  const name = (n?: string) => (n ?? '').replace(/^[ab]\//, '');
  return (
    <div className="page">
      <BackToMind />
      {commit && (
        <div className="mind-file-head">
          <h1>{commit.message}</h1>
          <div className="muted small">{dateTime(commit.date)}</div>
        </div>
      )}
      {diff.error && <div className="error-box">{diff.error}</div>}
      {files.map((f, i) => {
        const path = f.newFileName === '/dev/null' ? name(f.oldFileName) : name(f.newFileName);
        const deleted = f.newFileName === '/dev/null';
        return (
          <section key={i} className="mind-diff">
            <div className="path">
              {deleted ? (
                <span>{path}（削除）</span>
              ) : (
                <a href={fileHref(path)}>{path}</a>
              )}
            </div>
            <Diff hunks={f.hunks} />
          </section>
        );
      })}
      {diff.data && files.length === 0 && <div className="empty">変更の中身は無い。</div>}
    </div>
  );
}
