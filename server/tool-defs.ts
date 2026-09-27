// セッション（Claude Code）から使う、この仕組みの道具の定義。
// Claude Code の標準の道具ではできないこと（人に届ける・残り続けるセッション・目覚まし・仕組みの再起動）だけを置く。

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const str = (description: string) => ({ type: 'string', description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const TOOL_DEFS: ToolDef[] = [
  // ---- 人に届ける（タスク画面に載る） ----
  {
    name: 'ask_user',
    description:
      '画面の向こうの人に質問する。タスク画面に載り、その人がこのセッションを見ていなくても届く。返事はこのセッションへのメッセージとして届く。',
    inputSchema: obj(
      {
        question: str('質問（短く）'),
        detail: str('補足。Markdown可'),
        options: { type: 'array', items: { type: 'string' }, description: '選択肢（任意）。自由回答もできる' },
      },
      ['question'],
    ),
  },
  {
    name: 'propose',
    description: '「これをやろうか？」という提案をタスク画面に載せる。「やって／やめて」とコメントが、このセッションに届く。',
    inputSchema: obj({ title: str('提案（短く）'), detail: str('中身。Markdown可') }, ['title']),
  },
  {
    name: 'report',
    description: '報告をタスク画面に載せる。その人がコメントを書いたときだけ、このセッションに届く。',
    inputSchema: obj({ title: str('報告（短く）'), detail: str('詳細。Markdown可') }, ['title']),
  },
  {
    name: 'add_user_todo',
    description:
      'その人自身がやるべきことを、タスク画面の「あなたのToDo」に載せる。このセッションの作業の段取り（TaskCreate など）とは別物。',
    inputSchema: obj(
      { title: str('やること'), detail: str('補足'), due: str('期限（ISO 8601。例: 2026-10-01T18:00:00+09:00）') },
      ['title'],
    ),
  },

  // ---- 残り続けるセッション ----
  {
    name: 'start_session',
    description:
      '新しいセッションを始めて、並行して進める。Agent（サブエージェント）と違い、このターンが終わっても残り続け、セッション画面に並び、あとから続きを頼める。',
    inputSchema: obj(
      {
        prompt: str('そのセッションに渡すメッセージ'),
        title: str('題名'),
        cwd: str('作業フォルダ（絶対パス。省略時は既定）'),
        model_id: str('モデルID（省略時は既定）'),
      },
      ['prompt'],
    ),
  },
  {
    name: 'send_to_session',
    description:
      'この仕組みの別のセッションにメッセージを送る（SendMessage はサブエージェント用で、こちらとは別物）。相手が作業中なら、区切りがついたときに届く。',
    inputSchema: obj({ session_id: str('セッションID'), message: str('メッセージ') }, ['session_id', 'message']),
  },

  // ---- 時間 ----
  {
    name: 'schedule_wakeup',
    description:
      '指定の時刻に起こしてもらう。このセッションが終わっていても鳴る。session_id を指定するとそのセッションの続きとして、省略すると新しいセッションとして起きる。',
    inputSchema: obj(
      {
        prompt: str('起きたときに届くメッセージ'),
        at: str('時刻（ISO 8601）'),
        in_minutes: { type: 'number', description: '今から何分後か（at の代わり）' },
        every_minutes: { type: 'number', description: '繰り返す間隔（分、5以上）。省略すると1回きり' },
        session_id: str('続きとして起こすセッション（任意）'),
        model_id: str('新しいセッションのモデル（任意）'),
      },
      ['prompt'],
    ),
  },
  {
    name: 'list_wakeups',
    description: '予定している目覚ましの一覧を見る。',
    inputSchema: obj({}),
  },
  {
    name: 'cancel_wakeup',
    description: '目覚ましを取り消す。',
    inputSchema: obj({ wakeup_id: str('目覚ましID') }, ['wakeup_id']),
  },

  // ---- 仕組み ----
  {
    name: 'restart_self',
    description:
      'この仕組みのソースコードを書き換えたあと、変更を反映するために仕組みを再起動する。型チェック・画面のビルド・読み込みの確認がすべて通ったときだけ再起動する（通らなければ理由を返す）。動いているセッションは止まらない。',
    inputSchema: obj({ reason: str('何を変えたか（ログに残る）') }, ['reason']),
  },
];
