# Fetch-DshSandboxInputs.ps1 -- host-side sandbox input materialization (allow-listed only).
#
# Usage (host, T2):
#   powershell -NoProfile -File scripts/dsh-sidecar/sandbox/Fetch-DshSandboxInputs.ps1 `
#     -TaskRoot D:\novis-backup-20260526\Novis\dsh-runtime-lab\1411 -CodeSha <committed head>
#
# Contract:
#   - Only the three public URLs of DEV DOC v6 SS2 may be downloaded (anonymous HTTPS):
#     rc.2 tarball, rc.1 tarball, Node v24.21.0 win-x64 zip.
#   - The code package comes only from a clean worktree at the committed head:
#     git rev-parse HEAD == -CodeSha, git diff --quiet and git diff --cached --quiet pass,
#     then git archive extracts exactly that SHA.
#   - Writes only build/<buildId>/{incoming,outgoing} plus probe/staging (single probe entry
#     script, hash-bound into the build input-manifest entryScripts.probe). Probe incoming is
#     never written here.
#   - exit 0 = inputs ready; 1 = download/hash/manifest failure; 2 = argument/env/tooling failure.
#   - Never executes downloaded content; never starts Windows Sandbox; never calls npm/node.

param(
  [Parameter(Mandatory = $true)][string]$TaskRoot,
  [Parameter(Mandatory = $true)][string]$CodeSha,
  [string]$BaseSha = '2cde2320224f930b4769315edf1396b25157cad7'
)

$ErrorActionPreference = 'Stop'

$Issue = 1411
$Pinned = @{
  '0.2.2-rc.2' = @{
    Url = 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.2-rc.2.tgz'
    Integrity = 'sha512-J727r2C471x2cYXGjqZ0D9T1zYaYQDFH/Ynx8iq+85oslM4nky5YTBnbAuTtxMhW7nhY8wuAEfjjFCQ+K6Swgw=='
    FileName = 'dsh-0.2.2-rc.2.tgz'
  }
  '0.2.2-rc.1' = @{
    Url = 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.2-rc.1.tgz'
    Integrity = 'sha512-ijR9UEVYkG15Q/Q79JzvzLBzQOQfc63VLr9n6flpwHPhr5IKn2UxthnSoto/P9l7qGd7pPvI1Ra6TW7LH3oKpg=='
    FileName = 'dsh-0.2.2-rc.1.tgz'
  }
}
$NodeZipUrl = 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip'
$NodeZipSha256 = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
$NodeZipFileName = 'node-v24.21.0-win-x64.zip'

function Fail([string]$code, [string]$message, [int]$exitCode = 1) {
  Write-Output ([ordered]@{ ok = $false; code = $code; message = $message } | ConvertTo-Json -Compress -Depth 6)
  exit $exitCode
}

function Get-Sha256Hex([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
}

function Get-Sha512Base64([string]$Path) {
  $algorithm = [System.Security.Cryptography.SHA512]::Create()
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $bytes = $algorithm.ComputeHash($stream)
  } finally {
    $stream.Dispose()
    $algorithm.Dispose()
  }
  return [Convert]::ToBase64String($bytes)
}

