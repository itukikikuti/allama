#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { Command } from 'commander';
import { render } from 'ink';

import {
  ALLAMA_VERSION,
  AllamaConfigSchema,
  GitWorkspaceManager,
  configPath,
  saveConfig,
  type Task,
} from '@allama/core';

import { createRuntime, type Runtime } from './runtime.js';
import { buildServer } from './server.js';
import { ContractCard, Dashboard } from './ui.js';

async function ask(question: string): Promise<string> {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    return (await readline.question(question)).trim();
  } finally {
    readline.close();
  }
}

async function confirm(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!stdin.isTTY) return false;
  return /^y(?:es)?$/i.test(await ask(`${question} [y/N] `));
}

function printContract(task: Task): void {
  if (!task.contract) return;
  const instance = render(<ContractCard task={task} />);
  instance.unmount();
}

async function executeWithProgress(runtime: Runtime, taskId: string, json: boolean): Promise<void> {
  if (json || !stdout.isTTY) {
    let cursor = 0;
    const timer = setInterval(() => {
      for (const event of runtime.store.listEvents(taskId, cursor)) {
        cursor = event.id;
        process.stderr.write(`[${event.kind}] ${event.message}\n`);
      }
    }, 250);
    timer.unref();
    try {
      const result = await runtime.engine.run(taskId);
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } finally {
      clearInterval(timer);
    }
    return;
  }

  const dashboard = render(<Dashboard store={runtime.store} taskId={taskId} />);
  try {
    const result = await runtime.engine.run(taskId);
    await dashboard.waitUntilExit();
    stdout.write(`\n完了: ${result.summary}\n`);
    if (result.commit) stdout.write(`Commit: ${result.commit}\n`);
  } catch (error) {
    await dashboard.waitUntilExit();
    throw error;
  }
}

async function settleDecision(runtime: Runtime, task: Task, yes: boolean): Promise<Task> {
  let current = task;
  if (current.status === 'awaiting_decision') {
    const reason = runtime.store.lastDecisionReason(current.id);
    const data = runtime.store.lastDecisionData(current.id);
    if (reason === 'non_git' && data?.canInitialize !== true) {
      stdout.write(
        `\nこの場所では変更作業を開始できません。次のように専用フォルダを作成して再実行してください。\n\n` +
          `  mkdir <project-name>\n  cd <project-name>\n  allama\n\n` +
          `タスクID: ${current.id}（台帳には相談待ちとして保存されています）\n`,
      );
      return current;
    }
    const question =
      reason === 'non_git'
        ? `${current.repositoryPath}をGitリポジトリとして初期化し、作業を続けますか？`
        : `タスク${current.id}の相談事項を承認して続けますか？`;
    const approved = await confirm(question, yes);
    current = await runtime.engine.decide(current.id, approved);
  }
  if (current.status === 'awaiting_approval') {
    printContract(current);
    const approved = current.contract?.mutating
      ? await confirm('この契約で専用worktreeを作り、作業を開始しますか？', yes)
      : true;
    current = await runtime.engine.decide(current.id, approved);
  }
  return current;
}

async function runUntilPaused(
  runtime: Runtime,
  task: Task,
  options: { yes: boolean; json: boolean },
): Promise<void> {
  let current = task;
  while (current.status === 'executing' || current.status === 'verifying') {
    try {
      await executeWithProgress(runtime, current.id, options.json);
      return;
    } catch (error) {
      current = runtime.store.getTask(current.id);
      if (current.status !== 'awaiting_decision') throw error;
      current = await settleDecision(runtime, current, options.yes);
    }
  }
  if (current.status !== 'completed') {
    stdout.write(`${JSON.stringify({ task: current }, null, 2)}\n`);
  }
}

async function runNewTask(
  prompt: string,
  options: { cwd: string; yes: boolean; json: boolean },
): Promise<void> {
  const runtime = await createRuntime();
  let task = await runtime.engine.plan(prompt, options.cwd);
  task = await settleDecision(runtime, task, options.yes);
  if (task.status === 'executing') await runUntilPaused(runtime, task, options);
  else stdout.write(`${JSON.stringify({ task }, null, 2)}\n`);
}

async function resumeTask(
  taskId: string,
  options: { yes: boolean; json: boolean; message?: string },
): Promise<void> {
  const runtime = await createRuntime();
  if (options.message) runtime.store.addUserMessage(taskId, options.message);
  let task = runtime.store.getTask(taskId);
  task = await settleDecision(runtime, task, options.yes);
  if (task.status === 'awaiting_decision' || task.status === 'cancelled') {
    stdout.write(`${JSON.stringify({ task }, null, 2)}\n`);
    return;
  }
  if (task.status === 'failed') {
    if (!(await confirm('失敗状態から再試行しますか？', options.yes))) return;
    task = runtime.store.setStatus(task.id, 'executing', 'ユーザーの指示で再試行します。');
  }
  if (task.status !== 'executing' && task.status !== 'verifying') {
    throw new Error(`Task ${task.id} cannot be resumed from ${task.status}.`);
  }
  await runUntilPaused(runtime, task, options);
}

async function interactive(): Promise<void> {
  if (!stdin.isTTY)
    throw new Error('対話モードにはTTYが必要です。`allama run <依頼>`を使用してください。');
  stdout.write('allama — 報連相できる開発秘書\n');
  const prompt = await ask('依頼内容: ');
  if (!prompt) return;
  await runNewTask(prompt, { cwd: process.cwd(), yes: false, json: false });
}

