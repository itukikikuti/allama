# allama

**記憶を作る。**

LLM は知能、Claude Code はその知能をループさせて手を動かす仕組み。人間に近づけるためにいちばん足りないものが「記憶」だと考えて、allama はそれを作る。

最初はモデルの知識があるだけで、自分が誰か・相手が誰か・何をするかは何も知らない。体験したことが記憶になり、教えられたことが残り、そこから少しずつ育っていく。

## 記憶の働き

| 働き | 人間なら | allama では |
|---|---|---|
| **覚える** | 体験は勝手に記憶される | ターンが終わるたびに、そのやり取りから「出来事」「知ったこと」「やり方」を取り出して保存する（自動） |
| **思い出す** | きっかけがあると連想で浮かぶ | 新しいメッセージを手がかりに、意味の近い記憶を選んでプロンプトに添える（自動）。わざと思い出したいときは `remember` |
| **整理する** | 眠っている間に整理される | 暇なときに、最近の記憶から傾向や気づきをまとめ、古くなった知識を置き換え、「記憶の核」（自分・相手・今大事なこと）を書き直す |
| **薄れる** | 使わない記憶は薄れ、よく思い出すものは強くなる | 「覚えている度合い」が時間とともに下がり、自然には浮かびにくくなる。重要なもの・よく思い出すものほど下がりにくい。消えはしないので、探せば見つかる |

- 保存先は SQLite の1ファイル（`~/.allama/memory.sqlite`）。全文検索（FTS5）と、意味で探すための埋め込み（Ollama の埋め込みモデル）を持つ。毎日1つ写しを取り、7日分残す。
- 覚える・整理するのに使うモデルと、埋め込みモデルは設定画面で選ぶ。
- 記憶の種類：出来事（episode）・知ったこと（fact）・やり方（procedure）・気づき（reflection）。
- Claude Code 自身の自動メモリ（Markdown のメモ）は使わない。
- 全セッションの記録そのものも `~/.allama/sessions/<ID>/transcript.md` に残る。
- 画面から添えたファイルは `~/.allama/uploads/<日付>/` に置かれ、その絶対パスがそのままセッションへのメッセージに添えられる（セッションは Read で開ける）。1つ32MBまで。置いたファイルは自動では消えない。

## 画面

- **タスク**：頼みごとを書いて新しいセッションを始める。質問・提案・報告・あなたのToDoに返事をする。どの欄にもファイルを添えられる（紙クリップのボタン）。
- **セッション**：セッションの一覧と中身（思考・ツール・差分・サブエージェント）。下の欄から返信できる（ここにもファイルを添えられる）。
- **記憶**：記憶の核、記憶の一覧と検索（覚えている度合い・思い出した回数・もとになった記憶）、処理の記録。今すぐ整理することもできる。
- **設定**（右上の歯車）：Ollama の接続先、セッションのモデル（Ollama / Claude）、記憶に使うモデルと埋め込みモデル。

## しくみ

```
画面 ─頼む/返事/返信─▶ サーバー ─ターンごとに─▶ Claude Code（Agent SDK）
                         │    ▲                   │  ▲
                         │    └── 道具（MCP）───────┘  │ システムプロンプト：
                         │                              │  この仕組みの約束・記憶の核・思い出したこと
                         ▼                              │
                       記憶 ◀──── ターンが終わったら覚える ─┘
                     （SQLite）── 暇なときに整理する
```

- セッションは Claude Agent SDK の `query()` で動かす。1ターンごとに呼び、同じセッションIDで続きを再開する。
- システムプロンプトは、調べても分からないこの仕組みの約束（数行）と、記憶の核、このメッセージをきっかけに思い出したことだけ（[server/head.ts](server/head.ts)）。人格や振る舞いの指示は含めない。
- 道具は、Claude Code の標準にできないことだけ（[server/tools.ts](server/tools.ts)）：人に届ける（`ask_user`・`propose`・`report`・`add_user_todo`）、思い出す（`remember`）、残り続けるセッション（`start_session`・`send_to_session`）、目覚まし、仕組みの再起動（`restart_self`）。
- 記憶の中身は [server/memory/](server/memory/)。

## 入れ方（Ubuntu・sudo 不要）

