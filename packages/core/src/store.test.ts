import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from './database.js';
import { TaskStore } from './store.js';
import { allamaHome } from './paths.js';

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
  it('supports an explicit application home for isolated runs', () => {
    expect(allamaHome({ ALLAMA_HOME: 'C:\\isolated-allama' })).toBe('C:\\isolated-allama');
  });
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

  it('persists additional instructions and approved secret fingerprints', () => {
    const tasks = store();
    const task = tasks.createTask('Inspect', 'C:\\repo');
    tasks.addUserMessage(task.id, 'Do not change the public API');
    expect(tasks.listUserMessages(task.id)).toEqual(['Do not change the public API']);
    expect(tasks.allowedSecretFingerprints(task.id)).toEqual([]);
    tasks.allowSecretFingerprints(task.id, ['fingerprint-1']);
    expect(tasks.allowedSecretFingerprints(task.id)).toEqual(['fingerprint-1']);
  });
});
