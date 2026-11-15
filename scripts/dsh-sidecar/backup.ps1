# backup.ps1 - Synova 1A DSH Sidecar offline backup (synthetic/isolated only).
#
# Usage:
#   powershell -File scripts/dsh-sidecar/backup.ps1 -DshHome <dir> -BackupDir <dir> [-AllowProduction]
#
# Behaviour:
#   copies profiles/ sessions/ storages/ run/ from -DshHome into a new timestamped
#   folder under -BackupDir (or %TEMP%\synova-1a-backup when -BackupDir omitted),
#   writes manifest.json (relative path + bytes + sha256) and verifies every copied
#   file against the manifest. Refuses (exit 2) without -AllowProduction when
#   -DshHome equals the default sidecar home (offline mandate: no real-data ops).
# Exit: 0 = verified backup; 1 = backup/verify failed; 2 = refused/unsafe input.

param(
  [Parameter(Mandatory = $true)][string]$DshHome,
  [string]$BackupDir = '',
  [switch]$AllowProduction
)

$ErrorActionPreference = 'Stop'

function Fail([string]$code, [string]$message, [int]$exitCode = 1) {
  Write-Output (ConvertTo-Json -Compress @{ ok = $false; code = $code; message = $message })
  exit $exitCode
}

$defaultHome = Join-Path $env:LOCALAPPDATA 'Synova\dsh-sidecar\home'
$homeFull = [System.IO.Path]::GetFullPath($DshHome)
if (-not (Test-Path $homeFull)) { Fail 'BACKUP_SOURCE_MISSING' "missing DSH_HOME: $homeFull" }
if (-not $AllowProduction -and $homeFull.TrimEnd('\') -ieq ([System.IO.Path]::GetFullPath($defaultHome)).TrimEnd('\')) {
  Fail 'BACKUP_PRODUCTION_REFUSED' 'default sidecar home requires -AllowProduction (1A offline mandate)' 2
}
if ($BackupDir -eq '') { $BackupDir = Join-Path $env:TEMP 'synova-1a-backup' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path ([System.IO.Path]::GetFullPath($BackupDir)) "synova-sidecar-$stamp"
New-Item -ItemType Directory -Path $target -Force | Out-Null

$entries = @()
foreach ($sub in @('profiles', 'sessions', 'storages', 'run')) {
  $source = Join-Path $homeFull $sub
  if (-not (Test-Path $source)) { continue }
  $dest = Join-Path $target $sub
  Copy-Item -Path $source -Destination $dest -Recurse -Force
  Get-ChildItem -Path $dest -Recurse -File | ForEach-Object {
    $entries += [ordered]@{
      path = $_.FullName.Substring($target.Length).TrimStart('\').Replace('\', '/')
      bytes = $_.Length
      sha256 = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash.ToLower()
    }
  }
}

$manifest = [ordered]@{
  schemaVersion = 1
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  source = $homeFull
  files = $entries
}
$manifestPath = Join-Path $target 'manifest.json'
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding UTF8

$bad = 0
foreach ($entry in $entries) {
  $file = Join-Path $target ($entry.path.Replace('/', '\'))
  if (-not (Test-Path $file)) { $bad += 1; continue }
  $hash = (Get-FileHash -Path $file -Algorithm SHA256).Hash.ToLower()
  if ($hash -ne $entry.sha256) { $bad += 1 }
}
if ($bad -gt 0) { Fail 'BACKUP_VERIFY_FAILED' "$bad file(s) failed sha256 verification" }

Write-Output (ConvertTo-Json -Compress @{
  ok = $true
  code = 'BACKUP_OK'
  target = $target
  manifest = $manifestPath
  files = $entries.Count
  verified = ($entries.Count - $bad)
})
exit 0
