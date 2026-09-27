// 記憶。4つの働きを持つ。
//   覚える   … ターンが終わるたび、その体験から記憶を取り出して保存する（自動）
//   思い出す … メッセージを手がかりに関係する記憶を選んで渡す（自動）。remember でわざと探すこともできる
//   整理する … 時々、最近の記憶を知識・やり方・気づきにまとめ、古い知識を置き換え、「記憶の核」を書き直す（睡眠）
//   薄れる   … 思い出されない記憶は「覚えている度合い」が下がり、自然には浮かびにくくなる（消えはしない）

import fs from 'node:fs';
import path from 'node:path';
import type { MemoryItem, MemoryKind, MemoryStatus, TurnData } from '../../shared/types.ts';
import type { App } from '../app.ts';
import { turnsToText } from '../transcript.ts';
import { localDate, truncate } from '../util.ts';
import { z } from 'zod';
import { MemoryDb, normalize } from './db.ts';
import { chatJson, embed } from './ollama.ts';

const DAY = 86400_000;
const KIND_LABEL: Record<MemoryKind, string> = { episode: '出来事', fact: '知ったこと', procedure: 'やり方', reflection: '気づき' };

/** 覚えている度合い（0〜1）。時間とともに下がり、重要なもの・よく思い出すものほど下がりにくい */
export function retention(m: MemoryItem, now = Date.now()): number {
  const last = Date.parse(m.lastRecalledAt ?? m.happenedAt ?? m.createdAt);
  const days = Math.max(0, (now - last) / DAY);
  const stability = 3 * (1 + m.recallCount) * (0.5 + m.importance);
  return Math.exp(-days / stability);
}

const ENCODE_SYSTEM = `あなたは、ある存在の記憶を作る働きをする。その存在（記憶の持ち主）を「私」と呼ぶ。あなた自身（記憶を作る働き）のことは記憶に書かない。
渡されるのは、「私」が体験したひとまとまりのやり取りの記録。そこから、あとで思い出す価値のあることを記憶として取り出す。

種類:
- episode（出来事）: 何があったか。いつ・誰と・何を・どうなったか。1つの記録につき1〜2件。
- fact（知ったこと）: 私・相手・世界について分かった、あとで役立つ事実。
- procedure（やり方）: 教わった、または身につけた手順や方法。

書き方:
- 「私」の視点で、それだけ読んで意味が分かるように具体的に書く（「さっきの」「それ」は使わない）。
- 記録と同じ言語で書く。
- 性別・年齢など、記録に書かれていないことは推測しない（代名詞ではなく名前で書く）。
- 下の「すでに覚えていること」と同じ内容は書かない。
- importance（0〜1）: 相手が覚えておいてと言ったこと、相手や私自身のこと、約束や決まりごとは高く。一時的な作業の細部は低く。
- 覚える価値のあることが無ければ、memories は空でよい。`;

const EncodeSchema = z.object({
  memories: z.array(
    z.object({
      kind: z.enum(['episode', 'fact', 'procedure']),
      content: z.string(),
      importance: z.number().min(0).max(1),
    }),
  ),
});

const CONSOLIDATE_SYSTEM = `あなたは、ある存在の記憶を、その存在が眠っている間に整理する働きをする。その存在（記憶の持ち主）を「私」と呼ぶ。あなた自身（整理する働き）のことは、記憶にも核にも書かない。
渡されるのは、最近の記憶（まだ整理していないもの）、関係のありそうな既存の知識、今の「記憶の核」。

やること:
1. 最近の記憶のうち fact と procedure は、すでに知識として保存されている。まとめ直すのは、複数の記憶から新しく言えること（繰り返し出てくること、傾向、出来事から得た気づき）だけ。fact（知ったこと）・procedure（やり方）・reflection（気づき）として書く。すでにある知識と同じことは書かない。
2. 最近の記憶が既存の知識を更新・否定しているなら、新しい知識を作り、古い知識の id を supersedes に入れる。
3. sources には、そのまとめのもとになった記憶の id を入れる。
4. core（記憶の核）を書き直す。私について・私が関わっている人について・今大事なことを、2000字以内で。記憶に書かれていないこと（日付・回数・性別など）を推測で足さない（人は代名詞ではなく名前で書く）。分からないことは分からないままでよい。前の核のうち今も正しいことは残す。

記憶と同じ言語で書く。`;

const ConsolidateSchema = z.object({
  memories: z.array(
    z.object({
      kind: z.enum(['fact', 'procedure', 'reflection']),
      content: z.string(),
      importance: z.number().min(0).max(1),
      supersedes: z.array(z.string()).optional(),
      sources: z.array(z.string()).optional(),
    }),
  ),
  core: z.string(),
});

