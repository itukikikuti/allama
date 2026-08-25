#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sqliteWarningFlag = '--disable-warning=ExperimentalWarning';

if (process.execArgv.includes(sqliteWarningFlag)) {
  await import('./main.js');
} else {
  const child = spawn(
    process.execPath,
    [sqliteWarningFlag, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', windowsHide: true },
  );
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
}
