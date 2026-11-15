# start.ps1 - Synova 1A DSH Sidecar (thin wrapper over src/runtime/dsh/sidecar.ts)
#
# Usage:
#   powershell -File scripts/dsh-sidecar/start.ps1 -InstanceDir C:\path\to\instance
# Optional: -DshHome <per-instance DSH_HOME>, -InstallDir <fixed dsh install>,
#           -TimeoutSec <startup window, default 60>.
#
# Contract:
#   exit 0 = supervisor ready (ACP initialize passed); stdout = one JSON status line
#   exit 1 = typed failure (code/phase/retryable in JSON); exit 2 = wrapper broken
#
# This script never installs/upgrades dsh, never stops another DSH process, and
# never reads model credentials. The child environment is built by profile.ts
# (model keys stripped, DSH_HOME pinned).

param(
  [Parameter(Mandatory = $true)][string]$InstanceDir,
  [string]$DshHome = '',
  [string]$InstallDir = '',
  [int]$TimeoutSec = 60
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent (Split-Path -Parent $here)
$tsx = Join-Path $repo 'node_modules\.bin\tsx.cmd'
$entry = Join-Path $repo 'src\runtime\dsh\sidecar.ts'
if (-not (Test-Path $tsx)) { Write-Output '{"ok":false,"code":"PROFILE_NOT_FOUND","phase":"profile","retryable":false,"message":"tsx not found: run npm ci"}'; exit 2 }
if (-not (Test-Path $entry)) { Write-Output '{"ok":false,"code":"PROFILE_NOT_FOUND","phase":"profile","retryable":false,"message":"sidecar.ts not found"}'; exit 2 }

$instanceFull = [System.IO.Path]::GetFullPath($InstanceDir)
$arguments = @($entry, '--action', 'start', '--instance-dir', $instanceFull, '--start-timeout-ms', [string]($TimeoutSec * 1000))
if ($DshHome -ne '') { $arguments += @('--dsh-home', [System.IO.Path]::GetFullPath($DshHome)) }
if ($InstallDir -ne '') { $arguments += @('--install-dir', [System.IO.Path]::GetFullPath($InstallDir)) }

& $tsx @arguments
exit $LASTEXITCODE
