param([string]$Archive)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$packageDir = Join-Path $projectRoot 'desktop/node_modules/electron'
$version = (Get-Content -LiteralPath (Join-Path $packageDir 'package.json') -Raw | ConvertFrom-Json).version
$filename = "electron-v$version-win32-x64.zip"
$expected = (Get-Content -LiteralPath (Join-Path $packageDir 'checksums.json') -Raw | ConvertFrom-Json).$filename
if (-not $expected) { throw 'No official Electron checksum for this archive.' }
if (-not $Archive) {
    $cache = Join-Path $projectRoot '.tools/electron'
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    $Archive = Join-Path $cache $filename
    $valid = (Test-Path -LiteralPath $Archive) -and ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -eq $expected)
    if (-not $valid) {
        $sources = @("https://github.com/electron/electron/releases/download/v$version/$filename", "https://npmmirror.com/mirrors/electron/$version/$filename")
        foreach ($source in $sources) {
            Write-Host "Downloading Electron $version from $([uri]$source | ForEach-Object Host)..."
            & curl.exe --silent --show-error --location --fail --connect-timeout 15 --max-time 240 --output $Archive $source
            if ($LASTEXITCODE -eq 0 -and ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -eq $expected)) { $valid = $true; break }
        }
        if (-not $valid) { throw 'Electron download failed or checksum did not match the pinned official npm package.' }
    }
}
if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne $expected) { throw 'Electron SHA256 mismatch.' }
Expand-Archive -LiteralPath $Archive -DestinationPath (Join-Path $packageDir 'dist') -Force
[IO.File]::WriteAllText((Join-Path $packageDir 'path.txt'), 'electron.exe', [Text.Encoding]::ASCII)
Write-Host "Electron $version installed; official SHA256 verified."
