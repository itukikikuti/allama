import type { Contract, Task } from '@allama/protocol';

import type { AllamaConfig } from './config.js';
import { proposeContract } from './contract.js';
import { DecisionRequiredError } from './errors.js';
import { GitWorkspaceManager } from './git.js';
import type { OllamaClient, OllamaMessage } from './ollama.js';
import { assertCloudSafe } from './secrets.js';
import type { TaskStore } from './store.js';
import { ALLAMA_TOOLS, stableCallId, ToolRunner } from './tools.js';

const EXECUTOR_SYSTEM_PROMPT = `You are Allama, a careful development secretary.
Follow the approved contract exactly. Inspect before editing. Use report at meaningful milestones.
Never broaden scope, install dependencies, access secrets, use the network, push, merge, or run destructive commands.
Use write_file only for new files and replace_text for exact changes to existing files.
Run relevant checks as you work. When the contract is complete, respond with a concise evidence-based summary.
Do not expose hidden chain-of-thought. Do not claim success without tool evidence.`;

function contractMessage(contract: Contract): string {
  return `Approved work contract:\n${JSON.stringify(contract, null, 2)}`;
}

function outgoingText(messages: OllamaMessage[]): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join('\n\n');
}

export interface EngineRunResult {
  task: Task;
  summary: string;
  commit: string | null;
}

export class AllamaEngine {
  private readonly git: GitWorkspaceManager;

  public constructor(
    private readonly config: AllamaConfig,
    private readonly store: TaskStore,
    private readonly ollama: OllamaClient,
    git?: GitWorkspaceManager,
  ) {
    this.git = git ?? new GitWorkspaceManager();
  }

  public async plan(prompt: string, repositoryPath: string): Promise<Task> {
    const task = this.store.createTask(prompt, repositoryPath);
    try {
      assertCloudSafe(prompt, '依頼文');
      const contract = await proposeContract(this.ollama, this.config, prompt, repositoryPath);
      return this.store.setContract(task.id, contract);
    } catch (error) {
      this.handleError(task.id, error);
      throw error;
    }
  }

  public approve(taskId: string): Task {
    return this.store.approveContract(taskId);
  }

  public cancel(taskId: string): Task {
    const task = this.store.setStatus(
      taskId,
      'cancelled',
      'ユーザーがタスクをキャンセルしました。',
    );
    this.store.appendEvent(taskId, 'cancelled', 'タスクをキャンセルしました。');
    return task;
  }

  public async run(taskId: string, signal?: AbortSignal): Promise<EngineRunResult> {
    let task = this.store.getTask(taskId);
    if (!task.contract) throw new Error('Task contract is missing.');
    const contract = task.contract;
    if (!['executing', 'verifying'].includes(task.status)) {
      throw new Error(`Task ${taskId} cannot run from status ${task.status}.`);
    }

    try {
      let workspacePath = task.repositoryPath;
      if (contract.mutating && !task.worktreePath) {
        const workspace = await this.git.create(task);
        task = this.store.setWorkspace(
          task.id,
          workspace.branch,
          workspace.worktreePath,
          workspace.baseBranch,
        );
        workspacePath = workspace.worktreePath;
        this.store.appendEvent(task.id, 'progress', '専用Git worktreeを作成しました。', {
          branch: workspace.branch,
          worktreePath: workspace.worktreePath,
        });
      } else if (task.worktreePath) {
        workspacePath = task.worktreePath;
      }

      const messages: OllamaMessage[] = [
        { role: 'system', content: EXECUTOR_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `${contractMessage(contract)}\n\nOriginal request:\n${task.prompt}`,
        },
      ];
      const runner = new ToolRunner(task.id, workspacePath, contract, this.store, this.git);
      const heartbeat = setInterval(() => {
        this.store.appendEvent(
          task.id,
          'heartbeat',
          '作業を継続中です。直近のツール結果を確認しています。',
          { next: '契約の次の未完了項目へ進みます。' },
        );
      }, this.config.heartbeatMs);
      heartbeat.unref();

      let summary = '';
      try {
        for (let iteration = 0; iteration < this.config.maxToolIterations; iteration += 1) {
          if (signal?.aborted) {
            this.cancel(task.id);
            throw new Error('Task cancelled.');
          }
          assertCloudSafe(outgoingText(messages), 'モデル入力');
          const response = await this.ollama.chat({
            model: this.config.executorModel,
            messages,
            tools: ALLAMA_TOOLS,
            think: 'medium',
          });
          summary = response.content || summary;
          messages.push({
            role: 'assistant',
            content: response.content,
            tool_calls: response.toolCalls,
          });
          if (response.toolCalls.length === 0) break;

          for (const [index, call] of response.toolCalls.entries()) {
            const callId = stableCallId(iteration, index, call);
            let result: unknown;
            try {
              result = await runner.execute(callId, call);
            } catch (error) {
              if (error instanceof DecisionRequiredError) throw error;
              result = { error: error instanceof Error ? error.message : String(error) };
            }
            messages.push({
              role: 'tool',
              tool_name: call.function.name,
              content: JSON.stringify(result),
            });
          }
        }
      } finally {
        clearInterval(heartbeat);
      }

      let commit: string | null = null;
      if (contract.mutating) {
        this.store.setStatus(task.id, 'verifying');
        this.store.appendEvent(task.id, 'validation_started', '合意した検証を開始します。');
        const validation = await this.git.validate(workspacePath, contract);
        const failed = validation.find((result) => result.exitCode !== 0);
        this.store.appendEvent(
          task.id,
          'validation_finished',
          failed ? '検証に失敗しました。コミットは作成しません。' : 'すべての検証に成功しました。',
          { validation },
        );
        if (failed) {
          const message = failed.stderr || failed.stdout || failed.command;
          this.store.setStatus(task.id, 'failed', message);
          throw new Error(`Validation failed: ${message}`);
        }
        commit = await this.git.commit(workspacePath, `chore: ${contract.goal.slice(0, 68)}`);
        if (commit) {
          this.store.appendEvent(task.id, 'commit_created', '検証済みコミットを作成しました。', {
            commit,
          });
        }
      }

      const finalSummary = summary || '契約内容を完了し、検証結果を記録しました。';
      task = this.store.setStatus(task.id, 'completed', finalSummary);
      this.store.appendEvent(task.id, 'completed', 'タスクが完了しました。', {
        summary: finalSummary,
        commit,
      });
      return { task, summary: finalSummary, commit };
    } catch (error) {
      this.handleError(task.id, error);
      throw error;
    }
  }

  private handleError(taskId: string, error: unknown): void {
    const current = this.store.getTask(taskId);
    if (['completed', 'cancelled', 'failed', 'awaiting_decision'].includes(current.status)) return;
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof DecisionRequiredError) {
      this.store.setStatus(taskId, 'awaiting_decision', message);
      this.store.appendEvent(taskId, 'decision_required', message, {
        reason: error.reason,
        ...error.details,
      });
      return;
    }
    this.store.setStatus(taskId, 'failed', message);
    this.store.appendEvent(taskId, 'failed', message);
  }
}
