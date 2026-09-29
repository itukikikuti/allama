# allama を Windows に入れる（管理者不要）。何度実行してもよい。
#
#   Node.js はアプリに同梱のものを使う（本体は Node 24 で動く）。
#   Claude Code は本体の依存（@anthropic-ai/claude-agent-sdk）として、win32 版の claude.exe ごと入る。
#   Ollama と Git for Windows は winget で入れる。既にあれば触らない。
#
# 使い方:
#   .\deploy\install.ps1                                    GitHub の最新リリースから
#   .\deploy\install.ps1 -Zip .\allama-0.1.0-win-x64.zip    手元の zip から
#   .\deploy\install.ps1 -SkipGit -SkipOllama -NoStart
#
# 初回は npm ci で 1GB 近く取ってくるので、時間がかかる。

[CmdletBinding()]
param(
  [string]$Zip,
  [string]$Dir = (Join-Path $env:LOCALAPPDATA 'allama'),
  [switch]$SkipGit,
  [switch]$SkipOllama,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
function Say($message) { Write-Host "`n== $message" -ForegroundColor Cyan }
function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# --- Git for Windows（Claude Code の Bash 道具に要る。無いと PowerShell 道具に落ちる） ---
if (-not $SkipGit) {
  Say 'Git for Windows'
  if (Have git) {
    Write-Host "  もう入っている: $(git --version)"
  } elseif (Have winget) {
    winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
    Write-Host '  入れた（この画面には PATH がまだ通らないので、開き直すと効く）'
  } else {
    Write-Host '  winget が無い。手で入れて: https://git-scm.com/downloads/win'
  }
}

# --- Ollama（記憶の埋め込みを手元で動かす） ---
if (-not $SkipOllama) {
  Say 'Ollama'
  $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
  if (-not $ollama) {
    $candidate = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    if (Test-Path $candidate) { $ollama = $candidate }
  }
  if (-not $ollama -and (Have winget)) {
    winget install --id Ollama.Ollama -e --source winget --accept-package-agreements --accept-source-agreements
    $candidate = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    if (Test-Path $candidate) { $ollama = $candidate }
  }
  if ($ollama) {
    Write-Host "  埋め込みモデルを取ってくる（qwen3-embedding:0.6b）"
    & $ollama pull qwen3-embedding:0.6b
    Write-Host '  クラウドのモデルを使うなら、一度だけ: ollama signin'
  } else {
    Write-Host '  Ollama を入れられなかった。手で入れて: https://ollama.com/download/windows'
    Write-Host '  入れたあと、次を実行: ollama pull qwen3-embedding:0.6b'
  }
}

# --- allama 本体 ---
Say 'allama'
if (-not $Zip) {
  Write-Host '  最新のリリースを見ている…'
  $release = Invoke-RestMethod 'https://api.github.com/repos/itukikikuti/allama/releases/latest' -Headers @{ 'User-Agent' = 'allama-install' }
  $asset = $release.assets | Where-Object { $_.name -like '*win-x64.zip' } | Select-Object -First 1
  if (-not $asset) { throw "最新のリリース（$($release.tag_name)）に Windows 版が無い。-Zip で zip を渡して。" }
  $Zip = $asset.browser_download_url
}

if (Get-Process allama -ErrorAction SilentlyContinue) {
  throw 'allama が動いたまま。トレイの「終了」で止めてから、もう一度実行して。'
}

$tmp = Join-Path $env:TEMP ("allama-install-" + [guid]::NewGuid().ToString('n') + '.zip')
if ($Zip -match '^https?://') {
  Write-Host "  取ってくる: $Zip"
  Invoke-WebRequest $Zip -OutFile $tmp
} else {
  Copy-Item $Zip $tmp
}

# 更新のときも、設定と本体の依存は残す
$appDir = Join-Path $Dir 'resources\app'
$keep = Join-Path $env:TEMP ("allama-keep-" + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Force $keep | Out-Null
foreach ($name in 'config.json', 'node_modules') {
  $from = Join-Path $appDir $name
  if (Test-Path $from) { Move-Item $from (Join-Path $keep $name) }
}

if (Test-Path $Dir) { Remove-Item $Dir -Recurse -Force }
Expand-Archive -LiteralPath $tmp -DestinationPath $Dir -Force
Remove-Item $tmp -Force

foreach ($name in 'config.json', 'node_modules') {
  $from = Join-Path $keep $name
  if (Test-Path $from) { Move-Item $from (Join-Path $appDir $name) }
}
Remove-Item $keep -Recurse -Force
Write-Host "  置いた: $Dir"

# --- 本体の依存（同梱の node と npm を使う） ---
Say '本体の依存（npm ci）'
$node = Join-Path $Dir 'resources\node\node.exe'
$npm = Join-Path $Dir 'resources\node\node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path $node)) { throw "同梱の node が無い: $node" }
Push-Location $appDir
try {
  & $node $npm ci --no-audit --no-fund
} finally {
  Pop-Location
}

# --- 設定（無いときだけ見本から作る）。置き場所は記憶と同じ %USERPROFILE%\.allama ---
# 本体のフォルダに古い config.json があれば、本体が起動時にそこへ移すので、ここでは作らない
$config = Join-Path $env:USERPROFILE '.allama\config.json'
$legacyConfig = Join-Path $appDir 'config.json'
if (-not (Test-Path $config) -and -not (Test-Path $legacyConfig)) {
  New-Item -ItemType Directory -Force (Split-Path $config) | Out-Null
  Copy-Item (Join-Path $appDir 'config.example.json') $config
  Write-Host '  設定を作った（既定は 127.0.0.1:3170）'
}

# --- スタートメニュー ---
Say 'ショートカット'
$link = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\allama.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = Join-Path $Dir 'allama.exe'
$shortcut.WorkingDirectory = $Dir
$shortcut.IconLocation = (Join-Path $Dir 'allama.exe')
$shortcut.Description = 'allama'
$shortcut.Save()
Write-Host "  作った: $link"

if (-not $NoStart) {
  Say '起こす'
  Start-Process (Join-Path $Dir 'allama.exe')
}

@"

入れ終わった。
- 窓はトレイに常駐する。閉じても裏で動き続ける（終了はトレイの「終了」から）
- ログ:   %APPDATA%\allama\allama.log
- 記憶:   $env:USERPROFILE\.allama
- クラウドのモデルを使うなら: ollama signin（一度だけ）
- Windows にサインインしたら自動で開くようにする: トレイの右クリックから
"@ | Write-Host
