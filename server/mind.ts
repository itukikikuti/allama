// 記憶フォルダの管理。中身の書き方は本人が決める（最初は空の README.md だけ）。
// ここでは、最初の種まき・git への記録・読み出し・検索だけを受け持つ。

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { MindCommit, MindFile } from '../shared/types.ts';
import { APP_DIR } from './config.ts';
import { readText } from './util.ts';

function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return reject(err);
      resolve({ code: err ? Number((err as any).code) || 1 : 0, stdout: String(stdout) });
    });
  });
}

export class Mind {
  dir: string;
  dataDir: string;
  private chain: Promise<unknown> = Promise.resolve();
  private gitOk = true;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.dir = path.join(dataDir, 'mind');
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true });
    const empty = fs.readdirSync(this.dir).filter((f) => f !== '.git').length === 0;
    if (empty) fs.cpSync(path.join(APP_DIR, 'mind-seed'), this.dir, { recursive: true });
    if (!fs.existsSync(path.join(this.dir, '.git'))) {
      try {
        await git(this.dir, ['init', '-q']);
        await git(this.dir, ['config', 'user.name', 'allama']);
        await git(this.dir, ['config', 'user.email', 'allama@localhost']);
        await this.backup('記憶の始まり');
      } catch {
        this.gitOk = false;
        console.warn('[mind] gitが見つからないため、記憶のバックアップは無効');
      }
    }
  }

  /** 記憶フォルダの変更をgitに記録する（直列に実行） */
  backup(message: string): Promise<unknown> {
    if (!this.gitOk) return Promise.resolve();
    this.chain = this.chain
      .then(async () => {
        await git(this.dir, ['add', '-A']);
        const diff = await git(this.dir, ['diff', '--cached', '--quiet']);
        if (diff.code !== 0) await git(this.dir, ['commit', '-q', '-m', message]);
      })
      .catch((e) => console.warn('[mind] バックアップ失敗', e));
    return this.chain;
  }

  read(rel: string): string {
    return readText(path.join(this.dir, rel));
  }

  // ---- ビューワー用（見るだけ） ----

  /** 記憶フォルダの中だけを読む。外や .git の中は読まない */
  readSafe(rel: string): string | null {
    const full = path.resolve(this.dir, rel);
    const inside = full.startsWith(this.dir + path.sep);
    const inGit = path.relative(this.dir, full).split(/[\\/]/)[0] === '.git';
    if (!inside || inGit) return null;
    try {
      return fs.readFileSync(full, 'utf8');
    } catch {
      return null;
    }
  }

  files(): MindFile[] {
    return this.listFiles(2000).map((rel) => {
      const st = fs.statSync(path.join(this.dir, rel));
      return { path: rel, size: st.size, mtime: st.mtime.toISOString() };
    });
  }

  /** 記憶の変化の記録（git の履歴） */
  async history(limit = 100): Promise<MindCommit[]> {
    if (!this.gitOk) return [];
    const r = await git(this.dir, ['log', `-n${limit}`, '--name-status', '--format=%x1e%H%x1f%aI%x1f%s']);
    if (r.code !== 0) return [];
    return r.stdout
      .split('\x1e')
      .filter((b) => b.trim())
      .map((block) => {
        const [head, ...rest] = block.split('\n');
        const [hash, date, message] = head.split('\x1f');
        const files = rest
          .filter((l) => l.trim())
          .map((l) => {
            const [status, ...paths] = l.split('\t');
            return { status: status[0], path: paths[paths.length - 1] };
          });
        return { hash, date, message, files };
      });
  }

  /** ある時点での変更の中身（unified diff） */
  async commitDiff(hash: string): Promise<string | null> {
    if (!this.gitOk || !/^[0-9a-f]{4,40}$/.test(hash)) return null;
    const r = await git(this.dir, ['show', '--format=', '--patch', '--no-color', '-M', hash]);
    return r.code === 0 ? r.stdout : null;
  }

  listFiles(limit = 200): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === '.git') continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else out.push(path.relative(this.dir, p).replace(/\\/g, '/'));
        if (out.length >= limit) return;
      }
    };
    try {
      walk(this.dir);
    } catch {
      // 無ければ空
    }
    return out.sort();
  }
}
