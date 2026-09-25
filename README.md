# atama

Claude Code という「手」を使いこなす「頭」。PCに住んでいる、1人の相棒。

- **頭は1つ、手は複数**：Claude Code のセッションは手にすぎず、どのセッションも同じ1人。記憶と人格は1つだけ。
- **すべてを覚えている**：全セッションの記録が残り、`recall` / `read_session` でいつでも正確に思い出せる。日々のことは本人が記憶フォルダに日記として整理する。
- **決めすぎない**：名前・性格・話し方・記憶の整理の仕方は、使っているうちに本人が育てていく。
- **自分で動く**：見回り・リマインド・見張りの時刻は本人が決める（予定が1つも無いときだけ、予備の見回りが入る）。
- **やり取りはタスク画面で**：質問・提案・報告・あなたのToDoがタスク画面に届き、返事をするとそのセッションに届く。

## 画面

- **タスク画面**：頼みごとを書いて新しい手を動かす（モデルを選べる）。質問・提案・報告・ToDoに返事をする。
- **セッション画面**：手の一覧と、それぞれの中身（Claude Desktop のように、思考・ツール・差分・サブエージェントを表示）。見るだけ。暴走したときのために「止める」ボタンだけある。

## 動かし方（Docker）

atama と、atama からだけ使う Ollama の2つのコンテナで動く。

```bash
docker compose up -d --build
docker exec -it atama-ollama ollama signin   # 初回だけ。表示されたURLをブラウザで開いて許可する
```

`http://<マシンのIP>:3170` を開く。設定は [docker/config.json](docker/config.json)（書き換えたら `docker compose restart atama`）。

- 記憶・セッションの記録・Claude Code の会話・作業フォルダ・Ollama のログインは、それぞれ Docker のボリュームに残る（`docker compose down` では消えない。`down -v` で消える）
- Claude（Anthropic）のモデルを使うなら、一度 `docker exec -it atama claude` でログインしておく
- コンテナの中のソースコードは作り直すと元に戻るので、秘書が自分を改良しても残らない
- ポート3170は同じネットワークの誰からでも開ける。家の外に出さないこと。合言葉をかけるなら `authToken` を設定する

## 動かし方（Docker を使わない場合）

必要なもの：Node.js 22.18 以上（24 推奨）、git、Claude Code、（使うなら）Ollama

```bash
git clone <このリポジトリ> ~/atama   # またはフォルダごとコピー
cd ~/atama
npm install
npm run build
cp config.example.json config.json   # 中身を自分用に書き換える
npm start
```

`http://127.0.0.1:3170` を開く。

### 注意

- 手は `--dangerously-skip-permissions` で動く（誰も画面を見ていないときにも動くため）。確認すべきことは、本人が判断してタスク画面で聞いてくる。**root では動かさず、普通のユーザーで動かす**こと。
- Claude を使うモデルは、そのユーザーで `claude` にログインしておく。
- Ollama のクラウドモデルを使うなら `ollama signin` しておく。

### 常駐させる（systemd）

```bash
mkdir -p ~/.config/systemd/user
cp deploy/atama.service ~/.config/systemd/user/   # node のパスなどを書き換える
systemctl --user daemon-reload
systemctl --user enable --now atama
sudo loginctl enable-linger "$USER"               # ログアウト中も動かす
journalctl --user -u atama -f                     # ログを見る
```

### スマホから使う（外出先も）

Tailscale を入れて、自分の端末だけがつながる形で公開する。

```bash
sudo tailscale serve --bg 3170
```

スマホの Tailscale をオンにして、表示された `https://<マシン名>.<tailnet>.ts.net` を開く。ホーム画面に追加するとアプリのように使える。
さらに合言葉をかけたいときは `config.json` の `authToken` を設定する。

## 設定（config.json）

| 項目 | 意味 |
| --- | --- |
| `ownerName` | 秘書があなたを呼ぶ名前 |
| `dataDir` | 記憶とデータの置き場所（既定 `~/.atama`） |
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
- `command` は Claude Code を起動するコマンドの前半で、後ろに Claude Code の引数が付く（既定 `["claude"]`）。`["ollama", "launch", "claude", "--model", "…", "--yes", "--"]` のようにも書ける

## しくみ

```
タスク画面 ──頼む/返事──▶ サーバー（頭） ──1ターンごとに起動──▶ Claude Code（手）
     ▲                      │  ▲                                  │
     └──質問・提案・報告───────┘  └──── 頭の道具（MCP：ask_user など）──┘
                            │
                            ├─ 記憶フォルダ（self.md / user.md / journal/ …。git で自動バックアップ）
                            ├─ 全セッションの記録（sessions/<id>/turn-*.jsonl）
                            └─ 目覚まし（見回り・リマインド・見張り）
```

- 手は1ターンごとに `claude -p --resume <id>` で起動する。サーバーから切り離して動かしているので、サーバーを再起動しても作業は止まらない。
- 毎ターン、頭は「自分は何者か」「記憶（self.md・user.md・最近の日記）」「いま動いているほかの手」「タスク画面の状況」「予定」をシステムプロンプトとして手に渡す（`server/head.ts`）。
- 手は頭の道具（`server/tool-defs.ts`）で、質問・提案・報告・ToDo・新しい手・連絡・思い出す・目覚ましを使う。
- 記憶の整理は本人の仕事。見回りのときに、まだ整理していない手の記録を読み返して日記に書き、整理済みにする。

### データの置き場所（dataDir）

```
~/.atama/
├─ mind/                 記憶フォルダ（本人が自由に整理。git 管理）
├─ sessions/<id>/        手の記録（ターンごとの入力・出力・渡したシステムプロンプト）
└─ state/                セッション・タスク・目覚ましの一覧
```

## 開発

```bash
npm run dev       # サーバー（server/ を変更すると再起動）
npm run dev:web   # 画面（http://localhost:5173、API はサーバーへ中継）
npm run typecheck
```

サーバーは TypeScript をビルドせずに Node でそのまま動かしている（型注釈を取り除くだけの機能を使うため、`enum` などは使えない）。
秘書本人もこのソースコードの場所を知っていて、不便があれば自分で改良できる。
