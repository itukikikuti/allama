import { basename } from 'node:path';
import { createHash } from 'node:crypto';

import { DecisionRequiredError } from './errors.js';

export interface SecretFinding {
  kind: string;
  preview: string;
  fingerprint: string;
  line: number;
}

const SECRET_FILE_NAMES = [
  /^\.env(?:\.|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /id_(?:rsa|ed25519)$/i,
  /credentials/i,
];

const SECRET_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { kind: 'github-token', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  { kind: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}\b/gi },
  {
    kind: 'assigned-secret',
    pattern:
      /\b(?:api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{16,})/gi,
  },
];

function preview(value: string): string {
  return value.length <= 8 ? '[redacted]' : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function isSecretFile(path: string): boolean {
  return SECRET_FILE_NAMES.some((pattern) => pattern.test(basename(path)));
}

export function scanSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { kind, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      findings.push({
        kind,
        preview: preview(match[1] ?? match[0]),
        fingerprint: createHash('sha256').update(match[0]).digest('hex'),
        line: text.slice(0, index).split('\n').length,
      });
    }
  }
  return findings;
}

export function assertCloudSafe(text: string, source: string, allowed: string[] = []): void {
  const allowedSet = new Set(allowed);
  const findings = scanSecrets(text).filter((finding) => !allowedSet.has(finding.fingerprint));
  if (findings.length > 0) {
    throw new DecisionRequiredError(
      `Cloud送信候補「${source}」で機密情報らしき値を検出しました。送信を停止しています。`,
      'secret',
      { source, findings },
    );
  }
}
