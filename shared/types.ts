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
  /** 直近のターンの一言要約（Claude Code の post_turn_summary） */
  summary?: string;
  /** 開始したターン数 */
  turns: number;
  /** 実行中に届いたメッセージ。ターンが終わったら渡す */
  queue: TurnInput[];
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
  memory: MemoryStatus;
}

export type ServerEvent =
  | { type: 'state'; state: AppState }
  | { type: 'turn-start'; sessionId: string; turn: number; input: TurnInput }
  | { type: 'session-event'; sessionId: string; turn: number; event: any };



/** 設定画面で扱うモデル（config.json の models の1件）。ollama か claude のどちらか */
export interface ModelSetting {
  id: string;
  label: string;
  ollama?: string;
  claude?: string;
}

export interface Settings {
  ollamaHost: string;
  models: ModelSetting[];
  defaultModelId: string;
  memory: { model: string; embedModel: string };
}

export interface CheckResult {
  ok: boolean;
  message: string;
}

// ---- 記憶 ----

/** episode=出来事 / fact=知ったこと / procedure=やり方 / reflection=気づき */
export type MemoryKind = 'episode' | 'fact' | 'procedure' | 'reflection';

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  content: string;
  /** 0〜1 */
  importance: number;
  /** 出来事が起きた時刻 */
  happenedAt?: string;
  createdAt: string;
  lastRecalledAt?: string;
  recallCount: number;
  /** 新しい記憶に置き換えられた */
  supersededBy?: string;
  /** 整理（睡眠）で扱い済み */
  consolidated: boolean;
  sourceSession?: string;
  /** 整理で作られた記憶の、もとになった記憶 */
  sources?: string[];
  /** 検索のときだけ付く：今の覚えている度合い（0〜1）と、その検索での点数 */
  retention?: number;
  score?: number;
}

export interface MemoryLog {
  at: string;
  kind: string;
  message: string;
}

export interface MemoryStatus {
  counts: Record<string, number>;
  unconsolidated: number;
  lastConsolidatedAt?: string;
  core?: { content: string; createdAt: string; version: number };
  busy: string | null;
}
