import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { stateDatabasePath } from './paths.js';

export function openDatabase(path = stateDatabasePath()): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      repository_path TEXT NOT NULL,
      status TEXT NOT NULL,
      contract_json TEXT,
      branch TEXT,
      worktree_path TEXT,
      base_branch TEXT,
      summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_task_id_id ON events(task_id, id);
    CREATE TABLE IF NOT EXISTS tool_runs (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      arguments_json TEXT NOT NULL,
      result_json TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(task_id, call_id)
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      project_path TEXT,
      content TEXT NOT NULL,
      source_task_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return database;
}
