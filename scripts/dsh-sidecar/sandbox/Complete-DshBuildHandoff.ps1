# Complete-DshBuildHandoff.ps1 -- the only build -> probe handoff entry.
#
# Usage (host):
#   powershell -NoProfile -File scripts/dsh-sidecar/sandbox/Complete-DshBuildHandoff.ps1 `
#     -BuildDir <taskroot>\build\<buildId> -ProbeDir <taskroot>\probe\<probeId>
#
# Contract (DEV DOC v6 SS5.2 / v7 SSC / v8 SS1-SS2):
#   - Validate the build orchestration is DESTROYED with both sentinels/hashes bound, the build
#     input-manifest fully hash-verified, build-result.json (additionalProperties=false) all
#     green, and runtime-bundle.zip byte-identical to orchestration.runtimeBundleSha256.
#   - Validate probe/staging contains only the probe entry script whose sha256 equals the build
#     input-manifest entryScripts.probe.sha256.
#   - Refuse (exit 2) when probe incoming already exists/non-empty, ProbeDir is not empty,
#     handoff already happened, or any hash/binding differs. Nothing is started here.
#   - Create incoming.tmp-<probeId>, copy only the staged probe entry script + runtime-bundle.zip,
#     write the probe input-manifest (nonce left empty for New-DshSandboxConfig to fill),
#     atomically rename to incoming, then write handoff.json.
#   - exit 0 = handoff complete; exit 2 = refused or verification failed (scene preserved).

param(
  [Parameter(Mandatory = $true)][string]$BuildDir,
  [Parameter(Mandatory = $true)][string]$ProbeDir
)

$ErrorActionPreference = 'Stop'

$Issue = 1411

function Fail([string]$code, [string]$message, [int]$exitCode = 2) {
  Write-Output ([ordered]@{ ok = $false; code = $code; message = $message } | ConvertTo-Json -Compress -Depth 6)
  exit $exitCode
}

