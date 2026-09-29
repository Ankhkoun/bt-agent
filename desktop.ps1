param([switch]$Dev)
$ErrorActionPreference = 'Stop'
$desktopRoot = Join-Path $PSScriptRoot 'desktop'
$electron = Join-Path $desktopRoot 'node_modules/electron/dist/electron.exe'
if (-not (Test-Path -LiteralPath $electron)) { throw 'Run setup-desktop.ps1 first.' }
if (-not $Dev -and -not (Test-Path -LiteralPath (Join-Path $desktopRoot '.next/BUILD_ID'))) { throw 'Desktop build is missing. Run setup-desktop.ps1 first.' }
$env:BT_ROOT = $PSScriptRoot
$env:PI_CODING_AGENT_DIR = Join-Path $PSScriptRoot '.bt/agent'
$env:BT_DESKTOP_DEV = if ($Dev) { '1' } else { '0' }
Start-Process -FilePath $electron -ArgumentList ('"' + $desktopRoot + '"') -WorkingDirectory $PSScriptRoot
