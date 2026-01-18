param(
  [Parameter(Mandatory = $true)]
  [string]$Source
)

$destinationDir = Join-Path $env:LOCALAPPDATA "Aurora"
$destination = Join-Path $destinationDir "aurora.exe"

if (-not (Test-Path $Source)) {
  Write-Error "File not found: $Source"
  exit 1
}

New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
Copy-Item -Path $Source -Destination $destination -Force

$path = [Environment]::GetEnvironmentVariable("Path", "User")
if ($path -notlike "*$destinationDir*") {
  [Environment]::SetEnvironmentVariable("Path", $path + ";$destinationDir", "User")
}

Write-Host "Installed aurora to $destination"
Write-Host "Restart your terminal to pick up the PATH update."
