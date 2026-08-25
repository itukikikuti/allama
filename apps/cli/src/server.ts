import Fastify, { type FastifyInstance } from 'fastify';

import {
  AddMessageSchema,
  CreateWorkItemSchema,
  CreateTaskSchema,
  DecisionSchema,
  type AllamaEngine,
  type TaskStore,
} from '@allama/core';

export interface ServerDependencies {
  apiToken: string;
  engine: Pick<AllamaEngine, 'plan' | 'decide' | 'cancel' | 'run'>;
  store: TaskStore;
}

export function buildServer(dependencies: ServerDependencies): FastifyInstance {
  const app = Fastify({ logger: false });
  const active = new Map<string, AbortController>();

  app.addHook('onRequest', async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${dependencies.apiToken}`) {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  });

  const runBackground = (taskId: string): void => {
    if (active.has(taskId)) return;
    const controller = new AbortController();
    active.set(taskId, controller);
    void dependencies.engine
      .run(taskId, controller.signal)
      .catch(() => undefined)
      .finally(() => active.delete(taskId));
  };

  app.get('/health', async () => ({ ok: true }));

  app.get('/v1/work-items', async (request) => {
    const query = request.query as { owner?: 'user' | 'ai'; all?: string };
    const items =
      query.all === 'true'
        ? dependencies.store.listWorkItems()
        : dependencies.store.listOpenWorkItems(query.owner);
    return { items };
  });

  app.post('/v1/work-items', async (request, reply) => {
    const input = CreateWorkItemSchema.parse(request.body);
    const item = dependencies.store.createWorkItem(input);
    return await reply.code(201).send({ item });
  });

  app.get('/v1/work-items/:id', async (request) => {
    const { id } = request.params as { id: string };
    return { item: dependencies.store.getWorkItem(id) };
  });

  app.get('/v1/tasks', async () => ({ tasks: dependencies.store.listTasks() }));

  app.post('/v1/tasks', async (request, reply) => {
    const input = CreateTaskSchema.parse(request.body);
    const task = await dependencies.engine.plan(input.prompt, input.repositoryPath);
    return await reply.code(201).send({ task });
  });

  app.get('/v1/tasks/:id', async (request) => {
    const { id } = request.params as { id: string };
    return { task: dependencies.store.getTask(id), events: dependencies.store.listEvents(id) };
  });

  app.post('/v1/tasks/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { message } = AddMessageSchema.parse(request.body);
    dependencies.store.addUserMessage(id, message);
    return await reply.code(202).send({ task: dependencies.store.getTask(id) });
  });

  app.post('/v1/tasks/:id/decision', async (request) => {
    const { id } = request.params as { id: string };
    const decision = DecisionSchema.parse(request.body);
    const task = await dependencies.engine.decide(id, decision.approved, decision.message);
    if (task.status === 'executing') runBackground(task.id);
    return { task };
  });

  app.post('/v1/tasks/:id/cancel', async (request) => {
    const { id } = request.params as { id: string };
    active.get(id)?.abort();
    if (!active.has(id)) dependencies.engine.cancel(id);
    return { task: dependencies.store.getTask(id) };
  });

  app.get('/v1/tasks/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { after?: string };
    let cursor = Number(query.after ?? 0);
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const flush = (): void => {
      for (const event of dependencies.store.listEvents(id, cursor)) {
        cursor = event.id;
        reply.raw.write(
          `id: ${event.id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`,
        );
      }
    };
    flush();
    const timer = setInterval(flush, 500);
    request.raw.on('close', () => clearInterval(timer));
  });

  app.setErrorHandler(async (error, _request, reply) => {
    await reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  });
  return app;
}
