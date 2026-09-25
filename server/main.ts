import { startHttp } from './api.ts';
import { App } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = new App(config);
await app.mind.init();
app.runner.start();
app.scheduler.start();
startHttp(app);

console.log(`[atama] 起きた: http://${config.host}:${config.port}`);
console.log(`[atama] 記憶とデータ: ${config.dataDir}`);
console.log(`[atama] モデル: ${config.models.map((m) => m.id).join(', ')}（既定 ${config.defaultModelId}）`);
