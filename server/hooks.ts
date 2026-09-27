// ターンを終える前に、一度だけ立ち止まって問いかける。
// 「相手に届けるべきことを、道具でも届けたか」を確かめさせるため。
//
// ここでは判定をしない。文に「？」があるかや語尾のパターンで機械的に判定すると意味を取り違える
// （修辞的な疑問を質問と誤認する／「?」の無い質問を落とす）。判定はセッション自身がやる。
// この仕組みが保証するのは「必ず一度は立ち止まる」ことだけで、それによって
// 「届け忘れたままターンを終える」という失敗モードを消す。
//
// 止めるのは1ターンに1回だけ。stop_hook_active が真なら、既に一度止めたあとの続きなので通す。

import type { HookCallbackMatcher, HookEvent, StopHookInput } from '@anthropic-ai/claude-agent-sdk';

/** ターンを終えようとしたセッションに一度だけ渡す問いかけ */
export const STOP_NUDGE =
  'このターンで相手に届けるべき質問・確認・提案・報告・頼みごとがあるなら、' +
  'ask_user・propose・report・add_user_todo で届けたか確かめて。' +
  'まだなら届けてから終えて。もう届けたか、届けることが無いなら、そのまま終えてよい。';

/** Stop hook。ターンの終わりに一度だけ止めて、届け忘れが無いか確かめさせる */
export function stopNudge(sessionId: string): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    Stop: [
      {
        hooks: [
          async (input) => {
            const i = input as StopHookInput;
            // 既に一度止めたあとの続き。ここでまた止めるとターンが終われなくなる
            if (i.stop_hook_active) return { continue: true };
            console.log(`[allama] ターンの終わりに確認を挟んだ（session=${sessionId}）`);
            return { decision: 'block', reason: STOP_NUDGE };
          },
        ],
      },
    ],
  };
}
