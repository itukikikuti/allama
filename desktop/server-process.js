// allama の本体（server/main.ts）を、同梱の node で起こして見張る。
//
// Linux では systemd がやっていたことを、このアプリが代わりにやる：
//  - 落ちたら起こし直す（Restart=always の代わり）
//  - 秘書が自分を書き換えて process.exit(0) したら、起こし直す（restart_self の受け皿）
//  - すぐ落ちる失敗が続いたら、間隔を空ける（StartLimitBurst の代わり）
//
// Electron を読み込まないので、窓なしで単体で試せる。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** これより短く終わったら「失敗」とみなす */
const FAST_EXIT_MS = 5000;

/** 失敗が続いたときの待ち時間（1秒 → 2秒 → 4秒 … 最大30秒） */
function backoffMs(failures) {
  if (failures <= 3) return 1000;
  return Math.min(30_000, 1000 * 2 ** (failures - 3));
}

/**
 * @param {object} o
 * @param {string} o.appRoot  本体のある場所（server/ や node_modules/ がある所）
 * @param {string} o.nodeExe  本体を動かす node
 * @param {string} o.logFile  本体の出力を追記する先
 * @param {(line: string) => void} [o.onLog]
 * @param {(info: {code: number|null, signal: string|null, failures: number, wait: number}) => void} [o.onExit]
 * @param {NodeJS.ProcessEnv} [o.env]
 */
export function createServerProcess({ appRoot, nodeExe, logFile, onLog = () => {}, onExit = () => {}, env = process.env }) {
  let child = null;
  let mode = 'run'; // run | stopping | respawning
  let failures = 0;
  let startedAt = 0;
  let timer = null;

  function writeLog(text) {
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, text);
    } catch {
      // ログが書けなくても本体は動かす
    }
  }

  function say(line) {
    if (!line.trim()) return;
    writeLog(`${line}\n`);
    onLog(line);
  }

  function spawnOnce() {
    startedAt = Date.now();
    const dir = path.dirname(nodeExe);
    const childEnv = { ...env, PATH: `${dir}${path.delimiter}${env.PATH ?? ''}` };
    say(`[allama] 起こす: ${nodeExe} server/main.ts（${appRoot}）\n`);
    child = spawn(nodeExe, ['--no-warnings', 'server/main.ts'], {
      cwd: appRoot,
      env: childEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => say(String(d)));
    child.stderr.on('data', (d) => say(String(d)));
    child.on('error', (e) => say(`[allama] 起こせなかった: ${e.message}\n`));
    child.on('exit', (code, signal) => {
      child = null;
      if (mode === 'stopping') return;
      if (mode === 'respawning') {
        mode = 'run';
        spawnOnce();
        return;
      }
      const alive = Date.now() - startedAt;
      failures = alive < FAST_EXIT_MS ? failures + 1 : 0;
      const wait = backoffMs(failures);
      say(`[allama] 本体が終わった（code=${code} signal=${signal}／${Math.round(alive / 1000)}秒動いた）。${wait / 1000}秒後に起こし直す\n`);
      onExit({ code, signal, failures, wait });
      timer = setTimeout(spawnOnce, wait);
    });
  }

  /** 本体の子孫ごと止める（Windows では node だけ殺すと claude.exe が残る） */
  function killTree() {
    if (!child) return;
    const pid = child.pid;
    if (process.platform === 'win32' && pid) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      child.kill();
    }
  }

  return {
    start() {
      if (child) return;
      mode = 'run';
      failures = 0;
      spawnOnce();
    },
    /** 起こし直す（トレイの「本体を起こし直す」から） */
    restart() {
      failures = 0;
      if (timer) clearTimeout(timer);
      if (!child) {
        spawnOnce();
        return;
      }
      mode = 'respawning';
      killTree();
    },
    /** 終わるとき。以後は起こし直さない */
    stop() {
      mode = 'stopping';
      if (timer) clearTimeout(timer);
      killTree();
    },
    get running() {
      return child !== null;
    },
    pid() {
      return child?.pid ?? null;
    },
  };
}

/** 本体が応答し始めるまで待つ。返事が来なければ例外 */
export async function waitForServer(url, { timeoutMs = 90_000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`本体が応答しない（${url}）: ${last}`);
}
