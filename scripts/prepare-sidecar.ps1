param()

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "ui\src-tauri\target\release\aurora.exe"

if (-not (Test-Path $src)) {
  Write-Error "Missing CLI binary at $src. Run: (cd ui/src-tauri; cargo build --bin aurora --release)"
  exit 1
}

$target = (rustc -vV | Select-String '^host:' | ForEach-Object { $_.ToString().Split()[1] })
if (-not $target) {
  Write-Error "Could not determine rust target triple"
  exit 1
}

$dest = Join-Path $root ("ui\src-tauri\aurora-" + $target + ".exe")
Copy-Item -Path $src -Destination $dest -Force
Write-Host "Prepared sidecar: $dest"
