// セッションの記録（ターンごとのファイル）の読み書きと、テキストへの変換

import fs from 'node:fs';
import path from 'node:path';
import type { SessionMeta, TurnData, TurnInput } from '../shared/types.ts';
import { readJson, truncate } from './util.ts';

export type TurnFileKind = 'in.json' | 'in.txt' | 'out.jsonl' | 'err.txt' | 'sys.md';

export function sessionDir(dataDir: string, id: string): string {
  return path.join(dataDir, 'sessions', id);
}

export function turnFile(dataDir: string, id: string, turn: number, kind: TurnFileKind): string {
  return path.join(sessionDir(dataDir, id), `turn-${String(turn).padStart(4, '0')}.${kind}`);
}

export function parseJsonLines(text: string): any[] {
  const out: any[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // 書き込み途中の行などは読み飛ばす
    }
  }
  return out;
}

export function readTurn(dataDir: string, id: string, turn: number): TurnData {
  const input = readJson<TurnInput>(turnFile(dataDir, id, turn, 'in.json'), {
    text: '',
    source: 'user',
    at: '',
  });
  let events: any[] = [];
  try {
    events = parseJsonLines(fs.readFileSync(turnFile(dataDir, id, turn, 'out.jsonl'), 'utf8')).filter(
      (ev) => !(ev.type === 'system' && ev.subtype === 'thinking_tokens'),
    );
  } catch {
    // まだ出力が無い
  }
  return { turn, input, events };
}

export function readTurns(dataDir: string, meta: SessionMeta, fromTurn = 1): TurnData[] {
  const turns: TurnData[] = [];
  for (let t = Math.max(1, fromTurn); t <= meta.turns; t++) turns.push(readTurn(dataDir, meta.id, t));
  return turns;
}

// ---- テキストへの変換（思い出す・検索のため） ----

export interface Piece {
  role: string;
  text: string;
  depth: number;
}

export function toolResultText(block: any): string {
  const c = block?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((x: any) => (x?.type === 'text' ? x.text : x?.type === 'image' ? '[画像]' : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** ツールの呼び出しを、あとで正確に思い出せるだけの中身つきでテキストにする */
export function toolText(name: string, input: any, max: number): string {
  if (!input || typeof input !== 'object') return '';
  const edit = (o: string, n: string) => `--- 変更前\n${o}\n+++ 変更後\n${n}`;
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return truncate(`${input.command ?? ''}${input.description ? `  （${input.description}）` : ''}`, max);
    case 'Write':
      return truncate(`${input.file_path}\n${input.content ?? ''}`, max);
    case 'Edit':
      return truncate(`${input.file_path}\n${edit(input.old_string ?? '', input.new_string ?? '')}`, max);
    case 'MultiEdit':
      return truncate(
        `${input.file_path}\n${(input.edits ?? []).map((e: any) => edit(e.old_string ?? '', e.new_string ?? '')).join('\n')}`,
        max,
      );
    case 'Read':
      return String(input.file_path ?? '');
    default:
      return truncate(JSON.stringify(input), max);
  }
}

/** 1ターン分を、人が読めるテキストの断片に分ける */
export function turnPieces(turn: TurnData, opts: { resultChars?: number } = {}): Piece[] {
  const resultChars = opts.resultChars ?? 1500;
  const pieces: Piece[] = [];
  const src: Record<string, string> = {
    user: 'ユーザー',
    answer: 'タスク画面からの返事',
    wakeup: '目覚まし',
    session: '別の手から',
    system: 'システム',
  };
  if (turn.input.text) pieces.push({ role: src[turn.input.source] ?? 'ユーザー', text: turn.input.text, depth: 0 });
  for (const ev of turn.events) {
    const depth = ev.parent_tool_use_id ? 1 : 0;
    if (ev.type === 'assistant') {
      for (const b of ev.message?.content ?? []) {
        if (b.type === 'text' && b.text?.trim()) pieces.push({ role: 'あなた', text: b.text, depth });
        else if (b.type === 'tool_use') pieces.push({ role: `ツール ${b.name}`, text: toolText(b.name, b.input, resultChars), depth });
      }
    } else if (ev.type === 'user') {
      const content = ev.message?.content;
      if (typeof content === 'string') {
        pieces.push({ role: 'システム', text: content, depth });
      } else if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === 'tool_result') {
            const t = toolResultText(b);
            if (t) pieces.push({ role: b.is_error ? '結果（エラー）' : '結果', text: truncate(t, resultChars), depth });
          } else if (b.type === 'text' && b.text) {
            pieces.push({ role: 'システム', text: b.text, depth });
          }
        }
      }
    } else if (ev.type === 'result' && ev.is_error) {
      pieces.push({ role: 'エラー', text: String(ev.result ?? ''), depth: 0 });
    }
  }
  return pieces;
}

export function turnsToText(turns: TurnData[], opts: { resultChars?: number } = {}): string {
  const lines: string[] = [];
  for (const t of turns) {
    lines.push(`\n===== ターン${t.turn}（${t.input.at}） =====`);
    for (const p of turnPieces(t, opts)) {
      const indent = p.depth ? '    ' : '';
      lines.push(`${indent}【${p.role}】${p.text.replace(/\n/g, `\n${indent}`)}`);
    }
  }
  return lines.join('\n');
}
