// HTTPサーバー（Hono）。画面からの操作を受ける。

import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { App } from './app.ts';
import { APP_DIR, getSettings, saveSettings } from './config.ts';
import { checkModel, checkOllama } from './providers.ts';
import { readTurns } from './transcript.ts';
import { answerTask } from './tools.ts';
import { retention } from './memory/index.ts';
import { embed, pull } from './memory/ollama.ts';

const WEB_DIST = path.relative(process.cwd(), path.join(APP_DIR, 'web', 'dist')) || '.';

export function startHttp(app: App): void {
  const api = new Hono();

  // 合言葉（設定されているときだけ）
  api.use('*', async (c, next) => {
    const token = app.config.authToken;
    if (token && c.req.header('x-allama-token') !== token && c.req.query('token') !== token) {
      return c.json({ error: '合言葉が違う' }, 401);
    }
    await next();
  });

  api.onError((e, c) => c.json({ error: e.message }, 400));

  api.get('/state', (c) => c.json(app.state()));

  // 状態の変化とセッションの動きを流し続ける
  api.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const send = (data: string) => void stream.writeSSE({ data });
      app.clients.add(send);
      stream.onAbort(() => {
        app.clients.delete(send);
      });
      send(JSON.stringify({ type: 'state', state: app.state() }));
      while (!stream.aborted) await stream.sleep(25_000).then(() => stream.writeSSE({ event: 'ping', data: '' }));
    }),
  );

  api.post('/sessions', async (c) => {
    const b = await c.req.json();
    if (!String(b.message ?? '').trim()) throw new Error('頼みたいことを書いて');
    return c.json(app.runner.createSession({ message: String(b.message), modelId: b.modelId, cwd: b.cwd, trigger: 'user' }));
  });

  api.get('/sessions/:id/transcript', (c) => {
    const s = app.store.session(c.req.param('id'));
    if (!s) return c.json({ error: 'セッションが見つからない' }, 404);
    return c.json({ session: s, turns: readTurns(app.config.dataDir, s, Number(c.req.query('from')) || 1) });
  });

  // セッション画面からの返信。作業中なら区切りがついたときに届く
  api.post('/sessions/:id/message', async (c) => {
    const text = String((await c.req.json()).text ?? '').trim();
    if (!text) throw new Error('メッセージを書いて');
    return c.json({ result: app.runner.send(c.req.param('id'), { text, source: 'user', at: new Date().toISOString() }) });
  });

  api.post('/sessions/:id/stop', (c) => {
    app.runner.stop(c.req.param('id'));
    return c.json({ ok: true });
  });

  api.post('/tasks/:id/answer', async (c) => c.json(answerTask(app, c.req.param('id'), await c.req.json())));

  // 設定
  api.get('/settings', (c) => c.json(getSettings(app.config)));
  api.put('/settings', async (c) => {
    const s = saveSettings(app.config, await c.req.json());
    app.touch();
    return c.json(s);
  });
  api.post('/settings/check-ollama', async (c) => {
    const b = await c.req.json();
    return c.json(await checkOllama(String(b.host ?? app.config.ollamaHost)));
  });
  api.post('/settings/check-model', async (c) => {
    const b = await c.req.json();
    return c.json(await checkModel(b.model ?? {}, String(b.host ?? app.config.ollamaHost)));
  });

  api.post('/settings/check-embed', async (c) => {
    const b = await c.req.json();
    try {
      const [v] = await embed(String(b.host ?? app.config.ollamaHost), String(b.model), ['テスト']);
      return c.json({ ok: true, message: `使える（${v.length}次元）` });
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ ok: false, message: /model .*not found/i.test(msg) ? 'まだ取ってきていない（「取得する」を押す）' : `使えない: ${msg}` });
    }
  });
  api.post('/settings/pull', async (c) => {
    const b = await c.req.json();
    await pull(String(b.host ?? app.config.ollamaHost), String(b.model));
    return c.json({ ok: true, message: '取ってきた' });
  });

  // 記憶（見るだけ。整理は今すぐ走らせられる）
  api.get('/memory/status', (c) => c.json(app.memory.status()));
  api.get('/memory/list', async (c) => {
    const q = c.req.query('q')?.trim();
    const kind = c.req.query('kind') || undefined;
    const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
    if (q) return c.json(await app.memory.search(q, { limit, kind }));
    const now = Date.now();
    const items = app.memory.db.list({ kind, limit, offset: Number(c.req.query('offset')) || 0 });
    return c.json(items.map((m) => ({ ...m, retention: retention(m, now) })));
  });
  api.get('/memory/logs', (c) => c.json(app.memory.db.logs(50)));
  api.get('/memory/item/:id', (c) => {
    const m = app.memory.db.get(c.req.param('id'));
    if (!m) return c.json({ error: 'その記憶は無い' }, 404);
    return c.json({ ...m, retention: retention(m), sourceItems: app.memory.db.getMany(m.sources ?? []) });
  });
  api.post('/memory/consolidate', (c) => {
    void app.memory.consolidate();
    return c.json({ ok: true });
  });

  const root = new Hono();
  root.route('/api', api);
  root.use('/*', serveStatic({ root: WEB_DIST }));
  root.get('*', serveStatic({ root: WEB_DIST, path: 'index.html' })); // 画面の中の移動（#/...）はすべて index.html

  serve({ fetch: root.fetch, port: app.config.port, hostname: app.config.host });
}
