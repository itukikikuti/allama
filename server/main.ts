import fs from 'node:fs';
import { startHttp } from './api.ts';
import { App } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
fs.mkdirSync(config.defaultCwd, { recursive: true });
const app = new App(config);
app.runner.start();
app.scheduler.start();
startHttp(app);

console.log(`[allama] 起きた: http://${config.host}:${config.port}`);
console.log(`[allama] 記憶とデータ: ${config.dataDir}`);
console.log(`[allama] モデル: ${config.models.map((m) => m.id).join(', ')}（既定 ${config.defaultModelId}）`);
