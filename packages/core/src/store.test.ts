import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from './database.js';
import { TaskStore } from './store.js';

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function store(): TaskStore {
  const database = openDatabase(':memory:');
  databases.push(database);
  return new TaskStore(database);
}

describe('TaskStore', () => {
  it('requires a contract before approval and preserves the event trail', () => {
    const tasks = store();
    const task = tasks.createTask('Fix the bug', 'C:\\repo');
    expect(() => tasks.approveContract(task.id)).toThrow(/without a contract/);
    tasks.setContract(task.id, {
      goal: 'Fix the bug',
      completionCriteria: ['Tests pass'],
      allowedPaths: ['src'],
      outOfScope: [],
      validationCommands: ['pnpm test'],
      consultationTriggers: ['Scope expansion'],
      mutating: true,
    });
    expect(tasks.approveContract(task.id).status).toBe('executing');
    expect(tasks.listEvents(task.id).map((event) => event.kind)).toEqual([
      'task_created',
      'contract_proposed',
      'status_changed',
      'contract_approved',
    ]);
  });

  it('deduplicates completed tool calls across resumes', () => {
    const tasks = store();
    const task = tasks.createTask('Inspect', 'C:\\repo');
    expect(tasks.beginToolRun(task.id, 'call-1', 'read_file', { path: 'README.md' })).toBe(true);
    tasks.finishToolRun(task.id, 'call-1', { content: 'hello' });
    expect(tasks.beginToolRun(task.id, 'call-1', 'read_file', { path: 'README.md' })).toBe(false);
    expect(tasks.getToolResult(task.id, 'call-1')).toEqual({ content: 'hello' });
  });

  it('does not activate a proposed memory without approval', () => {
    const tasks = store();
    const memory = tasks.proposeMemory('Prefer pnpm', 'user', null, null);
    expect(memory.status).toBe('pending');
    expect(tasks.decideMemory(memory.id, true).status).toBe('approved');
  });
});
