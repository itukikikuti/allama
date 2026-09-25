// Claude Code の stream-json のイベント列を、画面に並べる項目へ組み立てる。
// ・1つの返答は、中身のかたまりごとに別々のイベントで届く
// ・ツールの結果は後から届くので、呼び出しに結びつける（IDはモデルによって重複するので、直近のものに結ぶ）
// ・サブエージェントの動きは parent_tool_use_id 付きで届くので、その呼び出しの中に入れ子にする

import type { TurnData, TurnInput } from '../../../shared/types.ts';

export interface ToolCall {
  id: string;
  name: string;
  input: any;
  result?: { content: any; isError: boolean; meta?: any };
  children: Item[];
  agent?: { status?: string; summary?: string; progress?: string };
}

export type Item =
  | { kind: 'input'; turn: number; input: TurnInput }
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; call: ToolCall }
  | { kind: 'error'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'result'; turn: number; ev: any; model?: string };

const AGENT_TOOLS = new Set(['Agent', 'Task']);

function blockText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (b?.type === 'text' ? b.text : '')).join('');
  return '';
}

export function buildItems(turns: TurnData[]): Item[] {
  const items: Item[] = [];
  const calls = new Map<string, ToolCall>();
  const agents = new Map<string, ToolCall>();
  const key = (parent: string | null | undefined, id: string) => `${parent ?? ''}|${id}`;

  for (const turn of turns) {
    items.push({ kind: 'input', turn: turn.turn, input: turn.input });
    let model: string | undefined;

    for (const ev of turn.events) {
      const parent: string | null | undefined = ev.parent_tool_use_id;
      const target = parent ? agents.get(parent)?.children ?? items : items;

      if (ev.type === 'system') {
        if (ev.subtype === 'init') model = ev.model;
        else if (ev.subtype === 'compact_boundary') target.push({ kind: 'note', text: '会話が長くなったので、要約して続けた' });
        else if (ev.subtype === 'task_notification' && ev.tool_use_id) {
          const a = agents.get(ev.tool_use_id);
          if (a) a.agent = { ...a.agent, status: ev.status, summary: ev.summary };
        } else if (ev.subtype === 'task_progress' && ev.tool_use_id) {
          const a = agents.get(ev.tool_use_id);
          if (a) a.agent = { ...a.agent, progress: ev.description };
        }
        continue;
      }

      if (ev.type === 'assistant') {
        const content = ev.message?.content ?? [];
        if (ev.error || ev.is_api_error_message) {
          target.push({ kind: 'error', text: blockText(content) || String(ev.error) });
          continue;
        }
        for (const b of content) {
          if (b.type === 'text' && b.text?.trim()) {
            const last = target[target.length - 1];
            // 同じ返答の続きの文章は1つにまとめる
            if (last?.kind === 'text') last.text += `\n\n${b.text}`;
            else target.push({ kind: 'text', text: b.text });
          } else if (b.type === 'thinking' && b.thinking?.trim()) {
            target.push({ kind: 'thinking', text: b.thinking });
          } else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
            const call: ToolCall = { id: b.id, name: b.name, input: b.input ?? {}, children: [] };
            calls.set(key(parent, b.id), call);
            if (AGENT_TOOLS.has(b.name)) agents.set(b.id, call);
            target.push({ kind: 'tool', call });
          }
        }
        continue;
      }

      if (ev.type === 'user') {
        const content = ev.message?.content;
        if (typeof content === 'string') {
          if (!parent && !ev.isReplay && content.trim()) target.push({ kind: 'note', text: content });
          continue;
        }
        for (const b of content ?? []) {
          if (b.type === 'tool_result') {
            const call = calls.get(key(parent, b.tool_use_id));
            if (call) call.result = { content: b.content, isError: !!b.is_error, meta: ev.tool_use_result };
          }
        }
        continue;
      }

      if (ev.type === 'result') items.push({ kind: 'result', turn: turn.turn, ev, model });
    }
  }
  return items;
}
