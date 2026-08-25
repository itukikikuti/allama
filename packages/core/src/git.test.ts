import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Task } from '@allama/protocol';

import { GitWorkspaceManager, isSafeGitInitPath } from './git.js';
import { runProcess } from './process.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const path of temporaryDirectories.splice(0)) {
    await rm(path, { recursive: true, force: true, maxRetries: 3 });
  }
});

describe('GitWorkspaceManager', () => {
  it('initializes an approved project directory with a usable base commit', async () => {
    const base = await mkdtemp(join(tmpdir(), 'allama-init-'));
    temporaryDirectories.push(base);
    const repository = join(base, 'new-project');
    await mkdir(repository);
    const manager = new GitWorkspaceManager(join(base, 'worktrees'));

    await manager.initialize(repository);

    await expect(manager.inspect(repository)).resolves.toMatchObject({ branch: 'main' });
    const log = await runProcess('git', ['log', '--format=%s'], { cwd: repository });
    expect(log.stdout.trim()).toBe('chore: initialize repository');
  });

  it('does not permit Git initialization at a home or filesystem root', () => {
    expect(isSafeGitInitPath(homedir())).toBe(false);
    expect(isSafeGitInitPath(parse(resolve(homedir())).root)).toBe(false);
    expect(isSafeGitInitPath(join(homedir(), 'allama-project'))).toBe(true);
  });

  it('isolates changes and commits only after validation', async () => {
    const base = await mkdtemp(join(tmpdir(), 'allama-git-'));
    temporaryDirectories.push(base);
    const repository = join(base, 'repository');
    const worktrees = join(base, 'worktrees');
    await runProcess('git', ['init', '-b', 'main', repository], { cwd: base });
    await writeFile(join(repository, 'README.md'), 'original\n');
    await runProcess(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', '.'],
      { cwd: repository },
    );
    await runProcess(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'],
      { cwd: repository },
    );
    const task: Task = {
      id: 'task123',
      prompt: 'Update readme',
      repositoryPath: repository,
      status: 'executing',
      contract: {
        goal: 'Update readme',
        completionCriteria: ['README changed'],
        allowedPaths: ['README.md'],
        outOfScope: [],
        validationCommands: [],
        consultationTriggers: [],
        mutating: true,
      },
      branch: null,
      worktreePath: null,
      baseBranch: null,
      summary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const manager = new GitWorkspaceManager(worktrees);
    const workspace = await manager.create(task);
    await writeFile(join(workspace.worktreePath, 'README.md'), 'changed\n');
    const validation = await manager.validate(workspace.worktreePath, task.contract!);
    expect(validation.every((result) => result.exitCode === 0)).toBe(true);
    const commit = await manager.commit(workspace.worktreePath, 'docs: update readme');
    expect(commit).toMatch(/^[a-f0-9]{40}$/);
    expect(await manager.status(repository)).toBe('');
  });
});
