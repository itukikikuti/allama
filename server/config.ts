import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** このアプリ（秘書の体）のソースコードの場所 */
export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface ModelConfig {
  id: string;
  label: string;
  /**
   * Ollama のモデル名（例: "deepseek-v4.1-flash:cloud"）。
   * 指定すると `ollama launch claude --model <これ>` と同じ設定で Claude Code を動かす。
   */
  ollama?: string;
  /**
   * Claude Code を起動するコマンドの前半。後ろに Claude Code の引数が付く（既定 ["claude"]）。
   * 例: ["claude", "--model", "opus"]
   *     ["ollama", "launch", "claude", "--model", "glm-4.6:cloud", "--yes", "--"]
   */
  command?: string[];
  env?: Record<string, string>;
}

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  defaultCwd: string;
  timezone: string;
  ownerName: string;
  models: ModelConfig[];
  defaultModelId: string;
  authToken: string;
  /** ollama を指定したモデルの接続先 */
  ollamaHost: string;
  /** 目覚ましが1つも無いとき、この時間後に見回りを入れる */
  fallbackPatrolHours: number;
  extraClaudeArgs: string[];
  /** 自分を再起動するコマンド（本人に教える） */
  restartCommand: string;
}

/** 設定画面で変えられる項目 */
export interface Settings {
  ownerName: string;
  ollamaHost: string;
  models: ModelConfig[];
  defaultModelId: string;
}

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

export const configFile = (): string => process.env.ALLAMA_CONFIG ?? path.join(APP_DIR, 'config.json');

function readRaw(): any {
  const file = configFile();
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

export function loadConfig(): Config {
  const raw = readRaw();
  const models: ModelConfig[] = raw.models?.length
    ? raw.models
    : [{ id: 'claude', label: 'Claude', command: ['claude'] }];
  return {
    host: raw.host ?? '127.0.0.1',
    port: raw.port ?? 3170,
    dataDir: path.resolve(APP_DIR, expandHome(raw.dataDir ?? '~/.allama')),
    defaultCwd: path.resolve(APP_DIR, expandHome(raw.defaultCwd ?? '~')),
    timezone: raw.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    ownerName: raw.ownerName ?? 'ユーザー',
    models,
    defaultModelId: raw.defaultModelId ?? models[0].id,
    authToken: raw.authToken ?? '',
    ollamaHost: raw.ollamaHost ?? process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434',
    fallbackPatrolHours: raw.fallbackPatrolHours ?? 6,
    extraClaudeArgs: raw.extraClaudeArgs ?? [],
    restartCommand: raw.restartCommand ?? 'systemctl --user restart allama',
  };
}

export function getSettings(cfg: Config): Settings {
  return { ownerName: cfg.ownerName, ollamaHost: cfg.ollamaHost, models: cfg.models, defaultModelId: cfg.defaultModelId };
}

/** 設定画面からの変更を確かめて config.json に書き、動いている設定にもすぐ反映する */
export function saveSettings(cfg: Config, s: Settings): Settings {
  const models = Array.isArray(s.models) ? s.models : [];
  if (!models.length) throw new Error('モデルが1つも無い');
  const ids = new Set<string>();
  for (const m of models) {
    if (!m.id?.trim() || !m.label?.trim()) throw new Error('モデルのIDと表示名は必須');
    if (ids.has(m.id)) throw new Error(`モデルのIDが重複している: ${m.id}`);
    ids.add(m.id);
    if (!m.ollama?.trim() && !m.command?.length) throw new Error(`「${m.label}」の中身（Ollama のモデル名か起動コマンド）が無い`);
  }
  if (!ids.has(s.defaultModelId)) throw new Error('既定のモデルが一覧に無い');
  const next: Settings = {
    ownerName: s.ownerName?.trim() || 'ユーザー',
    ollamaHost: s.ollamaHost?.trim() || 'http://127.0.0.1:11434',
    models,
    defaultModelId: s.defaultModelId,
  };
  const raw = { ...readRaw(), ...next };
  const file = configFile();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}
`);
  fs.renameSync(tmp, file);
  Object.assign(cfg, next);
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

/** MCPサーバーなど、同じPC内からこのサーバーに話しかけるときのURL */
export function internalUrl(cfg: Config): string {
  const host = cfg.host === '0.0.0.0' || cfg.host === '::' ? '127.0.0.1' : cfg.host;
  return `http://${host.includes(':') ? `[${host}]` : host}:${cfg.port}`;
}
