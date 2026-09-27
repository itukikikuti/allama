// 目覚まし。時刻が来たらセッションを動かす。
// いつ起きるかは本人が決めるが、予定が1つも無いときだけは見回りを入れて、眠ったままにならないようにする。

import type { Wakeup } from '../shared/types.ts';
import type { App } from './app.ts';
import { PATROL_PROMPT } from './head.ts';
import { firstLine, nowIso, shortId } from './util.ts';

export class Scheduler {
  app: App;

  constructor(app: App) {
    this.app = app;
  }

  start(): void {
    this.tick();
    setInterval(() => this.tick(), 15_000);
  }

  private tick(): void {
    const { store, config } = this.app;
    const now = Date.now();
    for (const w of [...store.wakeups]) {
      if (Date.parse(w.at) > now) continue;
      try {
        this.fire(w);
      } catch (e) {
        console.error('[scheduler] 目覚ましに失敗', w.id, e);
      }
      if (w.everyMinutes && w.everyMinutes > 0) {
        const step = w.everyMinutes * 60_000;
        let next = Date.parse(w.at);
        while (next <= now) next += step;
        store.updateWakeup(w.id, { at: new Date(next).toISOString() });
      } else {
        store.removeWakeup(w.id);
      }
    }

    if (store.wakeups.length === 0) {
      store.addWakeup({
        id: shortId(),
        at: new Date(now + config.fallbackPatrolHours * 3600_000).toISOString(),
        prompt: PATROL_PROMPT,
        createdAt: nowIso(),
      });
    }
  }

  private fire(w: Wakeup): void {
    const { store, runner } = this.app;
    const text = `【目覚まし】（${w.everyMinutes ? `${w.everyMinutes}分ごと` : '1回きり'}、wakeup_id=${w.id}）\n${w.prompt}`;
    if (w.sessionId && store.session(w.sessionId)) {
      runner.send(w.sessionId, { text, source: 'wakeup', at: nowIso() });
    } else {
      runner.createSession({
        message: text,
        trigger: 'wakeup',
        modelId: w.modelId,
        title: `目覚まし: ${firstLine(w.prompt, 30)}`,
      });
    }
  }
}
