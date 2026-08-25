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

  it('keeps user and AI work in one due-date ordered agenda', () => {
    const tasks = store();
    const later = tasks.createWorkItem({
      title: 'Later AI task',
      dueAt: '2030-01-02T12:00:00.000Z',
    });
    const first = tasks.createWorkItem({
      owner: 'user',
      kind: 'approval',
      title: 'Answer AI question',
      priority: 'high',
      dueAt: '2030-01-01T12:00:00.000Z',
    });
    tasks.createWorkItem({ title: 'Urgent without a deadline', priority: 'urgent' });

    expect(tasks.listOpenWorkItems().map((item) => item.id)).toEqual([
      first.id,
      later.id,
      expect.any(String),
    ]);
    expect(tasks.nextAiWorkItem()?.id).toBe(later.id);
  });

  it('links a user decision to an execution task and records the answer', () => {
    const tasks = store();
    const task = tasks.createTask('Draft a reply', 'C:\\repo');
    const item = tasks.createWorkItem({
      owner: 'user',
      kind: 'question',
      title: 'Which tone should be used?',
    });
    tasks.linkWorkItem(item.id, task.id);

    expect(tasks.findOpenWorkItemForTask(task.id, 'user')?.id).toBe(item.id);
    expect(tasks.answerWorkItem(item.id, 'Use a friendly tone')).toMatchObject({
      status: 'done',
      answer: 'Use a friendly tone',
      completedAt: expect.any(String),
    });
  });

  it('can requeue an AI item at a user-selected project location', () => {
    const tasks = store();
    const task = tasks.createTask('Build an app', 'C:\\Users\\person');
    const item = tasks.createWorkItem({
      title: 'Build an app',
      repositoryPath: 'C:\\Users\\person',
    });
    tasks.linkWorkItem(item.id, task.id);
    tasks.setWorkItemStatus(item.id, 'waiting');

    expect(tasks.requeueWorkItem(item.id, 'C:\\projects\\app')).toMatchObject({
      repositoryPath: 'C:\\projects\\app',
      taskId: null,
      status: 'open',
    });
  });
});
