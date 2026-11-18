# install-dsh-runtime.ps1 -- exact, integrity-checked install of the pinned DSH runtime.
#
# Usage (inside the build sandbox or a prepared environment):
#   powershell -NoProfile -File scripts/dsh-sidecar/install-dsh-runtime.ps1 `
#     -Version 0.2.2-rc.2 -Integrity sha512-... -InstallRoot C:\SynovaLab\work\install\0.2.2-rc.2 `
#     [-TarballPath <incoming>\dsh-0.2.2-rc.2.tgz] [-NodeDir C:\SynovaLab\work\node]
#
# Contract (DEV DOC v6 SS6.1):
#   - Version must be one of the two pinned values; Integrity must equal the pinned value.
#   - package.json declares the exact dependency (no caret). The installed
#     node_modules/@deepseek-ai/dsh/package.json version and the lock integrity must both match.
#   - Writes <InstallRoot>/dsh-install-lock.json as the product lockfile (version + integrity +
#     optional tarball sha256) used by probe #2.
#   - On failure: non-zero exit, half-installed directory is kept for forensics; no cleanup,
#     no automatic version switch.
#   - exit 0 = installed and verified; 1 = integrity/version/install failure; 2 = bad arguments.

param(
  [Parameter(Mandatory = $true)][ValidateSet('0.2.2-rc.2', '0.2.2-rc.1')][string]$Version,
  [Parameter(Mandatory = $true)][string]$Integrity,
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [string]$TarballPath = '',
  [string]$NodeDir = ''
)

$ErrorActionPreference = 'Stop'

$Pinned = @{
  '0.2.2-rc.2' = 'sha512-J727r2C471x2cYXGjqZ0D9T1zYaYQDFH/Ynx8iq+85oslM4nky5YTBnbAuTtxMhW7nhY8wuAEfjjFCQ+K6Swgw=='
  '0.2.2-rc.1' = 'sha512-ijR9UEVYkG15Q/Q79JzvzLBzQOQfc63VLr9n6flpwHPhr5IKn2UxthnSoto/P9l7qGd7pPvI1Ra6TW7LH3oKpg=='
}

