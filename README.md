# Allama

Allama（アラマ）は、Ollamaで動くWindows向けの「報連相できる開発秘書」です。変更前に
作業契約を提示し、承認された範囲だけを専用Git worktreeで変更します。作業中は節目と60秒
ごとに報告し、範囲外・機密情報・破壊的操作を検出すると停止して相談します。

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
Set-ExecutionPolicy -Scope Process Bypass
./scripts/install.ps1
allama doctor
```

グローバルリンクを作らず開発版を実行する場合は次のコマンドを使います。

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm allama -- --help
```

## 基本操作

```powershell
# 対話モード
allama

# 新しい依頼。契約カードを確認してから実行
allama run -C C:\src\my-project "失敗しているテストを直して"

# 保存されたタスクを確認・再開
allama tasks
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

## v0.1の制限

- WindowsとPowerShellを優先しています。
- CLIを終了すると実行も停止します。SQLite台帳から`allama resume`で再開できます。
- メール、カレンダー、SaaS連携、複数ユーザー、常駐Windowsサービスは対象外です。
- Node.jsの`node:sqlite`を使用しているため、Nodeの実行時にExperimentalWarningが表示される場合があります。
