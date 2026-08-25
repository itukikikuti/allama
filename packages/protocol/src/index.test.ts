import { describe, expect, it } from 'vitest';

import { ALLAMA_VERSION } from './index.js';

describe('protocol version', () => {
  it('is a semantic version', () => {
    expect(ALLAMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
