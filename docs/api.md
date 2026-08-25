# Local API

既定URLは`http://127.0.0.1:43117`です。Bearerトークンは
`allama config show --reveal-token`で確認します。

## Endpoints

| Method | Path                     | Purpose                                       |
| ------ | ------------------------ | --------------------------------------------- |
| `GET`  | `/health`                | APIプロセスの確認                             |
| `GET`  | `/v1/tasks`              | タスク一覧                                    |
| `POST` | `/v1/tasks`              | 契約作成。本文は`prompt`と`repositoryPath`    |
| `GET`  | `/v1/tasks/:id`          | タスクとイベント取得                          |
| `POST` | `/v1/tasks/:id/messages` | 追加指示。本文は`message`                     |
| `POST` | `/v1/tasks/:id/decision` | 承認・却下。本文は`approved`と任意の`message` |
| `POST` | `/v1/tasks/:id/cancel`   | 実行キャンセル                                |
| `GET`  | `/v1/tasks/:id/events`   | SSEイベント。`after`でイベントIDを指定可能    |

```powershell
$headers = @{ Authorization = 'Bearer YOUR_TOKEN' }
$body = @{
  prompt = 'READMEの誤字を直して'
  repositoryPath = 'C:\src\project'
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:43117/v1/tasks `
  -Headers $headers -ContentType application/json -Body $body
```

タスク作成だけでは変更を開始しません。返された契約を確認し、`decision`へ
`{"approved":true}`を送ると実行を開始します。
