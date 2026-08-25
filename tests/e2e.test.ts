import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AllamaEngine,
  GitWorkspaceManager,
  TaskStore,
  defaultConfig,
  openDatabase,
  runProcess,
  type ChatResult,
  type Contract,
  type OllamaClient,
} from '@allama/core';

const temporaryDirectories: string[] = [];
const databases: DatabaseSync[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const path of temporaryDirectories.splice(0)) {
    await rm(path, { recursive: true, force: true, maxRetries: 3 });
  }
});

async function repositoryFixture(): Promise<{
  base: string;
  repository: string;
  worktrees: string;
}> {
  const base = await mkdtemp(join(tmpdir(), 'allama-e2e-'));
  temporaryDirectories.push(base);
  const repository = join(base, 'repository');
  const worktrees = join(base, 'worktrees');
  await runProcess('git', ['init', '-b', 'main', repository], { cwd: base });
  await writeFile(join(repository, 'README.md'), 'original\n');
  await runProcess('git', ['add', '.'], { cwd: repository });
  await runProcess(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'],
    { cwd: repository },
  );
  return { base, repository, worktrees };
}

class ScriptedOllama {
  private calls = 0;

  public constructor(private readonly contract: Contract) {}

  public async structured<T>(): Promise<T> {
    return this.contract as T;
  }

  public async chat(): Promise<ChatResult> {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        content: '',
        toolCalls: [
          {
            id: 'write-1',
            function: {
              name: 'write_file',
              arguments: { path: 'src/new.ts', content: 'export const answer = 42;\n' },
            },
          },
          {
            id: 'report-1',
            function: {
              name: 'report',
              arguments: { message: '実装を追加しました。', next: '検証へ進みます。' },
            },
          },
        ],
        promptTokens: 100,
        outputTokens: 20,
      };
    }
    return {
      content: '新しいモジュールを追加し、検証しました。',
      toolCalls: [],
      promptTokens: 150,
      outputTokens: 15,
    };
  }
}

describe('Allama end-to-end workflow', () => {
  it('does not mutate before approval and commits only inside its worktree', async () => {
    const fixture = await repositoryFixture();
    const database = openDatabase(':memory:');
    databases.push(database);
    const store = new TaskStore(database);
    const contract: Contract = {
      goal: 'Add a small module',
      completionCriteria: ['src/new.ts exists'],
      allowedPaths: ['src'],
      outOfScope: ['README.md'],
      validationCommands: [],
      consultationTriggers: ['Scope changes'],
      mutating: true,
    };
    const engine = new AllamaEngine(
      { ...defaultConfig(), heartbeatMs: 10 },
      store,
      new ScriptedOllama(contract) as unknown as OllamaClient,
      new GitWorkspaceManager(fixture.worktrees),
    );

    const planned = await engine.plan('Add a small module', fixture.repository);
    expect(planned.status).toBe('awaiting_approval');
    expect(await readFile(join(fixture.repository, 'README.md'), 'utf8')).toBe('original\n');
    await expect(readFile(join(fixture.repository, 'src/new.ts'), 'utf8')).rejects.toThrow();

    engine.approve(planned.id);
    const result = await engine.run(planned.id);
    expect(result.task.status).toBe('completed');
    expect(result.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(await readFile(join(result.task.worktreePath!, 'src/new.ts'), 'utf8')).toContain('42');
    await expect(readFile(join(fixture.repository, 'src/new.ts'), 'utf8')).rejects.toThrow();
    expect(store.listEvents(planned.id).some((event) => event.kind === 'commit_created')).toBe(
      true,
    );
  });

  it('integrates completed commits only through the explicit integration operation', async () => {
    const fixture = await repositoryFixture();
    const database = openDatabase(':memory:');
    databases.push(database);
    const store = new TaskStore(database);
    const contract: Contract = {
      goal: 'Add a small module',
      completionCriteria: ['src/new.ts exists'],
      allowedPaths: ['src'],
      outOfScope: [],
      validationCommands: [],
      consultationTriggers: [],
      mutating: true,
    };
    const manager = new GitWorkspaceManager(fixture.worktrees);
    const engine = new AllamaEngine(
      defaultConfig(),
      store,
      new ScriptedOllama(contract) as unknown as OllamaClient,
      manager,
    );
    const planned = await engine.plan('Add module', fixture.repository);
    engine.approve(planned.id);
    const result = await engine.run(planned.id);
    const commits = await manager.integrate(result.task);
    expect(commits).toHaveLength(1);
    expect(await readFile(join(fixture.repository, 'src/new.ts'), 'utf8')).toContain('42');
  });
});