function Get-Sha256Hex([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
}

function Write-JsonFile([string]$Path, $Value) {
  $temp = "$Path.tmp-$([guid]::NewGuid().ToString('N'))"
  $json = $Value | ConvertTo-Json -Depth 12
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($temp, $json, $utf8NoBom)
  Move-Item -LiteralPath $temp -Destination $Path -Force
}

function Get-KeyList($Object) {
  return @($Object.PSObject.Properties.Name)
}

function Assert-ExactKeys($Object, [string[]]$Expected, [string]$Label) {
  $actual = Get-KeyList $Object
  $missing = @($Expected | Where-Object { $actual -notcontains $_ })
  $extra = @($actual | Where-Object { $Expected -notcontains $_ })
  if ($missing.Count -gt 0 -or $extra.Count -gt 0) {
    Fail 'JSON_SHAPE' ("{0} keys mismatch (missing: {1}; extra: {2})" -f $Label, ($missing -join ','), ($extra -join ',')) 2
  }
}

function Resolve-TaskRelative([string]$TaskRoot, [string]$Relative, [string]$Label) {
  if ($Relative -match '(^/|^\\|^[A-Za-z]:|\.\.)') { Fail 'HANDOFF_BAD_PATH' "$Label must be a safe relative path: $Relative" 2 }
  $full = [System.IO.Path]::GetFullPath((Join-Path $TaskRoot ($Relative -replace '/', '\')))
  $rootFull = [System.IO.Path]::GetFullPath($TaskRoot).TrimEnd('\')
  if (-not $full.StartsWith($rootFull + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    Fail 'HANDOFF_BAD_PATH' "$Label escapes the task root: $Relative" 2
  }
  return $full
}

# -- 1. paths ----------------------------------------------------------------
if ($BuildDir -notmatch '^[A-Za-z]:\\') { Fail 'HANDOFF_BAD_BUILD_DIR' "BuildDir must be absolute: $BuildDir" 2 }
if ($ProbeDir -notmatch '^[A-Za-z]:\\') { Fail 'HANDOFF_BAD_PROBE_DIR' "ProbeDir must be absolute: $ProbeDir" 2 }
$buildDirFull = [System.IO.Path]::GetFullPath($BuildDir).TrimEnd('\')
$probeDirFull = [System.IO.Path]::GetFullPath($ProbeDir).TrimEnd('\')
$buildLeaf = Split-Path -Leaf $buildDirFull
$probeLeaf = Split-Path -Leaf $probeDirFull
$buildParent = Split-Path -Parent $buildDirFull
$probeParent = Split-Path -Parent $probeDirFull
if ((Split-Path -Leaf $buildParent) -ne 'build') { Fail 'HANDOFF_BAD_BUILD_DIR' "BuildDir must be <taskroot>/build/<id>: $buildDirFull" 2 }
if ((Split-Path -Leaf $probeParent) -ne 'probe') { Fail 'HANDOFF_BAD_PROBE_DIR' "ProbeDir must be <taskroot>/probe/<id>: $probeDirFull" 2 }
if ($probeLeaf -eq 'staging') { Fail 'HANDOFF_BAD_PROBE_DIR' 'ProbeDir must not be the staging directory' 2 }
$taskRoot = Split-Path -Parent $buildParent
if (([System.IO.Path]::GetFullPath((Split-Path -Parent $probeParent))).TrimEnd('\') -ne ([System.IO.Path]::GetFullPath($taskRoot)).TrimEnd('\')) {
  Fail 'HANDOFF_TASK_ROOT' "BuildDir and ProbeDir must share one task root" 2
}
$guidValue = [guid]::Empty
if (-not [guid]::TryParse($buildLeaf, [ref]$guidValue)) { Fail 'HANDOFF_BAD_BUILD_DIR' "build id must be a GUID: $buildLeaf" 2 }
$guidValue = [guid]::Empty
if (-not [guid]::TryParse($probeLeaf, [ref]$guidValue)) { Fail 'HANDOFF_BAD_PROBE_DIR' "probe id must be a GUID: $probeLeaf" 2 }

$incoming = Join-Path $buildDirFull 'incoming'
$outgoing = Join-Path $buildDirFull 'outgoing'
$orchestrationPath = Join-Path $buildDirFull 'orchestration.json'
$manifestPath = Join-Path $incoming 'input-manifest.json'
$configPath = Join-Path $buildDirFull 'build.wsb'
foreach ($path in @($incoming, $outgoing, $orchestrationPath, $manifestPath, $configPath)) {
  if (-not (Test-Path -LiteralPath $path)) { Fail 'HANDOFF_BUILD_INCOMPLETE' "missing build artifact: $path" 2 }
}

# -- 2. build orchestration: DESTROYED with bound sentinels -------------------
$orchestration = Get-Content -LiteralPath $orchestrationPath -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-ExactKeys $orchestration @(
  'schemaVersion', 'issue', 'mode', 'baseSha', 'codeSha', 'codeArchivePath', 'codeArchiveSha256',
  'sandboxId', 'nonce', 'configSha256', 'inputManifestSha256', 'runtimeBundleSha256', 'state',
  'hostPid', 'hostProcessStartTime', 'startedAt', 'finishedAt', 'destroyedAt', 'scriptExitCode',
  'hostExitCode', 'startedSentinel', 'finishedSentinel', 'handoff'
) 'orchestration.json'
if ([int]$orchestration.schemaVersion -ne 1) { Fail 'HANDOFF_ORCHESTRATION' 'orchestration.schemaVersion must be 1' 2 }
if ([int]$orchestration.issue -ne $Issue) { Fail 'HANDOFF_ORCHESTRATION' "orchestration.issue must be $Issue" 2 }
if ([string]$orchestration.mode -ne 'build') { Fail 'HANDOFF_ORCHESTRATION' 'build orchestration.mode must be build' 2 }
if ([string]$orchestration.sandboxId -ne $buildLeaf) { Fail 'HANDOFF_ORCHESTRATION' 'build orchestration.sandboxId must equal the build dir name' 2 }
if ([string]$orchestration.state -ne 'DESTROYED') { Fail 'HANDOFF_NOT_DESTROYED' "build orchestration.state=$($orchestration.state), expected DESTROYED" 2 }
if ($null -eq $orchestration.destroyedAt -or [string]::IsNullOrEmpty([string]$orchestration.destroyedAt)) { Fail 'HANDOFF_NOT_DESTROYED' 'build orchestration.destroyedAt is empty' 2 }
if ([int]$orchestration.scriptExitCode -ne 0) { Fail 'HANDOFF_BUILD_SCRIPT' "build orchestration.scriptExitCode=$($orchestration.scriptExitCode), expected 0" 2 }
if ([int]$orchestration.hostExitCode -ne 0) { Fail 'HANDOFF_BUILD_HOST' "build orchestration.hostExitCode=$($orchestration.hostExitCode), expected 0" 2 }
if ($null -ne $orchestration.handoff) { Fail 'HANDOFF_BUILD_HANDOFF' 'build orchestration.handoff must be null' 2 }
foreach ($key in @('baseSha', 'codeSha', 'nonce', 'configSha256', 'inputManifestSha256', 'runtimeBundleSha256')) {
  if ([string]::IsNullOrEmpty([string]$orchestration.$key)) { Fail 'HANDOFF_ORCHESTRATION' "orchestration.$key is empty" 2 }
}
if ((Get-Sha256Hex $configPath) -ne [string]$orchestration.configSha256) { Fail 'HANDOFF_CONFIG_HASH' 'build config hash does not match orchestration.configSha256' 2 }
if ((Get-Sha256Hex $manifestPath) -ne [string]$orchestration.inputManifestSha256) { Fail 'HANDOFF_MANIFEST_HASH' 'build input-manifest hash does not match orchestration.inputManifestSha256' 2 }

foreach ($sentinelName in @('startedSentinel', 'finishedSentinel')) {
  $sentinel = $orchestration.$sentinelName
  if ($null -eq $sentinel) { Fail 'HANDOFF_SENTINEL' "orchestration.$sentinelName is empty" 2 }
  Assert-ExactKeys $sentinel @('path', 'sha256') "orchestration.$sentinelName"
  $sentinelPath = Resolve-TaskRelative -TaskRoot $taskRoot -Relative ([string]$sentinel.path) -Label "orchestration.$sentinelName.path"
  if (-not (Test-Path -LiteralPath $sentinelPath)) { Fail 'HANDOFF_SENTINEL' "sentinel file missing: $sentinelPath" 2 }
  if ((Get-Sha256Hex $sentinelPath) -ne [string]$sentinel.sha256) { Fail 'HANDOFF_SENTINEL' "sentinel hash mismatch: $sentinelPath" 2 }
}

# -- 3. build input-manifest and its files ------------------------------------
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([int]$manifest.schemaVersion -ne 1) { Fail 'HANDOFF_MANIFEST' 'input-manifest.schemaVersion must be 1' 2 }
if ([string]$manifest.mode -ne 'build') { Fail 'HANDOFF_MANIFEST' 'input-manifest.mode must be build' 2 }
if ([string]$manifest.sandboxId -ne $buildLeaf) { Fail 'HANDOFF_MANIFEST' 'input-manifest.sandboxId must equal the build dir name' 2 }
if ([string]$manifest.nonce -ne [string]$orchestration.nonce) { Fail 'HANDOFF_MANIFEST' 'input-manifest.nonce does not match orchestration.nonce' 2 }
if ([string]$manifest.codeSha -ne [string]$orchestration.codeSha) { Fail 'HANDOFF_MANIFEST' 'input-manifest.codeSha does not match orchestration.codeSha' 2 }
if ([string]$manifest.codeArchiveSha256 -ne [string]$orchestration.codeArchiveSha256) { Fail 'HANDOFF_MANIFEST' 'input-manifest.codeArchiveSha256 does not match orchestration' 2 }
if (-not ($manifest.entryScripts.probe)) { Fail 'HANDOFF_MANIFEST' 'input-manifest.entryScripts.probe is missing' 2 }
$probeEntryRelative = [string]$manifest.entryScripts.probe.path
if ($probeEntryRelative -ne 'scripts/Invoke-DshSandboxProbe.ps1') { Fail 'HANDOFF_MANIFEST' "probe entry must be scripts/Invoke-DshSandboxProbe.ps1 (actual: $probeEntryRelative)" 2 }
$probeEntrySha256 = [string]$manifest.entryScripts.probe.sha256
if ($probeEntrySha256 -notmatch '^[0-9a-f]{64}$') { Fail 'HANDOFF_MANIFEST' 'input-manifest.entryScripts.probe.sha256 is invalid' 2 }
$manifestFiles = @($manifest.files)
if ($manifestFiles.Count -eq 0) { Fail 'HANDOFF_MANIFEST' 'input-manifest.files is empty' 2 }
foreach ($entry in $manifestFiles) {
  $relative = [string]$entry.path
  $target = Resolve-TaskRelative -TaskRoot $incoming -Relative $relative -Label 'manifest file'
  if (-not (Test-Path -LiteralPath $target)) { Fail 'HANDOFF_MANIFEST' "manifest file missing: $relative" 2 }
  if ((Get-Sha256Hex $target) -ne [string]$entry.sha256) { Fail 'HANDOFF_MANIFEST' "manifest file hash mismatch: $relative" 2 }
}

# -- 4. build-result.json (additionalProperties=false) ------------------------
$buildResultPath = Join-Path (Join-Path $outgoing 'build-evidence') 'build-result.json'
if (-not (Test-Path -LiteralPath $buildResultPath)) { Fail 'HANDOFF_BUILD_RESULT_MISSING' "missing $buildResultPath" 2 }
$buildResult = Get-Content -LiteralPath $buildResultPath -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-ExactKeys $buildResult @('schemaVersion', 'issue', 'codeSha', 'codeArchiveSha256', 'tests', 'lint') 'build-result.json'
if ([int]$buildResult.schemaVersion -ne 1) { Fail 'HANDOFF_BUILD_RESULT' 'build-result.schemaVersion must be 1' 2 }
if ([int]$buildResult.issue -ne $Issue) { Fail 'HANDOFF_BUILD_RESULT' "build-result.issue must be $Issue" 2 }
if ([string]$buildResult.codeSha -ne [string]$orchestration.codeSha) { Fail 'HANDOFF_BUILD_RESULT' 'build-result.codeSha does not match orchestration' 2 }
if ([string]$buildResult.codeArchiveSha256 -ne [string]$orchestration.codeArchiveSha256) { Fail 'HANDOFF_BUILD_RESULT' 'build-result.codeArchiveSha256 does not match orchestration' 2 }
Assert-ExactKeys $buildResult.tests @('command', 'exitCode', 'total', 'passed', 'failed', 'logPath', 'logSha256') 'build-result.tests'
Assert-ExactKeys $buildResult.lint @('command', 'exitCode', 'logPath', 'logSha256') 'build-result.lint'
if ([int]$buildResult.tests.exitCode -ne 0) { Fail 'HANDOFF_TESTS_RED' "tests.exitCode=$($buildResult.tests.exitCode), expected 0" 2 }
$testTotal = [long]$buildResult.tests.total
$testPassed = [long]$buildResult.tests.passed
$testFailed = [long]$buildResult.tests.failed
if ($testTotal -le 0 -or $testPassed -le 0) { Fail 'HANDOFF_TESTS_EMPTY' "tests total/passed must be positive (total=$testTotal passed=$testPassed)" 2 }
if ($testPassed -ne $testTotal) { Fail 'HANDOFF_TESTS_RED' "tests passed=$testPassed != total=$testTotal" 2 }
if ($testFailed -ne 0) { Fail 'HANDOFF_TESTS_RED' "tests failed=$testFailed, expected 0" 2 }
if ([int]$buildResult.lint.exitCode -ne 0) { Fail 'HANDOFF_LINT_RED' "lint.exitCode=$($buildResult.lint.exitCode), expected 0" 2 }
foreach ($logRecord in @(@{ label = 'tests'; entry = $buildResult.tests }, @{ label = 'lint'; entry = $buildResult.lint })) {
  $logRelative = [string]$logRecord.entry.logPath
  $logTarget = Resolve-TaskRelative -TaskRoot $outgoing -Relative $logRelative -Label "$($logRecord.label).logPath"
  if (-not (Test-Path -LiteralPath $logTarget)) { Fail 'HANDOFF_LOG_MISSING' "$($logRecord.label) log missing: $logRelative" 2 }
  if ((Get-Item -LiteralPath $logTarget).Length -le 0) { Fail 'HANDOFF_LOG_EMPTY' "$($logRecord.label) log is empty: $logRelative" 2 }
  if ((Get-Sha256Hex $logTarget) -ne [string]$logRecord.entry.logSha256) { Fail 'HANDOFF_LOG_HASH' "$($logRecord.label) log hash mismatch: $logRelative" 2 }
}

# -- 5. runtime bundle + staging entry ----------------------------------------
$bundlePath = Join-Path $outgoing 'runtime-bundle.zip'
if (-not (Test-Path -LiteralPath $bundlePath)) { Fail 'HANDOFF_BUNDLE_MISSING' "missing $bundlePath" 2 }
if ((Get-Sha256Hex $bundlePath) -ne [string]$orchestration.runtimeBundleSha256) { Fail 'HANDOFF_BUNDLE_HASH' 'runtime-bundle.zip does not match orchestration.runtimeBundleSha256' 2 }

$stagingDir = Join-Path (Join-Path $taskRoot 'probe') 'staging'
$stagingEntry = Join-Path $stagingDir 'Invoke-DshSandboxProbe.ps1'
if (-not (Test-Path -LiteralPath $stagingEntry)) { Fail 'HANDOFF_STAGING_MISSING' "missing staged probe entry: $stagingEntry" 2 }
$stagingItems = @(Get-ChildItem -LiteralPath $stagingDir -Force -Recurse)
foreach ($item in $stagingItems) {
  if ($item.PSIsContainer) { Fail 'HANDOFF_STAGING_EXTRA' "staging must not contain directories: $($item.FullName)" 2 }
  $leaf = $item.Name
  if ($item.FullName -ne $stagingEntry) { Fail 'HANDOFF_STAGING_EXTRA' "staging contains a file other than the probe entry: $leaf" 2 }
}
if ((Get-Sha256Hex $stagingEntry) -ne $probeEntrySha256) { Fail 'HANDOFF_STAGING_HASH' 'staged probe entry hash does not match build input-manifest entryScripts.probe.sha256' 2 }

# -- 6. refuse repeated / non-empty probe input -------------------------------
if (Test-Path -LiteralPath $probeDirFull) {
  $probeItems = @(Get-ChildItem -LiteralPath $probeDirFull -Force)
  if ($probeItems.Count -gt 0) { Fail 'HANDOFF_PROBE_DIR_NOT_EMPTY' "ProbeDir must be absent or empty: $probeDirFull" 2 }
} else {
  New-Item -ItemType Directory -Path $probeDirFull -Force | Out-Null
}
$probeIncoming = Join-Path $probeDirFull 'incoming'
if (Test-Path -LiteralPath $probeIncoming) { Fail 'HANDOFF_PROBE_INCOMING_NOT_EMPTY' "probe incoming already exists: $probeIncoming" 2 }
if (Test-Path -LiteralPath (Join-Path $probeDirFull 'handoff.json')) { Fail 'HANDOFF_REPEATED' 'handoff.json already exists in ProbeDir' 2 }

$tempIncoming = Join-Path $probeDirFull "incoming.tmp-$probeLeaf"
if (Test-Path -LiteralPath $tempIncoming) { Fail 'HANDOFF_TEMP_RESIDUAL' "temporary incoming already exists: $tempIncoming" 2 }
New-Item -ItemType Directory -Path (Join-Path $tempIncoming 'scripts') -Force | Out-Null

# -- 7. copy only the probe entry + bundle, then verify ----------------------
$destEntryRelative = 'scripts/Invoke-DshSandboxProbe.ps1'
$destEntry = Join-Path $tempIncoming ($destEntryRelative -replace '/', '\')
Copy-Item -LiteralPath $stagingEntry -Destination $destEntry -Force
$destBundle = Join-Path $tempIncoming 'runtime-bundle.zip'
Copy-Item -LiteralPath $bundlePath -Destination $destBundle -Force
$entrySha256 = Get-Sha256Hex $destEntry
$bundleOutSha256 = Get-Sha256Hex $destBundle
if ($entrySha256 -ne $probeEntrySha256) { Fail 'HANDOFF_COPY_HASH' "destination entry sha256=$entrySha256, expected $probeEntrySha256" 2 }
if ($bundleOutSha256 -ne [string]$orchestration.runtimeBundleSha256) { Fail 'HANDOFF_COPY_HASH' "destination bundle sha256=$bundleOutSha256" 2 }

$probeManifest = [ordered]@{
  schemaVersion = 1
  issue = $Issue
  mode = 'probe'
  sandboxId = $probeLeaf
  nonce = ''
  baseSha = [string]$orchestration.baseSha
  codeSha = [string]$orchestration.codeSha
  codeArchivePath = [string]$orchestration.codeArchivePath
  codeArchiveSha256 = [string]$orchestration.codeArchiveSha256
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  entryScript = [ordered]@{ path = $destEntryRelative; sha256 = $entrySha256 }
  files = @(
    [ordered]@{ path = $destEntryRelative; bytes = (Get-Item -LiteralPath $destEntry).Length; sha256 = $entrySha256 },
    [ordered]@{ path = 'runtime-bundle.zip'; bytes = (Get-Item -LiteralPath $destBundle).Length; sha256 = $bundleOutSha256 }
  )
}
Write-JsonFile -Path (Join-Path $tempIncoming 'input-manifest.json') -Value $probeManifest

Move-Item -LiteralPath $tempIncoming -Destination $probeIncoming
if (-not (Test-Path -LiteralPath $probeIncoming)) { Fail 'HANDOFF_RENAME_FAILED' "atomic rename failed: $tempIncoming -> $probeIncoming" 2 }
$probeManifestPath = Join-Path $probeIncoming 'input-manifest.json'
$probeManifestSha256 = Get-Sha256Hex $probeManifestPath

$handoff = [ordered]@{
  schemaVersion = 1
  issue = $Issue
  buildId = $buildLeaf
  probeId = $probeLeaf
  codeSha = [string]$orchestration.codeSha
  codeArchivePath = [string]$orchestration.codeArchivePath
  codeArchiveSha256 = [string]$orchestration.codeArchiveSha256
  runtimeBundleSha256 = [string]$orchestration.runtimeBundleSha256
  entryScriptPath = $destEntryRelative
  entryScriptSha256 = $entrySha256
  sourceBundlePath = $bundlePath
  destinationBundlePath = $destBundle
  probeIncoming = $probeIncoming
  inputManifestSha256 = $probeManifestSha256
  sourceSha256 = [string]$orchestration.runtimeBundleSha256
  destinationSha256 = $bundleOutSha256
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
}
Write-JsonFile -Path (Join-Path $probeDirFull 'handoff.json') -Value $handoff

Write-Output ([ordered]@{
  ok = $true
  code = 'HANDOFF_OK'
  buildId = $buildLeaf
  probeId = $probeLeaf
  probeIncoming = $probeIncoming
  runtimeBundleSha256 = $bundleOutSha256
  entryScriptSha256 = $entrySha256
  inputManifestSha256 = $probeManifestSha256
} | ConvertTo-Json -Compress -Depth 6)
exit 0
