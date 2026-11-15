# logs.ps1 - Synova 1A DSH Sidecar log tail (thin wrapper over sidecar.ts)
#
# Usage:
#   powershell -File scripts/dsh-sidecar/logs.ps1 -InstanceDir C:\path\to\instance -Lines 120
#
# Contract: stdout = one JSON line { ok, logPath, lines[] }; exit 0 on success,
# exit 1 when no log exists yet, exit 2 when the wrapper itself is broken.
# Log content includes raw ACP stdout/stderr lines and structured
# {time,level,component,code,phase,retryable,message} records.

param(
  [string]$InstanceDir = '',
  [string]$DshHome = '',
  [int]$Lines = 80
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent (Split-Path -Parent $here)
$tsx = Join-Path $repo 'node_modules\.bin\tsx.cmd'
$entry = Join-Path $repo 'src\runtime\dsh\sidecar.ts'
if (-not (Test-Path $tsx)) { Write-Output '{"ok":false,"code":"PROFILE_NOT_FOUND","phase":"profile","retryable":false,"message":"tsx not found: run npm ci"}'; exit 2 }

$arguments = @($entry, '--action', 'logs', '--lines', [string]$Lines)
if ($InstanceDir -ne '') { $arguments += @('--instance-dir', [System.IO.Path]::GetFullPath($InstanceDir)) }
if ($DshHome -ne '') { $arguments += @('--dsh-home', [System.IO.Path]::GetFullPath($DshHome)) }

& $tsx @arguments
exit $LASTEXITCODE
