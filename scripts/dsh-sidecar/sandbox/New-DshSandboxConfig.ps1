# New-DshSandboxConfig.ps1 -- generate the .wsb config + initial orchestration for one run.
#
# Usage (host):
#   powershell -NoProfile -File scripts/dsh-sidecar/sandbox/New-DshSandboxConfig.ps1 `
#     -Mode Build|Probe -TaskRoot <root> [-SandboxId <guid>]
#
# Contract:
#   - The run directory is discovered from the task root: build/<id> written by Fetch, or
#     probe/<id> written by Complete-DshBuildHandoff. Exactly one unconfigured run dir may exist.
#   - Refuses (exit 2) on: reparse points/junctions anywhere in the run dir, paths escaping the
#     run dir, cross-mode files, forbidden names (.env/token/secret/credential/keys), extra
#     files outside the mode allow-list, any file whose sha256 differs from input-manifest,
#     empty file set, hardlinked files (fsutil must report exactly one path).
#   - Generates exactly two MappedFolders (incoming ReadOnly=true, outgoing ReadOnly=false),
#     Clipboard/AudioInput/VideoInput/PrinterRedirection/vGPU disabled, ProtectedClient enabled,
#     Networking enabled only for Build. Writes <mode>.wsb next to orchestration.json and a
#     byte-identical copy at incoming/config/<mode>.wsb, then adds it to input-manifest.
#   - Writes orchestration.json in state PREPARED with configSha256/inputManifestSha256/nonce.
#   - exit 0 = configured; exit 1 = hash/manifest mismatch; exit 2 = refused/unsafe input.

