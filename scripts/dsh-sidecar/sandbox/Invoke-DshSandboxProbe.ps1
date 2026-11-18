# Invoke-DshSandboxProbe.ps1 -- probe-mode entry script (runs only inside the sandbox).
#
# Started by the .wsb LogonCommand:
#   cmd /c set "SYNOVA_SANDBOX_ID=..." && set "SYNOVA_SANDBOX_NONCE=..." && powershell ...
#       -File C:\SynovaLab\incoming\scripts\Invoke-DshSandboxProbe.ps1 `
#       -Mode Probe -SandboxId <guid> -Nonce <hex>
#
# Contract (DEV DOC v6 SS3/SS5.2, v8 SS2):
#   - fail-closed guards: sandbox id/nonce must match the input-manifest, every manifest file
#     hash must match, and every work path must stay under C:\SynovaLab\work with
#     DSH_HOME exactly C:\SynovaLab\work\home.
#   - verify runtime-bundle.zip against the manifest and its own inner manifest, unpack it to
#     C:\SynovaLab\work, then call the repo's probe-dsh-runtime.ps1 (never a host path).
#   - write RUN_STARTED.json / RUN_FINISHED.json / artifacts.json; the probe script writes
#     evidence.json and its logs into the outgoing directory.
#   - exit 0 = all ten probes reported valid; 1 = a probe failed; 2 = guard/manifest/self failure.

