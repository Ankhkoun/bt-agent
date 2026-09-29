$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$shell = New-Object -ComObject WScript.Shell
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'BT-Agent.lnk'
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $root 'desktop/node_modules/electron/dist/electron.exe'
$shortcut.Arguments = '"' + (Join-Path $root 'desktop') + '"'
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = (Join-Path $root 'desktop/public/icon.ico') + ',0'
$shortcut.Description = 'BT - Personal AI'
$shortcut.Save()
Write-Host "Created $shortcutPath"
