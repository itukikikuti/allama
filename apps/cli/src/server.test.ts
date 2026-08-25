import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { TaskStore, openDatabase, type AllamaEngine, type EngineRunResult } from '@allama/core';

import { buildServer } from './server.js';

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = openDatabase(':memory:');
  databases.push(database);
  const store = new TaskStore(database);
  const engine: Pick<AllamaEngine, 'plan' | 'decide' | 'cancel' | 'run'> = {
    async plan(prompt, repositoryPath) {
      const task = store.createTask(prompt, repositoryPath);
      return store.setContract(task.id, {
        goal: prompt,
        completionCriteria: ['Answer produced'],
        allowedPaths: ['.'],
        outOfScope: [],
        validationCommands: [],
        consultationTriggers: [],
        mutating: false,
      });
    },
    async decide(taskId, approved) {
      return approved ? store.approveContract(taskId) : store.setStatus(taskId, 'cancelled');
    },
    cancel(taskId) {
      return store.setStatus(taskId, 'cancelled');
    },
    async run(taskId): Promise<EngineRunResult> {
      const task = store.setStatus(taskId, 'completed', 'done');
      return { task, summary: 'done', commit: null };
    },
  };
  return { store, engine };
}

describe('Allama API', () => {
  it('requires a bearer token and creates a contract task', async () => {
    const { store, engine } = fixture();
    const app = buildServer({ apiToken: 'test-token', store, engine });
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(401);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: 'Bearer test-token' },
      payload: { prompt: 'Inspect the project', repositoryPath: 'C:\\repo' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().task.status).toBe('awaiting_approval');
    await app.close();
  });
});
