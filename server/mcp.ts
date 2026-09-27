// 手（Claude Code）から頭の道具を呼ぶための、小さなMCPサーバー（標準入出力）。
// 道具の中身はすべてサーバー本体にあり、ここは取り次ぐだけ。

import readline from 'node:readline';
import { TOOL_DEFS } from './tool-defs.ts';

const URL_BASE = process.env.ALLAMA_URL ?? 'http://127.0.0.1:3170';
const SESSION_ID = process.env.ALLAMA_SESSION_ID ?? '';
const TOKEN = process.env.ALLAMA_TOKEN ?? '';

function send(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function callTool(name: string, args: unknown): Promise<{ text: string; isError?: boolean }> {
  const res = await fetch(`${URL_BASE}/api/head/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(TOKEN ? { 'x-allama-token': TOKEN } : {}) },
    body: JSON.stringify({ sessionId: SESSION_ID, name, args }),
  });
  if (!res.ok) return { text: `頭のサーバーに届かなかった（HTTP ${res.status}）`, isError: true };
  return (await res.json()) as { text: string; isError?: boolean };
}

async function handle(msg: any): Promise<unknown> {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'allama', version: '0.1.0' },
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOL_DEFS };
    case 'tools/call': {
      try {
        const r = await callTool(msg.params?.name, msg.params?.arguments ?? {});
        return { content: [{ type: 'text', text: r.text }], isError: !!r.isError };
      } catch (e) {
        return { content: [{ type: 'text', text: `頭のサーバーに届かなかった: ${(e as Error).message}` }], isError: true };
      }
    }
    default:
      throw Object.assign(new Error(`Method not found: ${msg.method}`), { code: -32601 });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined || msg.id === null) return; // 通知には返事しない
  handle(msg).then(
    (result) => send({ jsonrpc: '2.0', id: msg.id, result }),
    (e) => send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? -32603, message: e.message } }),
  );
});
rl.on('close', () => process.exit(0));