param(
  [Parameter(Mandatory = $true)][ValidateSet('Probe')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$SandboxId,
  [Parameter(Mandatory = $true)][string]$Nonce
)

$ErrorActionPreference = 'Stop'

$Issue = 1411
$Incoming = 'C:\SynovaLab\incoming'
$Outgoing = 'C:\SynovaLab\outgoing'
$WorkRoot = 'C:\SynovaLab\work'
$DshHome = Join-Path $WorkRoot 'home'
$RepoRoot = Join-Path $WorkRoot 'repo'
$NodeDir = Join-Path $WorkRoot 'node'
$InstallRoot = Join-Path $WorkRoot 'install'

function Write-JsonFile([string]$Path, $Value) {
  $json = $Value | ConvertTo-Json -Depth 12
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

function Get-Sha256Hex([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
}

function Assert-WorkPath([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetFullPath($WorkRoot).TrimEnd('\')
  if (-not $full.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "path is outside ${WorkRoot}: $full"
  }
  return $full
}

$startedAt = (Get-Date).ToUniversalTime().ToString('o')
$scriptExitCode = 2
$inProbe = $false
$failure = $null
$configSha256 = ''
$inputManifestSha256 = ''
$runtimeBundleSha256 = ''

try {
  if ($env:SYNOVA_SANDBOX_ID -and $env:SYNOVA_SANDBOX_ID -ne $SandboxId) { throw 'SYNOVA_SANDBOX_ID does not match -SandboxId' }
  if ($env:SYNOVA_SANDBOX_NONCE -and $env:SYNOVA_SANDBOX_NONCE -ne $Nonce) { throw 'SYNOVA_SANDBOX_NONCE does not match -Nonce' }
  foreach ($path in @($Incoming, $Outgoing)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "required sandbox path missing: $path" }
  }
  New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $Outgoing -Force | Out-Null

  $manifestPath = Join-Path $Incoming 'input-manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'input-manifest.json missing' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([string]$manifest.mode -ne 'probe') { throw "input-manifest.mode=$($manifest.mode), expected probe" }
  if ([string]$manifest.sandboxId -ne $SandboxId) { throw 'input-manifest.sandboxId mismatch' }
  if ([string]$manifest.nonce -ne $Nonce) { throw 'input-manifest.nonce mismatch' }
  if ([int]$manifest.issue -ne $Issue) { throw "input-manifest.issue must be $Issue" }
  $configEntry = @($manifest.files) | Where-Object { [string]$_.path -eq 'config/probe.wsb' }
  if ($null -eq $configEntry) { throw 'input-manifest does not list config/probe.wsb' }
  $configSha256 = [string]$configEntry.sha256
  $bundleEntry = @($manifest.files) | Where-Object { [string]$_.path -eq 'runtime-bundle.zip' }
  if ($null -eq $bundleEntry) { throw 'input-manifest does not list runtime-bundle.zip' }
  $runtimeBundleSha256 = [string]$bundleEntry.sha256

  $manifestFiles = @($manifest.files)
  if ($manifestFiles.Count -eq 0) { throw 'input-manifest.files is empty' }
  foreach ($entry in $manifestFiles) {
    $relative = [string]$entry.path
    if ($relative -match '(^/|^\\|^[A-Za-z]:|\.\.)') { throw "invalid manifest path: $relative" }
    $target = Join-Path $Incoming ($relative -replace '/', '\')
    if (-not (Test-Path -LiteralPath $target)) { throw "manifest file missing: $relative" }
    if ((Get-Sha256Hex $target) -ne [string]$entry.sha256) { throw "manifest file hash mismatch: $relative" }
  }
  $inputManifestSha256 = Get-Sha256Hex $manifestPath

  $runStarted = [ordered]@{
    issue = $Issue
    mode = 'probe'
    sandboxId = $SandboxId
    nonce = $Nonce
    startedAt = $startedAt
    configSha256 = $configSha256
    inputManifestSha256 = $inputManifestSha256
  }
  Write-JsonFile -Path (Join-Path $Outgoing 'RUN_STARTED.json') -Value $runStarted

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $bundleZip = Join-Path $Incoming 'runtime-bundle.zip'
  if ((Get-Sha256Hex $bundleZip) -ne $runtimeBundleSha256) { throw 'runtime-bundle.zip hash does not match input-manifest' }
  if (Test-Path -LiteralPath $RepoRoot) { Remove-Item -LiteralPath $RepoRoot -Recurse -Force }
  if (Test-Path -LiteralPath $NodeDir) { Remove-Item -LiteralPath $NodeDir -Recurse -Force }
  if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($bundleZip, $WorkRoot)

  $bundleManifestPath = Join-Path $WorkRoot 'manifest.json'
  if (-not (Test-Path -LiteralPath $bundleManifestPath)) { throw 'runtime bundle manifest.json missing' }
  $bundleManifest = Get-Content -LiteralPath $bundleManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([int]$bundleManifest.issue -ne $Issue) { throw 'runtime bundle manifest.issue mismatch' }
  if ([string]$bundleManifest.codeSha -ne [string]$manifest.codeSha) { throw 'runtime bundle manifest.codeSha mismatch' }
  if ([string]$bundleManifest.codeArchiveSha256 -ne [string]$manifest.codeArchiveSha256) { throw 'runtime bundle manifest.codeArchiveSha256 mismatch' }
  $bundleFiles = @($bundleManifest.files)
  if ($bundleFiles.Count -eq 0) { throw 'runtime bundle manifest.files is empty' }
  if ($bundleFiles.Count -ne [int]$bundleManifest.fileCount) { throw 'runtime bundle manifest.fileCount mismatch' }
  foreach ($entry in $bundleFiles) {
    $relative = [string]$entry.path
    if ($relative -match '(^/|^\\|^[A-Za-z]:|\.\.)') { throw "invalid bundle path: $relative" }
    $target = Join-Path $WorkRoot ($relative -replace '/', '\')
    Assert-WorkPath $target | Out-Null
    if (-not (Test-Path -LiteralPath $target)) { throw "bundle file missing: $relative" }
    if ((Get-Sha256Hex $target) -ne [string]$entry.sha256) { throw "bundle file hash mismatch: $relative" }
  }

  # arrange the canonical layout: work\install\<version>, work\node, work\repo
  $dshRoot = Join-Path $WorkRoot 'dsh'
  if (-not (Test-Path -LiteralPath $dshRoot)) { throw 'runtime bundle does not contain dsh/<version> installs' }
  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
  foreach ($version in @('0.2.2-rc.2', '0.2.2-rc.1')) {
    $source = Join-Path $dshRoot $version
    if (-not (Test-Path -LiteralPath $source)) { throw "runtime bundle is missing dsh/$version" }
    Move-Item -LiteralPath $source -Destination (Join-Path $InstallRoot $version)
  }
  Remove-Item -LiteralPath $dshRoot -Recurse -Force
  foreach ($required in @('node\node.exe', 'repo\package.json', 'repo\node_modules\.bin\tsx.cmd', 'repo\node_modules\.bin\vitest.cmd',
      'repo\node_modules\better-sqlite3', 'repo\scripts\dsh-sidecar\probe-dsh-runtime.ps1', 'repo\scripts\dsh-sidecar\start.ps1',
      'repo\scripts\dsh-sidecar\stop.ps1', 'repo\scripts\dsh-sidecar\status.ps1', 'repo\scripts\dsh-sidecar\logs.ps1',
      'repo\scripts\dsh-sidecar\backup.ps1', 'repo\scripts\dsh-sidecar\restore.ps1', 'repo\scripts\dsh-sidecar\turn.ps1',
      'install\0.2.2-rc.2\node_modules\@deepseek-ai\dsh\lib\bin.js',
      'install\0.2.2-rc.1\node_modules\@deepseek-ai\dsh\lib\bin.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $WorkRoot $required))) { throw "probe tree is missing: $required" }
  }

  $env:DSH_HOME = $DshHome
  $env:SYNOVA_DSH_INSTALL_DIR = Join-Path $InstallRoot '0.2.2-rc.2'
  $env:SYNOVA_NODE_DIR = $NodeDir
  $env:PATH = "$NodeDir;$env:PATH"
  $env:CI = '1'

  $inProbe = $true
  $probeScript = Join-Path $RepoRoot 'scripts\dsh-sidecar\probe-dsh-runtime.ps1'
  $evidencePath = Join-Path $Outgoing 'evidence.json'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $probeScript `
    -WorkRoot $WorkRoot -Outgoing $Outgoing -EvidencePath $evidencePath `
    -SandboxId $SandboxId -Nonce $Nonce -BaseSha ([string]$manifest.baseSha) -CodeSha ([string]$manifest.codeSha) `
    -ConfigSha256 $configSha256 -InputManifestSha256 $inputManifestSha256 -RuntimeBundleSha256 $runtimeBundleSha256
  $scriptExitCode = $LASTEXITCODE
  if ($scriptExitCode -ne 0) { throw "probe-dsh-runtime.ps1 failed rc=$scriptExitCode" }
} catch {
  $failure = $_.Exception.Message
  if ($inProbe) { $scriptExitCode = 1 } else { $scriptExitCode = 2 }
  Write-JsonFile -Path (Join-Path $Outgoing 'failure.json') -Value ([ordered]@{
      time = (Get-Date).ToUniversalTime().ToString('o')
      component = 'invoke-probe'
      code = 'PROBE_FAILED'
      phase = 'probe'
      retryable = $false
      message = $failure
    })
}

# -- artifacts + finished sentinel (always) ----------------------------------
$artifacts = @()
$outgoingFiles = @(Get-ChildItem -LiteralPath $Outgoing -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'RUN_FINISHED.json' -and $_.Name -ne 'artifacts.json' })
foreach ($file in $outgoingFiles) {
  $artifacts += [ordered]@{
    path = $file.FullName.Substring($Outgoing.Length + 1).Replace('\', '/')
    bytes = $file.Length
    sha256 = (Get-Sha256Hex $file.FullName)
  }
}
$artifactsPath = Join-Path $Outgoing 'artifacts.json'
Write-JsonFile -Path $artifactsPath -Value ([ordered]@{ schemaVersion = 1; issue = $Issue; mode = 'probe'; files = $artifacts })
$artifactManifestSha256 = Get-Sha256Hex $artifactsPath
$finishedAt = (Get-Date).ToUniversalTime().ToString('o')
$runFinished = [ordered]@{
  issue = $Issue
  mode = 'probe'
  sandboxId = $SandboxId
  nonce = $Nonce
  startedAt = $startedAt
  finishedAt = $finishedAt
  configSha256 = $configSha256
  inputManifestSha256 = $inputManifestSha256
  scriptExitCode = $scriptExitCode
  artifactManifestSha256 = $artifactManifestSha256
}
Write-JsonFile -Path (Join-Path $Outgoing 'RUN_FINISHED.json') -Value $runFinished
exit $scriptExitCode
