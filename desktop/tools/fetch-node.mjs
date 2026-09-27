// 同梱する Node（Windows x64）を取ってきて vendor/node に置く。
// 本体は Electron の node では動かさない（node:sqlite と .ts の型はぎに Node 24 が要る）。
// Windows では PowerShell の Expand-Archive、それ以外では unzip を使う。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.resolve(here, '..', '..', 'vendor', 'node');
const version = process.env.ALLAMA_NODE_VERSION ?? 'v24.21.0';
const name = `node-${version}-win-x64`;

if (fs.existsSync(path.join(vendor, 'node.exe'))) {
  console.log(`もうある: ${vendor}`);
  process.exit(0);
}

const url = `https://nodejs.org/dist/${version}/${name}.zip`;
console.log(`取ってくる: ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`取れなかった（HTTP ${res.status}）: ${url}`);
const zip = Buffer.from(await res.arrayBuffer());

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'allama-node-'));
const zipFile = path.join(work, `${name}.zip`);
fs.writeFileSync(zipFile, zip);

if (process.platform === 'win32') {
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipFile}' -DestinationPath '${work}' -Force`],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error('展開できなかった（Expand-Archive）');
} else {
  const r = spawnSync('unzip', ['-q', zipFile, '-d', work], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('展開できなかった（unzip）');
}

fs.mkdirSync(vendor, { recursive: true });
fs.cpSync(path.join(work, name), vendor, { recursive: true });
fs.rmSync(work, { recursive: true, force: true });
console.log(`置いた: ${vendor}（${fs.readdirSync(vendor).length} 項目）`);
