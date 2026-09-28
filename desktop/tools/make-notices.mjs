// 同梱物に混ざる third-party の表示（著作権とライセンス文）を THIRD-PARTY-NOTICES.txt にまとめる。
//
// 配る .exe の中身は、自分たちのコードだけではない:
//   web/dist の JS … react などを束ねたもの（この道具が面倒を見る）
//   同梱の node    … Node.js と npm（それぞれのライセンス文をそのまま同梱している）
//   Electron       … LICENSE.electron.txt と LICENSES.chromium.html が付く
//
// どの package が束ねられたかは、ビルドの記録（web/.bundled-packages.json）を見る。
// web/vite.config.ts の collectBundledPackages が書く。人が一覧を持つと、依存が変わったときにずれる。
//
//   node desktop/tools/make-notices.mjs        （desktop/ で npm run notices でもよい）
//
// web/.bundled-packages.json が無いときは、先に本体をビルドする（npm run build）。

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const listFile = path.join(repo, 'web', '.bundled-packages.json');
const nodeModules = path.join(repo, 'node_modules');
const outFile = path.join(repo, 'THIRD-PARTY-NOTICES.txt');

const appVersion = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;

if (!fs.existsSync(listFile)) {
  console.error(`束ねられた package の記録がありません: ${listFile}`);
  console.error('先に本体をビルドしてください（リポジトリの根で npm run build）。');
  process.exit(1);
}

const names = JSON.parse(fs.readFileSync(listFile, 'utf8'));
if (!names.length) {
  console.error(`${listFile} が空です。ビルドが本当に走ったか確かめてください。`);
  process.exit(1);
}

/** package の場所を探す。近いほう（浅いほう）を採る */
function findPackageDir(name) {
  const require = createRequire(path.join(repo, 'noop.js'));
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    // exports で package.json を出していない package は、木を歩いて探す
  }
  let best = null;
  let bestDepth = Infinity;
  const walk = (dir, depth) => {
    if (depth > bestDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.name === 'node_modules') {
        walk(p, depth + 1);
        continue;
      }
      if (e.name.startsWith('@')) {
        for (const sub of fs.readdirSync(p, { withFileTypes: true })) {
          if (!sub.isDirectory()) continue;
          const sp = path.join(p, sub.name);
          if (fs.existsSync(path.join(sp, 'package.json')) && `${e.name}/${sub.name}` === name && depth < bestDepth) {
            best = sp;
            bestDepth = depth;
          }
          walk(path.join(sp, 'node_modules'), depth + 1);
        }
        continue;
      }
      if (fs.existsSync(path.join(p, 'package.json')) && e.name === name && depth < bestDepth) {
        best = p;
        bestDepth = depth;
      }
      walk(path.join(p, 'node_modules'), depth + 1);
    }
  };
  walk(nodeModules, 0);
  return best;
}

/** ライセンス文。LICENSE / COPYING / NOTICE を拾う */
function licenseText(dir) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return '';
  }
  const hits = files
    .filter((f) => /^(licen[cs]e|copying|notice)/i.test(f))
    .filter((f) => {
      try {
        return fs.statSync(path.join(dir, f)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
  return hits
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim())
    .filter(Boolean)
    .join('\n\n');
}

const body = [];
const missing = [];

for (const name of names) {
  const dir = findPackageDir(name);
  if (!dir) {
    missing.push(name);
    continue;
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? '（package.json に表示なし）');
  const text = licenseText(dir);
  // ライセンス文のファイルを同梱していない package もある（wouter など）。そのときは
  // package.json の表示だけを写し、どこを見ればよいかを書く。文を勝手に作ったりはしない。
  const fallback =
    `（この package はライセンス文のファイルを同梱していない。package.json の表示は ${license}。\n` +
    `  ${pkg.name}@${pkg.version} の配布物（https://www.npmjs.com/package/${pkg.name} など）を参照）\n` +
    (license === 'Unlicense' ? '（Unlicense は権利を放棄する表示なので、著作権表示の義務は無い）\n' : '');
  body.push(`${'-'.repeat(76)}\n${pkg.name} ${pkg.version}\nライセンス: ${license}\n\n` + (text ? `${text}\n` : fallback));
}

if (missing.length) {
  console.error(`node_modules に見つからなかった package: ${missing.join(', ')}`);
  console.error('npm ci が済んでいるか、名前が合っているか確かめてください。');
  process.exit(1);
}

const header = `allama ${appVersion} に同梱している third-party の表示
================================================================================

このファイルは、allama の配布物（allama-${appVersion}-win-x64 など）に混ざっている
third-party のコードの著作権表示とライセンス文をまとめたものです。
作る仕組み: desktop/tools/make-notices.mjs（ビルドの記録から、画面に束ねられた package を拾う）

次のものは、それぞれのライセンス文をそのまま同梱しています:
  Electron（MIT）      … LICENSE.electron.txt
  Chromium ほか        … LICENSES.chromium.html
  Node.js（MIT）       … resources/node/LICENSE
  npm（Artistic-2.0）  … resources/node/node_modules/npm/LICENSE

本体の依存（hono、Claude Code など）は配布物には入っていません。初回の起動で npm から
取ってくるので、それぞれのライセンス文はそのときについてきます。

`;

fs.writeFileSync(outFile, header + body.join('\n'));
console.log(`書いた: ${outFile}（${names.length} 件）`);
