// 設定画面の「確かめる」：Ollama につながるか、モデルが実際に答えるか

import type { ModelConfig } from './config.ts';

const base = (host: string) => (/^https?:\/\//.test(host) ? host : `http://${host}`).replace(/\/+$/, '');

export async function checkOllama(host: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${base(host)}/api/version`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, message: `応答が変（HTTP ${res.status}）` };
    const v = (await res.json()) as { version?: string };
    return { ok: true, message: `つながった（Ollama ${v.version ?? '?'}）` };
  } catch (e) {
    return { ok: false, message: `つながらない: ${(e as Error).message}` };
  }
}

/** Ollama のモデルに短い質問をして、答えが返るか見る */
export async function checkModel(m: ModelConfig, host: string): Promise<{ ok: boolean; message: string }> {
  if (!m.ollama) return { ok: true, message: 'Claude のモデルはここでは確かめない（サーバーで `claude` にログインしておく）' };
  try {
    const res = await fetch(`${base(host)}/v1/messages`, {
      method: 'POST',
      signal: AbortSignal.timeout(90_000),
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'ollama',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: m.ollama, max_tokens: 32, messages: [{ role: 'user', content: 'Reply with: ok' }] }),
    });
    if (res.status === 401) return { ok: false, message: 'Ollama にサインインしていない（サーバーで `ollama signin`）' };
    const text = await res.text();
    if (!res.ok) return { ok: false, message: `使えない（HTTP ${res.status}）: ${text.slice(0, 200)}` };
    return { ok: true, message: '答えが返ってきた' };
  } catch (e) {
    return { ok: false, message: `使えない: ${(e as Error).message}` };
  }
}
