# status.ps1 - Synova 1A DSH Sidecar status (thin wrapper over sidecar.ts)
#
# Usage:
#   powershell -File scripts/dsh-sidecar/status.ps1 -InstanceDir C:\path\to\instance
#
# Contract:
#   exit 0 = running and ready; exit 1 = not running or not ready (typed JSON);
#   exit 2 = wrapper broken. stdout = one JSON status line.

param(
  [string]$InstanceDir = '',
  [string]$DshHome = ''
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent (Split-Path -Parent $here)
$tsx = Join-Path $repo 'node_modules\.bin\tsx.cmd'
$entry = Join-Path $repo 'src\runtime\dsh\sidecar.ts'
if (-not (Test-Path $tsx)) { Write-Output '{"ok":false,"code":"PROFILE_NOT_FOUND","phase":"profile","retryable":false,"message":"tsx not found: run npm ci"}'; exit 2 }

$arguments = @($entry, '--action', 'status')
if ($InstanceDir -ne '') { $arguments += @('--instance-dir', [System.IO.Path]::GetFullPath($InstanceDir)) }
if ($DshHome -ne '') { $arguments += @('--dsh-home', [System.IO.Path]::GetFullPath($DshHome)) }

& $tsx @arguments
exit $LASTEXITCODE
