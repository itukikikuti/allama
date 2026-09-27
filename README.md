# allama

Claude Code に、セッションをまたいで残る記憶と、時間と、人とのやり取りの窓口を与える仕組み。

- **頭は1つ、手は複数**：Claude Code のセッションは手にすぎず、どのセッションも同じ1人。記憶と人格は1つだけ。
- **記憶**：全セッションの記録が残り、`recall` / `read_session` でいつでも読み返せる。記憶フォルダに書いたものは次のセッションに引き継がれる（`README.md` だけは毎回プロンプトに載る）。
- **何も決めない**：最初はモデルの知識があるだけで、自分が誰か・相手が誰か・何をするかは何も知らない。人格や呼び方、記憶の書き方は、教えられたり自分で決めたりして育っていく。
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
                           ├─ 記憶フォルダ（最初は空の README.md だけ。git で自動記録）
                           ├─ 全セッションの記録（sessions/<id>/turn-*.jsonl）
                           └─ 目覚まし（見回り・リマインド・見張り）
```

- 手は1ターンごとに `claude -p --resume <id>` で起動する。サーバーから切り離して動かしているので、サーバーを再起動しても作業は止まらない。
- 毎ターン、頭は「この仕組みの事実」「今の状況（時刻・ほかのセッション・タスク・予定）」「記憶フォルダの README.md」をシステムプロンプトとして手に渡す（[server/head.ts](server/head.ts)）。人格や振る舞いの指示は含めない。
- 手は頭の道具（[server/tool-defs.ts](server/tool-defs.ts)）で、質問・提案・報告・ToDo・新しい手・連絡・思い出す・目覚まし・自分の再起動を使う。

### データの置き場所（dataDir）

```
~/.allama/
├─ mind/                 記憶フォルダ（本人が自由に書く。git で記録）
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
