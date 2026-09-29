$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts/runtime.ps1')
$nodePath = Get-BTNode
Set-BTNodePath $nodePath
Push-Location $PSScriptRoot
try {
    $npmCli = Join-Path $PSScriptRoot '.tools/npm/bin/npm-cli.js'
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCommand -and -not (Test-Path -LiteralPath $npmCli)) {
        Write-Host 'npm is missing; downloading project-local npm 11.6.2 from the official registry.'
        $npmDir = Join-Path $PSScriptRoot '.tools/npm'
        New-Item -ItemType Directory -Force $npmDir | Out-Null
        $archive = Join-Path $PSScriptRoot '.tools/npm-11.6.2.tgz'
        Invoke-WebRequest 'https://registry.npmjs.org/npm/-/npm-11.6.2.tgz' -OutFile $archive -UseBasicParsing
        $sha = [Security.Cryptography.SHA512]::Create()
        try { $actual = [Convert]::ToBase64String($sha.ComputeHash([IO.File]::ReadAllBytes($archive))) }
        finally { $sha.Dispose() }
        $expected = '7iKzNfy8lWYs3zq4oFPa8EXZz5xt9gQNKJZau3B1ErLBb6bF7sBJ00x09485DOvRT2l5Gerbl3VlZNT57MxJVA=='
        if ($actual -ne $expected) { throw 'npm archive integrity verification failed.' }
        & tar.exe -xzf $archive -C $npmDir --strip-components=1
        if ($LASTEXITCODE -ne 0) { throw 'Could not extract npm.' }
    }
    $installAction = if (Test-Path -LiteralPath 'package-lock.json') { 'ci' } else { 'install' }
    if ($npmCommand) { & $npmCommand.Source $installAction --ignore-scripts --no-fund --no-audit }
    else { & $nodePath $npmCli $installAction --ignore-scripts --no-fund --no-audit }
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & $nodePath (Join-Path $PSScriptRoot 'scripts/init-memory.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Memory initialization failed.' }
    Write-Host 'BT-Agent is ready. Run .\start.cmd (or .\start.ps1).'
} finally { Pop-Location }
