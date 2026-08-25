#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
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
  type WorkItem,
  WorkPrioritySchema,
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

function parseDueAt(value?: string): string | null {
  if (!value) return null;
  const relativeDays: Record<string, number> = { today: 0, 今日: 0, tomorrow: 1, 明日: 1 };
  if (value in relativeDays) {
    const date = new Date();
    date.setDate(date.getDate() + (relativeDays[value] ?? 0));
    date.setHours(23, 59, 59, 999);
    return date.toISOString();
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 23, 59, 59, 999)
    : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('期日はYYYY-MM-DD、今日/today、明日/tomorrowのいずれかで指定してください。');
  }
  return date.toISOString();
}

function workItemRows(items: WorkItem[]) {
  return items.map((item) => ({
    id: item.id,
    担当: item.owner === 'user' ? 'あなた' : 'AI',
    期日: item.dueAt ? new Date(item.dueAt).toLocaleString('ja-JP') : '-',
    優先度: item.priority,
    状態: item.status,
    内容: item.title,
  }));
}

function printWorkItems(title: string, items: WorkItem[]): void {
  stdout.write(`\n${title} (${items.length})\n`);
  if (items.length === 0) stdout.write('  なし\n');
  else console.table(workItemRows(items));
}

function printAgenda(runtime: Runtime): void {
  printWorkItems('あなたが対応すること', runtime.store.listOpenWorkItems('user'));
  printWorkItems('AIが対応すること', runtime.store.listOpenWorkItems('ai'));
}

function queueDecision(runtime: Runtime, task: Task): WorkItem {
  const existing = runtime.store.findOpenWorkItemForTask(task.id, 'user');
  if (existing) return existing;
  const aiItem = runtime.store.findOpenWorkItemForTask(task.id, 'ai');
  const approval = task.status === 'awaiting_approval';
  const decisionData = runtime.store.lastDecisionData(task.id);
  const details = approval
    ? JSON.stringify(task.contract, null, 2)
    : [task.summary ?? 'AIから確認事項があります。', JSON.stringify(decisionData ?? {}, null, 2)]
        .filter(Boolean)
        .join('\n\n');
  return runtime.store.createWorkItem({
    owner: 'user',
    kind: approval ? 'approval' : 'question',
    title: approval
      ? `作業契約を確認: ${task.contract?.goal ?? task.prompt}`
      : `AIからの確認: ${task.summary ?? task.prompt}`,
    details,
    priority: aiItem?.priority ?? 'normal',
    dueAt: aiItem?.dueAt ?? null,
    repositoryPath: task.repositoryPath,
    taskId: task.id,
  });
}

function syncQueuedTask(runtime: Runtime, taskId: string): Task {
  const task = runtime.store.getTask(taskId);
  const aiItem = runtime.store.findOpenWorkItemForTask(taskId, 'ai');
  if (aiItem) {
    if (task.status === 'completed') runtime.store.setWorkItemStatus(aiItem.id, 'done');
    else if (task.status === 'cancelled') runtime.store.setWorkItemStatus(aiItem.id, 'cancelled');
    else if (task.status === 'awaiting_approval' || task.status === 'awaiting_decision') {
      runtime.store.setWorkItemStatus(aiItem.id, 'waiting');
      queueDecision(runtime, task);
    } else if (task.status === 'failed') {
      runtime.store.setWorkItemStatus(aiItem.id, 'waiting');
      if (!runtime.store.findOpenWorkItemForTask(task.id, 'user')) {
        runtime.store.createWorkItem({
          owner: 'user',
          kind: 'action',
          title: `AI作業の失敗を確認: ${aiItem.title}`,
          details: `${task.summary ?? '原因不明'}\n\n再試行: allama resume ${task.id}`,
          priority: aiItem.priority,
          dueAt: aiItem.dueAt,
          repositoryPath: task.repositoryPath,
          taskId: task.id,
        });
      }
    } else runtime.store.setWorkItemStatus(aiItem.id, 'in_progress');
  }
  return task;
}

async function planWorkItem(runtime: Runtime, item: WorkItem): Promise<Task> {
  if (item.owner !== 'ai' || item.status !== 'open') {
    throw new Error('AI担当かつopen状態のタスクだけを開始できます。');
  }
  runtime.store.setWorkItemStatus(item.id, 'in_progress');
  try {
    const task = await runtime.engine.plan(item.title, item.repositoryPath ?? process.cwd());
    runtime.store.linkWorkItem(item.id, task.id);
    return syncQueuedTask(runtime, task.id);
  } catch (error) {
    runtime.store.setWorkItemStatus(item.id, 'open');
    throw error;
  }
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
  const runtime = await createRuntime();
  stdout.write('allama — あなたとAIの仕事を1か所に\n');
  printAgenda(runtime);
  stdout.write(
    '\n依頼を追加: allama add "依頼内容" --due 明日\n次のAI仕事を整理: allama work\n回答: allama answer <id> --yes\n',
  );
}

