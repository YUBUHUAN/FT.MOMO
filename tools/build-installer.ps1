param(
  [string]$Portable = "dist\MomoPet-Windows-Portable",
  [string]$Version = "1.7.1.0"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$portable = Join-Path $root $Portable
if (!(Test-Path (Join-Path $portable "MomoPet.exe"))) {
  throw "Portable build not found: $portable"
}

$makensis = (Get-Command makensis -ErrorAction SilentlyContinue).Source
if (!$makensis) {
  $candidates = @(
    "C:\Program Files (x86)\NSIS\makensis.exe",
    "C:\Program Files\NSIS\makensis.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { $makensis = $candidate; break }
  }
}
if (!$makensis) {
  throw "makensis not found. Install NSIS 3 first."
}

Push-Location $root
try {
  & $makensis -INPUTCHARSET UTF8 (Join-Path $root "installer\MomoPet.nsi")
  if ($LASTEXITCODE -ne 0) { throw "makensis failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
}

$output = Join-Path $root "dist\MomoPet-Setup-$Version.exe"
if (!(Test-Path $output)) { throw "Installer was not created: $output" }
Get-Item $output | Select-Object FullName, Length
