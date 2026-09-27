import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { App } from './app.ts';
import { APP_DIR } from './config.ts';
import { readTurns } from './transcript.ts';
import { answerTask, callTool } from './tools.ts';

const WEB_DIST = path.join(APP_DIR, 'web', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 10 * 1024 * 1024) throw new HttpError(413, '大きすぎる');
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'JSONが読めない');
  }
}

function serveStatic(res: http.ServerResponse, urlPath: string): void {
  if (!fs.existsSync(WEB_DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('画面がまだビルドされていません。`npm run build` を実行してください。');
    return;
  }
  let file = path.join(WEB_DIST, path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, ''));
  if (!file.startsWith(WEB_DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(WEB_DIST, 'index.html');
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

async function handle(app: App, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  const method = req.method ?? 'GET';

  if (!p.startsWith('/api/')) return serveStatic(res, p);

  const token = app.config.authToken;
  if (token && req.headers['x-allama-token'] !== token && url.searchParams.get('token') !== token) {
    throw new HttpError(401, '合言葉が違う');
  }

  if (method === 'GET' && p === '/api/state') return sendJson(res, 200, app.state());

  if (method === 'GET' && p === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`data: ${JSON.stringify({ type: 'state', state: app.state() })}\n\n`);
    app.clients.add(res);
    req.on('close', () => app.clients.delete(res));
    return;
  }

  if (method === 'POST' && p === '/api/sessions') {
    const b = await readBody(req);
    if (!String(b.message ?? '').trim()) throw new HttpError(400, '頼みたいことを書いて');
    const s = app.runner.createSession({ message: String(b.message), modelId: b.modelId, cwd: b.cwd, trigger: 'user' });
    return sendJson(res, 200, s);
  }

  let m = p.match(/^\/api\/sessions\/([\w-]+)\/transcript$/);
  if (method === 'GET' && m) {
    const s = app.store.session(m[1]);
    if (!s) throw new HttpError(404, 'セッションが見つからない');
    return sendJson(res, 200, { session: s, turns: readTurns(app.config.dataDir, s, Number(url.searchParams.get('from')) || 1) });
  }

  // セッション画面からの返信。作業中なら区切りがついたときに届く
  m = p.match(/^\/api\/sessions\/([\w-]+)\/message$/);
  if (method === 'POST' && m) {
    const b = await readBody(req);
    const text = String(b.text ?? '').trim();
    if (!text) throw new HttpError(400, 'メッセージを書いて');
    if (!app.store.session(m[1])) throw new HttpError(404, 'セッションが見つからない');
    const r = app.runner.send(m[1], { text, source: 'user', at: new Date().toISOString() });
    return sendJson(res, 200, { result: r });
  }

  // 記憶のビューワー（見るだけ）
  if (method === 'GET' && p === '/api/mind/files') return sendJson(res, 200, app.mind.files());
  if (method === 'GET' && p === '/api/mind/file') {
    const content = app.mind.readSafe(url.searchParams.get('path') ?? '');
    if (content === null) throw new HttpError(404, 'ファイルが見つからない');
    return sendJson(res, 200, { content });
  }
  if (method === 'GET' && p === '/api/mind/history') {
    return sendJson(res, 200, await app.mind.history(Number(url.searchParams.get('limit')) || 100));
  }
  m = p.match(/^\/api\/mind\/commit\/([0-9a-f]+)$/);
  if (method === 'GET' && m) {
    const diff = await app.mind.commitDiff(m[1]);
    if (diff === null) throw new HttpError(404, 'その記録は見つからない');
    return sendJson(res, 200, { diff });
  }

  m = p.match(/^\/api\/sessions\/([\w-]+)\/stop$/);
  if (method === 'POST' && m) {
    app.runner.stop(m[1]);
    return sendJson(res, 200, { ok: true });
  }

  m = p.match(/^\/api\/tasks\/([\w-]+)\/answer$/);
  if (method === 'POST' && m) {
    const b = await readBody(req);
    try {
      return sendJson(res, 200, answerTask(app, m[1], b));
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  }

  // 手（MCPサーバー）からの道具の呼び出し
  if (method === 'POST' && p === '/api/head/call') {
    const b = await readBody(req);
    try {
      const text = await callTool(app, String(b.sessionId), String(b.name), b.args);
      return sendJson(res, 200, { text });
    } catch (e) {
      return sendJson(res, 200, { text: (e as Error).message, isError: true });
    }
  }

  throw new HttpError(404, '無いAPI');
}

export function startHttp(app: App): http.Server {
  const server = http.createServer((req, res) => {
    handle(app, req, res).catch((e) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error('[api]', e);
      if (!res.headersSent) sendJson(res, status, { error: (e as Error).message });
      else res.end();
    });
  });
  server.listen(app.config.port, app.config.host);
  return server;
}
