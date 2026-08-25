import type { DatabaseSync } from 'node:sqlite';

import {
  ContractSchema,
  EventKindSchema,
  MemorySchema,
  TaskEventSchema,
  TaskSchema,
  TaskStatusSchema,
  type Contract,
  type EventKind,
  type Memory,
  type Task,
  type TaskEvent,
  type TaskStatus,
} from '@allama/protocol';
import { nanoid } from 'nanoid';

type SqlRow = Record<string, unknown>;

function now(): string {
  return new Date().toISOString();
}

function mapTask(row: SqlRow): Task {
  return TaskSchema.parse({
    id: row.id,
    prompt: row.prompt,
    repositoryPath: row.repository_path,
    status: row.status,
    contract: row.contract_json ? JSON.parse(String(row.contract_json)) : null,
    branch: row.branch,
    worktreePath: row.worktree_path,
    baseBranch: row.base_branch,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapEvent(row: SqlRow): TaskEvent {
  return TaskEventSchema.parse({
    id: row.id,
    taskId: row.task_id,
    kind: row.kind,
    message: row.message,
    data: JSON.parse(String(row.data_json)),
    createdAt: row.created_at,
  });
}

export class TaskStore {
  public constructor(private readonly database: DatabaseSync) {}

  public createTask(prompt: string, repositoryPath: string): Task {
    const id = nanoid(12);
    const timestamp = now();
    this.database
      .prepare(
        `INSERT INTO tasks
          (id, prompt, repository_path, status, created_at, updated_at)
         VALUES (?, ?, ?, 'contract_proposed', ?, ?)`,
      )
      .run(id, prompt, repositoryPath, timestamp, timestamp);
    this.appendEvent(id, 'task_created', '依頼を受け付けました。', { repositoryPath });
    return this.getTask(id);
  }

  public getTask(id: string): Task {
    const row = this.database.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      SqlRow | undefined;
    if (!row) throw new Error(`Task not found: ${id}`);
    return mapTask(row);
  }

  public listTasks(limit = 50): Task[] {
    return (
      this.database
        .prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?')
        .all(limit) as SqlRow[]
    ).map(mapTask);
  }

  public setContract(id: string, contract: Contract): Task {
    const parsed = ContractSchema.parse(contract);
    this.database
      .prepare(
        `UPDATE tasks SET contract_json = ?, status = 'awaiting_approval', updated_at = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(parsed), now(), id);
    this.appendEvent(id, 'contract_proposed', '作業契約を提案しました。', { contract: parsed });
    return this.getTask(id);
  }

  public approveContract(id: string): Task {
    const task = this.getTask(id);
    if (!task.contract) throw new Error('Cannot approve a task without a contract.');
    if (task.status !== 'awaiting_approval') {
      throw new Error(`Cannot approve task in status ${task.status}.`);
    }
    this.setStatus(id, 'executing');
    this.appendEvent(id, 'contract_approved', '作業契約が承認されました。');
    return this.getTask(id);
  }

  public setStatus(id: string, status: TaskStatus, summary?: string): Task {
    const parsed = TaskStatusSchema.parse(status);
    this.database
      .prepare(
        'UPDATE tasks SET status = ?, summary = COALESCE(?, summary), updated_at = ? WHERE id = ?',
      )
      .run(parsed, summary ?? null, now(), id);
    this.appendEvent(id, 'status_changed', `状態を${parsed}へ更新しました。`, { status: parsed });
    return this.getTask(id);
  }

  public setWorkspace(id: string, branch: string, worktreePath: string, baseBranch: string): Task {
    this.database
      .prepare(
        'UPDATE tasks SET branch = ?, worktree_path = ?, base_branch = ?, updated_at = ? WHERE id = ?',
      )
      .run(branch, worktreePath, baseBranch, now(), id);
    return this.getTask(id);
  }

  public allowedSecretFingerprints(id: string): string[] {
    const row = this.database
      .prepare('SELECT allowed_secret_fingerprints_json FROM tasks WHERE id = ?')
      .get(id) as SqlRow | undefined;
    if (!row) throw new Error(`Task not found: ${id}`);
    return JSON.parse(String(row.allowed_secret_fingerprints_json)) as string[];
  }

  public allowSecretFingerprints(id: string, fingerprints: string[]): void {
    const allowed = [...new Set([...this.allowedSecretFingerprints(id), ...fingerprints])];
    this.database
      .prepare('UPDATE tasks SET allowed_secret_fingerprints_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(allowed), now(), id);
  }

  public addUserMessage(taskId: string, content: string): void {
    this.getTask(taskId);
    this.database
      .prepare('INSERT INTO task_messages (task_id, content, created_at) VALUES (?, ?, ?)')
      .run(taskId, content, now());
    this.appendEvent(taskId, 'progress', '追加指示を受け付けました。', { userMessage: content });
  }

  public listUserMessages(taskId: string): string[] {
    const rows = this.database
      .prepare('SELECT content FROM task_messages WHERE task_id = ? ORDER BY id')
      .all(taskId) as SqlRow[];
    return rows.map((row) => String(row.content));
  }

  public lastDecisionReason(taskId: string): string | null {
    const data = this.lastDecisionData(taskId);
    return typeof data?.reason === 'string' ? data.reason : null;
  }

  public lastDecisionData(taskId: string): Record<string, unknown> | null {
    const row = this.database
      .prepare(
        `SELECT data_json FROM events
         WHERE task_id = ? AND kind = 'decision_required' ORDER BY id DESC LIMIT 1`,
      )
      .get(taskId) as SqlRow | undefined;
    if (!row) return null;
    return JSON.parse(String(row.data_json)) as Record<string, unknown>;
  }

  public appendEvent(
    taskId: string,
    kind: EventKind,
    message: string,
    data: Record<string, unknown> = {},
  ): TaskEvent {
    EventKindSchema.parse(kind);
    const timestamp = now();
    const result = this.database
      .prepare(
        'INSERT INTO events (task_id, kind, message, data_json, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(taskId, kind, message, JSON.stringify(data), timestamp);
    return TaskEventSchema.parse({
      id: Number(result.lastInsertRowid),
      taskId,
      kind,
      message,
      data,
      createdAt: timestamp,
    });
  }

  public listEvents(taskId: string, afterId = 0): TaskEvent[] {
    return (
      this.database
        .prepare('SELECT * FROM events WHERE task_id = ? AND id > ? ORDER BY id')
        .all(taskId, afterId) as SqlRow[]
    ).map(mapEvent);
  }

  public beginToolRun(taskId: string, callId: string, toolName: string, args: unknown): boolean {
    const timestamp = now();
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO tool_runs
          (task_id, call_id, tool_name, arguments_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'running', ?, ?)`,
      )
      .run(taskId, callId, toolName, JSON.stringify(args), timestamp, timestamp);
    return result.changes === 1;
  }

  public finishToolRun(taskId: string, callId: string, result: unknown): void {
    this.database
      .prepare(
        `UPDATE tool_runs SET result_json = ?, status = 'completed', updated_at = ?
         WHERE task_id = ? AND call_id = ?`,
      )
      .run(JSON.stringify(result), now(), taskId, callId);
  }

  public getToolResult(taskId: string, callId: string): unknown | undefined {
    const row = this.database
      .prepare(
        `SELECT result_json FROM tool_runs
         WHERE task_id = ? AND call_id = ? AND status = 'completed'`,
      )
      .get(taskId, callId) as SqlRow | undefined;
    return row?.result_json ? JSON.parse(String(row.result_json)) : undefined;
  }

  public proposeMemory(
    content: string,
    scope: 'user' | 'project',
    projectPath: string | null,
    sourceTaskId: string | null,
  ): Memory {
    const id = nanoid(12);
    const timestamp = now();
    this.database
      .prepare(
        `INSERT INTO memories
          (id, scope, project_path, content, source_task_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(id, scope, projectPath, content, sourceTaskId, timestamp, timestamp);
    if (sourceTaskId) {
      this.appendEvent(sourceTaskId, 'memory_proposed', '記憶候補を提案しました。', {
        memoryId: id,
      });
    }
    return this.getMemory(id);
  }

  public getMemory(id: string): Memory {
    const row = this.database.prepare('SELECT * FROM memories WHERE id = ?').get(id) as
      SqlRow | undefined;
    if (!row) throw new Error(`Memory not found: ${id}`);
    return MemorySchema.parse({
      id: row.id,
      scope: row.scope,
      projectPath: row.project_path,
      content: row.content,
      sourceTaskId: row.source_task_id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  public listMemories(status?: 'pending' | 'approved' | 'rejected'): Memory[] {
    const rows = status
      ? this.database
          .prepare('SELECT * FROM memories WHERE status = ? ORDER BY created_at')
          .all(status)
      : this.database.prepare('SELECT * FROM memories ORDER BY created_at').all();
    return (rows as SqlRow[]).map((row) => this.getMemory(String(row.id)));
  }

  public decideMemory(id: string, approved: boolean): Memory {
    const memory = this.getMemory(id);
    const status = approved ? 'approved' : 'rejected';
    this.database
      .prepare('UPDATE memories SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now(), id);
    if (memory.sourceTaskId) {
      this.appendEvent(
        memory.sourceTaskId,
        approved ? 'memory_approved' : 'memory_rejected',
        approved ? '記憶候補を承認しました。' : '記憶候補を却下しました。',
        { memoryId: id },
      );
    }
    return this.getMemory(id);
  }

  public deleteMemory(id: string): void {
    this.database.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }
}
