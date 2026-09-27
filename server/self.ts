// 自分の体（このソースコード）を書き換えたあとの再起動。
// 壊れたまま再起動すると自分では直せなくなるので、確かめてから再起動する。

import { execFile } from 'node:child_process';
import path from 'node:path';
import { APP_DIR } from './config.ts';

function run(label: string, args: string[]): Promise<{ ok: boolean; log: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      args,
      { cwd: APP_DIR, windowsHide: true, timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = `${stdout}${stderr}`.trim();
        resolve({ ok: !err, log: err ? `✗ ${label}\n${out.slice(-4000)}` : `✓ ${label}` });
      },
    );
  });
}

/** 型チェック・画面のビルド・読み込みの確認。どれかが失敗したら再起動しない */
export async function checkBody(): Promise<{ ok: boolean; log: string }> {
  const tsc = path.join(APP_DIR, 'node_modules', 'typescript', 'bin', 'tsc');
  const vite = path.join(APP_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  const steps: [string, string[]][] = [
    ['サーバーの型チェック', [tsc, '-p', 'tsconfig.json']],
    ['画面の型チェック', [tsc, '-p', 'web/tsconfig.json']],
    ['画面のビルド', [vite, 'build', '--config', 'web/vite.config.ts', '--logLevel', 'warn']],
    [
      'サーバーの読み込み',
      ['--no-warnings', '--input-type=module', '-e', "await import('./server/api.ts'); await import('./server/app.ts');"],
    ],
  ];
  const logs: string[] = [];
  for (const [label, args] of steps) {
    const r = await run(label, args);
    logs.push(r.log);
    if (!r.ok) return { ok: false, log: logs.join('\n') };
  }
  return { ok: true, log: logs.join('\n') };
}

