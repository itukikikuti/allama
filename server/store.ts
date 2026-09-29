import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { RateLimits, SessionMeta, Task, UsageWindow, Wakeup } from '../shared/types.ts';
import { nowIso, readJson, writeJsonAtomic } from './util.ts';

/** Claude のサブスクで届く、使用制限のお知らせ（SDKRateLimitInfo の一部） */
export interface RateLimitInfo {
  status?: string;
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number | null;
}

/** 0〜1 と 0〜100 のどちらで来ても、%にそろえる */
function toPercent(v: number | null | undefined): number | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return Math.round(v <= 1 ? v * 100 : v);
}

/** 秒とミリ秒のどちらで来ても、時刻にそろえる */
function toIso(at: number | undefined): string | undefined {
  if (at === undefined || Number.isNaN(at)) return undefined;
  return new Date(at > 1e12 ? at : at * 1000).toISOString();
}

const sameWindow = (a: UsageWindow | undefined, b: UsageWindow): boolean =>
  a?.utilization === b.utilization && a?.resetsAt === b.resetsAt;

/** セッション・タスク・目覚ましの保存場所。変更があると 'change' を出す */
export class Store extends EventEmitter {
  dir: string;
  sessions: SessionMeta[];
  tasks: Task[];
  wakeups: Wakeup[];
  /** Claude の使用制限。分かったときだけ入る */
  rateLimits: RateLimits | undefined;

  constructor(dataDir: string) {
    super();
    this.dir = path.join(dataDir, 'state');
    this.sessions = readJson(path.join(this.dir, 'sessions.json'), []);
    this.tasks = readJson(path.join(this.dir, 'tasks.json'), []);
    this.wakeups = readJson(path.join(this.dir, 'wakeups.json'), []);
    this.rateLimits = readJson<RateLimits | undefined>(path.join(this.dir, 'usage.json'), undefined);
  }

  private save(name: 'sessions' | 'tasks' | 'wakeups'): void {
    writeJsonAtomic(path.join(this.dir, `${name}.json`), this[name]);
    this.emit('change');
  }

  /** ターン中に届いた使用制限のお知らせを、いま分かっている値に重ねる */
  setRateLimit(info: RateLimitInfo): void {
    const now = nowIso();
    const cur: RateLimits = this.rateLimits ?? { updatedAt: now };
    const win: UsageWindow = { utilization: toPercent(info.utilization), resetsAt: toIso(info.resetsAt) };
    let changed = false;
    if (info.rateLimitType === 'five_hour' && !sameWindow(cur.fiveHour, win)) {
      cur.fiveHour = win;
      changed = true;
    } else if (info.rateLimitType === 'seven_day' && !sameWindow(cur.sevenDay, win)) {
      cur.sevenDay = win;
      changed = true;
    }
    if (info.status && cur.status !== info.status) {
      cur.status = info.status;
      changed = true;
    }
    // 同じ値なら、書き込まずに画面にも知らせない
    if (!changed) return;
    cur.updatedAt = now;
    this.rateLimits = cur;
    writeJsonAtomic(path.join(this.dir, 'usage.json'), cur);
    this.emit('change');
  }

  session(id: string): SessionMeta | undefined {
    return this.sessions.find((s) => s.id === id || s.id.startsWith(id));
  }

  addSession(s: SessionMeta): SessionMeta {
    this.sessions.push(s);
    this.save('sessions');
    return s;
  }

  /** touch=false なら「最後に動いた時刻」を変えない */
  updateSession(id: string, patch: Partial<SessionMeta>, touch = true): SessionMeta {
    const s = this.session(id);
    if (!s) throw new Error(`セッションが見つからない: ${id}`);
    Object.assign(s, patch, touch ? { updatedAt: nowIso() } : {});
    this.save('sessions');
    return s;
  }

  task(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  addTask(t: Task): Task {
    this.tasks.push(t);
    this.save('tasks');
    return t;
  }

  updateTask(id: string, patch: Partial<Task>): Task {
    const t = this.task(id);
    if (!t) throw new Error(`タスクが見つからない: ${id}`);
    Object.assign(t, patch, { updatedAt: nowIso() });
    this.save('tasks');
    return t;
  }

  addWakeup(w: Wakeup): Wakeup {
    this.wakeups.push(w);
    this.save('wakeups');
    return w;
  }

  updateWakeup(id: string, patch: Partial<Wakeup>): void {
    const w = this.wakeups.find((x) => x.id === id);
    if (!w) throw new Error(`目覚ましが見つからない: ${id}`);
    Object.assign(w, patch);
    this.save('wakeups');
  }

  removeWakeup(id: string): boolean {
    const before = this.wakeups.length;
    this.wakeups = this.wakeups.filter((w) => w.id !== id);
    if (this.wakeups.length === before) return false;
    this.save('wakeups');
    return true;
  }
}
