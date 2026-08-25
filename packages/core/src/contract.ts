import { ContractSchema, type Contract } from '@allama/protocol';
import { z } from 'zod';

import type { AllamaConfig } from './config.js';
import type { OllamaClient } from './ollama.js';

const CONTRACT_SYSTEM_PROMPT = `You are Allama's chief-of-staff planner.
Turn the request into a concise work contract before any repository mutation.
Use paths relative to the repository. Use ["."] when the whole repository is in scope.
Validation commands must be commands that plausibly exist in the repository; use an empty array when unknown.
Mark mutating false only for explanation, audit, or read-only research tasks.
Allama's standard lifecycle includes approved Git initialization, a dedicated worktree and branch, staging, and a local commit after successful validation. Do not list those lifecycle operations as out of scope or consultation triggers.
Consultation triggers must cover ambiguity, scope expansion, secrets, destructive actions, dependency changes, network writes, push, and merge.
Write all user-facing strings in the user's language. Return only the requested JSON schema.`;

export async function proposeContract(
  ollama: OllamaClient,
  config: AllamaConfig,
  prompt: string,
  repositoryPath: string,
): Promise<Contract> {
  const schema = z.toJSONSchema(ContractSchema, { target: 'draft-7' }) as Record<string, unknown>;
  const raw = await ollama.structured<unknown>(
    config.plannerModel,
    [
      { role: 'system', content: CONTRACT_SYSTEM_PROMPT },
      { role: 'user', content: `Repository: ${repositoryPath}\n\nRequest:\n${prompt}` },
    ],
    schema,
  );
  return ContractSchema.parse(raw);
}
