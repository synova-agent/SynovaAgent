# Get-DshRuntimeBundleSha256.ps1 -- host-side SHA-256 producer for outgoing/runtime-bundle.zip.
#
# Usage (host):
#   $sha = & scripts/dsh-sidecar/sandbox/Get-DshRuntimeBundleSha256.ps1 -OutgoingDir <runDir>\outgoing
#
# Contract (Issue #1446):
#   - Runs on the host, after the sandbox finished writing outgoing/runtime-bundle.zip.
#     Start-DshSandbox.ps1 injects this script into SandboxLifecycle.psm1, which only records
#     the returned value; the state machine never hashes the bundle itself.
#   - Output: exactly one 64-character lowercase hex string when the bundle exists.
#   - Output: nothing (the caller sees $null) when the bundle does not exist. An empty string,
#     a placeholder or any synthesised hash is never emitted.
#   - @input    -OutgoingDir <string>  absolute run-dir outgoing directory
#   - @output   <string>|$null          lower-case sha256 of runtime-bundle.zip, or nothing
#   - @degraded none -- a missing bundle is an explicit "no value", never a silent fake hash
param(
  [Parameter(Mandatory = $true)][string]$OutgoingDir
)

$ErrorActionPreference = 'Stop'

$outgoingFull = [System.IO.Path]::GetFullPath($OutgoingDir)
$bundlePath = Join-Path $outgoingFull 'runtime-bundle.zip'
if (-not (Test-Path -LiteralPath $bundlePath -PathType Leaf)) { return }
return (Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash.ToLower()
