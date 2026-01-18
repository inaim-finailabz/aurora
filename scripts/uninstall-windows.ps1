param()

$paths = @(
  "C:\Program Files\Aurora",
  "$env:LOCALAPPDATA\Aurora"
)

foreach ($p in $paths) {
  if (Test-Path $p) {
    Write-Host "Removing $p"
    Remove-Item -Path $p -Recurse -Force
  }
}

$appDataDirs = @(
  "$env:APPDATA\aurora",
  "$env:LOCALAPPDATA\aurora"
)

foreach ($p in $appDataDirs) {
  if (Test-Path $p) {
    Write-Host "Removing $p"
    Remove-Item -Path $p -Recurse -Force
  }
}

Write-Host "Uninstall complete. If installed via MSI/NSIS, remove it via Apps & Features."
