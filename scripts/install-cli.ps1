param(
  [Parameter(Mandatory = $true)]
  [string]$Source
)

$destination = "C:\Program Files\Aurora\aurora.exe"

if (-not (Test-Path $Source)) {
  Write-Error "File not found: $Source"
  exit 1
}

New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
Copy-Item -Path $Source -Destination $destination -Force

$path = [Environment]::GetEnvironmentVariable("Path", "Machine")
if ($path -notlike "*C:\Program Files\Aurora*") {
  [Environment]::SetEnvironmentVariable("Path", $path + ";C:\Program Files\Aurora", "Machine")
}

Write-Host "Installed aurora to $destination"
Write-Host "Restart your terminal to pick up the PATH update."
