# Allama

Allama（アラマ）は、あなたとAIの仕事を1つのタスクリストに集めるWindows向けの仕事管理CLIです。
あなたはAIのリストへ依頼を追加し、AIは確認・承認・判断が必要になったらあなたのリストへ仕事を
返します。期日順に自分のリストを処理すれば、AI側の作業が再開します。

v0.2は仕組みを理解できる最小版です。タスク管理自体は開発以外の仕事も登録できますが、AIが実際に
手を動かせるのは、現時点では既存の安全な開発・ファイル操作エンジンだけです。メール、カレンダー、
各種SaaSへの接続はまだ行いません。

## 必要環境

- Windows 11
- Node.js 24以降
- Gitとripgrep（`rg`）
- Ollama 0.30系
- Ollama Cloudを使う場合は`ollama signin`

既定モデルは、契約作成に`kimi-k3:cloud`、実装に`kimi-k2.7-code:cloud`です。モデル名は
設定から変更できます。

## インストール

```powershell
git clone https://github.com/itukikikuti/allama.git
cd allama
.\scripts\install.cmd
allama doctor
```

グローバルリンクを作らず開発版を実行する場合は次のコマンドを使います。

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm allama -- --help
```

## 最小ワークフロー

```powershell
# あなたとAIの未完了タスクを1画面で確認
allama

# AIへ依頼。AIはすぐに依頼を整理し、必要な承認をあなたのリストへ追加
allama add "失敗しているテストを直して" -C C:\src\my-project --due 明日 --priority high

# あなたが回答すべき項目だけを表示
allama inbox

# 契約や質問の詳細を確認
allama show <work-item-id>

# 承認または却下。承認後はAI作業が再開
allama answer <work-item-id> --yes
allama answer <work-item-id> "公開APIは変更しないで" --yes
allama answer <work-item-id> --no

# 全履歴を含む統合タスクリスト
allama tasks

# Ollamaが停止中でも先に依頼だけ記録
allama add "あとで調査する" --due 2026-09-01 --no-plan
allama work
```

優先度は`urgent`、`high`、`normal`、`low`です。期日は`YYYY-MM-DD`、`今日`、`明日`で
指定できます。あなた向けの確認項目は、元のAIタスクと同じ期日・優先度を引き継ぎます。

## 開発エージェントの直接操作

タスクリストを介さず、従来どおりその場で開発タスクを実行することもできます。

```powershell
allama run -C C:\src\my-project "失敗しているテストを直して"

# 保存されたタスクを確認・再開
allama tasks --runs
allama resume <task-id>

# 完了済みworktreeのコミットを、明示確認後に元ブランチへ取り込む
allama integrate <task-id>

# 承認制の長期記憶
allama memory list --status pending
allama memory approve <memory-id>

# 設定とOllama診断
allama config show
allama doctor
```

`--yes`は表示済み契約や相談への明示承認を非対話で与えます。push、merge、依存追加、
削除操作は`--yes`でもエージェントツールから自動実行されません。

設定・状態の保存先を分離したいテスト環境では、`ALLAMA_HOME`環境変数を指定できます。

## 安全モデル

- 変更タスクでは、契約承認まで対象リポジトリに書き込みません。
- `allama/<task-id>-<slug>`ブランチと`%LOCALAPPDATA%\allama\worktrees`内の専用worktreeを使います。
- 契約の許可パス外、絶対パス、親ディレクトリへの書き込みを拒否します。
- `.env`、秘密鍵、トークンらしき値をCloud送信前に検出し、判断を求めます。
- `git diff --check`と契約内の検証コマンドが成功した変更だけをコミットします。
- push、merge、rebase、reset、削除、外部通信、依存変更は自動ツールから拒否します。
- 生のthinkingは保存・表示せず、イベントから作った短い報告だけを表示します。

## ローカルAPI

```powershell
allama serve --port 43117
allama config show --reveal-token
```

APIは`127.0.0.1`だけで待ち受け、全リクエストに`Authorization: Bearer <token>`が必要です。
タスク作成、取得、追加指示、承認・却下、キャンセル、SSEイベント購読を提供します。
詳細は[APIドキュメント](docs/api.md)を参照してください。

## 開発

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
```

構成は[アーキテクチャ](docs/architecture.md)、受け入れ基準は[評価方法](docs/evaluation.md)にまとめています。

## v0.2の制限

- WindowsとPowerShellを優先しています。
- `add`による依頼整理と`answer`後のAI実行は、そのCLIプロセス内で行います。常駐ワーカーはまだありません。
- メール、カレンダー、SaaS連携は未実装です。それらの仕事を一覧へ記録することはできます。
- AIの自動実行はコード調査・編集・テスト・Git・開発文書に限定しています。
- 複数端末同期、通知、GUI、複数ユーザーはまだありません。
