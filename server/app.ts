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
  /** 画面（SSE）への送り口。接続ごとに1つ */
  clients = new Set<(data: string) => void>();
  private stateTimer: NodeJS.Timeout | undefined;

  constructor(config: Config) {
    this.config = config;
    this.store = new Store(config.dataDir);
    this.mind = new Mind(config.dataDir);
    this.runner = new Runner(this);
    this.scheduler = new Scheduler(this);
    this.store.on('change', () => this.touch());
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
    const data = JSON.stringify(ev);
    for (const send of this.clients) send(data);
  }

  /** 状態が変わったことを画面に知らせる */
  touch(): void {
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = undefined;
      this.emit({ type: 'state', state: this.state() });
    }, 80);
  }
}