const program = new Command()
  .name('allama')
  .description('A development secretary that reports, consults, and finishes the job.')
  .version(ALLAMA_VERSION)
  .action(interactive);

program
  .command('run')
  .description('Create, agree, and execute a new task')
  .argument('<prompt...>', 'task request')
  .option('-C, --cwd <path>', 'repository path', process.cwd())
  .option('-y, --yes', 'approve the displayed contract and decisions', false)
  .option('--json', 'emit machine-readable final output', false)
  .action(async (prompt: string[], options: { cwd: string; yes: boolean; json: boolean }) => {
    await runNewTask(prompt.join(' '), options);
  });

program
  .command('resume')
  .description('Resume a persisted task')
  .argument('<task-id>')
  .option('-y, --yes', 'approve pending decisions', false)
  .option('--json', 'emit machine-readable final output', false)
  .option('-m, --message <text>', 'additional instruction')
  .action(resumeTask);

program
  .command('tasks')
  .description('List persisted tasks')
  .option('--json', 'emit JSON', false)
  .action(async (options: { json: boolean }) => {
    const { store } = await createRuntime();
    const tasks = store.listTasks();
    if (options.json) stdout.write(`${JSON.stringify(tasks, null, 2)}\n`);
    else
      console.table(
        tasks.map((task) => ({
          id: task.id,
          status: task.status,
          goal: task.contract?.goal ?? task.prompt,
          updated: task.updatedAt,
        })),
      );
  });

program
  .command('integrate')
  .description('Cherry-pick a completed task after explicit approval')
  .argument('<task-id>')
  .option('-y, --yes', 'confirm integration', false)
  .action(async (taskId: string, options: { yes: boolean }) => {
    const { store } = await createRuntime();
    const task = store.getTask(taskId);
    if (
      !(await confirm(
        `ブランチ${task.branch ?? ''}を${task.baseBranch ?? ''}へ取り込みますか？`,
        options.yes,
      ))
    )
      return;
    const commits = await new GitWorkspaceManager().integrate(task);
    stdout.write(`取り込み完了: ${commits.join(', ') || '新規コミットなし'}\n`);
  });

const memory = program.command('memory').description('Manage proposed durable memories');
memory
  .command('list')
  .option('--status <status>', 'pending, approved, or rejected')
  .action(async (options: { status?: 'pending' | 'approved' | 'rejected' }) => {
    const { store } = await createRuntime();
    console.table(store.listMemories(options.status));
  });
for (const [name, approved] of [
  ['approve', true],
  ['reject', false],
] as const) {
  memory
    .command(name)
    .argument('<memory-id>')
    .action(async (id: string) => {
      const { store } = await createRuntime();
      stdout.write(`${JSON.stringify(store.decideMemory(id, approved), null, 2)}\n`);
    });
}
memory
  .command('delete')
  .argument('<memory-id>')
  .action(async (id: string) => {
    const { store } = await createRuntime();
    store.deleteMemory(id);
    stdout.write(`Deleted memory ${id}\n`);
  });

const config = program.command('config').description('Inspect or update Allama configuration');
config
  .command('show')
  .option('--reveal-token', 'show the API bearer token', false)
  .action(async (options: { revealToken: boolean }) => {
    const runtime = await createRuntime();
    const value = options.revealToken
      ? runtime.config
      : { ...runtime.config, apiToken: '[redacted]' };
    stdout.write(`${JSON.stringify({ path: configPath(), config: value }, null, 2)}\n`);
  });
config
  .command('set')
  .argument('<key>')
  .argument('<value>')
  .action(async (key: string, value: string) => {
    const runtime = await createRuntime();
    if (
      ![
        'ollamaBaseUrl',
        'plannerModel',
        'executorModel',
        'heartbeatMs',
        'maxToolIterations',
      ].includes(key)
    ) {
      throw new Error(`Unsupported config key: ${key}`);
    }
    const parsedValue = ['heartbeatMs', 'maxToolIterations'].includes(key) ? Number(value) : value;
    const next = AllamaConfigSchema.parse({ ...runtime.config, [key]: parsedValue });
    await saveConfig(next);
    stdout.write(`Updated ${key}\n`);
  });

program
  .command('doctor')
  .description('Check Ollama connectivity and configured models')
  .action(async () => {
    const runtime = await createRuntime();
    const health = await runtime.ollama.health();
    stdout.write(
      `${JSON.stringify({ ollama: 'ok', plannerModel: runtime.config.plannerModel, executorModel: runtime.config.executorModel, availableModels: health.models }, null, 2)}\n`,
    );
  });

program
  .command('serve')
  .description('Run the localhost REST/SSE API')
  .option('-p, --port <number>', 'listen port', '43117')
  .action(async (options: { port: string }) => {
    const runtime = await createRuntime();
    const app = buildServer({
      apiToken: runtime.config.apiToken,
      engine: runtime.engine,
      store: runtime.store,
    });
    const port = Number(options.port);
    await app.listen({ host: '127.0.0.1', port });
    stdout.write(
      `Allama API: http://127.0.0.1:${port}\nToken: allama config show --reveal-token\n`,
    );
  });

try {
  await program.parseAsync();
} catch (error) {
  process.stderr.write(`allama: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
