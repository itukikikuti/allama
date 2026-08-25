import { createHash } from 'node:crypto';

import type { Contract } from '@allama/protocol';

import { DecisionRequiredError } from './errors.js';
import type { GitWorkspaceManager } from './git.js';
import type { OllamaTool, OllamaToolCall } from './ollama.js';
import { assertSafeCommand } from './policy.js';
import { runPowerShell } from './process.js';
import { RepositoryAccess } from './repository.js';
import type { TaskStore } from './store.js';

export const ALLAMA_TOOLS: OllamaTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file inside the repository. Paths are repository-relative.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Search repository text with ripgrep. Use a narrow pattern and optional glob.',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string' }, glob: { type: 'string' } },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a new UTF-8 text file. It refuses to overwrite existing files.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_text',
      description: 'Replace one unique exact string in an existing UTF-8 file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          oldText: { type: 'string' },
          newText: { type: 'string' },
        },
        required: ['path', 'oldText', 'newText'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run a non-destructive PowerShell command in the isolated worktree. Dependency, network, file redirection, destructive Git, and delete commands stop for consultation.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Show the current unstaged and staged Git diff.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'report',
      description: 'Report a concise milestone, current evidence, and next action to the user.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          next: { type: 'string' },
        },
        required: ['message', 'next'],
        additionalProperties: false,
      },
    },
  },
];

type ToolArguments = Record<string, unknown>;

function stringArgument(args: ToolArguments, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') throw new Error(`Tool argument ${key} must be a string.`);
  return value;
}

export function stableCallId(iteration: number, index: number, call: OllamaToolCall): string {
  if (call.id) return call.id;
  return createHash('sha256')
    .update(
      `${iteration}:${index}:${call.function.name}:${JSON.stringify(call.function.arguments)}`,
    )
    .digest('hex')
    .slice(0, 24);
}

export class ToolRunner {
  private readonly repository: RepositoryAccess;

  public constructor(
    private readonly taskId: string,
    private readonly workspacePath: string,
    contract: Contract,
    private readonly store: TaskStore,
    private readonly git: GitWorkspaceManager,
  ) {
    this.repository = new RepositoryAccess(workspacePath, contract);
  }

  public async execute(callId: string, call: OllamaToolCall): Promise<unknown> {
    const cached = this.store.getToolResult(this.taskId, callId);
    if (cached !== undefined) return cached;
    const started = this.store.beginToolRun(
      this.taskId,
      callId,
      call.function.name,
      call.function.arguments,
    );
    if (!started) {
      throw new DecisionRequiredError(
        '前回中断時に完了確認できなかったツールがあります。重複実行を避けるため停止しました。',
        'incomplete_tool',
        { callId, tool: call.function.name },
      );
    }
    this.store.appendEvent(this.taskId, 'tool_started', `${call.function.name}を開始します。`, {
      callId,
      tool: call.function.name,
    });
    const result = await this.dispatch(call);
    this.store.finishToolRun(this.taskId, callId, result);
    this.store.appendEvent(this.taskId, 'tool_finished', `${call.function.name}が完了しました。`, {
      callId,
      tool: call.function.name,
    });
    return result;
  }

  private async dispatch(call: OllamaToolCall): Promise<unknown> {
    const args = call.function.arguments;
    switch (call.function.name) {
      case 'read_file':
        return { content: await this.repository.read(stringArgument(args, 'path')) };
      case 'search':
        return {
          matches: await this.repository.search(
            stringArgument(args, 'pattern'),
            typeof args.glob === 'string' ? args.glob : undefined,
          ),
        };
      case 'write_file':
        await this.repository.writeNew(
          stringArgument(args, 'path'),
          stringArgument(args, 'content'),
        );
        return { written: stringArgument(args, 'path') };
      case 'replace_text':
        await this.repository.replace(
          stringArgument(args, 'path'),
          stringArgument(args, 'oldText'),
          stringArgument(args, 'newText'),
        );
        return { updated: stringArgument(args, 'path') };
      case 'run_command': {
        const command = stringArgument(args, 'command');
        assertSafeCommand(command);
        return await runPowerShell(command, this.workspacePath);
      }
      case 'git_diff':
        return { diff: await this.git.diff(this.workspacePath) };
      case 'report': {
        const message = stringArgument(args, 'message');
        const next = stringArgument(args, 'next');
        this.store.appendEvent(this.taskId, 'progress', message, { next });
        return { reported: true };
      }
      default:
        throw new Error(`Unknown tool: ${call.function.name}`);
    }
  }
}
