$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
  Write-Warning 'PowerShell 7 is recommended; continuing with Windows PowerShell.'
}

corepack prepare pnpm@10.34.5 --activate
corepack pnpm install --frozen-lockfile
corepack pnpm build
Push-Location apps/cli
try {
  npm link
} finally {
  Pop-Location
}
$powerShellShim = Join-Path $env:APPDATA 'npm\allama.ps1'
if (Test-Path -LiteralPath $powerShellShim) {
  Remove-Item -LiteralPath $powerShellShim
}

Write-Host 'Allama installed. Run: allama doctor'
