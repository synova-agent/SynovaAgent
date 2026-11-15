# stop.ps1 - Synova 1A DSH Sidecar graceful stop (thin wrapper over sidecar.ts)
#
# Usage:
#   powershell -File scripts/dsh-sidecar/stop.ps1 -InstanceDir C:\path\to\instance
#
# Contract:
#   exit 0 = supervisor process verified gone; exit 1 = not running / stop failed;
#   exit 2 = wrapper broken. stdout = one JSON line.
# "close session" is NOT "stop process": the stop action closes ACP, kills the
# child, removes the state file and verifies the supervisor PID disappeared.

param(
  [string]$InstanceDir = '',
  [string]$DshHome = '',
  [int]$TimeoutSec = 15
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent (Split-Path -Parent $here)
$tsx = Join-Path $repo 'node_modules\.bin\tsx.cmd'
$entry = Join-Path $repo 'src\runtime\dsh\sidecar.ts'
if (-not (Test-Path $tsx)) { Write-Output '{"ok":false,"code":"PROFILE_NOT_FOUND","phase":"profile","retryable":false,"message":"tsx not found: run npm ci"}'; exit 2 }

$arguments = @($entry, '--action', 'stop', '--stop-timeout-ms', [string]($TimeoutSec * 1000))
if ($InstanceDir -ne '') { $arguments += @('--instance-dir', [System.IO.Path]::GetFullPath($InstanceDir)) }
if ($DshHome -ne '') { $arguments += @('--dsh-home', [System.IO.Path]::GetFullPath($DshHome)) }

& $tsx @arguments
exit $LASTEXITCODE
