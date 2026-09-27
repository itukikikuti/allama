import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Loader2, Moon, Search } from 'lucide-react';
import type { AppState, MemoryItem, MemoryKind } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Markdown } from '../components/Markdown.tsx';
import { ago, cx, dateTime } from '../util.ts';

const KINDS: { kind: MemoryKind | ''; label: string }[] = [
  { kind: '', label: 'すべて' },
  { kind: 'episode', label: '出来事' },
  { kind: 'fact', label: '知ったこと' },
  { kind: 'procedure', label: 'やり方' },
  { kind: 'reflection', label: '気づき' },
];
const LABEL = Object.fromEntries(KINDS.map((k) => [k.kind, k.label])) as Record<MemoryKind, string>;

/** 記憶のビューワー（見るだけ。整理は今すぐ走らせられる） */
export function MemoryPage({ state }: { state: AppState }) {
  const m = state.memory;
  const qc = useQueryClient();
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<MemoryKind | ''>('');
  const list = useQuery({ queryKey: ['memory', q, kind], queryFn: () => api.memoryList(q, kind) });
  const logs = useQuery({ queryKey: ['memory-logs'], queryFn: api.memoryLogs });

  // 記憶が増えたり整理されたりしたら、一覧を取り直す
  const total = Object.values(m.counts).reduce((a, b) => a + b, 0);
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['memory'] });
    void qc.invalidateQueries({ queryKey: ['memory-logs'] });
  }, [qc, total, m.unconsolidated, m.core?.version, m.busy]);

  return (
    <div className="page memory">
      <div className="memory-stats">
        {KINDS.slice(1).map((k) => (
          <div key={k.kind} className="stat">
            <span className="n">{m.counts[k.kind] ?? 0}</span>
            <span className="l">{k.label}</span>
          </div>
        ))}
        <div className="stat-side">
          <div className="muted small">
            整理待ち {m.unconsolidated}件 ・ 最後の整理 {m.lastConsolidatedAt ? ago(m.lastConsolidatedAt) : 'まだ'}
          </div>
          <button type="button" className="sleep-btn" disabled={!!m.busy || !m.unconsolidated} onClick={() => api.consolidate()}>
            {m.busy ? <Loader2 className="spin" size={14} /> : <Moon size={14} />} {m.busy ? `${m.busy}…` : '今すぐ整理する'}
          </button>
        </div>
      </div>

      <h2>記憶の核</h2>
      <div className="card">
        {m.core ? (
          <>
            <Markdown text={m.core.content} />
            <div className="muted small core-meta">
              第{m.core.version}版 ・ {ago(m.core.createdAt)}
            </div>
          </>
        ) : (
          <div className="muted">まだ無い。記憶が溜まって整理されると、ここにできる。</div>
        )}
      </div>

      <h2>記憶</h2>
      <form
        className="memory-search"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(input.trim());
        }}
      >
        <Search size={15} />
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="思い出す（意味でも言葉でも探せる）" />
      </form>
      <div className="chips kinds">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" className={cx('chip', kind === k.kind && 'active')} onClick={() => setKind(k.kind)}>
            {k.label}
          </button>
        ))}
      </div>
      {list.isLoading && <div className="loading-inline">読み込み中…</div>}
      {list.error && <div className="error-box">{list.error.message}</div>}
      {list.data?.length === 0 && <div className="empty">{q ? '思い出せなかった。' : 'まだ記憶は無い。'}</div>}
      <div className="memory-list">
        {list.data?.map((item) => <MemoryRow key={item.id} item={item} />)}
      </div>

      {!!logs.data?.length && (
        <details className="closed-tasks">
          <summary>
            <ChevronRight className="chev" size={14} /> 記憶の処理の記録
          </summary>
          {logs.data.map((l, i) => (
            <div key={i} className={cx('memory-log', l.kind === 'error' && 'is-error')}>
              <time>{dateTime(l.at)}</time> {l.message}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function MemoryRow({ item }: { item: MemoryItem }) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({ queryKey: ['memory-item', item.id], queryFn: () => api.memoryItem(item.id), enabled: open });
  const r = item.retention ?? 1;
  return (
    <div className={cx('memory-item', `kind-${item.kind}`, item.supersededBy && 'superseded', open && 'open')}>
      <button type="button" className="memory-main" onClick={() => setOpen(!open)}>
        <span className="kind-badge">{LABEL[item.kind]}</span>
        <span className="memory-content">{item.content}</span>
      </button>
      <div className="memory-meta">
        <span title="覚えている度合い（思い出されないと下がる）" className="retention">
          <span className="bar">
            <span style={{ width: `${Math.round(r * 100)}%` }} />
          </span>
          {Math.round(r * 100)}%
        </span>
        <span>重要さ {Math.round(item.importance * 100)}</span>
        {item.recallCount > 0 && <span>思い出した {item.recallCount}回</span>}
        <span>{item.happenedAt ? dateTime(item.happenedAt) : `${ago(item.createdAt)}に覚えた`}</span>
        {item.supersededBy && <span className="tag">置き換え済み</span>}
        {item.sourceSession && <a href={`#/sessions/${item.sourceSession}`}>セッション</a>}
      </div>
      {open && detail.data?.sourceItems.length ? (
        <div className="memory-sources">
          <div className="muted small">もとになった記憶</div>
          {detail.data.sourceItems.map((s) => (
            <div key={s.id} className="memory-source">
              <span className="kind-badge">{LABEL[s.kind]}</span> {s.content}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
