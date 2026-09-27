# allama

Claude Code という「手」を使いこなす「頭」。PCに住んでいる、1人の相棒。

- **頭は1つ、手は複数**：Claude Code のセッションは手にすぎず、どのセッションも同じ1人。記憶と人格は1つだけ。
- **すべてを覚えている**：全セッションの記録が残り、`recall` / `read_session` でいつでも正確に思い出せる。日々のことは本人が記憶フォルダに日記として整理する。
- **決めすぎない**：名前・性格・話し方・記憶の整理の仕方は、使っているうちに本人が育てていく。
- **自分で動く**：見回り・リマインド・見張りの時刻は本人が決める（予定が1つも無いときだけ、予備の見回りが入る）。
- **自分を改良できる**：自分のソースコードを書き換え、確かめてから再起動し、コミットしてプッシュする。

## 画面

- **タスク**：頼みごとを書いて新しい手を動かす（モデルを選べる）。秘書からの質問・提案・報告・あなたのToDoに返事をする。
- **セッション**：手の一覧と、それぞれの中身（Claude Desktop のように、思考・ツール・差分・サブエージェントを表示）。下の欄からそのセッションに返信できる（作業中なら区切りで届く）。
- **記憶**：記憶フォルダの中身と、その変化の記録（git）を見る。見るだけ。
- **設定**（右上の歯車）：Ollama の接続先、使うモデル（Ollama / Claude）、既定のモデル。接続やモデルが使えるかをその場で確かめられる。保存するとすぐ反映される。

## 入れ方（Ubuntu・sudo 不要）

```bash
git clone https://github.com/itukikikuti/allama.git ~/allama
cd ~/allama
./deploy/install.sh        # Node.js 24・Claude Code・Ollama を ~/.local に入れ、systemd で常駐させる
nano config.json           # 必要なら（モデルなどは画面の設定からも変えられる）
ollama signin              # Ollama のクラウドモデルを使うなら、初回だけ
```

`http://<マシンのIP>:3170` を開く（外から開くには `config.json` の `host` を `0.0.0.0` に）。

- ログ：`journalctl --user -u allama -f`
- ログアウト中も動かす：`sudo loginctl enable-linger "$USER"`（一度だけ）
- Claude（Anthropic）のモデルを使うなら、一度 `claude` を起動してログインしておく
- 手は `--dangerously-skip-permissions` で動く（誰も画面を見ていないときにも動くため）。確認すべきことは本人が判断してタスク画面で聞いてくる。**root では動かさない**。
- 同じネットワークの誰でも開けるので、家の外には出さない。合言葉をかけるなら `authToken` を設定する。外出先からは Tailscale（`tailscale serve --bg 3170`）を使う。

### 自分を改良させるには

秘書は `~/allama` のソースを書き換え、道具 `restart_self` で自分を再起動して反映する。型チェック・画面のビルド・読み込みの確認が通ったときだけ再起動する。人が手で反映するときは `npm run restart`（同じ確認のあと `systemctl --user restart allama`）。
コミットしてプッシュするには、`~/allama` から GitHub に書き込めるようにしておく。

## 設定（config.json）

| 項目 | 意味 |
| --- | --- |
| `host` / `port` | 画面を開く場所（既定 `127.0.0.1:3170`） |
| `dataDir` | 記憶とデータの置き場所（既定 `~/.allama`） |
| `defaultCwd` | 手の既定の作業フォルダ |
| `models` | 選べるモデル（下の例） |
| `defaultModelId` | 目覚ましなど、自動で始まる手が使うモデル |
| `ollamaHost` | Ollama の場所（既定 `http://127.0.0.1:11434`） |
| `authToken` | 画面の合言葉（空なら無し） |
| `fallbackPatrolHours` | 予定が1つも無いときに入れる見回りまでの時間 |

モデルの例：

```json
{ "id": "deepseek", "label": "Ollama: deepseek", "ollama": "deepseek-v4.1-flash:cloud" }
{ "id": "opus", "label": "Claude Opus", "command": ["claude", "--model", "opus"] }
```

- `ollama` を書くと、`ollama launch claude --model <モデル>` と同じ設定（接続先・トークン・既定モデル）で Claude Code を動かす。`ollama ls` に出ないクラウドモデルもそのまま使える
- `command` は Claude Code を起動するコマンドの前半で、後ろに Claude Code の引数が付く（既定 `["claude"]`）

## しくみ

```
画面 ──頼む/返事/返信──▶ サーバー（頭） ──1ターンごとに起動──▶ Claude Code（手）
  ▲                        │  ▲                                   │
  └──質問・提案・報告─────────┘  └───── 頭の道具（MCP：ask_user など）──┘
                           │
                           ├─ 記憶フォルダ（self.md / user.md / journal/ …。git で自動記録）
                           ├─ 全セッションの記録（sessions/<id>/turn-*.jsonl）
                           └─ 目覚まし（見回り・リマインド・見張り）
```

- 手は1ターンごとに `claude -p --resume <id>` で起動する。サーバーから切り離して動かしているので、サーバーを再起動しても作業は止まらない。
- 毎ターン、頭は「自分は何者か」「記憶（self.md・user.md・最近の日記）」「いま動いているほかの手」「タスク画面の状況」「予定」をシステムプロンプトとして手に渡す（[server/head.ts](server/head.ts)）。
- 手は頭の道具（[server/tool-defs.ts](server/tool-defs.ts)）で、質問・提案・報告・ToDo・新しい手・連絡・思い出す・目覚まし・自分の再起動を使う。
- 記憶の整理は本人の仕事。見回りのときに、まだ整理していない手の記録を読み返して日記に書き、整理済みにする。

### データの置き場所（dataDir）

```
~/.allama/
├─ mind/                 記憶フォルダ（本人が自由に整理。git で記録）
├─ sessions/<id>/        手の記録（ターンごとの入力・出力・渡したシステムプロンプト）
└─ state/                セッション・タスク・目覚ましの一覧
```

記憶とデータはソースコードの外にあり、リポジトリには入らない。

## 以前の allama

このリポジトリには、以前の allama（あなたとAIの仕事を1つのタスクリストに集める Windows 向けの仕事管理 CLI、v0.2.1）の履歴も残っている。
その最後の状態はコミット `3a22da1` で見られる。

## 開発

```bash
npm install
npm run dev       # サーバー（server/ を変更すると再起動）
npm run dev:web   # 画面（http://localhost:5173、API はサーバーへ中継）
npm run typecheck
```

サーバーは TypeScript をビルドせずに Node（22.18 以上）でそのまま動かしている（型注釈を取り除くだけの機能を使うため、`enum` などは使えない）。
