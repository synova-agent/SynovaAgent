# Test-DshEvidence.ps1 -- the only machine check for probe evidence + orchestration binding.
#
# Usage (host, never inside the sandbox):
#   powershell -NoProfile -File scripts/dsh-sidecar/sandbox/Test-DshEvidence.ps1 `
#     -EvidencePath <outgoing>\evidence.json -OrchestrationPath <runDir>\orchestration.json
#
# Contract (DEV DOC v6 SS5.3):
#   - Parses JSON/text/hashes only; never executes anything from the outgoing directory.
#   - evidence.json and orchestration.json are additionalProperties=false and must match the
#     fixed field sets. Probes must be exactly ids 1..10, each executed=true, ok=true,
#     exitCode=expectedExitCode=0, with a non-empty bounded log whose sha256 matches.
#   - Everything is bound to the final DESTROYED orchestration and both sentinels: same
#     baseSha/codeSha/sandboxId/nonce/config/input/runtime hashes; timestamps parse and
#     finishedAt >= startedAt; sentinel files exist with matching hashes.
#   - exit 0 = valid; exit 1 = evidence invalid; exit 2 = cannot judge (file/parse/validator error).

param(
  [Parameter(Mandatory = $true)][string]$EvidencePath,
  [Parameter(Mandatory = $true)][string]$OrchestrationPath
)

$ErrorActionPreference = 'Stop'

$Issue = 1411
$PinnedNode = 'v24.21.0'
$PinnedDsh = '0.2.2-rc.5'

function Exit-With([int]$code, [string]$message) {
  $payload = [ordered]@{ ok = ($code -eq 0); code = $(if ($code -eq 0) { 'EVIDENCE_OK' } else { 'EVIDENCE_INVALID' }); message = $message }
  Write-Output ($payload | ConvertTo-Json -Compress -Depth 6)
  exit $code
}

