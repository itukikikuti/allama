// 記憶の保存先（SQLite）。全文検索（FTS5 trigram）と、意味検索用の埋め込みを持つ。

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { MemoryItem, MemoryKind, MemoryLog } from '../../shared/types.ts';
import { newId, nowIso } from '../util.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  importance REAL NOT NULL,
  happened_at TEXT,
  created_at TEXT NOT NULL,
  last_recalled_at TEXT,
  recall_count INTEGER NOT NULL DEFAULT 0,
  superseded_by TEXT,
  consolidated INTEGER NOT NULL DEFAULT 0,
  source_session TEXT,
  sources TEXT,
  embedding BLOB
);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, content='memories', content_rowid='rowid', tokenize='trigram');
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TABLE IF NOT EXISTS core (
  version INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

interface Row {
  rowid: number;
  id: string;
  kind: string;
  content: string;
  importance: number;
  happened_at: string | null;
  created_at: string;
  last_recalled_at: string | null;
  recall_count: number;
  superseded_by: string | null;
  consolidated: number;
  source_session: string | null;
  sources: string | null;
  embedding?: Uint8Array | null;
}

export interface NewMemory {
  kind: MemoryKind;
  content: string;
  importance: number;
  happenedAt?: string;
  sourceSession?: string;
  sources?: string[];
  embedding?: Float32Array;
  consolidated?: boolean;
}

function toItem(r: Row): MemoryItem {
  return {
    id: r.id,
    kind: r.kind as MemoryKind,
    content: r.content,
    importance: r.importance,
    happenedAt: r.happened_at ?? undefined,
    createdAt: r.created_at,
    lastRecalledAt: r.last_recalled_at ?? undefined,
    recallCount: r.recall_count,
    supersededBy: r.superseded_by ?? undefined,
    consolidated: !!r.consolidated,
    sourceSession: r.source_session ?? undefined,
    sources: r.sources ? JSON.parse(r.sources) : undefined,
  };
}

const COLS =
  'rowid, id, kind, content, importance, happened_at, created_at, last_recalled_at, recall_count, superseded_by, consolidated, source_session, sources';

/** 長さ1にそろえた埋め込み（内積＝コサイン類似度） */
export function normalize(v: number[] | Float32Array): Float32Array {
  const out = Float32Array.from(v);
  let n = 0;
  for (const x of out) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

export class MemoryDb {
  db: DatabaseSync;
  /** 意味検索のため、埋め込みはメモリにも持っておく */
  private vectors = new Map<string, Float32Array>();

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'memory.sqlite'));
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
    for (const r of this.db.prepare('SELECT id, embedding FROM memories WHERE embedding IS NOT NULL').all() as unknown as Row[]) {
      const b = r.embedding!;
      this.vectors.set(r.id, new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
    }
  }

  add(m: NewMemory): MemoryItem {
    const id = newId();
    const emb = m.embedding ? new Uint8Array(m.embedding.buffer.slice(0)) : null;
    this.db
      .prepare(
        'INSERT INTO memories (id, kind, content, importance, happened_at, created_at, consolidated, source_session, sources, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        m.kind,
        m.content,
        Math.min(1, Math.max(0, m.importance)),
        m.happenedAt ?? null,
        nowIso(),
        m.consolidated ? 1 : 0,
        m.sourceSession ?? null,
        m.sources?.length ? JSON.stringify(m.sources) : null,
        emb,
      );
    if (m.embedding) this.vectors.set(id, m.embedding);
    return this.get(id)!;
  }

  get(id: string): MemoryItem | undefined {
    const r = this.db.prepare(`SELECT ${COLS} FROM memories WHERE id = ?`).get(id) as unknown as Row | undefined;
    return r ? toItem(r) : undefined;
  }

  getMany(ids: string[]): MemoryItem[] {
    return ids.map((id) => this.get(id)).filter((m): m is MemoryItem => !!m);
  }

  /** 思い出されたので強くなる */
  touch(ids: string[], importance?: number): void {
    const st = this.db.prepare(
      'UPDATE memories SET recall_count = recall_count + 1, last_recalled_at = ?, importance = MAX(importance, ?) WHERE id = ?',
    );
    for (const id of ids) st.run(nowIso(), importance ?? 0, id);
  }

  supersede(oldIds: string[], newId: string): void {
    const st = this.db.prepare('UPDATE memories SET superseded_by = ? WHERE id = ? AND superseded_by IS NULL');
    for (const id of oldIds) st.run(newId, id);
  }

  markConsolidated(ids: string[]): void {
    const st = this.db.prepare('UPDATE memories SET consolidated = 1 WHERE id = ?');
    for (const id of ids) st.run(id);
  }

  unconsolidated(limit: number): MemoryItem[] {
    const rows = this.db
      .prepare(`SELECT ${COLS} FROM memories WHERE consolidated = 0 ORDER BY rowid LIMIT ?`)
      .all(limit) as unknown as Row[];
    return rows.map(toItem);
  }

  countUnconsolidated(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM memories WHERE consolidated = 0').get() as { n: number }).n;
  }

  /** 意味の近さで探す（置き換え済みを含めるかは呼び手が決める） */
  nearest(query: Float32Array, limit: number): { id: string; sim: number }[] {
    const out: { id: string; sim: number }[] = [];
    for (const [id, v] of this.vectors) {
      if (v.length !== query.length) continue;
      let s = 0;
      for (let i = 0; i < v.length; i++) s += v[i] * query[i];
      out.push({ id, sim: s });
    }
    return out.sort((a, b) => b.sim - a.sim).slice(0, limit);
  }

  /** 言葉の一致で探す（3文字未満は部分一致） */
  keyword(q: string, limit: number): string[] {
    const terms = q.split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    if (terms.every((t) => [...t].length >= 3)) {
      const match = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
      const rows = this.db
        .prepare('SELECT m.id AS id FROM memories_fts f JOIN memories m ON m.rowid = f.rowid WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?')
        .all(match, limit) as { id: string }[];
      return rows.map((r) => r.id);
    }
    const like = this.db.prepare('SELECT id FROM memories WHERE content LIKE ? ORDER BY rowid DESC LIMIT ?');
    return [...new Set(terms.flatMap((t) => (like.all(`%${t}%`, limit) as { id: string }[]).map((r) => r.id)))];
  }

  list(opts: { kind?: string; limit: number; offset?: number }): MemoryItem[] {
    const where = opts.kind ? 'WHERE kind = ?' : '';
    const args = opts.kind ? [opts.kind, opts.limit, opts.offset ?? 0] : [opts.limit, opts.offset ?? 0];
    const rows = this.db.prepare(`SELECT ${COLS} FROM memories ${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(...args) as unknown as Row[];
    return rows.map(toItem);
  }

  counts(): Record<string, number> {
    const rows = this.db.prepare('SELECT kind, COUNT(*) AS n FROM memories GROUP BY kind').all() as { kind: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
  }

  // ---- 記憶の核 ----

  core(): { content: string; createdAt: string; version: number } | undefined {
    const r = this.db.prepare('SELECT version, content, created_at FROM core ORDER BY version DESC LIMIT 1').get() as
      | { version: number; content: string; created_at: string }
      | undefined;
    return r ? { content: r.content, createdAt: r.created_at, version: r.version } : undefined;
  }

  setCore(content: string): void {
    this.db.prepare('INSERT INTO core (content, created_at) VALUES (?, ?)').run(content, nowIso());
  }

  // ---- 処理の記録 ----

  log(kind: string, message: string): void {
    this.db.prepare('INSERT INTO log (at, kind, message) VALUES (?, ?, ?)').run(nowIso(), kind, message);
  }

  logs(limit: number): MemoryLog[] {
    return this.db.prepare('SELECT at, kind, message FROM log ORDER BY id DESC LIMIT ?').all(limit) as unknown as MemoryLog[];
  }

  getMeta(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  /** 丸ごとの写しを取る（バックアップ） */
  backupTo(file: string): void {
    fs.rmSync(file, { force: true });
    this.db.prepare('VACUUM INTO ?').run(file);
  }
}
