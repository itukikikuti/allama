import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { Contract } from '@allama/protocol';

import { DecisionRequiredError } from './errors.js';

const BLOCKED_COMMANDS: Array<{
  pattern: RegExp;
  reason: DecisionRequiredError['reason'];
  message: string;
}> = [
  {
    pattern: /\b(?:git\s+)?(?:push|merge|rebase|reset|clean|checkout|switch|cherry-pick)\b/i,
    reason: 'destructive',
    message: 'Git履歴・ブランチ・リモートを変更する操作',
  },
  {
    pattern: /\b(?:Remove-Item|rm|rmdir|del|erase|format)\b/i,
    reason: 'destructive',
    message: '削除またはフォーマット操作',
  },
  {
    pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:add|install|remove|uninstall|update|upgrade)\b/i,
    reason: 'dependency',
    message: '依存関係を変更する操作',
  },
  {
    pattern: /\b(?:Invoke-WebRequest|Invoke-RestMethod|curl|wget|ssh|scp)\b/i,
    reason: 'network',
    message: '外部ネットワークへ接続する操作',
  },
  {
    pattern: /(?:^|[;&|])\s*(?:Set-Content|Add-Content|Out-File)|(?:>>?|2>)\s*[^&]/i,
    reason: 'external_write',
    message: 'シェルから直接ファイルを書き込む操作',
  },
];

export function assertSafeCommand(command: string): void {
  for (const blocked of BLOCKED_COMMANDS) {
    if (blocked.pattern.test(command)) {
      throw new DecisionRequiredError(
        `${blocked.message}を検出したため、実行前に相談が必要です。`,
        blocked.reason,
        { command },
      );
    }
  }
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(command)) {
    throw new DecisionRequiredError(
      '作業ディレクトリ外を参照するコマンドは実行前に相談が必要です。',
      'scope',
      { command },
    );
  }
}

export function resolveRepositoryPath(root: string, path: string): string {
  if (isAbsolute(path)) {
    throw new DecisionRequiredError('絶対パスは許可されていません。', 'scope', { path });
  }
  const absolute = resolve(root, path);
  const fromRoot = relative(resolve(root), absolute);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new DecisionRequiredError('リポジトリ外のパスは許可されていません。', 'scope', { path });
  }
  return absolute;
}

export function assertMutationInScope(contract: Contract, path: string): void {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  const permitted = contract.allowedPaths.some((allowedPath) => {
    const allowed = allowedPath.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
    return allowed === '.' || normalized === allowed || normalized.startsWith(`${allowed}/`);
  });
  if (!permitted) {
    throw new DecisionRequiredError(
      `契約範囲外のパス「${path}」を変更しようとしたため停止しました。`,
      'scope',
      { path, allowedPaths: contract.allowedPaths },
    );
  }
}