function Fail([string]$code, [string]$message, [int]$exitCode = 1) {
  Write-Output ([ordered]@{ ok = $false; code = $code; message = $message } | ConvertTo-Json -Compress -Depth 6)
  exit $exitCode
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

function Get-Sha256Hex([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
}

function Write-JsonFile([string]$Path, $Value) {
  $json = $Value | ConvertTo-Json -Depth 10
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

if ($Integrity -notmatch '^sha512-') { $Integrity = 'sha512-' + $Integrity }
$expectedIntegrity = $Pinned[$Version]
if ($expectedIntegrity -ne $Integrity) { Fail 'INTEGRITY_NOT_PINNED' "Integrity for $Version does not match the pinned value" }
if ($InstallRoot -notmatch '^[A-Za-z]:\\') { Fail 'BAD_INSTALL_ROOT' "InstallRoot must be an absolute path: $InstallRoot" 2 }
$installRootFull = [System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')

if ($NodeDir -ne '') {
  $nodeDirFull = [System.IO.Path]::GetFullPath($NodeDir).TrimEnd('\')
} elseif ($env:SYNOVA_NODE_DIR) {
  $nodeDirFull = [System.IO.Path]::GetFullPath($env:SYNOVA_NODE_DIR).TrimEnd('\')
} else {
  $nodeDirFull = ''
}
if ($nodeDirFull -ne '') {
  $npm = Join-Path $nodeDirFull 'npm.cmd'
  $nodeExe = Join-Path $nodeDirFull 'node.exe'
  if (-not (Test-Path -LiteralPath $npm)) { Fail 'NPM_NOT_FOUND' "npm.cmd not found in NodeDir: $nodeDirFull" 2 }
  if (-not (Test-Path -LiteralPath $nodeExe)) { Fail 'NODE_NOT_FOUND' "node.exe not found in NodeDir: $nodeDirFull" 2 }
} else {
  $npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
  if ($null -eq $npmCommand) { Fail 'NPM_NOT_FOUND' 'npm.cmd is not available (pass -NodeDir or set SYNOVA_NODE_DIR)' 2 }
  $npm = $npmCommand.Source
}

New-Item -ItemType Directory -Path $installRootFull -Force | Out-Null
$packageJsonPath = Join-Path $installRootFull 'package.json'
$packageJson = [ordered]@{
  name = 'synova-dsh-runtime'
  version = '0.0.0'
  private = $true
  dependencies = [ordered]@{ '@deepseek-ai/dsh' = $Version }
}
Write-JsonFile -Path $packageJsonPath -Value $packageJson

$sourceKind = 'registry'
$tarballSha256 = $null
$tarballIntegrity = $null
if ($TarballPath -ne '') {
  if (-not (Test-Path -LiteralPath $TarballPath)) { Fail 'TARBALL_MISSING' "tarball not found: $TarballPath" 1 }
  $tarballFull = [System.IO.Path]::GetFullPath($TarballPath)
  $tarballIntegrity = 'sha512-' + (Get-Sha512Base64 $tarballFull)
  if ($tarballIntegrity -ne $expectedIntegrity) { Fail 'TARBALL_INTEGRITY_MISMATCH' "tarball integrity=$tarballIntegrity, expected $expectedIntegrity" 1 }
  $tarballSha256 = Get-Sha256Hex $tarballFull
  $sourceKind = 'tarball'
}

Push-Location $installRootFull
try {
  if ($sourceKind -eq 'tarball') {
    $npmOut = (& $npm install --no-audit --no-fund --no-save --loglevel=error $tarballFull 2>&1 | Out-String)
  } else {
    $npmOut = (& $npm install --no-audit --no-fund --save-exact --loglevel=error "@deepseek-ai/dsh@$Version" 2>&1 | Out-String)
  }
  $npmExit = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($npmExit -ne 0) { Fail 'NPM_INSTALL_FAILED' "npm install rc=$npmExit`n$npmOut" 1 }

$installedPackageJson = Join-Path $installRootFull 'node_modules\@deepseek-ai\dsh\package.json'
$binJs = Join-Path $installRootFull 'node_modules\@deepseek-ai\dsh\lib\bin.js'
if (-not (Test-Path -LiteralPath $installedPackageJson)) { Fail 'PACKAGE_MISSING' "installed package.json missing: $installedPackageJson" 1 }
if (-not (Test-Path -LiteralPath $binJs)) { Fail 'BIN_JS_MISSING' "installed lib/bin.js missing: $binJs" 1 }
$installedPackage = Get-Content -LiteralPath $installedPackageJson -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$installedPackage.version -ne $Version) { Fail 'VERSION_MISMATCH' "installed version=$($installedPackage.version), expected $Version" 1 }

$lockIntegrity = $null
$packageLockPath = Join-Path $installRootFull 'package-lock.json'
if (Test-Path -LiteralPath $packageLockPath) {
  $packageLock = Get-Content -LiteralPath $packageLockPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $entry = $packageLock.packages.'node_modules/@deepseek-ai/dsh'
  if ($null -ne $entry) {
    if ([string]$entry.version -ne $Version) { Fail 'LOCK_VERSION_MISMATCH' "package-lock version=$($entry.version), expected $Version" 1 }
    $lockIntegrity = [string]$entry.integrity
    if ([string]::IsNullOrEmpty($lockIntegrity)) { $lockIntegrity = $null }
  }
}
if ($sourceKind -eq 'registry') {
  if ($null -eq $lockIntegrity) { Fail 'LOCK_INTEGRITY_MISSING' 'package-lock.json has no integrity for @deepseek-ai/dsh' 1 }
  if ($lockIntegrity -ne $expectedIntegrity) { Fail 'LOCK_INTEGRITY_MISMATCH' "lock integrity=$lockIntegrity, expected $expectedIntegrity" 1 }
}

$recordedIntegrity = if ($sourceKind -eq 'tarball') { $tarballIntegrity } else { $lockIntegrity }
$lock = [ordered]@{
  schemaVersion = 1
  package = '@deepseek-ai/dsh'
  version = $Version
  integrity = $recordedIntegrity
  source = $sourceKind
  tarballSha256 = $tarballSha256
  installedAt = (Get-Date).ToUniversalTime().ToString('o')
  installRoot = $installRootFull
}
Write-JsonFile -Path (Join-Path $installRootFull 'dsh-install-lock.json') -Value $lock

Write-Output ([ordered]@{
  ok = $true
  code = 'INSTALL_OK'
  version = $Version
  integrity = $recordedIntegrity
  installRoot = $installRootFull
  binJs = $binJs
  source = $sourceKind
} | ConvertTo-Json -Compress -Depth 6)
exit 0
