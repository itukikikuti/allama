import { homedir } from 'node:os';
import { join } from 'node:path';

export function allamaHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ALLAMA_HOME) return env.ALLAMA_HOME;
  const base = env.LOCALAPPDATA ?? join(homedir(), '.local', 'share');
  return join(base, 'allama');
}

export function stateDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(allamaHome(env), 'state.db');
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(allamaHome(env), 'config.json');
}

export function worktreesRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(allamaHome(env), 'worktrees');
}
