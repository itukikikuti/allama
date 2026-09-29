// サーバーとWeb画面で共有する型

export type SessionStatus = 'running' | 'idle' | 'error';

/** Claude が考える量（推論エフォート）。Claude のモデルのときだけ使える */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
export const EFFORT_LABEL: Record<EffortLevel, string> = {
  low: '低い',
  medium: '普通',
  high: '高い',
  xhigh: 'とても高い',
  max: '最大',
};

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
  /** 考える量（Claude のモデルのときだけ）。未設定なら Claude Code の既定 */
  effort?: EffortLevel;
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

/** 画面から預かったファイル。置いた場所をそのままセッションから読める */
export interface UploadedFile {
  /** 置いた絶対パス */
  path: string;
  name: string;
  size: number;
}

export interface ModelOption {
  id: string;
  label: string;
  /** Claude（Anthropic）のモデルか。Ollama のモデルでは エフォートは使えない */
  claude: boolean;
}

/** 使用制限の1つの窓（5時間・7日など） */
export interface UsageWindow {
  /** 使った割合（0〜100）。分からないときは null */
  utilization: number | null;
  /** リセットされる時刻 */
  resetsAt?: string;
}

/** Claude の契約（サブスク）で使える量の残り。APIキーやOllamaでは分からない */
export interface RateLimits {
  /** 'pro' | 'max' | 'team' | 'enterprise' など */
  subscriptionType?: string | null;
  /** allowed / allowed_warning / rejected */
  status?: string;
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  /** いつ時点の値か（ターン中に届いたもの） */
  updatedAt: string;
}

export interface AppState {
  sessions: SessionMeta[];
  tasks: Task[];
  wakeups: Wakeup[];
  models: ModelOption[];
  defaultModelId: string;
  defaultCwd: string;
  memory: MemoryStatus;
  /** 分かっているときだけ入る */
  rateLimits?: RateLimits;
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
