$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
  Write-Warning 'PowerShell 7 is recommended; continuing with Windows PowerShell.'
}

corepack prepare pnpm@10.34.5 --activate
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm --filter '@allama/cli' link --global

Write-Host 'Allama installed. Run: allama doctor'

