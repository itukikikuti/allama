// 毎ターン、セッションに渡すシステムプロンプト。
// 調べても分からない「この仕組みの約束」と、記憶フォルダの README.md だけを渡す。
// 人格・呼び方・振る舞いは一切決めない。最初はモデルの知識だけがあり、ほかは何も知らない状態から始まる。

import path from 'node:path';
import type { App } from './app.ts';

/** README.md を毎回載せる上限。超えたら載せずに知らせる */
export const README_MAX_CHARS = 10_000;

/** 目覚ましが1つも無いときに、仕組みが起こすときの文 */
export const PATROL_PROMPT = '予定されている目覚ましが1つも無かったので、仕組みが起こした。';

export function buildSystemPrompt(app: App): string {
  const { mind, config } = app;
  const readme = mind.read('README.md').trim();
  const body = !readme
    ? '（空）'
    : readme.length > README_MAX_CHARS
      ? `（${readme.length}字あり、上限の${README_MAX_CHARS}字を超えているので載せていない）`
      : readme;
  return `# この仕組みについて

- この会話は、終わると次のセッションには引き継がれない。引き継がれるのは記憶フォルダ（${mind.dir}）に書いたものだけ。その中の README.md は、毎回このプロンプトの最後に載る（${README_MAX_CHARS}字まで）。
- これまでの全セッションの記録は ${path.join(config.dataDir, 'sessions')}/<セッションID>/transcript.md にある。
- 普通の返答は、相手がセッション画面を見ているときしか読まれない。確実に届けたいことは ask_user・propose・report・add_user_todo で届ける。返事はこのセッションへのメッセージとして届く。

# 記憶フォルダの README.md

${body}
`;
}
