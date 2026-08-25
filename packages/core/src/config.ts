import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import { configPath } from './paths.js';

export const AllamaConfigSchema = z.object({
  ollamaBaseUrl: z.url().default('http://127.0.0.1:11434'),
  plannerModel: z.string().default('kimi-k3:cloud'),
  executorModel: z.string().default('kimi-k2.7-code:cloud'),
  heartbeatMs: z.number().int().positive().default(60_000),
  maxToolIterations: z.number().int().positive().default(40),
  apiToken: z.string().min(32),
});
export type AllamaConfig = z.infer<typeof AllamaConfigSchema>;

export function defaultConfig(): AllamaConfig {
  return {
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    plannerModel: 'kimi-k3:cloud',
    executorModel: 'kimi-k2.7-code:cloud',
    heartbeatMs: 60_000,
    maxToolIterations: 40,
    apiToken: randomBytes(24).toString('base64url'),
  };
}

export async function loadConfig(path = configPath()): Promise<AllamaConfig> {
  try {
    return AllamaConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    const config = defaultConfig();
    await saveConfig(config, path);
    return config;
  }
}

export async function saveConfig(config: AllamaConfig, path = configPath()): Promise<void> {
  const parsed = AllamaConfigSchema.parse(config);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}
