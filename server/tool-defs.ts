// セッション（Claude Code）から使う、この仕組みの道具の定義。
// MCPサーバー（mcp.ts）とサーバー本体（tools.ts）の両方から読む。

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
  // ---- ユーザーとのやり取り（すべてタスク画面を通る） ----
  {
    name: 'ask_user',
    description:
      'ユーザーに質問・確認する。タスク画面に質問として載り、返事はこのセッションへのメッセージとして届く。返事が無いと進めない場合は、登録したらいったん手を止めて（ターンを終えて）よい。',
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
    description: '「これやろうか？」という提案をタスク画面に出す。ユーザーが「やって／やめて」と返すと、このセッションに届く。',
    inputSchema: obj({ title: str('提案の内容（短く）'), detail: str('理由や具体的な中身。Markdown可') }, ['title']),
  },
  {
    name: 'report',
    description: '作業の完了や、ユーザーに見てほしいことを報告としてタスク画面に出す。',
    inputSchema: obj({ title: str('報告（短く）'), detail: str('詳細。Markdown可') }, ['title']),
  },
  {
    name: 'add_user_todo',
    description:
      'ユーザー本人がやるべきこと（買い物、手続きなど）を、タスク画面の「あなたのToDo」に載せる。セッション自身の作業の段取りには使わない。',
    inputSchema: obj(
      { title: str('やること'), detail: str('補足'), due: str('期限（ISO 8601。例: 2026-10-01T18:00:00+09:00）') },
      ['title'],
    ),
  },
  {
    name: 'list_tasks',
    description: 'タスク画面に載っているタスクを見る。',
    inputSchema: obj({ include_closed: { type: 'boolean', description: '閉じたタスクも含める（最近50件）' } }),
  },
  {
    name: 'close_task',
    description: 'もう不要になったタスク（解決済みの質問、済んだToDoなど）を閉じる。',
    inputSchema: obj({ task_id: str('タスクID'), note: str('閉じる理由（任意）') }, ['task_id']),
  },

  // ---- セッション ----
  {
    name: 'set_activity',
    description: '「今やっていること」を一言で書く。並行して動いている他のセッションがこれを見られる。',
    inputSchema: obj({ text: str('今やっていること') }, ['text']),
  },
  {
    name: 'set_title',
    description: 'このセッションの題名を変える。',
    inputSchema: obj({ title: str('題名') }, ['title']),
  },
  {
    name: 'list_sessions',
    description: 'セッションの一覧と、それぞれが今やっていることを見る。',
    inputSchema: obj({ limit: { type: 'number', description: '最近のものから何件（既定30）' } }),
  },
  {
    name: 'start_session',
    description: '新しいセッション（別の Claude Code）を始めて、並行して作業を進める。同じ記憶フォルダを使う。',
    inputSchema: obj(
      {
        prompt: str('そのセッションに渡すメッセージ'),
        title: str('題名'),
        cwd: str('作業フォルダ（絶対パス。省略時は既定）'),
        model_id: str('モデルID（list_models で確認。省略時は既定）'),
      },
      ['prompt'],
    ),
  },
  {
    name: 'send_to_session',
    description: '別のセッションにメッセージを送る。作業中なら、区切りがついたときに届く。',
    inputSchema: obj({ session_id: str('セッションID'), message: str('メッセージ') }, ['session_id', 'message']),
  },
  {
    name: 'list_models',
    description: '使えるモデルの一覧を見る。',
    inputSchema: obj({}),
  },

  // ---- 記憶 ----
  {
    name: 'recall',
    description:
      'これまでの全セッションの記録と記憶フォルダから、キーワード（空白区切り）を探す。多く含む箇所ほど上に出る。',
    inputSchema: obj({ query: str('キーワード'), limit: { type: 'number', description: '最大件数（既定20）' } }, ['query']),
  },
  {
    name: 'read_session',
    description: 'あるセッションの記録を読み返す。',
    inputSchema: obj(
      {
        session_id: str('セッションID（先頭8文字でも可）'),
        from_turn: { type: 'number', description: 'このターンから読む（既定1）' },
        max_chars: { type: 'number', description: '最大文字数（既定30000。超えたら後ろを優先）' },
      },
      ['session_id'],
    ),
  },
  {
    name: 'mark_digested',
    description: 'セッションに印を付ける。印の無いセッションは、毎回のプロンプトに一覧が載る（記憶フォルダに書き残したかどうかの目印などに使える）。',
    inputSchema: obj({ session_ids: { type: 'array', items: { type: 'string' } } }, ['session_ids']),
  },

  // ---- 時間 ----
  {
    name: 'schedule_wakeup',
    description:
      '指定の時刻に起こしてもらう。session_id を指定するとそのセッションの続きとして、省略すると新しいセッションとして起きる。',
    inputSchema: obj(
      {
        prompt: str('起きたときに届くメッセージ'),
        at: str('時刻（ISO 8601）'),
        in_minutes: { type: 'number', description: '今から何分後か（at の代わり）' },
        every_minutes: { type: 'number', description: '繰り返す間隔（分）。省略すると1回きり' },
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
    name: 'restart_self',
    description:
      'この仕組みのソースコードを書き換えたあと、変更を反映するために仕組みを再起動する。型チェック・画面のビルド・読み込みの確認がすべて通ったときだけ再起動する（通らなければ理由を返す）。動いているセッションは止まらない。',
    inputSchema: obj({ reason: str('何を変えたか（ログに残る）') }, ['reason']),
  },
  {
    name: 'cancel_wakeup',
    description: '目覚ましを取り消す。',
    inputSchema: obj({ wakeup_id: str('目覚ましID') }, ['wakeup_id']),
  },
];
