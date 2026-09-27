// 頭：どの手（セッション）にも、置かれている仕組みの事実と、記憶の入口（README.md）と、今の状況を渡す。
// 人格・呼び方・振る舞いは一切決めない。最初はモデルの知識だけがあり、ほかは何も知らない状態から始まる。

import fs from 'node:fs';
import os from 'node:os';
import type { SessionMeta, TurnInput } from '../shared/types.ts';
import type { App } from './app.ts';
import { APP_DIR } from './config.ts';
import { formatTime, truncate } from './util.ts';

/** 目覚ましが1つも無いときに、仕組みが起こすときの文 */
export const PATROL_PROMPT = '予定されている目覚ましが1つも無かったので、仕組みが起こした。';

/** 体が今どこで動いているか（記憶が古くても、ここが今の事実） */
function whereAmI(): string {
  const inContainer = fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
  return `${os.hostname()}（${os.type()} ${os.release()}、ユーザー ${os.userInfo().username}、${inContainer ? 'コンテナの中' : 'ホストで直接'}）`;
}

const TRIGGER_TEXT: Record<string, string> = {
  user: '画面から始められた',
  wakeup: '目覚まし',
  session: '別のセッションから始められた',
};

export function buildSystemPrompt(app: App, meta: SessionMeta, turn: number, input: TurnInput): string {
  const { config, store, mind } = app;
  const tz = config.timezone;
  const t = (iso: string) => formatTime(iso, tz);
  const titleOf = (id?: string) => (id ? store.session(id)?.title ?? '?' : '');

  const others = store.sessions.filter((s) => s.id !== meta.id && s.status === 'running');
  const recent = store.sessions
    .filter((s) => s.id !== meta.id && s.status !== 'running')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
  const openTasks = store.tasks.filter((x) => x.status === 'open');
  const recentlyClosed = store.tasks
    .filter((x) => x.status === 'done' && x.closedAt && Date.now() - Date.parse(x.closedAt) < 3 * 86400_000)
    .slice(-10);
  const undigested = store.sessions
    .filter((s) => !s.digested && s.status !== 'running' && s.turns > 0 && s.id !== meta.id)
    .slice(0, 20);
  const wakeups = [...store.wakeups].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 15);
  const model = config.models.find((m) => m.id === meta.modelId);

  const list = (items: string[]) => (items.length ? items.join('\n') : 'なし');

  return `# この仕組みについて

これは、あなたが置かれている仕組みの事実だけを書いたもの。あなたが誰か・何をすべきかは、ここでは決めていない。

- あなたは Claude Code のセッションとして動いている。同じ仕組みの中で、別のセッションが同時に動いていることもある。どのセッションも同じ記憶フォルダを使う。
- セッションの会話は、終わると次のセッションには引き継がれない。引き継がれるのは、記憶フォルダ（${mind.dir}）に書いたものだけ。
- 記憶フォルダの README.md は、毎回このプロンプトの最後に載る。それ以外のファイルは載らないので、必要なら自分で読む。記憶フォルダの変更は、自動で git に記録される。
- これまでの全セッションの記録は残っていて、recall と read_session で読める。
- ツールの実行に許可は求められない。
- 画面の向こうの人とは、2つの方法でやり取りできる。
  - セッション画面：その人はこのセッションの記録を見られ、ここに直接話しかけてくることもある（このターンのきっかけが user のとき）。普通の返答はここに表示される。
  - タスク画面：ask_user・propose・report・add_user_todo で載せたものは、その人がこのセッションを見ていなくても届く。返事は、このセッションへのメッセージとして届く。

# 今の状況

現在時刻: ${t(new Date().toISOString())}（${tz}）
動いている場所: ${whereAmI()}
この仕組みのソースコード: ${APP_DIR}
このセッション: 「${meta.title}」 id=${meta.id} / ターン${turn} / モデル: ${model?.label ?? meta.modelId} / 作業フォルダ: ${meta.cwd}
始まったきっかけ: ${TRIGGER_TEXT[meta.trigger] ?? meta.trigger}${meta.parentId ? `（「${titleOf(meta.parentId)}」id=${meta.parentId}）` : ''}
このターンのきっかけ: ${input.source}

## いま動いているほかのセッション
${list(others.map((s) => `- 「${s.title}」 id=${s.id} ／ 今: ${s.activity ?? '（未記入）'} ／ 最終更新 ${t(s.updatedAt)}`))}

## 最近のセッション
${list(recent.map((s) => `- 「${s.title}」 id=${s.id} ／ ${s.status === 'error' ? 'エラーで停止' : '待機中'} ／ ${t(s.updatedAt)}`))}

## タスク画面に出ているもの
${list(
  openTasks.map(
    (x) =>
      `- [${x.kind}] ${x.title} ／ task_id=${x.id} ／ セッション: 「${titleOf(x.sessionId)}」${x.due ? ` ／ 期限 ${t(x.due)}` : ''}`,
  ),
)}

## 最近閉じたタスク
${list(recentlyClosed.map((x) => `- [${x.kind}] ${x.title} → ${x.answer ?? ''}`))}

## 予定している目覚まし
${list(
  wakeups.map(
    (w) =>
      `- ${t(w.at)}${w.everyMinutes ? `（${w.everyMinutes}分ごと）` : ''} ／ ${truncate(w.prompt.replace(/\n/g, ' '), 120)} ／ wakeup_id=${w.id}`,
  ),
)}

## mark_digested の印が付いていないセッション
${list(undigested.map((s) => `- 「${s.title}」 id=${s.id} ／ ${t(s.updatedAt)}`))}

# 記憶フォルダの README.md

${mind.read('README.md').trim() || '（まだ何も書かれていない）'}

## 記憶フォルダにあるファイル
${mind.listFiles(100).join('\n') || '（無し）'}
`;
}
