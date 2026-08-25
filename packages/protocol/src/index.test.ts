import { describe, expect, it } from 'vitest';

import { ALLAMA_VERSION, CreateWorkItemSchema } from './index.js';

describe('protocol version', () => {
  it('is a semantic version', () => {
    expect(ALLAMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('applies understandable defaults to new work items', () => {
    expect(CreateWorkItemSchema.parse({ title: 'Reply to the customer' })).toMatchObject({
      owner: 'ai',
      kind: 'request',
      priority: 'normal',
      dueAt: null,
    });
  });
});
