import { z } from 'zod';

export const ALLAMA_VERSION = '0.2.1';

export const TaskStatusSchema = z.enum([
  'contract_proposed',
  'awaiting_approval',
  'executing',
  'awaiting_decision',
  'verifying',
  'completed',
  'failed',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const ContractSchema = z.object({
  goal: z.string().min(1),
  completionCriteria: z.array(z.string().min(1)).min(1),
  allowedPaths: z.array(z.string().min(1)).default(['.']),
  outOfScope: z.array(z.string()).default([]),
  validationCommands: z.array(z.string().min(1)).default([]),
  consultationTriggers: z.array(z.string().min(1)).default([]),
  mutating: z.boolean(),
});
export type Contract = z.infer<typeof ContractSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  repositoryPath: z.string(),
  status: TaskStatusSchema,
  contract: ContractSchema.nullable(),
  branch: z.string().nullable(),
  worktreePath: z.string().nullable(),
  baseBranch: z.string().nullable(),
  summary: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const WorkOwnerSchema = z.enum(['user', 'ai']);
export const WorkKindSchema = z.enum(['request', 'approval', 'question', 'location', 'action']);
export const WorkStatusSchema = z.enum(['open', 'in_progress', 'waiting', 'done', 'cancelled']);
export const WorkPrioritySchema = z.enum(['urgent', 'high', 'normal', 'low']);
export type WorkOwner = z.infer<typeof WorkOwnerSchema>;
export type WorkKind = z.infer<typeof WorkKindSchema>;
export type WorkStatus = z.infer<typeof WorkStatusSchema>;
export type WorkPriority = z.infer<typeof WorkPrioritySchema>;

export const WorkItemSchema = z.object({
  id: z.string(),
  owner: WorkOwnerSchema,
  kind: WorkKindSchema,
  title: z.string().min(1),
  details: z.string().default(''),
  status: WorkStatusSchema,
  priority: WorkPrioritySchema,
  dueAt: z.string().datetime().nullable(),
  repositoryPath: z.string().nullable(),
  taskId: z.string().nullable(),
  answer: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type WorkItem = z.infer<typeof WorkItemSchema>;

export const CreateWorkItemSchema = z.object({
  owner: WorkOwnerSchema.default('ai'),
  kind: WorkKindSchema.default('request'),
  title: z.string().min(1),
  details: z.string().default(''),
  priority: WorkPrioritySchema.default('normal'),
  dueAt: z.string().datetime().nullable().default(null),
  repositoryPath: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
});
export type CreateWorkItem = z.infer<typeof CreateWorkItemSchema>;
export type CreateWorkItemInput = z.input<typeof CreateWorkItemSchema>;

export const AnswerWorkItemSchema = z.object({
  answer: z.string().default(''),
  approved: z.boolean(),
});

export const EventKindSchema = z.enum([
  'task_created',
  'contract_proposed',
  'contract_approved',
  'status_changed',
  'progress',
  'heartbeat',
  'tool_started',
  'tool_finished',
  'validation_started',
  'validation_finished',
  'commit_created',
  'decision_required',
  'memory_proposed',
  'memory_approved',
  'memory_rejected',
  'completed',
  'failed',
  'cancelled',
]);
export type EventKind = z.infer<typeof EventKindSchema>;

export const TaskEventSchema = z.object({
  id: z.number().int().nonnegative(),
  taskId: z.string(),
  kind: EventKindSchema,
  message: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
});
export type TaskEvent = z.infer<typeof TaskEventSchema>;

export const MemoryStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export const MemoryScopeSchema = z.enum(['user', 'project']);
export const MemorySchema = z.object({
  id: z.string(),
  scope: MemoryScopeSchema,
  projectPath: z.string().nullable(),
  content: z.string().min(1),
  sourceTaskId: z.string().nullable(),
  status: MemoryStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Memory = z.infer<typeof MemorySchema>;

export const DecisionSchema = z.object({
  approved: z.boolean(),
  message: z.string().optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const CreateTaskSchema = z.object({
  prompt: z.string().min(1),
  repositoryPath: z.string().min(1),
});
export type CreateTask = z.infer<typeof CreateTaskSchema>;

export const AddMessageSchema = z.object({ message: z.string().min(1) });