function Write-JsonAtomic([string]$Path, $Value) {
  $temp = "$Path.tmp-$([guid]::NewGuid().ToString('N'))"
  ($Value | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $temp -Encoding UTF8
  Move-Item -LiteralPath $temp -Destination $Path -Force
}

# -- 1. arguments and environment ---------------------------------------------
if ($CodeSha -notmatch '^[0-9a-f]{40}$') { Fail 'BAD_CODE_SHA' "CodeSha must be 40 lowercase hex: $CodeSha" 2 }
if ($BaseSha -notmatch '^[0-9a-f]{40}$') { Fail 'BAD_BASE_SHA' "BaseSha must be 40 lowercase hex: $BaseSha" 2 }
if ($TaskRoot -notmatch '^[A-Za-z]:\\') { Fail 'BAD_TASK_ROOT' "TaskRoot must be an absolute path: $TaskRoot" 2 }
$taskRootFull = [System.IO.Path]::GetFullPath($TaskRoot).TrimEnd('\')
$userProfile = [System.IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\')
if ($taskRootFull.StartsWith($userProfile + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
  Fail 'TASK_ROOT_IN_USER_PROFILE' "TaskRoot must not live under the host home: $taskRootFull" 2
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $here))
if (-not (Test-Path -LiteralPath (Join-Path $repo 'package.json'))) { Fail 'REPO_NOT_FOUND' "Cannot locate repo root from script path: $repo" 2 }

$head = (& git -C $repo rev-parse HEAD 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { Fail 'GIT_HEAD_UNREADABLE' "git rev-parse HEAD failed: $head" 2 }
if ($head -ne $CodeSha) { Fail 'CODE_SHA_MISMATCH' "worktree HEAD=$head, expected CodeSha=$CodeSha (no uncommitted content, no other branch)" 2 }
& git -C $repo diff --quiet 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'WORKTREE_DIRTY' "worktree is not clean (git diff --quiet rc=$LASTEXITCODE)" 2 }
& git -C $repo diff --cached --quiet 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'INDEX_DIRTY' "index is not clean (git diff --cached --quiet rc=$LASTEXITCODE)" 2 }

$buildMember = 'scripts/dsh-sidecar/sandbox/Invoke-DshSandboxBuild.ps1'
$probeMember = 'scripts/dsh-sidecar/sandbox/Invoke-DshSandboxProbe.ps1'
foreach ($member in @($buildMember, $probeMember)) {
  & git -C $repo cat-file -e "${CodeSha}:${member}" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'ENTRY_SCRIPT_NOT_COMMITTED' "commit $CodeSha does not contain entry script: $member" 2 }
}

# -- 2. directories (build + probe/staging only) ------------------------------
$buildId = [guid]::NewGuid().ToString()
$buildDir = Join-Path (Join-Path $taskRootFull 'build') $buildId
$incoming = Join-Path $buildDir 'incoming'
$outgoing = Join-Path $buildDir 'outgoing'
$scriptsDir = Join-Path $incoming 'scripts'
$probeRoot = Join-Path $taskRootFull 'probe'
$stagingDir = Join-Path $probeRoot 'staging'
New-Item -ItemType Directory -Path $incoming -Force | Out-Null
New-Item -ItemType Directory -Path $outgoing -Force | Out-Null
New-Item -ItemType Directory -Path $scriptsDir -Force | Out-Null
New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

# -- 3. the three allow-listed public URLs ------------------------------------
foreach ($version in @('0.2.2-rc.2', '0.2.2-rc.1')) {
  $artifact = $Pinned[$version]
  $target = Join-Path $incoming $artifact.FileName
  try {
    Invoke-WebRequest -Uri $artifact.Url -OutFile $target -UseBasicParsing -TimeoutSec 900
  } catch {
    Fail 'DOWNLOAD_FAILED' "download failed $($artifact.Url): $($_.Exception.Message)" 1
  }
  $actualIntegrity = 'sha512-' + (Get-Sha512Base64 $target)
  if ($actualIntegrity -ne $artifact.Integrity) {
    Fail 'TARBALL_INTEGRITY_MISMATCH' "$($artifact.FileName) integrity=$actualIntegrity, expected $($artifact.Integrity)" 1
  }
}

$nodeZip = Join-Path $incoming $NodeZipFileName
try {
  Invoke-WebRequest -Uri $NodeZipUrl -OutFile $nodeZip -UseBasicParsing -TimeoutSec 900
} catch {
  Fail 'DOWNLOAD_FAILED' "download failed ${NodeZipUrl}: $($_.Exception.Message)" 1
}
$nodeZipHash = Get-Sha256Hex $nodeZip
if ($nodeZipHash -ne $NodeZipSha256) {
  Fail 'NODE_ZIP_HASH_MISMATCH' ("{0} sha256={1}, expected {2}" -f $NodeZipFileName, $nodeZipHash, $NodeZipSha256) 1
}

# -- 4. code archive from the same clean worktree -----------------------------
$codeArchiveName = "synova-$CodeSha.zip"
$codeArchive = Join-Path $incoming $codeArchiveName
& git -C $repo archive "--format=zip" "--output=$codeArchive" $CodeSha 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'CODE_ARCHIVE_FAILED' "git archive failed rc=$LASTEXITCODE" 2 }
$codeArchiveSha256 = Get-Sha256Hex $codeArchive

