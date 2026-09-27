// 記憶の処理に使う Ollama（文章から記憶を取り出す・整理する・埋め込みを計算する）

import { z } from 'zod';

const base = (host: string) => (/^https?:\/\//.test(host) ? host : `http://${host}`).replace(/\/+$/, '');

async function post(host: string, path: string, body: unknown, timeoutMs: number): Promise<any> {
  const res = await fetch(`${base(host)}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Ollama ${path}（HTTP ${res.status}）: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function extractJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    // 前後に余計な文字（```json など）が付いたときのため、最初の { から最後の } までを読む
    const i = content.indexOf('{');
    const j = content.lastIndexOf('}');
    if (i >= 0 && j > i) return JSON.parse(content.slice(i, j + 1));
    throw new Error('JSON が見つからない');
  }
}

/**
 * 決まった形（zod のスキーマ）で答えさせる。
 * クラウドモデルは format の指定を守らないことがあるので、形をプロンプトにも書き、
 * 検査して違っていたら、どこが違うかを伝えてやり直させる。
 */
export async function chatJson<T>(host: string, model: string, system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  const jsonSchema = z.toJSONSchema(schema);
  const messages = [
    { role: 'system', content: `${system}\n\n答えは、次の JSON Schema に従う JSON だけを返す（説明の文は付けない）。\n${JSON.stringify(jsonSchema)}` },
    { role: 'user', content: user },
  ];
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await post(host, '/api/chat', { model, stream: false, format: jsonSchema, options: { temperature: 0.2 }, messages }, 300_000);
    const content: string = r.message?.content ?? '';
    try {
      const parsed = schema.safeParse(extractJson(content));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' / ');
    } catch (e) {
      lastError = (e as Error).message;
    }
    messages.push({ role: 'assistant', content }, { role: 'user', content: `形が違う（${lastError}）。JSON Schema に従う JSON だけを返し直して。` });
  }
  throw new Error(`決まった形の答えが返ってこない: ${lastError}`);
}

export async function embed(host: string, model: string, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const r = await post(host, '/api/embed', { model, input: texts }, 120_000);
  return r.embeddings as number[][];
}

/** モデルを取ってくる（埋め込みモデルは手元で動くので、初回に必要） */
export async function pull(host: string, model: string): Promise<void> {
  await post(host, '/api/pull', { model, stream: false }, 30 * 60_000);
}
