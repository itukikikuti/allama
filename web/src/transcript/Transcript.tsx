import { useMemo, useState } from 'react';
import { AlarmClock, Brain, ChevronRight, CircleAlert, Hand } from 'lucide-react';
import type { TurnData, TurnInput } from '../../../shared/types.ts';
import { buildItems, type Item } from './build.ts';
import { ToolCallView } from './ToolCall.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { cx, dateTime, duration } from '../util.ts';

export function Transcript({ turns, running }: { turns: TurnData[]; running: boolean }) {
  const items = useMemo(() => buildItems(turns), [turns]);
  // 動いているのは最後のターンだけ。それより前の「結果待ち」は中断されたもの
  const lastInput = items.map((it) => it.kind).lastIndexOf('input');
  return (
    <div className="transcript">
      <ItemList items={items.slice(0, lastInput)} live={false} />
      <ItemList items={items.slice(lastInput)} live={running} />
    </div>
  );
}

function ItemList({ items, live }: { items: Item[]; live: boolean }) {
  return (
    <>
      {items.map((it, k) => (
        <ItemView key={k} item={it} live={live} />
      ))}
    </>
  );
}

const renderItems = (items: Item[], live: boolean) => <ItemList items={items} live={live} />;

function ItemView({ item, live }: { item: Item; live: boolean }) {
  switch (item.kind) {
    case 'input':
      return <InputView input={item.input} />;
    case 'text':
      return <Markdown className="assistant-text" text={item.text} />;
    case 'thinking':
      return <Thinking text={item.text} />;
    case 'tool':
      return <ToolCallView call={item.call} live={live} renderItems={renderItems} />;
    case 'error':
      return (
        <div className="error-box">
          <CircleAlert size={15} /> <span>{item.text}</span>
        </div>
      );
    case 'note':
      return <div className="note">{item.text}</div>;
    case 'result':
      return <TurnFooter ev={item.ev} model={item.model} />;
  }
}

function Collapsible({ text, lines = 14 }: { text: string; lines?: number }) {
  const [all, setAll] = useState(false);
  const rows = text.split('\n');
  const long = rows.length > lines || text.length > 1200;
  return (
    <>
      <div className={cx('input-text', long && !all && 'clamped')}>{text}</div>
      {long && (
        <button type="button" className="link-btn" onClick={() => setAll(!all)}>
          {all ? '折りたたむ' : '全文を表示'}
        </button>
      )}
    </>
  );
}

function InputView({ input }: { input: TurnInput }) {
  const time = <time>{dateTime(input.at)}</time>;
  if (input.source === 'wakeup') {
    return (
      <div className="input-event">
        <div className="event-label">
          <AlarmClock size={14} /> 目覚まし {time}
        </div>
        <Collapsible text={input.text} lines={6} />
      </div>
    );
  }
  if (input.source === 'session' || input.source === 'system') {
    return (
      <div className="input-event">
        <div className="event-label">
          <Hand size={14} /> {input.source === 'session' ? '別の手から' : 'まとめて届いたメッセージ'} {time}
        </div>
        <Collapsible text={input.text} lines={8} />
      </div>
    );
  }
  return (
    <div className="bubble-wrap">
      <div className={cx('bubble', input.source === 'answer' && 'answer')}>
        <Collapsible text={input.text} />
      </div>
      {time}
    </div>
  );
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const preview = text.trim().split('\n')[0];
  return (
    <div className={cx('thinking', open && 'open')}>
      <button type="button" onClick={() => setOpen(!open)}>
        <Brain size={14} />
        <span className="thinking-preview">{open ? '考えたこと' : preview}</span>
        <ChevronRight className="chev" size={14} />
      </button>
      {open && <div className="thinking-body">{text}</div>}
    </div>
  );
}

function TurnFooter({ ev, model }: { ev: any; model?: string }) {
  if (ev.is_error) {
    return (
      <div className="turn-footer is-error">
        <CircleAlert size={13} /> エラーで止まった: {String(ev.result ?? ev.subtype ?? '')}
      </div>
    );
  }
  return (
    <div className="turn-footer">
      {[duration(ev.duration_ms), ev.num_turns ? `${ev.num_turns}ステップ` : '', model].filter(Boolean).join(' · ')}
    </div>
  );
}
