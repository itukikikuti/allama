# desktop（Windows の窓）

allama を Windows の .exe として使うための殻。中身は本体（リポジトリの `server/`）そのままで、この窓が Linux の systemd の代わりをする。

```
allama.exe                      … Electron の窓。トレイに常駐する
  resources/app                 … 本体（server/ shared/ web/ package.json）。node_modules は初回の npm ci で入る
  resources/node/node.exe       … 本体を動かす Node 24（win-x64）
    └ 本体が SDK で起こす claude.exe（win32-x64、依存として入る）
```

## 何を引き受けるか

| Linux（systemd） | Windows（この窓） |
| --- | --- |
| `Restart=always` | 本体が終わったら起こし直す（`server-process.js`） |
| `StartLimitBurst` | すぐ落ちる失敗が続いたら、1秒→2秒→4秒…最大30秒あける |
| `restart_self` の `process.exit(0)` | 終わったのを見て起こし直す。だから本体側の変更は要らない |
| `journalctl --user -u allama` | `%APPDATA%\allama\allama.log` |

- 窓を閉じても裏で動き続ける（終了はトレイの「終了」から）。トレイから `Windows にサインインしたら開く` を切り替えられる
- 本体は asar の外（`resources/app`）に置く。秘書が自分の体を書き換えて `restart_self` できるようにするため

## 組む

Windows の .exe は Linux では作れない（wine が要る）。GitHub Actions の `windows` ワークフローが `windows-latest` で組む。手元（Windows）で組むなら:

```powershell
cd desktop
npm ci
npm run build      # = アイコン生成 → 同梱する Node 取得 → electron-builder --win
```

出来るもの: `../dist-desktop/allama-<版>-win-x64-setup.exe` と `...-win-x64.zip`。

## まだ確かめていないこと

- Windows 実機での窓・トレイの動き
- Git for Windows（Bash 道具）との噛み合わせ。無いと Claude Code は PowerShell 道具に落ちる
- Ollama（Windows 版）との噛み合わせ
- .exe の実ビルド（CI を回して初めて分かる）

Linux で確かめたこと: 見張りの道（起こす・起こし直す・落ちても起こし直す・止めたら起きてこない）と、組んだ `resources/app` の木がそのまま本体として起動して画面（`/`）と `/api/state` を返すこと。