/** 日付は出来事にだけ付ける（知識に「覚えた日」を付けると、出来事の日付と取り違えるため） */
const when = (m: MemoryItem, tz: string) => (m.happenedAt ? `（${localDate(new Date(m.happenedAt), tz)}）` : '');
const line = (m: MemoryItem, tz: string) => `- [${m.id}] ${KIND_LABEL[m.kind]}${when(m, tz)}: ${m.content}`;

export class Memory {
  app: App;
  db: MemoryDb;
  /** 今やっている処理（画面に出す） */
  busy: string | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(app: App) {
    this.app = app;
    this.db = new MemoryDb(app.config.dataDir);
  }

  private get host() {
    return this.app.config.ollamaHost;
  }

  private get cfg() {
    return this.app.config.memory;
  }

  /** 順番に1つずつ処理する（同時に走らせない） */
  private enqueue(label: string, job: () => Promise<void>): Promise<void> {
    const run = async () => {
      this.busy = label;
      this.app.touch();
      try {
        await job();
      } catch (e) {
        this.db.log('error', `${label}に失敗: ${(e as Error).message}`);
        console.warn(`[memory] ${label}に失敗`, e);
      } finally {
        this.busy = null;
        this.app.touch();
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p;
    return p;
  }

  private async embedTexts(texts: string[]): Promise<Float32Array[]> {
    return (await embed(this.host, this.cfg.embedModel, texts)).map(normalize);
  }

  // ---- 思い出す ----

  /** 自動で思い出す：意味の近さを中心に、覚えている度合いと重要さで選ぶ。置き換え済みは出さない */
  async recallFor(text: string, limit = 8): Promise<MemoryItem[]> {
    if (!text.trim() || !Object.keys(this.db.counts()).length) return [];
    let q: Float32Array;
    try {
      [q] = await this.embedTexts([truncate(text, 2000)]);
    } catch (e) {
      this.db.log('error', `思い出すのに失敗: ${(e as Error).message}`);
      return [];
    }
    const now = Date.now();
    const picked = this.db
      .nearest(q, 60)
      .filter((h) => h.sim >= 0.35)
      .map((h) => ({ m: this.db.get(h.id)!, sim: h.sim }))
      .filter(({ m }) => m && !m.supersededBy)
      .map(({ m, sim }) => {
        const r = retention(m, now);
        return { ...m, retention: r, score: 0.6 * sim + 0.2 * r + 0.2 * m.importance };
      })
      .sort((a, b) => b.score! - a.score!)
      .slice(0, limit);
    this.db.touch(picked.map((m) => m.id));
    return picked;
  }

  /** わざと思い出す：意味と言葉の両方で探す。薄れた記憶も、置き換えられた古い記憶も見つかる */
  async search(query: string, opts: { limit?: number; kind?: string; touch?: boolean } = {}): Promise<MemoryItem[]> {
    const limit = opts.limit ?? 20;
    const scores = new Map<string, number>();
    try {
      const [q] = await this.embedTexts([query]);
      for (const h of this.db.nearest(q, limit * 4)) scores.set(h.id, 0.75 * h.sim);
    } catch {
      // 埋め込みが使えなくても、言葉では探せる
    }
    for (const id of this.db.keyword(query, limit * 2)) scores.set(id, (scores.get(id) ?? 0) + 0.25);
    const now = Date.now();
    const items = this.db
      .getMany([...scores.keys()])
      .filter((m) => !opts.kind || m.kind === opts.kind)
      .map((m) => ({ ...m, retention: retention(m, now), score: scores.get(m.id)! + 0.05 * m.importance }))
      .sort((a, b) => b.score! - a.score!)
      .slice(0, limit);
    if (opts.touch) this.db.touch(items.map((m) => m.id));
    return items;
  }

  /** ほとんど同じ内容の、同じ種類の記憶（置き換え済みは除く） */
  private findDuplicate(v: Float32Array, kind: MemoryKind): string | undefined {
    return this.db.nearest(v, 5).find((h) => {
      const m = h.sim >= 0.92 ? this.db.get(h.id) : undefined;
      return m && m.kind === kind && !m.supersededBy;
    })?.id;
  }

  // ---- 覚える ----

  encodeTurn(sessionId: string, turn: TurnData): Promise<void> {
    return this.enqueue('覚える', async () => {
      const record = truncate(turnsToText([turn], { resultChars: 800 }), 16000);
      if (!record.trim()) return;
      const [rv] = await this.embedTexts([truncate(record, 4000)]);
      const known = this.db
        .nearest(rv, 15)
        .map((h) => this.db.get(h.id)!)
        .filter((m) => m && !m.supersededBy);
      const core = this.db.core()?.content ?? '（まだ無い）';
      const user = `# 記憶の核\n${core}\n\n# すでに覚えていること\n${known.map((m) => line(m, this.app.config.timezone)).join('\n') || 'なし'}\n\n# やり取りの記録（${turn.input.at}）\n${record}`;
      const out = await chatJson(this.host, this.cfg.model, ENCODE_SYSTEM, user, EncodeSchema);
      const items = (out.memories ?? []).filter((m) => m.content?.trim());
      if (!items.length) return;
      const vecs = await this.embedTexts(items.map((m) => m.content));
      let added = 0;
      items.forEach((m, i) => {
        // ほとんど同じ記憶があれば、新しく作らずにそれを強める
        const dup = this.findDuplicate(vecs[i], m.kind);
        if (dup) return this.db.touch([dup], m.importance);
        this.db.add({
          kind: m.kind,
          content: m.content.trim(),
          importance: Number(m.importance) || 0.5,
          happenedAt: m.kind === 'episode' ? turn.input.at : undefined,
          sourceSession: sessionId,
          embedding: vecs[i],
        });
        added++;
      });
      this.db.log('encode', `${added}件を覚えた（候補${items.length}件）`);
    });
  }

  // ---- 整理する（睡眠） ----

  consolidate(): Promise<void> {
    return this.enqueue('整理する', async () => {
      for (let round = 0; round < 10; round++) {
        const recent = this.db.unconsolidated(60);
        if (!recent.length) break;
        const recentIds = new Set(recent.map((m) => m.id));
        const related = new Map<string, MemoryItem>();
        const vecs = await this.embedTexts(recent.map((m) => m.content));
        for (const v of vecs) {
          for (const h of this.db.nearest(v, 6)) {
            const m = this.db.get(h.id);
            if (m && !recentIds.has(m.id) && !m.supersededBy && m.kind !== 'episode') related.set(m.id, m);
            if (related.size >= 40) break;
          }
        }
        const core = this.db.core()?.content ?? '（まだ無い）';
        const user = `# 今の記憶の核\n${core}\n\n# 関係のありそうな既存の知識\n${[...related.values()].map((m) => line(m, this.app.config.timezone)).join('\n') || 'なし'}\n\n# 最近の記憶\n${recent.map((m) => line(m, this.app.config.timezone)).join('\n')}`;
        const out = await chatJson(this.host, this.cfg.model, CONSOLIDATE_SYSTEM, user, ConsolidateSchema);
        const known = new Set([...recentIds, ...related.keys()]);
        const items = (out.memories ?? []).filter((m) => m.content?.trim());
        const nv = await this.embedTexts(items.map((m) => m.content));
        let made = 0;
        items.forEach((m, i) => {
          const dup = this.findDuplicate(nv[i], m.kind);
          if (dup) return this.db.touch([dup], m.importance);
          made++;
          const added = this.db.add({
            kind: m.kind,
            content: m.content.trim(),
            importance: Number(m.importance) || 0.5,
            sources: (m.sources ?? []).filter((id) => known.has(id)),
            embedding: nv[i],
            consolidated: true,
          });
          this.db.supersede((m.supersedes ?? []).filter((id) => known.has(id)), added.id);
        });
        this.db.markConsolidated([...recentIds]);
        if (out.core?.trim() && out.core.trim() !== core) this.db.setCore(out.core.trim());
        this.db.log('consolidate', `${recent.length}件を整理し、${made}件の知識や気づきを加えた`);
      }
      this.db.setMeta('lastConsolidatedAt', new Date().toISOString());
      this.backup();
    });
  }

  /** 暇なとき、溜まっていたら整理する（目覚ましの見回りから呼ばれる） */
  maybeConsolidate(): void {
    if (this.busy || this.app.store.sessions.some((s) => s.status === 'running')) return;
    const n = this.db.countUnconsolidated();
    if (!n) return;
    const last = Date.parse(this.db.getMeta('lastConsolidatedAt') ?? '1970-01-01');
    const since = Date.now() - last;
    if ((n >= 10 && since > 20 * 60_000) || since > 6 * 3600_000) void this.consolidate();
  }

  /** 1日1つ写しを取り、7日分残す */
  private backup(): void {
    const dir = path.join(this.app.config.dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    this.db.backupTo(path.join(dir, `memory-${localDate(new Date(), this.app.config.timezone)}.sqlite`));
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('memory-')).sort();
    for (const f of files.slice(0, -7)) fs.rmSync(path.join(dir, f));
  }

  status(): MemoryStatus {
    return {
      counts: this.db.counts(),
      unconsolidated: this.db.countUnconsolidated(),
      lastConsolidatedAt: this.db.getMeta('lastConsolidatedAt'),
      core: this.db.core(),
      busy: this.busy,
    };
  }

  /** プロンプトに添えるための形 */
  static format(items: MemoryItem[], tz: string): string {
    return items.map((m) => `- ${KIND_LABEL[m.kind]}${when(m, tz)}: ${m.content}`).join('\n');
  }
}
