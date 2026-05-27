# Regenerate desktop Tauri icons from icon.png (PNG, ICO, ICNS only).
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $dir '..\..')
$source = Join-Path $dir 'icon.png'

if (-not (Test-Path $source)) {
    throw "Missing $source — add your master logo as icon.png first."
}

Copy-Item $source (Join-Path $dir 'icon_original.png') -Force

Push-Location $root
try {
    pnpm exec tauri icon $source -o $dir
}
finally {
    Pop-Location
}

Remove-Item -Recurse -Force (Join-Path $dir 'ios'), (Join-Path $dir 'android') -ErrorAction SilentlyContinue
Get-ChildItem $dir -Filter 'Square*.png' | Remove-Item -Force
Remove-Item -Force (Join-Path $dir 'StoreLogo.png'), (Join-Path $dir '64x64.png') -ErrorAction SilentlyContinue
Write-Host "Desktop icons written to $dir"
