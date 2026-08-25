import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Contract } from '@allama/protocol';

import { DecisionRequiredError } from './errors.js';
import { assertMutationInScope, resolveRepositoryPath } from './policy.js';
import { runProcess } from './process.js';
import { isSecretFile } from './secrets.js';

export class RepositoryAccess {
  public constructor(
    private readonly root: string,
    private readonly contract: Contract,
  ) {}

  public async read(path: string, maxBytes = 200_000): Promise<string> {
    if (isSecretFile(path)) {
      throw new DecisionRequiredError(
        `秘密ファイル候補「${path}」の読み取り前に相談が必要です。`,
        'secret',
        { path },
      );
    }
    const content = await readFile(resolveRepositoryPath(this.root, path), 'utf8');
    if (Buffer.byteLength(content) > maxBytes) {
      return `${content.slice(0, maxBytes)}\n\n[truncated by Allama]`;
    }
    return content;
  }

  public async search(pattern: string, glob?: string): Promise<string> {
    const args = ['-n', '--hidden', '--glob', '!.git/**', '--max-count', '200'];
    if (glob) args.push('--glob', glob);
    args.push('--', pattern, '.');
    const result = await runProcess('rg', args, {
      cwd: this.root,
      timeoutMs: 30_000,
      maxOutputBytes: 500_000,
    });
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(`Search failed: ${result.stderr}`);
    }
    return result.stdout;
  }

  public async writeNew(path: string, content: string): Promise<void> {
    assertMutationInScope(this.contract, path);
    const absolute = resolveRepositoryPath(this.root, path);
    try {
      await readFile(absolute);
      throw new DecisionRequiredError(
        `既存ファイル「${path}」はwrite_fileで上書きできません。replace_textを使用してください。`,
        'scope',
        { path },
      );
    } catch (error) {
      if (error instanceof DecisionRequiredError) throw error;
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
  }

  public async replace(path: string, oldText: string, newText: string): Promise<void> {
    assertMutationInScope(this.contract, path);
    const absolute = resolveRepositoryPath(this.root, path);
    const content = await readFile(absolute, 'utf8');
    const first = content.indexOf(oldText);
    if (first < 0) throw new Error(`replace_text: oldText was not found in ${path}`);
    if (content.indexOf(oldText, first + oldText.length) >= 0) {
      throw new Error(`replace_text: oldText is not unique in ${path}`);
    }
    await writeFile(absolute, content.replace(oldText, newText), 'utf8');
  }
}
