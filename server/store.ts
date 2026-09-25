import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { SessionMeta, Task, Wakeup } from '../shared/types.ts';
import { nowIso, readJson, writeJsonAtomic } from './util.ts';

/** セッション・タスク・目覚ましの保存場所。変更があると 'change' を出す */
export class Store extends EventEmitter {
  dir: string;
  sessions: SessionMeta[];
  tasks: Task[];
  wakeups: Wakeup[];

  constructor(dataDir: string) {
    super();
    this.dir = path.join(dataDir, 'state');
    this.sessions = readJson(path.join(this.dir, 'sessions.json'), []);
    this.tasks = readJson(path.join(this.dir, 'tasks.json'), []);
    this.wakeups = readJson(path.join(this.dir, 'wakeups.json'), []);
  }

  private save(name: 'sessions' | 'tasks' | 'wakeups'): void {
    writeJsonAtomic(path.join(this.dir, `${name}.json`), this[name]);
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
