$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
$nodePath = Get-BTNode
Set-BTNodePath $nodePath
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCommand) { $npmCommand = Get-Command npm -ErrorAction SilentlyContinue }
    if ($npmCommand) {
        & $npmCommand.Source @args
    }
    else {
        $npmCli = Join-Path $projectRoot '.tools/npm/bin/npm-cli.js'
        if (-not (Test-Path -LiteralPath $npmCli)) { throw 'Run setup.ps1 first.' }
        & $nodePath $npmCli @args
    }
    $result = $LASTEXITCODE
} finally { Pop-Location }
exit $result
