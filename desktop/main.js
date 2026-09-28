// allama の窓（Electron）。
//
//  - 同梱の node で本体（server/main.ts）を起こす
//  - 本体が応答し始めたら、その画面を窓に出す
//  - 落ちたら起こし直す（Linux の systemd がやっていたことの代わり）
//  - トレイに常駐する。窓を閉じても裏で動き続ける（終了はトレイから）
//
// 開発中（npm start）は、このフォルダの親を本体として見る。ALLAMA_NODE で node を差せる。

import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerProcess, waitForServer } from './server-process.js';
import { installDeps, missingDeps } from './install-deps.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 本体（server/ shared/ web/ node_modules/）の場所 */
const appRoot = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.resolve(here, '..');
/** 本体を動かす node。同梱のものを使う（Electron 自身の node ではない） */
const nodeExe = app.isPackaged ? path.join(process.resourcesPath, 'node', 'node.exe') : process.env.ALLAMA_NODE || 'node';
/** 同梱の npm。初回の依存入れ（npm ci）に使う */
const npmCli = path.join(process.resourcesPath, 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js');
/** 窓のログ。本体の記録（~/.allama）とは別に置く */
const logFile = path.join(app.getPath('userData'), 'allama.log');

let win = null;
let tray = null;
let server = null;
let quitting = false;
let url = 'http://127.0.0.1:3170/';

/** config.json が無ければ見本から作る。窓は port だけ知ればよい */
function readConfig() {
  const file = path.join(appRoot, 'config.json');
  const example = path.join(appRoot, 'config.example.json');
  if (!fs.existsSync(file) && fs.existsSync(example)) fs.copyFileSync(example, file);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { port: Number(raw.port) || 3170 };
  } catch {
    return { port: 3170 };
  }
}

/** 窓の側の出来事も、本体と同じログに残す */
function log(text) {
  try {
    fs.appendFileSync(logFile, text);
  } catch {
    // ログが書けなくても進む
  }
}

function setStatus(text) {
  if (!win || win.isDestroyed()) return;
  void win.webContents.executeJavaScript(`window.setStatus(${JSON.stringify(text)})`).catch(() => {});
}

function show() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'allama',
    backgroundColor: '#faf9f5',
    autoHideMenuBar: true,
    icon: path.join(here, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  // 窓の中で別の頁を開かせない。外のリンクは既定のブラウザへ
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    void shell.openExternal(u);
    return { action: 'deny' };
  });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide(); // 閉じても裏で動き続ける
  });
  void win.loadFile(path.join(here, 'loading.html'));
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(here, 'build', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('allama');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '開く', click: show },
      { label: 'ブラウザで開く', click: () => void shell.openExternal(url) },
      { type: 'separator' },
      { label: '本体を起こし直す', click: () => server?.restart() },
      { label: 'ログを見る', click: () => shell.showItemInFolder(logFile) },
      { type: 'separator' },
      {
        label: 'Windows にサインインしたら開く',
        type: 'checkbox',
        checked: app.isPackaged && app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
      },
      {
        label: '終了',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', show);
}

async function fail(message) {
  setStatus(message);
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'allama を起こせない',
    message: 'allama の本体を起こせませんでした',
    detail: `${message}\n\nログ: ${logFile}`,
    buttons: ['もう一度', '終了'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    await boot();
  } else {
    quitting = true;
    app.quit();
  }
}

/** 初回だけ、本体の依存を入れる（人が PowerShell や cmd を開かなくて済むように） */
async function prepareBody() {
  if (app.isPackaged && !fs.existsSync(nodeExe)) {
    await fail(`同梱の node が見つかりません: ${nodeExe}`);
    return false;
  }
  if (!missingDeps(appRoot).length) return true;

  log(`[allama] 本体の依存を入れる（${appRoot}）\n`);
  const done = await installDeps({
    appRoot,
    nodeExe: app.isPackaged ? nodeExe : undefined,
    npmCli: app.isPackaged ? npmCli : undefined,
    onStatus: (line) => setStatus(`初回の準備をしています…（本体の依存を取ってきます。1GBほど、5〜10分）\n${line}`),
    onLog: log,
  });
  if (!done.ok) {
    await fail(`${done.message}\n\n手で入れるなら:\ncd ${appRoot}\nnpm ci\n\n（install.ps1 を使うと、これも自動で入ります）`);
    return false;
  }
  const still = missingDeps(appRoot);
  if (still.length) {
    await fail(`依存を入れたのに見つかりません（${still.join('、')}）:\n${appRoot}`);
    return false;
  }
  log('[allama] 依存が入った\n');
  return true;
}

async function boot() {
  if (!(await prepareBody())) return;
  const { port } = readConfig();
  url = `http://127.0.0.1:${port}/`;

  server?.stop();
  server = createServerProcess({
    appRoot,
    nodeExe,
    logFile,
    onExit: ({ failures, wait }) => {
      void win?.loadFile(path.join(here, 'loading.html'));
      setStatus(`本体が止まりました。${Math.round(wait / 1000)}秒後に起こし直します（${failures}回目の失敗）`);
    },
  });
  server.start();
  setStatus('allama を起こしています…');

  try {
    await waitForServer(`${url}api/state`);
  } catch (e) {
    await fail(e.message);
    return;
  }
  await win.loadURL(url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', show);
  app.on('window-all-closed', () => {
    // トレイに残るので何もしない（Electron の既定だとここで終わってしまう）
  });
  app.on('before-quit', () => {
    quitting = true;
    server?.stop();
  });
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
    await boot();
  });
}