param(
  [Parameter(Mandatory = $true)][ValidateSet('Build', 'Probe')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$TaskRoot,
  [string]$SandboxId = ''
)

$ErrorActionPreference = 'Stop'

$Issue = 1411
$ModeLower = $Mode.ToLower()
$EntryByMode = @{ build = 'Invoke-DshSandboxBuild.ps1'; probe = 'Invoke-DshSandboxProbe.ps1' }
$EntryRelativeByMode = @{ build = 'scripts/Invoke-DshSandboxBuild.ps1'; probe = 'scripts/Invoke-DshSandboxProbe.ps1' }

function Fail([string]$code, [string]$message, [int]$exitCode = 2) {
  Write-Output ([ordered]@{ ok = $false; code = $code; message = $message } | ConvertTo-Json -Compress -Depth 6)
  exit $exitCode
}

function Get-Sha256Hex([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
}

function Write-JsonAtomic([string]$Path, $Value) {
  $temp = "$Path.tmp-$([guid]::NewGuid().ToString('N'))"
  $json = $Value | ConvertTo-Json -Depth 12
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($temp, $json, $utf8NoBom)
  Move-Item -LiteralPath $temp -Destination $Path -Force
}

function Assert-NoReparse([string]$Root, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Root)) { Fail 'MISSING_DIRECTORY' "$Label missing: $Root" 2 }
  $rootItem = Get-Item -LiteralPath $Root -Force
  if ($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { Fail 'REPARSE_POINT' "$Label root is a reparse point: $Root" 2 }
  foreach ($item in @(Get-ChildItem -LiteralPath $Root -Recurse -Force)) {
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { Fail 'REPARSE_POINT' "$Label contains a reparse point: $($item.FullName)" 2 }
  }
}

function Assert-PathInside([string]$Path, [string]$Root, [string]$Label) {
  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
  $pathFull = [System.IO.Path]::GetFullPath($Path)
  if (-not $pathFull.StartsWith($rootFull + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    Fail 'PATH_ESCAPES_RUN_DIR' "$Label escapes the run directory: $pathFull" 2
  }
  return $pathFull
}

function Assert-SingleHardlink([string]$Path) {
  $out = & fsutil hardlink list $Path 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Fail 'HARDLINK_CHECK_FAILED' "fsutil hardlink list failed for $Path" 2 }
  $paths = @($out -split "`r?`n" | Where-Object { $_.Trim() -ne '' })
  if ($paths.Count -ne 1) { Fail 'HARDLINK_MULTIPLE' "$Path is linked to $($paths.Count) paths (exactly one required)" 2 }
}

function Test-ForbiddenName([string]$RelativePath) {
  $leaf = ($RelativePath -split '/')[-1]
  if ($leaf -match '(?i)^\.env' -or $leaf -match '(?i)token|secret|credential' -or $leaf -match '(?i)\.(pem|key|pfx|p12)$' -or $leaf -match '(?i)^id_(rsa|dsa|ecdsa|ed25519)') { return $true }
  return $false
}

function Get-ExpectedFiles([string]$ModeLower, [string]$CodeSha) {
  if ($ModeLower -eq 'build') {
    return @(
      'scripts/Invoke-DshSandboxBuild.ps1',
      "synova-$CodeSha.zip",
      'dsh-0.2.2-rc.5.tgz',
      'dsh-0.2.2-rc.2.tgz',
      'node-v24.21.0-win-x64.zip',
      'input-manifest.json',
      'config/build.wsb'
    )
  }
  return @(
    'scripts/Invoke-DshSandboxProbe.ps1',
    'runtime-bundle.zip',
    'input-manifest.json',
    'config/probe.wsb'
  )
}

# -- 1. locate the single unconfigured run directory --------------------------
if ($TaskRoot -notmatch '^[A-Za-z]:\\') { Fail 'BAD_TASK_ROOT' "TaskRoot must be an absolute path: $TaskRoot" 2 }
$taskRootFull = [System.IO.Path]::GetFullPath($TaskRoot).TrimEnd('\')
$modeRoot = Join-Path $taskRootFull $ModeLower
if (-not (Test-Path -LiteralPath $modeRoot)) { Fail 'MODE_ROOT_MISSING' "Missing mode root: $modeRoot" 2 }

$candidates = @()
foreach ($dir in @(Get-ChildItem -LiteralPath $modeRoot -Directory -Force -ErrorAction SilentlyContinue)) {
  if ($dir.Name -eq 'staging') { continue }
  $candidateManifest = Join-Path (Join-Path $dir.FullName 'incoming') 'input-manifest.json'
  if (-not (Test-Path -LiteralPath $candidateManifest)) { continue }
  if (Test-Path -LiteralPath (Join-Path $dir.FullName 'orchestration.json')) { continue }
  $candidates += $dir
}
if ($candidates.Count -ne 1) {
  Fail 'RUN_DIR_NOT_UNIQUE' ("expected exactly one unconfigured {0} run dir, found {1}" -f $ModeLower, $candidates.Count) 2
}
$runDir = $candidates[0].FullName
if ($SandboxId -ne '') {
  $parsedGuid = [guid]::Empty
  if (-not [guid]::TryParse($SandboxId, [ref]$parsedGuid)) { Fail 'BAD_SANDBOX_ID' "SandboxId is not a GUID: $SandboxId" 2 }
  if ((Split-Path -Leaf $runDir) -ne $SandboxId) { Fail 'SANDBOX_ID_MISMATCH' "run dir name does not match -SandboxId: $runDir" 2 }
}
$sandboxId = Split-Path -Leaf $runDir
$incoming = Join-Path $runDir 'incoming'
$outgoing = Join-Path $runDir 'outgoing'

# -- 2. safety: reparse points, manifest, allow-list, hardlinks ---------------
Assert-NoReparse -Root $incoming -Label "incoming"
Assert-NoReparse -Root $outgoing -Label "outgoing"
$manifestPath = Join-Path $incoming 'input-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { Fail 'MANIFEST_MISSING' "missing input-manifest: $manifestPath" 2 }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1) { Fail 'MANIFEST_SCHEMA' "input-manifest.schemaVersion must be 1" 2 }
if ($manifest.issue -ne $Issue) { Fail 'MANIFEST_ISSUE' "input-manifest.issue must be $Issue" 2 }
if ([string]$manifest.mode -ne $ModeLower) { Fail 'MANIFEST_MODE' "input-manifest.mode=$($manifest.mode), expected $ModeLower" 2 }
if ([string]$manifest.sandboxId -ne $sandboxId) { Fail 'MANIFEST_SANDBOX_ID' "input-manifest.sandboxId mismatch" 2 }
if ([string]$manifest.codeSha -notmatch '^[0-9a-f]{40}$') { Fail 'MANIFEST_CODE_SHA' "input-manifest.codeSha invalid" 2 }
if ([string]$manifest.baseSha -notmatch '^[0-9a-f]{40}$') { Fail 'MANIFEST_BASE_SHA' "input-manifest.baseSha invalid" 2 }
if ([string]$manifest.codeArchivePath -notmatch '^synova-[0-9a-f]{40}\.zip$') { Fail 'MANIFEST_CODE_ARCHIVE' "input-manifest.codeArchivePath invalid" 2 }
if ([string]$manifest.codeArchiveSha256 -notmatch '^[0-9a-f]{64}$') { Fail 'MANIFEST_CODE_ARCHIVE_HASH' "input-manifest.codeArchiveSha256 invalid" 2 }
if ([string]$manifest.entryScript.path -ne $EntryRelativeByMode[$ModeLower]) { Fail 'MANIFEST_ENTRY' "input-manifest.entryScript.path must be $($EntryRelativeByMode[$ModeLower])" 2 }

$files = @($manifest.files)
if ($files.Count -eq 0) { Fail 'EMPTY_FILE_SET' "input-manifest.files must not be empty" 2 }

$expected = Get-ExpectedFiles -ModeLower $ModeLower -CodeSha ([string]$manifest.codeSha)
$seen = @{}
foreach ($entry in $files) {
  $relative = [string]$entry.path
  if ($relative -match '(^/|^\\|\.\.)' ) { Fail 'MANIFEST_PATH_ESCAPE' "input-manifest path must be a safe relative path: $relative" 2 }
  if ($seen.ContainsKey($relative)) { Fail 'MANIFEST_DUPLICATE' "duplicate input-manifest file: $relative" 2 }
  $seen[$relative] = $true
  if (Test-ForbiddenName $relative) { Fail 'FORBIDDEN_FILE' "forbidden input file name: $relative" 2 }
  if (-not ($expected -contains $relative)) { Fail 'FILE_NOT_ALLOWED' "file is outside the $ModeLower allow-list: $relative" 2 }
  $target = Join-Path $incoming ($relative -replace '/', '\')
  Assert-PathInside -Path $target -Root $incoming -Label "manifest file" | Out-Null
  if (-not (Test-Path -LiteralPath $target)) { Fail 'MANIFEST_FILE_MISSING' "manifest file missing on disk: $relative" 2 }
  $actualHash = Get-Sha256Hex $target
  if ($actualHash -ne [string]$entry.sha256) { Fail 'MANIFEST_FILE_HASH_MISMATCH' "sha256 mismatch: $relative" 2 }
  $actualBytes = (Get-Item -LiteralPath $target).Length
  if ($actualBytes -ne [long]$entry.bytes) { Fail 'MANIFEST_FILE_BYTES_MISMATCH' "byte length mismatch: $relative" 2 }
}

$actualFiles = @(Get-ChildItem -LiteralPath $incoming -Recurse -File -Force | ForEach-Object {
    $_.FullName.Substring($incoming.Length + 1).Replace('\', '/')
  })
$ownConfigCopy = "config/$ModeLower.wsb"
foreach ($relative in $actualFiles) {
  if ($relative -eq 'input-manifest.json') { continue }
  if (-not ($seen.ContainsKey($relative)) -and $relative -ne $ownConfigCopy) {
    Fail 'EXTRA_FILE_PRESENT' "incoming contains a file that is not listed in input-manifest: $relative" 2
  }
}
foreach ($relative in $actualFiles) { Assert-SingleHardlink (Join-Path $incoming ($relative -replace '/', '\')) }

# -- 3. nonce + .wsb ----------------------------------------------------------
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$nonceBytes = New-Object byte[] 16
$random.GetBytes($nonceBytes)
$nonce = (($nonceBytes | ForEach-Object { $_.ToString('x2') }) -join '')

$networking = if ($ModeLower -eq 'build') { 'Enable' } else { 'Disable' }
$logon = 'cmd /c set "SYNOVA_SANDBOX_ID=' + $sandboxId + '" &amp;&amp; set "SYNOVA_SANDBOX_NONCE=' + $nonce +
  '" &amp;&amp; powershell -NoProfile -ExecutionPolicy Bypass -File C:\SynovaLab\incoming\scripts\' +
  $EntryByMode[$ModeLower] + ' -Mode ' + $Mode + ' -SandboxId ' + $sandboxId + ' -Nonce ' + $nonce

$wsbPath = Join-Path $runDir "$ModeLower.wsb"
$wsbContent = @"
<Configuration>
  <Networking>$networking</Networking>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <PrinterRedirection>Disable</PrinterRedirection>
  <vGPU>Disable</vGPU>
  <ProtectedClient>Enable</ProtectedClient>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>$incoming</HostFolder>
      <SandboxFolder>C:\SynovaLab\incoming</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>$outgoing</HostFolder>
      <SandboxFolder>C:\SynovaLab\outgoing</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>$logon</Command>
  </LogonCommand>
</Configuration>
"@
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($wsbPath, $wsbContent, $utf8NoBom)

# Re-parse the config we just wrote and re-assert the frozen posture.
$wsbXml = [xml](Get-Content -LiteralPath $wsbPath -Raw -Encoding UTF8)
if (@($wsbXml.Configuration.MappedFolders.MappedFolder).Count -ne 2) { Fail 'WSB_MAPPING_COUNT' "config must have exactly two MappedFolders" 2 }
if ([string]$wsbXml.Configuration.Networking -ne $networking) { Fail 'WSB_NETWORKING' "config Networking must be $networking for $ModeLower" 2 }
if ([string]$wsbXml.Configuration.ClipboardRedirection -ne 'Disable') { Fail 'WSB_SECURITY' 'ClipboardRedirection must be Disable' 2 }
if ([string]$wsbXml.Configuration.AudioInput -ne 'Disable') { Fail 'WSB_SECURITY' 'AudioInput must be Disable' 2 }
if ([string]$wsbXml.Configuration.VideoInput -ne 'Disable') { Fail 'WSB_SECURITY' 'VideoInput must be Disable' 2 }
if ([string]$wsbXml.Configuration.PrinterRedirection -ne 'Disable') { Fail 'WSB_SECURITY' 'PrinterRedirection must be Disable' 2 }
if ([string]$wsbXml.Configuration.vGPU -ne 'Disable') { Fail 'WSB_SECURITY' 'vGPU must be Disable' 2 }
if ([string]$wsbXml.Configuration.ProtectedClient -ne 'Enable') { Fail 'WSB_SECURITY' 'ProtectedClient must be Enable' 2 }
$wsbText = Get-Content -LiteralPath $wsbPath -Raw -Encoding UTF8
if ($wsbText.IndexOf('%USERPROFILE%', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
  Fail 'WSB_HOST_PATH_LEAK' 'config must not contain the %USERPROFILE% placeholder' 2
}
$profileFull = [System.IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\')
foreach ($mapped in @($wsbXml.Configuration.MappedFolders.MappedFolder)) {
  $hostFolder = [System.IO.Path]::GetFullPath([string]$mapped.HostFolder).TrimEnd('\')
  if ($hostFolder -ieq $profileFull) { Fail 'WSB_HOST_PATH_LEAK' 'config must not map the host user profile root' 2 }
  foreach ($sensitive in @('\.ssh', '\.aws', '\.git', '\.dsh', 'DeepSeek Harness', 'OneDrive', 'Dropbox', 'Google Drive', 'iCloudDrive')) {
    if ($hostFolder -match $sensitive) { Fail 'WSB_HOST_PATH_LEAK' "config must not map a sensitive/cloud directory: $hostFolder" 2 }
  }
}

$configDir = Join-Path $incoming 'config'
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
$configCopy = Join-Path $configDir "$ModeLower.wsb"
Copy-Item -LiteralPath $wsbPath -Destination $configCopy -Force

# -- 4. rewrite input-manifest with nonce + config copy ----------------------
$newFiles = @()
foreach ($entry in $files) {
  $relative = [string]$entry.path
  $target = Join-Path $incoming ($relative -replace '/', '\')
  $newFiles += [ordered]@{
    path = $relative
    bytes = (Get-Item -LiteralPath $target).Length
    sha256 = (Get-Sha256Hex $target)
  }
}
$newFiles += [ordered]@{
  path = "config/$ModeLower.wsb"
  bytes = (Get-Item -LiteralPath $configCopy).Length
  sha256 = (Get-Sha256Hex $configCopy)
}
$manifest.nonce = $nonce
$manifest.files = $newFiles
Write-JsonAtomic -Path $manifestPath -Value $manifest
$configSha256 = Get-Sha256Hex $wsbPath
$manifestSha256 = Get-Sha256Hex $manifestPath

# -- 5. orchestration (PREPARED) ---------------------------------------------
$runtimeBundleSha256 = $null
$handoffRecord = $null
if ($ModeLower -eq 'probe') {
  $handoffPath = Join-Path $runDir 'handoff.json'
  if (-not (Test-Path -LiteralPath $handoffPath)) { Fail 'HANDOFF_MISSING' "probe run requires handoff.json: $handoffPath" 2 }
  $handoff = Get-Content -LiteralPath $handoffPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $runtimeBundleSha256 = [string]$handoff.runtimeBundleSha256
  if ($runtimeBundleSha256 -notmatch '^[0-9a-f]{64}$') { Fail 'HANDOFF_BUNDLE_HASH' "handoff.runtimeBundleSha256 invalid" 2 }
  if ([string]$handoff.sourceSha256 -ne [string]$handoff.destinationSha256) { Fail 'HANDOFF_HASH_MISMATCH' 'handoff sourceSha256 != destinationSha256' 2 }
  if ([string]$handoff.sourceSha256 -ne $runtimeBundleSha256) { Fail 'HANDOFF_HASH_MISMATCH' 'handoff sourceSha256 != runtimeBundleSha256' 2 }
  $bundleTarget = Join-Path $incoming 'runtime-bundle.zip'
  if ((Get-Sha256Hex $bundleTarget) -ne $runtimeBundleSha256) { Fail 'BUNDLE_HASH_MISMATCH' "runtime-bundle.zip does not match handoff.runtimeBundleSha256" 2 }
  $handoffRecord = [ordered]@{ sourceSha256 = [string]$handoff.sourceSha256; destinationSha256 = [string]$handoff.destinationSha256 }
}

$orchestration = [ordered]@{
  schemaVersion = 1
  issue = $Issue
  mode = $ModeLower
  baseSha = [string]$manifest.baseSha
  codeSha = [string]$manifest.codeSha
  codeArchivePath = [string]$manifest.codeArchivePath
  codeArchiveSha256 = [string]$manifest.codeArchiveSha256
  sandboxId = $sandboxId
  nonce = $nonce
  configSha256 = $configSha256
  inputManifestSha256 = $manifestSha256
  runtimeBundleSha256 = $runtimeBundleSha256
  state = 'PREPARED'
  hostPid = $null
  hostProcessStartTime = $null
  startedAt = $null
  finishedAt = $null
  destroyedAt = $null
  scriptExitCode = $null
  hostExitCode = $null
  startedSentinel = $null
  finishedSentinel = $null
  handoff = $handoffRecord
}
Write-JsonAtomic -Path (Join-Path $runDir 'orchestration.json') -Value $orchestration

Write-Output ([ordered]@{
  ok = $true
  code = 'CONFIG_OK'
  mode = $ModeLower
  sandboxId = $sandboxId
  runDir = $runDir
  configPath = $wsbPath
  configSha256 = $configSha256
  inputManifestSha256 = $manifestSha256
  nonce = $nonce
} | ConvertTo-Json -Compress -Depth 6)
exit 0
