$ErrorActionPreference = 'Stop'

function Get-BTNode {
    $projectRoot = Split-Path $PSScriptRoot -Parent
    $localNode = Join-Path $projectRoot '.tools/node/node.exe'
    if (Test-Path -LiteralPath $localNode) { return $localNode }
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { return $nodeCommand.Source }
    # Codex desktop bundles Node; a standard Node LTS installation also works.
    $bundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if (Test-Path -LiteralPath $bundledNode) { return $bundledNode }
    throw 'Node.js >=22.19.0 is required. Install Node LTS from https://nodejs.org and rerun setup.ps1.'
}

function Set-BTNodePath([string]$NodePath) {
    $env:PATH = (Split-Path $NodePath -Parent) + [IO.Path]::PathSeparator + $env:PATH
    $nodeVersion = & $NodePath --version
    if ($LASTEXITCODE -ne 0 -or [version]($nodeVersion.TrimStart('v')) -lt [version]'22.19.0') {
        throw 'Node >=22.19.0 is required.'
    }
}
