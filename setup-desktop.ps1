$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts/runtime.ps1')
$nodePath = Get-BTNode
Set-BTNodePath $nodePath
Push-Location $PSScriptRoot
try {
    & (Join-Path $PSScriptRoot 'setup.ps1')
    & (Join-Path $PSScriptRoot 'scripts/npm.ps1') --prefix desktop ci --ignore-scripts --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { throw 'Desktop dependency installation failed.' }
    & (Join-Path $PSScriptRoot 'scripts/install-electron.ps1')
    & $nodePath (Join-Path $PSScriptRoot 'scripts/prepare-desktop.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Desktop preparation failed.' }
    $env:NEXT_TELEMETRY_DISABLED='1'
    & (Join-Path $PSScriptRoot 'scripts/npm.ps1') --prefix desktop run build
    if ($LASTEXITCODE -ne 0) { throw 'Desktop production build failed.' }
    & (Join-Path $PSScriptRoot 'scripts/create-shortcut.ps1')
} finally { Pop-Location }
