import { useMemo } from 'react';
import { diffLines } from 'diff';

export interface Hunk {
  oldStart: number;
  newStart: number;
  lines: string[];
}

interface Row {
  type: 'add' | 'del' | 'ctx' | 'sep';
  text: string;
  oldNo?: number;
  newNo?: number;
}

function fromHunks(hunks: Hunk[]): Row[] {
  const rows: Row[] = [];
  hunks.forEach((h, i) => {
    if (i > 0) rows.push({ type: 'sep', text: '⋯' });
    let o = h.oldStart;
    let n = h.newStart;
    for (const l of h.lines) {
      if (l.startsWith('\\')) continue; // "\ No newline at end of file"
      const text = l.slice(1);
      if (l[0] === '+') rows.push({ type: 'add', text, newNo: n++ });
      else if (l[0] === '-') rows.push({ type: 'del', text, oldNo: o++ });
      else rows.push({ type: 'ctx', text, oldNo: o++, newNo: n++ });
    }
  });
  return rows;
}

function fromTexts(oldText: string, newText: string): Row[] {
  const rows: Row[] = [];
  for (const part of diffLines(oldText, newText)) {
    for (const text of part.value.replace(/\n$/, '').split('\n')) {
      rows.push({ type: part.added ? 'add' : part.removed ? 'del' : 'ctx', text });
    }
  }
  return rows;
}

/** 変更の差分。行番号付きの差分（hunks）があればそれを使う */
export function Diff({ oldText, newText, hunks }: { oldText?: string; newText?: string; hunks?: Hunk[] }) {
  const rows = useMemo(
    () => (hunks?.length ? fromHunks(hunks) : fromTexts(oldText ?? '', newText ?? '')),
    [hunks, oldText, newText],
  );
  const numbered = !!hunks?.length;
  const added = rows.filter((r) => r.type === 'add').length;
  const removed = rows.filter((r) => r.type === 'del').length;
  return (
    <div className="diff">
      <div className="diff-stat">
        <span className="add">+{added}</span> <span className="del">−{removed}</span>
      </div>
      <div className="diff-body">
        {rows.map((r, i) => (
          <div key={i} className={`diff-row ${r.type}`}>
            {numbered && <span className="ln">{r.type === 'add' ? '' : r.oldNo ?? ''}</span>}
            {numbered && <span className="ln">{r.type === 'del' ? '' : r.newNo ?? ''}</span>}
            <span className="sign">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</span>
            <span className="txt">{r.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
