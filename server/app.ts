import type { ServerResponse } from 'node:http';
import type { AppState, ServerEvent } from '../shared/types.ts';
import type { Config } from './config.ts';
import { Mind } from './mind.ts';
import { Runner } from './runner.ts';
import { Scheduler } from './scheduler.ts';
import { Store } from './store.ts';

/** 体の部品をまとめたもの */
export class App {
  config: Config;
  store: Store;
  mind: Mind;
  runner: Runner;
  scheduler: Scheduler;
  clients = new Set<ServerResponse>();
  private stateTimer: NodeJS.Timeout | undefined;

  constructor(config: Config) {
    this.config = config;
    this.store = new Store(config.dataDir);
    this.mind = new Mind(config.dataDir);
    this.runner = new Runner(this);
    this.scheduler = new Scheduler(this);
    this.store.on('change', () => this.scheduleState());
    setInterval(() => {
      for (const c of this.clients) c.write(': ping\n\n');
    }, 25_000).unref();
  }

  state(): AppState {
    const { store, config } = this;
    const sessions = [...store.sessions]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((s, i) => i < 300 || s.status === 'running');
    const closed = store.tasks
      .filter((t) => t.status === 'done')
      .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
      .slice(0, 100);
    return {
      sessions,
      tasks: [...store.tasks.filter((t) => t.status === 'open'), ...closed],
      wakeups: [...store.wakeups].sort((a, b) => a.at.localeCompare(b.at)),
      models: config.models.map(({ id, label }) => ({ id, label })),
      defaultModelId: config.defaultModelId,
      defaultCwd: config.defaultCwd,
    };
  }

  emit(ev: ServerEvent): void {
    const data = `data: ${JSON.stringify(ev)}\n\n`;
    for (const c of this.clients) c.write(data);
  }

  private scheduleState(): void {
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = undefined;
      this.emit({ type: 'state', state: this.state() });
    }, 80);
  }
}
