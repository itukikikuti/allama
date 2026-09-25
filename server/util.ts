import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const nowIso = (): string => new Date().toISOString();
export const newId = (): string => crypto.randomUUID();
export const shortId = (): string => crypto.randomBytes(4).toString('hex');

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** 例: 2026/09/25(金) 21:30 */
export function formatTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 例: 2026-09-25 */
export function localDate(d: Date, tz: string): string {
  return d.toLocaleDateString('sv-SE', { timeZone: tz });
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…（残り${s.length - n}文字省略）` : s;
}

export function firstLine(s: string, n: number): string {
  const line = s.trim().split('\n')[0] ?? '';
  return line.length > n ? `${line.slice(0, n)}…` : line;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
