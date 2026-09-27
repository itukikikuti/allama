import type {
  AppState,
  CheckResult,
  MemoryItem,
  MemoryLog,
  ModelSetting,
  ServerEvent,
  SessionMeta,
  Settings,
  Task,
  TurnData,
} from '../../shared/types.ts';
import { loadPref, savePref } from './util.ts';

export class UnauthorizedError extends Error {}

export const getToken = () => loadPref('token');
export const setToken = (t: string) => savePref('token', t);

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { 'x-allama-token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new UnauthorizedError('合言葉が必要');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  state: () => req<AppState>('GET', '/api/state'),
  transcript: (id: string) => req<{ session: SessionMeta; turns: TurnData[] }>('GET', `/api/sessions/${id}/transcript`),
  startSession: (b: { message: string; modelId?: string; cwd?: string }) => req<SessionMeta>('POST', '/api/sessions', b),
  answer: (taskId: string, b: { action?: string; text?: string }) => req<Task>('POST', `/api/tasks/${taskId}/answer`, b),
  stop: (id: string) => req<{ ok: boolean }>('POST', `/api/sessions/${id}/stop`),
  sendMessage: (id: string, text: string) =>
    req<{ result: 'started' | 'queued' }>('POST', `/api/sessions/${id}/message`, { text }),
  memoryList: (q: string, kind: string) =>
    req<MemoryItem[]>('GET', `/api/memory/list?limit=100&q=${encodeURIComponent(q)}&kind=${encodeURIComponent(kind)}`),
  memoryItem: (id: string) => req<MemoryItem & { sourceItems: MemoryItem[] }>('GET', `/api/memory/item/${id}`),
  memoryLogs: () => req<MemoryLog[]>('GET', '/api/memory/logs'),
  consolidate: () => req<{ ok: boolean }>('POST', '/api/memory/consolidate'),
  settings: () => req<Settings>('GET', '/api/settings'),
  saveSettings: (s: Settings) => req<Settings>('PUT', '/api/settings', s),
  checkOllama: (host: string) => req<CheckResult>('POST', '/api/settings/check-ollama', { host }),
  checkModel: (model: ModelSetting, host: string) => req<CheckResult>('POST', '/api/settings/check-model', { model, host }),
  checkEmbed: (model: string, host: string) => req<CheckResult>('POST', '/api/settings/check-embed', { model, host }),
  pull: (model: string, host: string) => req<CheckResult>('POST', '/api/settings/pull', { model, host }),
};

type Listener = (ev: ServerEvent) => void;
const listeners = new Set<Listener>();

export function onServerEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let source: EventSource | null = null;

/** サーバーからの知らせを受け取り続ける（切れたら自動で繋ぎ直す） */
export function connectEvents(onStatus: (online: boolean) => void): () => void {
  const token = getToken();
  source?.close();
  const es = new EventSource(`/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);
  source = es;
  es.onopen = () => onStatus(true);
  es.onerror = () => onStatus(false);
  es.onmessage = (m) => {
    let ev: ServerEvent;
    try {
      ev = JSON.parse(m.data);
    } catch {
      return;
    }
    for (const l of listeners) l(ev);
  };
  return () => es.close();
}
