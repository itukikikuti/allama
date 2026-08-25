import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import type { Contract, Task } from '@allama/protocol';

import { DecisionRequiredError } from './errors.js';
import { assertSafeCommand } from './policy.js';
import { runProcess, runPowerShell, type ProcessResult } from './process.js';
import { worktreesRoot } from './paths.js';

async function git(cwd: string, args: string[]): Promise<ProcessResult> {
  return await runProcess('git', args, { cwd, timeoutMs: 120_000 });
}

function expectSuccess(result: ProcessResult, operation: string): string {
  if (result.exitCode !== 0) {
    throw new Error(`${operation} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || 'task'
  );
}

export interface WorkspaceInfo {
  repositoryRoot: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
}

export class GitWorkspaceManager {
  public constructor(private readonly root = worktreesRoot()) {}

  public async inspect(repositoryPath: string): Promise<{ root: string; branch: string }> {
    const rootResult = await git(repositoryPath, ['rev-parse', '--show-toplevel']);
    if (rootResult.exitCode !== 0) {
      throw new DecisionRequiredError(
        '変更タスクにはGitリポジトリが必要です。`git init`の可否を確認してください。',
        'non_git',
        { repositoryPath },
      );
    }
    const repositoryRoot = resolve(expectSuccess(rootResult, 'git rev-parse'));
    const branchResult = await git(repositoryRoot, ['branch', '--show-current']);
    const branch = expectSuccess(branchResult, 'git branch') || 'HEAD';
    return { root: repositoryRoot, branch };
  }

  public async create(task: Task): Promise<WorkspaceInfo> {
    if (!task.contract) throw new Error('Task contract is required.');
    if (task.status !== 'executing') {
      throw new Error('A worktree can only be created after contract approval.');
    }
    const repository = await this.inspect(task.repositoryPath);
    const repositoryKey = createHash('sha256').update(repository.root).digest('hex').slice(0, 12);
    const worktreePath = join(this.root, repositoryKey, task.id);
    const branch = `allama/${task.id}-${slug(task.contract.goal)}`;
    await mkdir(dirname(worktreePath), { recursive: true });
    const result = await git(repository.root, [
      'worktree',
      'add',
      '-b',
      branch,
      worktreePath,
      'HEAD',
    ]);
    expectSuccess(result, 'git worktree add');
    return { repositoryRoot: repository.root, worktreePath, branch, baseBranch: repository.branch };
  }

  public async status(worktreePath: string): Promise<string> {
    return expectSuccess(await git(worktreePath, ['status', '--short']), 'git status');
  }

  public async diff(worktreePath: string): Promise<string> {
    const unstaged = expectSuccess(await git(worktreePath, ['diff', '--no-ext-diff']), 'git diff');
    const staged = expectSuccess(
      await git(worktreePath, ['diff', '--cached', '--no-ext-diff']),
      'git diff --cached',
    );
    return [unstaged, staged].filter(Boolean).join('\n');
  }

  public async validate(worktreePath: string, contract: Contract): Promise<ProcessResult[]> {
    const results: ProcessResult[] = [];
    const diffCheck = await git(worktreePath, ['diff', '--check']);
    results.push(diffCheck);
    if (diffCheck.exitCode !== 0) return results;
    for (const command of contract.validationCommands) {
      assertSafeCommand(command);
      const result = await runPowerShell(command, worktreePath);
      results.push(result);
      if (result.exitCode !== 0) break;
    }
    return results;
  }

  public async commit(worktreePath: string, message: string): Promise<string | null> {
    const status = await this.status(worktreePath);
    if (!status) return null;
    expectSuccess(await git(worktreePath, ['add', '-A']), 'git add');
    const commit = await git(worktreePath, [
      '-c',
      'user.name=Allama',
      '-c',
      'user.email=allama@local',
      'commit',
      '-m',
      message,
    ]);
    expectSuccess(commit, 'git commit');
    return expectSuccess(await git(worktreePath, ['rev-parse', 'HEAD']), 'git rev-parse HEAD');
  }

  public async integrate(task: Task): Promise<string[]> {
    if (!task.worktreePath || !task.baseBranch || !task.branch)
      throw new Error('Task has no worktree.');
    if (task.status !== 'completed') throw new Error('Only completed tasks can be integrated.');
    const repository = await this.inspect(task.repositoryPath);
    if (repository.branch !== task.baseBranch) {
      throw new DecisionRequiredError(
        `元ブランチ${task.baseBranch}ではなく${repository.branch}がチェックアウトされています。`,
        'scope',
      );
    }
    const dirty = await git(repository.root, ['status', '--porcelain']);
    if (expectSuccess(dirty, 'git status')) {
      throw new DecisionRequiredError(
        '元の作業ツリーに未コミット変更があるため取り込みを停止しました。',
        'scope',
      );
    }
    const commits = expectSuccess(
      await git(repository.root, ['rev-list', '--reverse', `${task.baseBranch}..${task.branch}`]),
      'git rev-list',
    )
      .split('\n')
      .filter(Boolean);
    for (const commit of commits) {
      expectSuccess(await git(repository.root, ['cherry-pick', commit]), 'git cherry-pick');
    }
    return commits;
  }

  public displayName(repositoryPath: string): string {
    return basename(resolve(repositoryPath));
  }
}