const program = new Command()
  .name('allama')
  .description('One task list for work shared between you and AI.')
  .version(ALLAMA_VERSION)
  .action(interactive);

program
  .command('add')
  .description('Add a request to the AI task list')
  .argument('<request...>', 'request for the AI')
  .option('--due <date>', 'YYYY-MM-DD, 今日/today, or 明日/tomorrow')
  .option('--priority <priority>', 'urgent, high, normal, or low', 'normal')
  .option('-C, --cwd <path>', 'working directory', process.cwd())
  .option('--no-plan', 'only capture the request without asking the AI to plan it')
  .action(
    async (
      request: string[],
      options: { due?: string; priority: string; cwd: string; plan: boolean },
    ) => {
      const runtime = await createRuntime();
      const item = runtime.store.createWorkItem({
        title: request.join(' '),
        priority: WorkPrioritySchema.parse(options.priority),
        dueAt: parseDueAt(options.due),
        repositoryPath: resolve(options.cwd),
      });
      stdout.write(`AIのタスクリストへ追加しました: ${item.id}\n`);
      if (options.plan) {
        await planWorkItem(runtime, item);
        stdout.write('AIが依頼を整理し、必要な確認をあなたのタスクリストへ追加しました。\n');
      }
      printAgenda(runtime);
    },
  );

program
  .command('inbox')
  .description('Show decisions and actions waiting for you')
  .option('--json', 'emit JSON', false)
  .action(async (options: { json: boolean }) => {
    const runtime = await createRuntime();
    const items = runtime.store.listOpenWorkItems('user');
    if (options.json) stdout.write(`${JSON.stringify(items, null, 2)}\n`);
    else printWorkItems('あなたが対応すること', items);
  });

program
  .command('show')
  .description('Show one task-list item and its linked AI task')
  .argument('<work-item-id>')
  .action(async (id: string) => {
    const runtime = await createRuntime();
    const item = runtime.store.getWorkItem(id);
    const task = item.taskId ? runtime.store.getTask(item.taskId) : null;
    stdout.write(`${JSON.stringify({ item, task }, null, 2)}\n`);
  });

program
  .command('work')
  .description('Plan the next AI request and put required confirmation in your inbox')
  .argument('[work-item-id]')
  .action(async (id?: string) => {
    const runtime = await createRuntime();
    const item = id ? runtime.store.getWorkItem(id) : runtime.store.nextAiWorkItem();
    if (!item) {
      stdout.write('AIが新しく着手できるタスクはありません。\n');
      return;
    }
    await planWorkItem(runtime, item);
    stdout.write(`AIが依頼を整理しました: ${item.id}\n`);
    printAgenda(runtime);
  });

program
  .command('answer')
  .description('Answer one item from your inbox and resume the linked AI task')
  .argument('<work-item-id>')
  .argument('[answer...]')
  .option('-y, --yes', 'approve the proposed action', false)
  .option('-n, --no', 'reject the proposed action', false)
  .action(async (id: string, answer: string[], options: { yes: boolean; no: boolean }) => {
    if (options.yes && options.no) throw new Error('--yesと--noは同時に指定できません。');
    const runtime = await createRuntime();
    const item = runtime.store.getWorkItem(id);
    const message = answer.join(' ');
    if (item.owner !== 'user') throw new Error('あなた担当のタスクだけに回答できます。');
    if (item.kind === 'action' || !item.taskId) {
      runtime.store.answerWorkItem(id, message);
      printAgenda(runtime);
      return;
    }
    if (item.kind === 'approval' && !options.yes && !options.no) {
      throw new Error('承認項目には--yesまたは--noを指定してください。');
    }
    const approved = options.no ? false : true;
    const task = await runtime.engine.decide(item.taskId, approved, message || undefined);
    runtime.store.answerWorkItem(id, message || (approved ? '承認' : '却下'));
    const aiItem = runtime.store.findOpenWorkItemForTask(task.id, 'ai');
    if (task.status === 'executing' || task.status === 'verifying') {
      if (aiItem) runtime.store.setWorkItemStatus(aiItem.id, 'in_progress');
      try {
        await executeWithProgress(runtime, task.id, false);
      } catch (error) {
        const current = runtime.store.getTask(task.id);
        if (current.status !== 'awaiting_decision') throw error;
      }
    }
    syncQueuedTask(runtime, task.id);
    printAgenda(runtime);
  });

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
  .description('Show the unified task list')
  .option('--json', 'emit JSON', false)
  .option('--runs', 'show low-level AI execution records', false)
  .action(async (options: { json: boolean; runs: boolean }) => {
    const { store } = await createRuntime();
    if (!options.runs) {
      const items = store.listWorkItems();
      if (options.json) stdout.write(`${JSON.stringify(items, null, 2)}\n`);
      else {
        printWorkItems(
          'あなたが対応すること',
          items.filter((item) => item.owner === 'user'),
        );
        printWorkItems(
          'AIが対応すること',
          items.filter((item) => item.owner === 'ai'),
        );
      }
      return;
    }
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
