import {
  AllamaEngine,
  OllamaClient,
  TaskStore,
  loadConfig,
  openDatabase,
  type AllamaConfig,
} from '@allama/core';

export interface Runtime {
  config: AllamaConfig;
  store: TaskStore;
  ollama: OllamaClient;
  engine: AllamaEngine;
}

export async function createRuntime(): Promise<Runtime> {
  const config = await loadConfig();
  const store = new TaskStore(openDatabase());
  const ollama = new OllamaClient(config.ollamaBaseUrl);
  const engine = new AllamaEngine(config, store, ollama);
  return { config, store, ollama, engine };
}
