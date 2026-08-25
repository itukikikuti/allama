# Architecture

## Packages

- `packages/protocol`: Zodで定義した仕事アイテム、契約、実行タスク、イベント、API入出力。
- `packages/core`: SQLite台帳、Ollama、状態機械、安全ポリシー、ツール、Git worktree。
- `apps/cli`: Commander CLI、Ink TUI、Fastify REST/SSE API。

## Task lifecycle

利用者が直接扱う`work_items`は、担当が`user`または`ai`で、期日・優先度を持ちます。AI依頼は
`open -> in_progress -> waiting -> done`と進み、確認が必要になるたびに同じ実行タスクへリンクした
`user`担当の承認・質問アイテムを作ります。回答済みアイテムは履歴として残ります。

低レベルのAI実行は従来の状態機械で管理します。

```text
contract_proposed -> awaiting_approval -> executing -> verifying -> completed
                              |              |            |
                              |              +-> awaiting_decision
                              +---------------------------> cancelled
                                             +-----------> failed
```

変更タスクでは`awaiting_approval`から`executing`へ移るまでworktreeを作りません。各状態変更と
ツール呼び出しはSQLiteへ先に記録されます。同一ツール呼び出しIDに完了結果があれば再利用し、
開始済みで完了結果がない場合は重複実行せず相談状態へ移ります。

## Ollama flow

契約カードはJSON Schema付きの非ストリーミング応答で作成します。実行は`/api/chat`のNDJSON
ストリームとfunction toolsを使います。thinkingフィールドはプロセス内でもUIや永続層へ渡しません。

モデルへ送るファイルは検索と明示的な`read_file`で絞り込みます。送信直前にメッセージ全体を
秘密情報スキャナーへ通します。

## Tool boundary

ファイル操作はリポジトリ相対パスだけを受け付けます。既存ファイルは一意な文字列置換、新規
ファイルは上書き禁止の作成ツールを使います。PowerShellはworktree内で実行されますが、削除、
リダイレクト、依存変更、ネットワーク、破壊的Git操作をポリシー層で停止します。

## Persistence

`%LOCALAPPDATA%\allama\state.db`に相互タスクリスト、実行タスク、イベント、ツール結果、追加指示、記憶候補を保存します。
設定とAPIトークンは`%LOCALAPPDATA%\allama\config.json`へ保存します。記憶は`pending`から
ユーザー操作でのみ`approved`または`rejected`へ変わります。
