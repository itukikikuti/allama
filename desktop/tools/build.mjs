// 窓の .exe を組む。まず同梱する物（アイコン・Node・third-party の表示）をそろえ、それから electron-builder を回す。
// 組む物の選び方は、ここが持ち主（desktop/electron-builder.yml には書かない。2箇所に分かれると、いつか食い違う）。
//
//   node tools/build.mjs        （desktop/ で npm run build でもよい）
//
// インストーラ（setup.exe）は Windows でしか組めない。Linux で nsis を組もうとすると、最後に
// 版情報を書き込む所で wine を呼ぼうとして止まり、中身の入っていない setup.exe（200KB ほど）が
// 黙って残る。配ると事故になるので、Windows 以外では zip だけを組む。
// 配る setup.exe は、本物の Windows で組む CI（.github/workflows/windows.yml、windows-latest）が作る。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const outDir = path.resolve(desktop, '..', 'dist-desktop');
const version = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8')).version;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: desktop });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    console.error(`\n止まった（${path.basename(cmd)} ${args.join(' ')} → code=${r.status}）`);
    process.exit(r.status ?? 1);
  }
}

// 同梱する物をそろえる
for (const tool of ['make-icon.mjs', 'fetch-node.mjs', 'make-notices.mjs']) {
  run(process.execPath, [path.join(here, tool)]);
}

const onWindows = process.platform === 'win32';
const targets = onWindows ? ['nsis', 'zip'] : ['zip'];

if (!onWindows) {
  console.log(
    [
      '',
      '手元は Windows ではないので、インストーラ（setup.exe）は組みません。',
      '配る setup.exe は、本物の Windows で組む CI が作ります（.github/workflows/windows.yml）。',
      '手元で確かめたいのは中身なので、zip だけで足ります。',
      '',
    ].join('\n'),
  );
}

const cli = createRequire(import.meta.url).resolve('electron-builder/cli.js');
run(process.execPath, [cli, '--win', ...targets, '--x64', '--config', 'electron-builder.yml']);

// 出来た物を確かめる。中身の入っていない setup.exe を黙って残さないための見張り。
const MIN_ZIP = 20 * 1024 * 1024;
const MIN_SETUP = 10 * 1024 * 1024;
const problems = [];

const zip = path.join(outDir, `allama-${version}-win-x64.zip`);
if (!fs.existsSync(zip)) problems.push(`zip が出来ていない: ${zip}`);
else if (fs.statSync(zip).size < MIN_ZIP) problems.push(`zip が小さすぎる: ${zip}（${fs.statSync(zip).size} バイト）`);

if (onWindows) {
  const setup = path.join(outDir, `allama-${version}-win-x64-setup.exe`);
  if (!fs.existsSync(setup)) problems.push(`setup.exe が出来ていない: ${setup}`);
  else if (fs.statSync(setup).size < MIN_SETUP) {
    problems.push(`setup.exe が小さすぎる（中身が入っていない疑い）: ${setup}（${fs.statSync(setup).size} バイト）`);
  }
}

if (problems.length) {
  console.error(`\n出来た物がおかしい:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

console.log(`\n出来た物: ${outDir}`);
