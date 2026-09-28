// 設定画面の「確かめる」：Ollama につながるか、モデルが実際に答えるか

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ModelConfig } from './config.ts';
import { handEnv } from './runner.ts';

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

/** 短い質問をして、答えが返るか見る */
export async function checkModel(m: ModelConfig, host: string): Promise<{ ok: boolean; message: string }> {
  if (!m.ollama) return checkClaude(m.claude);
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

/** Claude のモデルに短い質問をして、答えが返るか見る（セッションと同じ道を通す） */
export async function checkClaude(model?: string): Promise<{ ok: boolean; message: string }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 90_000);
  let result: any;
  try {
    const q = query({
      prompt: 'Reply with exactly: ok',
      options: {
        ...(model ? { model } : {}),
        maxTurns: 1,
        tools: [],
        settingSources: ['user', 'project', 'local'],
        abortController: abort,
        env: handEnv(process.env),
        stderr: () => {},
      },
    });
    for await (const msg of q) if ((msg as any).type === 'result') result = msg;
  } catch (e) {
    return { ok: false, message: abort.signal.aborted ? '時間内に答えなかった（`claude` にログインしていないかも）' : `使えない: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
  if (!result) return { ok: false, message: '答えが返らなかった（`claude` にログインしていないかも）' };
  if (result.is_error) return { ok: false, message: `使えない: ${String(result.result ?? result.subtype ?? 'エラー').slice(0, 200)}` };
  // どのモデルが答えたかも出す（環境変数で別の所に流れていると、ここで気づける）
  const answered = Object.keys(result.modelUsage ?? {}).map((name) => name.replace(/\[[^\]]*\]$/, ''));
  return { ok: true, message: `答えが返ってきた（${(answered.length ? answered.join(', ') : String(result.result ?? '').trim()).slice(0, 60)}）` };
}
