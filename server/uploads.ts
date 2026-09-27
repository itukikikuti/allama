// 画面から預かったファイルの置き場。
// 置いたパスをそのままメッセージに添えるので、セッションは Read でそのまま開ける。

import fs from 'node:fs';
import path from 'node:path';
import type { UploadedFile } from '../shared/types.ts';
import type { Config } from './config.ts';
import { localDate, shortId } from './util.ts';

/** これより大きいファイルは断る */
const MAX_BYTES = 32 * 1024 * 1024;

export function uploadsDir(config: Config): string {
  return path.join(config.dataDir, 'uploads');
}

/** 画面から来た名前を、置ける名前に直す（道は持たせない） */
function safeName(name: string): string {
  const base = path
    .basename(name || 'file')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f/\\]/g, '_')
    .trim();
  if (!base || base === '.' || base === '..') return 'file';
  return base.length > 120 ? base.slice(-120) : base;
}

/** 預かって、置いた場所を返す */
export async function saveUpload(config: Config, file: File): Promise<UploadedFile> {
  if (file.size > MAX_BYTES) {
    throw new Error(`大きすぎる（${Math.round(file.size / 1024 / 1024)}MB）。${MAX_BYTES / 1024 / 1024}MB まで`);
  }
  const name = safeName(file.name);
  const dir = path.join(uploadsDir(config), localDate(new Date(), config.timezone));
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${shortId()}-${name}`);
  fs.writeFileSync(target, Buffer.from(await file.arrayBuffer()));
  return { path: target, name, size: file.size };
}

/** 画面から来たパスが、本当に預かり所の中にあるかを確かめる */
export function checkFiles(config: Config, input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.some((p) => typeof p !== 'string')) throw new Error('添付ファイルの指定が不正');
  const root = `${uploadsDir(config)}${path.sep}`;
  return input.map((raw) => {
    const p = path.resolve(raw);
    if (!p.startsWith(root)) throw new Error(`預かり所の外のファイルは添えられない: ${raw}`);
    if (!fs.existsSync(p)) throw new Error(`添付ファイルが見つからない: ${raw}`);
    return p;
  });
}

/** 本文のうしろに、預かったファイルの一覧を足す */
export function withAttachments(text: string, files: string[]): string {
  if (!files.length) return text;
  const block = `【添付ファイル】\n${files.map((f) => `- ${f}`).join('\n')}`;
  return text ? `${text}\n\n${block}` : block;
}

/** 添付だけを送ったときの題名に使う */
export function attachmentNames(files: string[]): string {
  return files.map((f) => path.basename(f).replace(/^[0-9a-f]{8}-/, '')).join('、');
}
