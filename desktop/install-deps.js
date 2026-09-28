// 初回の依存入れ（npm ci）。
//
// 本体は resources/app のソースをそのまま動かすので、動かす前に本体の依存（Claude Code など、
// 1GB 近く）が要る。その一手間を窓にやらせて、人が PowerShell や cmd を開かなくて済むようにする。
//
// Electron を読み込まないので、単体で試せる（Linux の手元でも動く）。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** これが入っていなければ「まだ」とみなす */
export const NEEDED = ['hono', '@anthropic-ai/claude-agent-sdk', 'zod'];

/** 入っていない依存の名前を返す（空なら入っている） */
export function missingDeps(appRoot) {
  return NEEDED.filter((n) => !fs.existsSync(path.join(appRoot, 'node_modules', ...n.split('/'))));
}

/**
 * npm ci を回す。同梱の node と npm があればそれを使う（本体は Node 24 で動く）。
 *
 * @param {object} o
 * @param {string} o.appRoot    package.json と package-lock.json のある場所
 * @param {string} [o.nodeExe]  同梱の node
 * @param {string} [o.npmCli]   同梱の npm-cli.js
 * @param {(line: string) => void} [o.onStatus] 今どこかを1行で伝える
 * @param {(text: string) => void} [o.onLog]    出力をそのまま渡す
 * @returns {Promise<{ok: true} | {ok: false, message: string}>}
 */
export async function installDeps({ appRoot, nodeExe, npmCli, onStatus = () => {}, onLog = () => {} }) {
  const bundled = Boolean(nodeExe && npmCli && fs.existsSync(nodeExe) && fs.existsSync(npmCli));
  const cmd = bundled ? nodeExe : 'npm';
  const args = [...(bundled ? [npmCli] : []), 'ci', '--no-audit', '--no-fund'];
  // 同梱でない npm は Windows では npm.cmd なので、殻ごしに呼ぶ
  const shell = !bundled && process.platform === 'win32';

  onLog(`[allama] 初回の準備: ${cmd} ${args.join(' ')}（${appRoot}）\n`);
  return await new Promise((resolve) => {
    let tail = '';
    const child = spawn(cmd, args, { cwd: appRoot, windowsHide: true, shell, stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (d) => {
      const text = String(d);
      onLog(text);
      tail = (tail + text).slice(-2000);
      const line = tail.split(/\r?\n/).filter((l) => l.trim()).pop() ?? '';
      onStatus(line.trim().slice(0, 120));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => resolve({ ok: false, message: `npm ci を起こせなかった: ${e.message}` }));
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      const last = tail.split(/\r?\n/).filter((l) => l.trim()).slice(-6).join('\n');
      resolve({ ok: false, message: `npm ci が code=${code} で終わった\n\n${last}` });
    });
  });
}