```bash
git clone https://github.com/itukikikuti/allama.git ~/allama
cd ~/allama
./deploy/install.sh        # Node.js 24・Claude Code・Ollama・埋め込みモデルを入れ、systemd で常駐させる
ollama signin              # Ollama のクラウドモデルを使うなら、初回だけ
```

`http://<マシンのIP>:3170` を開く（外から開くには `config.json` の `host` を `0.0.0.0` に）。モデルなどは画面の設定から変えられる。

- ログ：`journalctl --user -u allama -f`
- ログアウト中も動かす：`sudo loginctl enable-linger "$USER"`（一度だけ）
- Claude（Anthropic）のモデルを使うなら、一度 `claude` を起動してログインしておく
- セッションは許可を求めずに動く。**root では動かさない**。
- 同じネットワークの誰でも開けるので、家の外には出さない。合言葉をかけるなら `config.json` の `authToken`。

## 入れ方（Windows・管理者不要）

[リリース](https://github.com/itukikikuti/allama/releases/latest) から取ってくる。PowerShell は要らない。

- **インストーラ**: `allama-<版>-win-x64-setup.exe` をダブルクリック
- **持ち運びたいとき**: `allama-<版>-win-x64.zip` を書き込める場所に解凍して、`allama.exe` を叩く（インストール不要）

どちらも**初回の起動で、本体の依存（1GBほど）を自分で取ってくる**。窓に「初回の準備をしています…」と出て、5〜10分かかる。2回目からはすぐ開く。

- 画面は `allama.exe` の窓に出る。トレイに常駐し、閉じても裏で動き続ける（終了はトレイの「終了」から）
- **Linux の systemd がやっていたことは、この窓がやる**：落ちたら起こし直す、`restart_self` の受け皿になる、すぐ落ちる失敗が続いたら間隔を空ける
- Node.js はアプリに同梱のものを使う（本体は Node 24 で動く）。Claude Code も本体の依存として、win32 版の `claude.exe` ごと入る
- Git for Windows と Ollama は入っていないと働かない所がある（Git が無いと Bash 道具、Ollama が無いと記憶の埋め込み）。手で入れるなら公式のインストーラ、winget なら `winget install Git.Git Ollama.Ollama` のあと `ollama pull qwen3-embedding:0.6b`
- ログ：`%APPDATA%\allama\allama.log`、記憶：`%USERPROFILE%\.allama`
- 窓は [desktop/](desktop/)。Windows の `.exe` を組むには Windows か wine が要るので、組むのは GitHub Actions の `windows` ワークフロー（`desktop/` で `npm run build`）

### まとめて入れたいとき（PowerShell）

`deploy/install.ps1` は、リリースの zip を `%LOCALAPPDATA%\allama` に置き、Git for Windows と Ollama を winget で入れ、依存も先に入れて、スタートメニューに登録する道具。窓が自分でやれるようになったので、もう必須ではない。

```powershell
git clone https://github.com/itukikikuti/allama.git $env:USERPROFILE\allama
cd $env:USERPROFILE\allama
.\deploy\install.ps1
```

### 自分を改良させるには

セッションは `~/allama` のソースを書き換え、`restart_self` で反映する。型チェック・画面のビルド・読み込みの確認が通ったときだけ、動いているセッションが区切りに来たところで再起動する。人が手で反映するときは `npm run restart`。

## 設定（config.json）

画面から変えられないもの：

| 項目 | 意味 |
| --- | --- |
| `host` / `port` | 画面を開く場所（既定 `127.0.0.1:3170`） |
| `dataDir` | 記憶とデータの置き場所（既定 `~/.allama`） |
| `defaultCwd` | セッションの既定の作業フォルダ |
| `timezone` | 時刻の表示に使う地域 |
| `authToken` | 画面の合言葉（空なら無し） |
| `fallbackPatrolHours` | 目覚ましが1つも無いとき、この時間後に起こす |

## 開発

```bash
npm install
npm run dev       # サーバー（server/ を変更すると再起動）
npm run dev:web   # 画面（http://localhost:5173、API はサーバーへ中継）
npm run check     # 型チェック・画面のビルド・読み込みの確認
```

サーバーは TypeScript をビルドせずに Node（22.18 以上）でそのまま動かしている。

## 以前の allama

このリポジトリには、以前の allama（あなたとAIの仕事を1つのタスクリストに集める Windows 向けの仕事管理 CLI、v0.2.1）の履歴も残っている。
その最後の状態はコミット `3a22da1` で見られる。
