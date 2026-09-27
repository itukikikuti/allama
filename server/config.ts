import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** この仕組みのソースコードの場所 */
export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** セッションに使うモデル。Ollama のモデルか、Claude（Anthropic）のモデルのどちらか */
const ModelSchema = z
  .object({
    id: z.string().trim().min(1, 'モデルのIDは必須'),
    label: z.string().trim().min(1, 'モデルの表示名は必須'),
    /** Ollama のモデル名（例: deepseek-v4.1-flash:cloud）。`ollama launch claude` と同じ設定で動かす */
    ollama: z.string().trim().optional(),
    /** Claude のモデル名（例: opus）。空なら Claude Code の既定 */
    claude: z.string().trim().optional(),
  })
  .refine((m) => (m.ollama !== undefined) !== (m.claude !== undefined), {
    message: 'モデルは Ollama か Claude のどちらか一方を指定する',
  })
  .refine((m) => m.ollama === undefined || m.ollama.length > 0, { message: 'Ollama のモデル名が空' });

const SettingsSchema = z
  .object({
    ollamaHost: z.string().trim().min(1).default('http://127.0.0.1:11434'),
    models: z.array(ModelSchema).min(1, 'モデルが1つも無い'),
    defaultModelId: z.string(),
    memory: z.object({
      /** 記憶の処理（覚える・整理する）に使う Ollama のモデル */
      model: z.string().trim().min(1, '記憶に使うモデルが空'),
      /** 意味で探すための埋め込みモデル（Ollama で手元で動く） */
      embedModel: z.string().trim().min(1, '埋め込みモデルが空'),
    }),
  })
  .refine((s) => s.models.some((m) => m.id === s.defaultModelId), { message: '既定のモデルが一覧に無い' })
  .refine((s) => new Set(s.models.map((m) => m.id)).size === s.models.length, { message: 'モデルのIDが重複している' });

export type ModelConfig = z.infer<typeof ModelSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

export interface Config extends Settings {
  host: string;
  port: number;
  dataDir: string;
  defaultCwd: string;
  timezone: string;
  authToken: string;
  /** 目覚ましが1つも無いとき、この時間後に起こす */
  fallbackPatrolHours: number;
}

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

const configFile = (): string => process.env.ALLAMA_CONFIG ?? path.join(APP_DIR, 'config.json');

function readRaw(): any {
  const file = configFile();
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

/** 古い形（command: ["claude", "--model", "opus"]）を今の形に直す */
function migrateModel(m: any): any {
  if (m.ollama !== undefined || m.claude !== undefined) return { id: m.id, label: m.label, ollama: m.ollama, claude: m.claude };
  const c: string[] = m.command ?? ['claude'];
  return { id: m.id, label: m.label, claude: c[1] === '--model' ? c[2] ?? '' : '' };
}

export function loadConfig(): Config {
  const raw = readRaw();
  const models = (raw.models?.length ? raw.models : [{ id: 'claude', label: 'Claude', claude: '' }]).map(migrateModel);
  const firstOllama = models.find((m: ModelConfig) => m.ollama)?.ollama ?? 'deepseek-v4.1-flash:cloud';
  const settings = SettingsSchema.parse({
    ollamaHost: raw.ollamaHost ?? process.env.OLLAMA_HOST,
    models,
    defaultModelId: raw.defaultModelId ?? models[0].id,
    memory: { model: raw.memory?.model ?? firstOllama, embedModel: raw.memory?.embedModel ?? 'qwen3-embedding:0.6b' },
  });
  return {
    ...settings,
    host: raw.host ?? '127.0.0.1',
    port: raw.port ?? 3170,
    dataDir: path.resolve(APP_DIR, expandHome(raw.dataDir ?? '~/.allama')),
    defaultCwd: path.resolve(APP_DIR, expandHome(raw.defaultCwd ?? '~')),
    timezone: raw.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    authToken: raw.authToken ?? '',
    fallbackPatrolHours: raw.fallbackPatrolHours ?? 6,
  };
}

export function getSettings(cfg: Config): Settings {
  return { ollamaHost: cfg.ollamaHost, models: cfg.models, defaultModelId: cfg.defaultModelId, memory: cfg.memory };
}

/** 設定画面からの変更を確かめて config.json に書き、動いている設定にもすぐ反映する */
export function saveSettings(cfg: Config, input: unknown): Settings {
  const r = SettingsSchema.safeParse(input);
  if (!r.success) throw new Error(r.error.issues.map((i) => i.message).join('、'));
  const raw = { ...readRaw(), ...r.data };
  delete raw.ownerName;
  const file = configFile();
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(raw, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
  Object.assign(cfg, r.data);
  return getSettings(cfg);
}

/** `ollama launch claude` が Claude Code に渡すのと同じ設定 */
export function ollamaEnv(host: string, model: string): Record<string, string> {
  const base = /^https?:\/\//.test(host) ? host : `http://${host}`;
  return {
    ANTHROPIC_BASE_URL: base.replace(/\/+$/, ''),
    ANTHROPIC_AUTH_TOKEN: 'ollama',
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
  };
}
