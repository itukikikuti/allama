// HTTPサーバー（Hono）。画面からの操作と、セッションの道具（MCP経由）の呼び出しを受ける。

import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { App } from './app.ts';
import { APP_DIR, getSettings, saveSettings } from './config.ts';
import { checkModel, checkOllama } from './providers.ts';
import { readTurns } from './transcript.ts';
import { answerTask, callTool } from './tools.ts';

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

  // 記憶のビューワー（見るだけ）
  api.get('/mind/files', (c) => c.json(app.mind.files()));
  api.get('/mind/file', (c) => {
    const content = app.mind.readSafe(c.req.query('path') ?? '');
    return content === null ? c.json({ error: 'ファイルが見つからない' }, 404) : c.json({ content });
  });
  api.get('/mind/history', async (c) => c.json(await app.mind.history(Number(c.req.query('limit')) || 100)));
  api.get('/mind/commit/:hash', async (c) => {
    const diff = await app.mind.commitDiff(c.req.param('hash'));
    return diff === null ? c.json({ error: 'その記録は見つからない' }, 404) : c.json({ diff });
  });

  // セッションの道具の呼び出し（mcp.ts から）
  api.post('/head/call', async (c) => {
    const b = await c.req.json();
    try {
      return c.json({ text: await callTool(app, String(b.sessionId), String(b.name), b.args) });
    } catch (e) {
      return c.json({ text: (e as Error).message, isError: true });
    }
  });

  const root = new Hono();
  root.route('/api', api);
  root.use('/*', serveStatic({ root: WEB_DIST }));
  root.get('*', serveStatic({ root: WEB_DIST, path: 'index.html' })); // 画面の中の移動（#/...）はすべて index.html

  serve({ fetch: root.fetch, port: app.config.port, hostname: app.config.host });
}
