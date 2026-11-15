# restore.ps1 - Synova 1A DSH Sidecar offline restore (synthetic/isolated only).
#
# Usage:
#   powershell -File scripts/dsh-sidecar/restore.ps1 -BackupDir <backup folder> -TargetDshHome <dir> [-AllowProduction]
#
# Behaviour:
#   verifies manifest.json (sha256 per file) BEFORE touching the target; refuses
#   when a live supervisor state file points to a running process; restores into
#   -TargetDshHome (created if absent) and re-verifies. Never starts/stops dsh.
# Exit: 0 = verified restore; 1 = verify/restore failed; 2 = refused/unsafe input.

param(
  [Parameter(Mandatory = $true)][string]$BackupDir,
  [Parameter(Mandatory = $true)][string]$TargetDshHome,
  [switch]$AllowProduction
)

$ErrorActionPreference = 'Stop'

function Fail([string]$code, [string]$message, [int]$exitCode = 1) {
  Write-Output (ConvertTo-Json -Compress @{ ok = $false; code = $code; message = $message })
  exit $exitCode
}

$backupFull = [System.IO.Path]::GetFullPath($BackupDir)
$manifestPath = Join-Path $backupFull 'manifest.json'
if (-not (Test-Path $manifestPath)) { Fail 'RESTORE_MANIFEST_MISSING' "missing manifest: $manifestPath" }
$manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json

foreach ($entry in $manifest.files) {
  $file = Join-Path $backupFull ($entry.path.Replace('/', '\'))
  if (-not (Test-Path $file)) { Fail 'RESTORE_FILE_MISSING' "backup file missing: $($entry.path)" }
  $hash = (Get-FileHash -Path $file -Algorithm SHA256).Hash.ToLower()
  if ($hash -ne $entry.sha256) { Fail 'RESTORE_VERIFY_FAILED' "sha256 mismatch before restore: $($entry.path)" }
}

$targetFull = [System.IO.Path]::GetFullPath($TargetDshHome)
$defaultHome = Join-Path $env:LOCALAPPDATA 'Synova\dsh-sidecar\home'
if (-not $AllowProduction -and $targetFull.TrimEnd('\') -ieq ([System.IO.Path]::GetFullPath($defaultHome)).TrimEnd('\')) {
  Fail 'RESTORE_PRODUCTION_REFUSED' 'default sidecar home requires -AllowProduction (1A offline mandate)' 2
}
$statePath = Join-Path $targetFull 'run\synova-sidecar.json'
if (Test-Path $statePath) {
  $state = Get-Content -Path $statePath -Raw | ConvertFrom-Json
  $alive = $false
  try { $null = Get-Process -Id ([int]$state.supervisorPid) -ErrorAction Stop; $alive = $true } catch { $alive = $false }
  if ($alive) { Fail 'RESTORE_SIDECAR_RUNNING' 'refusing to restore while supervisor is running (stop it first)' 2 }
}

New-Item -ItemType Directory -Path $targetFull -Force | Out-Null
Get-ChildItem -Path $backupFull -Directory | ForEach-Object {
  if ($_.Name -eq 'manifest.json') { return }
  Copy-Item -Path $_.FullName -Destination (Join-Path $targetFull $_.Name) -Recurse -Force
}

$bad = 0
foreach ($entry in $manifest.files) {
  $file = Join-Path $targetFull ($entry.path.Replace('/', '\'))
  if (-not (Test-Path $file)) { $bad += 1; continue }
  if ((Get-FileHash -Path $file -Algorithm SHA256).Hash.ToLower() -ne $entry.sha256) { $bad += 1 }
}
if ($bad -gt 0) { Fail 'RESTORE_POST_VERIFY_FAILED' "$bad file(s) mismatch after restore" }

Write-Output (ConvertTo-Json -Compress @{
  ok = $true
  code = 'RESTORE_OK'
  target = $targetFull
  files = $manifest.files.Count
  verified = ($manifest.files.Count - $bad)
})
exit 0
