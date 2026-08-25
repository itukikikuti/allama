import { describe, expect, it } from 'vitest';

import { DecisionRequiredError } from './errors.js';
import { assertMutationInScope, assertSafeCommand, resolveRepositoryPath } from './policy.js';

describe('execution policy', () => {
  it('allows verification but stops destructive, dependency, and network commands', () => {
    expect(() => assertSafeCommand('pnpm test')).not.toThrow();
    expect(() => assertSafeCommand('git diff --check')).not.toThrow();
    for (const command of [
      'git push',
      'Remove-Item foo',
      'pnpm add left-pad',
      'curl example.com',
    ]) {
      expect(() => assertSafeCommand(command)).toThrow(DecisionRequiredError);
    }
  });

  it('keeps paths inside the repository and mutations inside contract scope', () => {
    expect(resolveRepositoryPath('C:\\repo', 'src/index.ts')).toBe('C:\\repo\\src\\index.ts');
    expect(() => resolveRepositoryPath('C:\\repo', '..\\secret.txt')).toThrow(
      DecisionRequiredError,
    );
    const contract = {
      goal: 'Edit source',
      completionCriteria: ['Done'],
      allowedPaths: ['src'],
      outOfScope: [],
      validationCommands: [],
      consultationTriggers: [],
      mutating: true,
    };
    expect(() => assertMutationInScope(contract, 'src/index.ts')).not.toThrow();
    expect(() => assertMutationInScope(contract, 'package.json')).toThrow(DecisionRequiredError);
  });
});