function Get-Sha256Hex([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
}

function Get-KeyList($Object) {
  return @($Object.PSObject.Properties.Name)
}

function Test-ExactKeys($Object, [string[]]$Expected) {
  $actual = Get-KeyList $Object
  $missing = @($Expected | Where-Object { $actual -notcontains $_ })
  $extra = @($actual | Where-Object { $Expected -notcontains $_ })
  return @{ ok = ($missing.Count -eq 0 -and $extra.Count -eq 0); missing = $missing; extra = $extra }
}

function Test-Integer($Value) {
  return ($Value -is [int] -or $Value -is [long])
}

function Test-IsoTime([string]$Value) {
  $parsed = [datetime]::MinValue
  return [datetime]::TryParse($Value, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsed)
}

function Resolve-UnderRoot([string]$Root, [string]$Relative) {
  if ($Relative -match '(^/|^\\|^[A-Za-z]:|\.\.)') { return $null }
  $full = [System.IO.Path]::GetFullPath((Join-Path $Root ($Relative -replace '/', '\')))
  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
  if (-not $full.StartsWith($rootFull + '\', [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
  return $full
}

function New-Problem([string]$Code, [string]$Message) {
  return [ordered]@{ code = $Code; message = $Message }
}

# -- load --------------------------------------------------------------------
foreach ($path in @($EvidencePath, $OrchestrationPath)) {
  if (-not (Test-Path -LiteralPath $path)) { Exit-With 2 "missing input file: $path" }
}
try {
  $evidence = Get-Content -LiteralPath $EvidencePath -Raw -Encoding UTF8 | ConvertFrom-Json
  $orchestration = Get-Content -LiteralPath $OrchestrationPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  Exit-With 2 "cannot parse evidence/orchestration JSON: $($_.Exception.Message)"
}
if ($null -eq $evidence -or $null -eq $orchestration) { Exit-With 2 'evidence/orchestration JSON is empty' }

$problems = @()
$orchestrationPathFull = [System.IO.Path]::GetFullPath($OrchestrationPath)
$runDir = Split-Path -Parent $orchestrationPathFull
$evidenceDir = Split-Path -Parent ([System.IO.Path]::GetFullPath($EvidencePath))
$taskRoot = Split-Path -Parent (Split-Path -Parent $runDir)

# -- orchestration shape -----------------------------------------------------
$orchestrationKeys = @(
  'schemaVersion', 'issue', 'mode', 'baseSha', 'codeSha', 'codeArchivePath', 'codeArchiveSha256',
  'sandboxId', 'nonce', 'configSha256', 'inputManifestSha256', 'runtimeBundleSha256', 'state',
  'hostPid', 'hostProcessStartTime', 'startedAt', 'finishedAt', 'destroyedAt', 'scriptExitCode',
  'hostExitCode', 'startedSentinel', 'finishedSentinel', 'handoff'
)
$orchestrationShape = Test-ExactKeys $orchestration $orchestrationKeys
if (-not $orchestrationShape.ok) { $problems += New-Problem 'ORCHESTRATION_KEYS' ("missing=" + ($orchestrationShape.missing -join ',') + ' extra=' + ($orchestrationShape.extra -join ',')) }
if ([int]$orchestration.schemaVersion -ne 1) { $problems += New-Problem 'ORCHESTRATION_SCHEMA' 'schemaVersion must be 1' }
if ([int]$orchestration.issue -ne $Issue) { $problems += New-Problem 'ORCHESTRATION_ISSUE' "issue must be $Issue" }
if ([string]$orchestration.mode -ne 'probe') { $problems += New-Problem 'ORCHESTRATION_MODE' 'mode must be probe' }
if ([string]$orchestration.state -ne 'DESTROYED') { $problems += New-Problem 'ORCHESTRATION_STATE' "state=$($orchestration.state), expected DESTROYED" }
if ([string]::IsNullOrEmpty([string]$orchestration.destroyedAt)) { $problems += New-Problem 'ORCHESTRATION_DESTROYED_AT' 'destroyedAt must be set' }
if (-not (Test-Integer $orchestration.scriptExitCode) -or [int]$orchestration.scriptExitCode -ne 0) { $problems += New-Problem 'ORCHESTRATION_SCRIPT_EXIT' 'scriptExitCode must be integer 0' }
if (-not (Test-Integer $orchestration.hostExitCode) -or [int]$orchestration.hostExitCode -ne 0) { $problems += New-Problem 'ORCHESTRATION_HOST_EXIT' 'hostExitCode must be integer 0' }
foreach ($key in @('baseSha', 'codeSha', 'nonce', 'configSha256', 'inputManifestSha256', 'runtimeBundleSha256')) {
  if ([string]::IsNullOrEmpty([string]$orchestration.$key)) { $problems += New-Problem 'ORCHESTRATION_FIELD' "$key must be set" }
}
if ([string]$orchestration.baseSha -notmatch '^[0-9a-f]{40}$') { $problems += New-Problem 'ORCHESTRATION_BASE' 'baseSha must be 40 lowercase hex' }
if ([string]$orchestration.codeSha -notmatch '^[0-9a-f]{40}$') { $problems += New-Problem 'ORCHESTRATION_CODE' 'codeSha must be 40 lowercase hex' }
foreach ($sentinelName in @('startedSentinel', 'finishedSentinel')) {
  $sentinel = $orchestration.$sentinelName
  if ($null -eq $sentinel) { $problems += New-Problem 'ORCHESTRATION_SENTINEL' "$sentinelName missing"; continue }
  $shape = Test-ExactKeys $sentinel @('path', 'sha256')
  if (-not $shape.ok) { $problems += New-Problem 'ORCHESTRATION_SENTINEL' "$sentinelName keys invalid"; continue }
  $sentinelFile = Resolve-UnderRoot -Root $taskRoot -Relative ([string]$sentinel.path)
  if ($null -eq $sentinelFile) { $problems += New-Problem 'ORCHESTRATION_SENTINEL' "$sentinelName.path invalid"; continue }
  if (-not (Test-Path -LiteralPath $sentinelFile)) { $problems += New-Problem 'ORCHESTRATION_SENTINEL' "$sentinelName file missing"; continue }
  if ((Get-Sha256Hex $sentinelFile) -ne [string]$sentinel.sha256) { $problems += New-Problem 'ORCHESTRATION_SENTINEL' "$sentinelName hash mismatch" }
}
if ($null -eq $orchestration.handoff) {
  $problems += New-Problem 'ORCHESTRATION_HANDOFF' 'probe orchestration.handoff must be set'
} else {
  $handoffShape = Test-ExactKeys $orchestration.handoff @('sourceSha256', 'destinationSha256')
  if (-not $handoffShape.ok) { $problems += New-Problem 'ORCHESTRATION_HANDOFF' 'handoff keys invalid' }
  if ([string]$orchestration.handoff.sourceSha256 -ne [string]$orchestration.handoff.destinationSha256) { $problems += New-Problem 'ORCHESTRATION_HANDOFF' 'handoff sourceSha256 != destinationSha256' }
  if ([string]$orchestration.handoff.sourceSha256 -ne [string]$orchestration.runtimeBundleSha256) { $problems += New-Problem 'ORCHESTRATION_HANDOFF' 'handoff sourceSha256 != runtimeBundleSha256' }
}
$configFile = Join-Path $runDir 'probe.wsb'
$manifestFile = Join-Path $runDir 'incoming\input-manifest.json'
if (-not (Test-Path -LiteralPath $configFile)) { $problems += New-Problem 'ORCHESTRATION_CONFIG' 'probe.wsb missing in run dir' }
elseif ((Get-Sha256Hex $configFile) -ne [string]$orchestration.configSha256) { $problems += New-Problem 'ORCHESTRATION_CONFIG' 'probe.wsb hash mismatch' }
if (-not (Test-Path -LiteralPath $manifestFile)) { $problems += New-Problem 'ORCHESTRATION_MANIFEST' 'input-manifest.json missing' }
elseif ((Get-Sha256Hex $manifestFile) -ne [string]$orchestration.inputManifestSha256) { $problems += New-Problem 'ORCHESTRATION_MANIFEST' 'input-manifest hash mismatch' }

# -- evidence shape ----------------------------------------------------------
$evidenceKeys = @(
  'schemaVersion', 'issue', 'mode', 'baseSha', 'codeSha', 'sandboxId', 'nonce', 'startedAt',
  'finishedAt', 'configSha256', 'inputManifestSha256', 'runtimeBundleSha256', 'nodeVersion',
  'dshVersion', 'probes'
)
$evidenceShape = Test-ExactKeys $evidence $evidenceKeys
if (-not $evidenceShape.ok) { $problems += New-Problem 'EVIDENCE_KEYS' ("missing=" + ($evidenceShape.missing -join ',') + ' extra=' + ($evidenceShape.extra -join ',')) }
if ([int]$evidence.schemaVersion -ne 1) { $problems += New-Problem 'EVIDENCE_SCHEMA' 'schemaVersion must be 1' }
if ([int]$evidence.issue -ne $Issue) { $problems += New-Problem 'EVIDENCE_ISSUE' "issue must be $Issue" }
if ([string]$evidence.mode -ne 'probe') { $problems += New-Problem 'EVIDENCE_MODE' 'mode must be probe' }
if ([string]$evidence.nodeVersion -ne $PinnedNode) { $problems += New-Problem 'EVIDENCE_NODE_VERSION' "nodeVersion must be $PinnedNode" }
if ([string]$evidence.dshVersion -ne $PinnedDsh) { $problems += New-Problem 'EVIDENCE_DSH_VERSION' "dshVersion must be $PinnedDsh" }
foreach ($pair in @(@('baseSha', 'baseSha'), @('codeSha', 'codeSha'), @('sandboxId', 'sandboxId'), @('nonce', 'nonce'),
    @('configSha256', 'configSha256'), @('inputManifestSha256', 'inputManifestSha256'), @('runtimeBundleSha256', 'runtimeBundleSha256'))) {
  if ([string]$evidence.($pair[0]) -ne [string]$orchestration.($pair[1])) {
    $problems += New-Problem 'EVIDENCE_BINDING' "$($pair[0]) does not match orchestration.$($pair[1])"
  }
}
if (-not (Test-IsoTime ([string]$evidence.startedAt))) { $problems += New-Problem 'EVIDENCE_TIME' 'startedAt does not parse' }
if (-not (Test-IsoTime ([string]$evidence.finishedAt))) { $problems += New-Problem 'EVIDENCE_TIME' 'finishedAt does not parse' }
if ((Test-IsoTime ([string]$evidence.startedAt)) -and (Test-IsoTime ([string]$evidence.finishedAt))) {
  $started = [datetime]::Parse([string]$evidence.startedAt, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
  $finished = [datetime]::Parse([string]$evidence.finishedAt, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
  if ($finished -lt $started) { $problems += New-Problem 'EVIDENCE_TIME' 'finishedAt is before startedAt' }
}

# -- probes ------------------------------------------------------------------
$probes = @($evidence.probes)
if ($probes.Count -ne 10) { $problems += New-Problem 'EVIDENCE_PROBE_COUNT' "probes count=$($probes.Count), expected 10" }
$seenIds = @{}
$probeKeys = @('id', 'name', 'executed', 'ok', 'command', 'exitCode', 'expectedExitCode', 'observed', 'logPath', 'logSha256')
foreach ($probe in $probes) {
  $label = "probe[$([string]$probe.id)]"
  $shape = Test-ExactKeys $probe $probeKeys
  if (-not $shape.ok) { $problems += New-Problem 'EVIDENCE_PROBE_KEYS' "$label keys invalid"; continue }
  if (-not (Test-Integer $probe.id)) { $problems += New-Problem 'EVIDENCE_PROBE_ID' "$label id must be an integer"; continue }
  $id = [int]$probe.id
  if ($id -lt 1 -or $id -gt 10) { $problems += New-Problem 'EVIDENCE_PROBE_ID' "$label id must be 1..10"; continue }
  if ($seenIds.ContainsKey($id)) { $problems += New-Problem 'EVIDENCE_PROBE_DUPLICATE' "$label duplicate id"; continue }
  $seenIds[$id] = $true
  if ([string]::IsNullOrEmpty([string]$probe.name)) { $problems += New-Problem 'EVIDENCE_PROBE_NAME' "$label name is empty" }
  if ($probe.executed -isnot [bool]) { $problems += New-Problem 'EVIDENCE_PROBE_EXECUTED' "$label executed must be a boolean" }
  elseif (-not $probe.executed) { $problems += New-Problem 'EVIDENCE_PROBE_EXECUTED' "$label executed is false" }
  if ($probe.ok -isnot [bool]) { $problems += New-Problem 'EVIDENCE_PROBE_OK' "$label ok must be a boolean" }
  elseif (-not $probe.ok) { $problems += New-Problem 'EVIDENCE_PROBE_OK' "$label ok is false" }
  if ([string]::IsNullOrEmpty([string]$probe.command)) { $problems += New-Problem 'EVIDENCE_PROBE_COMMAND' "$label command is empty" }
  if (-not (Test-Integer $probe.exitCode)) { $problems += New-Problem 'EVIDENCE_PROBE_EXIT' "$label exitCode must be an integer" }
  elseif ([int]$probe.exitCode -ne 0) { $problems += New-Problem 'EVIDENCE_PROBE_EXIT' "$label exitCode must be 0" }
  if (-not (Test-Integer $probe.expectedExitCode)) { $problems += New-Problem 'EVIDENCE_PROBE_EXPECTED' "$label expectedExitCode must be an integer" }
  elseif ([int]$probe.expectedExitCode -ne 0) { $problems += New-Problem 'EVIDENCE_PROBE_EXPECTED' "$label expectedExitCode must be 0" }
  if ((Test-Integer $probe.exitCode) -and (Test-Integer $probe.expectedExitCode) -and [int]$probe.exitCode -ne [int]$probe.expectedExitCode) {
    $problems += New-Problem 'EVIDENCE_PROBE_EXIT' "$label exitCode != expectedExitCode"
  }
  if ([string]::IsNullOrEmpty([string]$probe.observed)) { $problems += New-Problem 'EVIDENCE_PROBE_OBSERVED' "$label observed is empty" }
  if ([string]$probe.logSha256 -notmatch '^[0-9a-f]{64}$') { $problems += New-Problem 'EVIDENCE_LOG_HASH' "$label logSha256 invalid" }
  $logFile = Resolve-UnderRoot -Root $evidenceDir -Relative ([string]$probe.logPath)
  if ($null -eq $logFile) { $problems += New-Problem 'EVIDENCE_LOG_PATH' "$label logPath is absolute or escapes outgoing" }
  elseif (-not (Test-Path -LiteralPath $logFile)) { $problems += New-Problem 'EVIDENCE_LOG_PATH' "$label log file missing" }
  elseif ((Get-Item -LiteralPath $logFile).Length -le 0) { $problems += New-Problem 'EVIDENCE_LOG_EMPTY' "$label log file is empty" }
  elseif ((Get-Sha256Hex $logFile) -ne [string]$probe.logSha256) { $problems += New-Problem 'EVIDENCE_LOG_HASH' "$label log hash mismatch" }
}
foreach ($expectedId in 1..10) {
  if (-not $seenIds.ContainsKey($expectedId)) { $problems += New-Problem 'EVIDENCE_PROBE_MISSING' "probe id $expectedId is missing" }
}

if ($problems.Count -gt 0) {
  $summary = ($problems | ForEach-Object { "$($_.code): $($_.message)" }) -join ' ; '
  Exit-With 1 $summary
}
Exit-With 0 'evidence and orchestration are valid and fully bound'
