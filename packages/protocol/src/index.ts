import { z } from 'zod';

export const ALLAMA_VERSION = '0.1.0';

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
