// 毎ターン、セッションに渡すシステムプロンプト。
// 調べても分からない「この仕組みの約束」と、記憶の核、このメッセージをきっかけに思い出したことだけを渡す。
// 人格・呼び方・振る舞いは一切決めない。最初はモデルの知識だけがあり、ほかは何も知らない状態から始まる。

import path from 'node:path';
import type { MemoryItem } from '../shared/types.ts';
import type { App } from './app.ts';
import { Memory } from './memory/index.ts';

/** 目覚ましが1つも無いときに、仕組みが起こすときの文。
 * 文は掛けた時点で決まり、鳴るのは数時間後なので、鳴った時点のことを書いてはいけない。 */
export const PATROL_PROMPT =
  '見回りの目覚まし。掛けたときは予定が1つも無かったので、仕組みが起こした。鳴るまでに予定が入っていることもある。';

export function buildSystemPrompt(app: App, recalled: MemoryItem[]): string {
  const { config, memory } = app;
  const core = memory.db.core()?.content;
  return `# この仕組みについて

- この会話は、終わると次のセッションには引き継がれない。代わりに、体験は自動で記憶され、ときどき整理される。
- 下の「記憶の核」と「思い出したこと」は、記憶から自動で取り出したもの。もっと思い出したいときは remember で探す。
- 全セッションの記録そのものは ${path.join(config.dataDir, 'sessions')}/<セッションID>/transcript.md にある。
- 普通の返答は、相手がセッション画面を見ているときしか読まれない。確実に届けたいことは ask_user・propose・report・add_user_todo で届ける。返事はこのセッションへのメッセージとして届く。

# 記憶の核

${core || '（まだ無い）'}

# 思い出したこと

${Memory.format(recalled, config.timezone) || '（無い）'}
`;
}
