// サーバーとWeb画面で共有する型

export type SessionStatus = 'running' | 'idle' | 'error';

/** セッションを始めたきっかけ */
export type Trigger = 'user' | 'wakeup' | 'session';

export interface SessionMeta {
  /** Claude CodeのセッションIDと同じ */
  id: string;
  title: string;
  modelId: string;
  cwd: string;
  trigger: Trigger;
  /** このセッションを立ち上げた別のセッション */
  parentId?: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  /** 今やっていること（本人が set_activity で書く） */
  activity?: string;
  /** 直近のターンの一言要約（Claude Code の post_turn_summary） */
  summary?: string;
  /** 開始したターン数 */
  turns: number;
  pid?: number;
  /** 実行中に届いたメッセージ。ターンが終わったら渡す */
  queue: TurnInput[];
  /** 記憶（日記）に整理済みかどうか */
  digested: boolean;
  lastError?: string;
  lastCostUsd?: number;
}

export type TaskKind = 'question' | 'proposal' | 'report' | 'todo';

export interface Task {
  id: string;
  sessionId: string;
  kind: TaskKind;
  title: string;
  body?: string;
  /** question の選択肢 */
  options?: string[];
  /** todo の期限 */
  due?: string;
  status: 'open' | 'done';
  answer?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface Wakeup {
  id: string;
  at: string;
  prompt: string;
  /** 繰り返し間隔（分） */
  everyMinutes?: number;
  /** 指定があれば、新しいセッションではなくこのセッションに届ける */
  sessionId?: string;
  modelId?: string;
  createdBy?: string;
  createdAt: string;
}

export type InputSource = 'user' | 'answer' | 'wakeup' | 'session' | 'system';

export interface TurnInput {
  text: string;
  source: InputSource;
  at: string;
  fromSessionId?: string;
}

export interface TurnData {
  turn: number;
  input: TurnInput;
  /** Claude Code の stream-json 出力（1行1イベント） */
  events: any[];
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface AppState {
  sessions: SessionMeta[];
  tasks: Task[];
  wakeups: Wakeup[];
  models: ModelOption[];
  defaultModelId: string;
  defaultCwd: string;
}

export type ServerEvent =
  | { type: 'state'; state: AppState }
  | { type: 'turn-start'; sessionId: string; turn: number; input: TurnInput }
  | { type: 'session-event'; sessionId: string; turn: number; event: any };
