import type { AppState, MindCommit, MindFile, ServerEvent, SessionMeta, Task, TurnData } from '../../shared/types.ts';
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
  mindFiles: () => req<MindFile[]>('GET', '/api/mind/files'),
  mindFile: (path: string) => req<{ content: string }>('GET', `/api/mind/file?path=${encodeURIComponent(path)}`),
  mindHistory: () => req<MindCommit[]>('GET', '/api/mind/history'),
  mindCommit: (hash: string) => req<{ diff: string }>('GET', `/api/mind/commit/${hash}`),
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
