# rollback.ps1 - Synova 1A DSH Sidecar install-pointer rollback (synthetic/isolated only).
#
# Usage:
#   powershell -File scripts/dsh-sidecar/rollback.ps1 -DshHome <dir> -PreviousInstallDir <dir> [-CurrentInstallDir <dir>] [-AllowProduction]
#
# Behaviour:
#   reads/writes <DshHome>/install-dir.txt only (a pointer file used by deployment
#   to pin the fixed dsh install). Verifies the previous install directory contains
#   "DeepSeek Harness.exe" before switching; refuses if supervisor is running.
#   It NEVER installs, uninstalls, stops a process or touches the real installation.
# Exit: 0 = pointer switched; 1 = verification failed; 2 = refused/unsafe input.

param(
  [Parameter(Mandatory = $true)][string]$DshHome,
  [Parameter(Mandatory = $true)][string]$PreviousInstallDir,
  [string]$CurrentInstallDir = '',
  [switch]$AllowProduction
)

$ErrorActionPreference = 'Stop'

function Fail([string]$code, [string]$message, [int]$exitCode = 1) {
  Write-Output (ConvertTo-Json -Compress @{ ok = $false; code = $code; message = $message })
  exit $exitCode
}

$homeFull = [System.IO.Path]::GetFullPath($DshHome)
$defaultHome = Join-Path $env:LOCALAPPDATA 'Synova\dsh-sidecar\home'
if (-not $AllowProduction -and $homeFull.TrimEnd('\') -ieq ([System.IO.Path]::GetFullPath($defaultHome)).TrimEnd('\')) {
  Fail 'ROLLBACK_PRODUCTION_REFUSED' 'default sidecar home requires -AllowProduction (1A offline mandate)' 2
}
if (-not (Test-Path $homeFull)) { Fail 'ROLLBACK_HOME_MISSING' "missing DSH_HOME: $homeFull" }

$statePath = Join-Path $homeFull 'run\synova-sidecar.json'
if (Test-Path $statePath) {
  $state = Get-Content -Path $statePath -Raw | ConvertFrom-Json
  $alive = $false
  try { $null = Get-Process -Id ([int]$state.supervisorPid) -ErrorAction Stop; $alive = $true } catch { $alive = $false }
  if ($alive) { Fail 'ROLLBACK_SIDECAR_RUNNING' 'refusing to rollback while supervisor is running (stop it first)' 2 }
}

$previousFull = [System.IO.Path]::GetFullPath($PreviousInstallDir)
$exe = Join-Path $previousFull 'DeepSeek Harness.exe'
if (-not (Test-Path $exe)) { Fail 'ROLLBACK_TARGET_INVALID' "previous install missing DeepSeek Harness.exe: $previousFull" }

$pointer = Join-Path $homeFull 'install-dir.txt'
$previousPointer = ''
if (Test-Path $pointer) { $previousPointer = (Get-Content -Path $pointer -Raw).Trim() }
$current = $CurrentInstallDir
if ($current -eq '' -and $previousPointer -ne '') { $current = $previousPointer }

Set-Content -Path $pointer -Value $previousFull -Encoding UTF8
$written = (Get-Content -Path $pointer -Raw).Trim()
if ($written -ne $previousFull) { Fail 'ROLLBACK_POINTER_MISMATCH' 'install-dir.txt did not persist the previous path' }

Write-Output (ConvertTo-Json -Compress @{
  ok = $true
  code = 'ROLLBACK_OK'
  previousInstallDir = $previousFull
  previousPointer = $previousPointer
  currentInstallDir = $current
  pointer = $pointer
})
exit 0
