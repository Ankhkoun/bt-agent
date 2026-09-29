$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts/runtime.ps1')
$nodePath = Get-BTNode
Set-BTNodePath $nodePath
& $nodePath (Join-Path $PSScriptRoot 'scripts/start.mjs') @args
exit $LASTEXITCODE