# -- 5. entry scripts (build incoming + probe staging; probe incoming untouched)
$buildEntryTarget = Join-Path $scriptsDir 'Invoke-DshSandboxBuild.ps1'
Copy-Item -LiteralPath (Join-Path $repo ($buildMember -replace '/', '\')) -Destination $buildEntryTarget -Force
$probeEntryTarget = Join-Path $stagingDir 'Invoke-DshSandboxProbe.ps1'
Copy-Item -LiteralPath (Join-Path $repo ($probeMember -replace '/', '\')) -Destination $probeEntryTarget -Force
$buildEntrySha256 = Get-Sha256Hex $buildEntryTarget
$probeEntrySha256 = Get-Sha256Hex $probeEntryTarget

$probeIncomingDir = Join-Path $probeRoot 'incoming'
if (Test-Path -LiteralPath $probeIncomingDir) {
  $existing = @(Get-ChildItem -LiteralPath $probeIncomingDir -Force -ErrorAction SilentlyContinue)
  if ($existing.Count -gt 0) { Fail 'PROBE_INCOMING_NOT_EMPTY' 'Fetch must not write probe incoming; refusing because probe/incoming is non-empty' 2 }
}

# -- 6. build input-manifest ---------------------------------------------------
$manifestFiles = @()
foreach ($name in @($Pinned['0.2.2-rc.2'].FileName, $Pinned['0.2.2-rc.1'].FileName, $NodeZipFileName, $codeArchiveName, 'scripts/Invoke-DshSandboxBuild.ps1')) {
  $path = Join-Path $incoming ($name -replace '/', '\')
  $manifestFiles += [ordered]@{
    path = $name
    bytes = (Get-Item -LiteralPath $path).Length
    sha256 = (Get-Sha256Hex $path)
  }
}

$manifest = [ordered]@{
  schemaVersion = 1
  issue = $Issue
  mode = 'build'
  sandboxId = $buildId
  nonce = ''
  baseSha = $BaseSha
  codeSha = $CodeSha
  codeArchivePath = $codeArchiveName
  codeArchiveSha256 = $codeArchiveSha256
  dshIntegrity = [ordered]@{
    '0.2.2-rc.2' = $Pinned['0.2.2-rc.2'].Integrity
    '0.2.2-rc.1' = $Pinned['0.2.2-rc.1'].Integrity
  }
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  entryScript = [ordered]@{ path = 'scripts/Invoke-DshSandboxBuild.ps1'; sha256 = $buildEntrySha256 }
  entryScripts = [ordered]@{
    build = [ordered]@{ path = 'scripts/Invoke-DshSandboxBuild.ps1'; sha256 = $buildEntrySha256 }
    probe = [ordered]@{ path = 'scripts/Invoke-DshSandboxProbe.ps1'; sha256 = $probeEntrySha256 }
  }
  files = $manifestFiles
}
$manifestPath = Join-Path $incoming 'input-manifest.json'
Write-JsonAtomic -Path $manifestPath -Value $manifest
$manifestSha256 = Get-Sha256Hex $manifestPath

$fetchRecord = [ordered]@{
  schemaVersion = 1
  issue = $Issue
  buildId = $buildId
  baseSha = $BaseSha
  codeSha = $CodeSha
  codeArchiveSha256 = $codeArchiveSha256
  inputManifestSha256 = $manifestSha256
  probeStagingDir = 'probe/staging'
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
}
Write-JsonAtomic -Path (Join-Path $buildDir 'fetch.json') -Value $fetchRecord

Write-Output ([ordered]@{
  ok = $true
  code = 'FETCH_OK'
  buildId = $buildId
  buildDir = $buildDir
  incoming = $incoming
  outgoing = $outgoing
  codeArchiveSha256 = $codeArchiveSha256
  inputManifestSha256 = $manifestSha256
  probeStagingDir = $stagingDir
} | ConvertTo-Json -Compress -Depth 6)
exit 0
