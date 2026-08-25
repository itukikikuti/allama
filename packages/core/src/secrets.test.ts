import { describe, expect, it } from 'vitest';

import { DecisionRequiredError } from './errors.js';
import { assertCloudSafe, isSecretFile, scanSecrets } from './secrets.js';

describe('secret protection', () => {
  it('recognizes sensitive file names', () => {
    expect(isSecretFile('.env.local')).toBe(true);
    expect(isSecretFile('id_ed25519')).toBe(true);
    expect(isSecretFile('src/index.ts')).toBe(false);
  });

  it('redacts findings and stops cloud transmission', () => {
    const text = 'api_key = "abcdefghijklmnopqrstuvwxyz123456"';
    const findings = scanSecrets(text);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.preview).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(() => assertCloudSafe(text, 'test')).toThrow(DecisionRequiredError);
  });
});
