import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { OllamaClient } from './ollama.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function mockOllama(): Promise<string> {
  const server = createServer((request, response) => {
    if (request.url === '/api/tags') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ models: [{ name: 'test-model' }] }));
      return;
    }
    response.setHeader('content-type', 'application/x-ndjson');
    response.write(JSON.stringify({ message: { thinking: 'hidden', content: 'hel' } }) + '\n');
    response.end(
      JSON.stringify({
        message: { content: 'lo' },
        prompt_eval_count: 3,
        eval_count: 2,
      }) + '\n',
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  return `http://127.0.0.1:${address.port}`;
}

describe('OllamaClient', () => {
  it('checks models and streams content without exposing thinking', async () => {
    const client = new OllamaClient(await mockOllama());
    expect(await client.health()).toEqual({ models: ['test-model'] });
    const deltas: string[] = [];
    const result = await client.chat(
      { model: 'test-model', messages: [{ role: 'user', content: 'hello' }] },
      (delta) => deltas.push(delta),
    );
    expect(result.content).toBe('hello');
    expect(deltas).toEqual(['hel', 'lo']);
    expect(result).not.toHaveProperty('thinking');
  });
});
