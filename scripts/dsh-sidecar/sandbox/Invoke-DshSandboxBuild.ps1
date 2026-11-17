# Invoke-DshSandboxBuild.ps1 -- build-mode entry script (runs only inside the sandbox).
#
# Started by the .wsb LogonCommand:
#   cmd /c set "SYNOVA_SANDBOX_ID=..." && set "SYNOVA_SANDBOX_NONCE=..." && powershell ...
#       -File C:\SynovaLab\incoming\scripts\Invoke-DshSandboxBuild.ps1 `
#       -Mode Build -SandboxId <guid> -Nonce <hex>
#
# Contract (DEV DOC v6 SS3/SS5.2, v7 SSB12/SSB14, v8 SS2):
#   - fail-closed: sandbox id / nonce must match C:\SynovaLab\incoming\input-manifest.json,
#     every manifest file hash must match, all work paths must be under C:\SynovaLab\work,
#     DSH_HOME must be exactly C:\SynovaLab\work\home. No fallback to a default home.
#   - verify the code archive, install the portable Node runtime, run npm ci, run the repo
#     test slice and type check, install rc.2 and rc.1 with the pinned integrity, then emit
#     exactly one runtime-bundle.zip plus build-result.json and logs in the outgoing dir.
#   - write RUN_STARTED.json / RUN_FINISHED.json / artifacts.json with the binding fields.
#   - exit 0 = build succeeded; 1 = build/test/lint failed; 2 = guard/manifest/self failure.

param(
  [Parameter(Mandatory = $true)][ValidateSet('Build')][string]$Mode,
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
$ExpectedNode = 'v24.21.0'

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

function Run-Captured([string]$LogPath, [string]$WorkingDirectory, [string]$Exe, [string[]]$Arguments) {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add(('COMMAND: {0} {1}' -f $Exe, ($Arguments -join ' ')))
  $lines.Add(('CWD: {0}' -f $WorkingDirectory))
  Push-Location $WorkingDirectory
  try {
    $output = (& $Exe @Arguments 2>&1 | Out-String)
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  $lines.Add($output)
  $lines.Add(('EXIT: {0}' -f $code))
  [System.IO.File]::WriteAllText($LogPath, ($lines -join "`n"), (New-Object System.Text.UTF8Encoding($false)))
  return [pscustomobject]@{ exitCode = $code; output = $output }
}

$startedAt = (Get-Date).ToUniversalTime().ToString('o')
$scriptExitCode = 2
$inBuild = $false
$failure = $null

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
  if ([string]$manifest.mode -ne 'build') { throw "input-manifest.mode=$($manifest.mode), expected build" }
  if ([string]$manifest.sandboxId -ne $SandboxId) { throw 'input-manifest.sandboxId mismatch' }
  if ([string]$manifest.nonce -ne $Nonce) { throw 'input-manifest.nonce mismatch' }
  if ([int]$manifest.issue -ne $Issue) { throw "input-manifest.issue must be $Issue" }
  $configEntry = @($manifest.files) | Where-Object { [string]$_.path -eq 'config/build.wsb' }
  if ($null -eq $configEntry) { throw 'input-manifest does not list config/build.wsb' }
  $configSha256 = [string]$configEntry.sha256

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
    mode = 'build'
    sandboxId = $SandboxId
    nonce = $Nonce
    startedAt = $startedAt
    configSha256 = $configSha256
    inputManifestSha256 = $inputManifestSha256
  }
  Write-JsonFile -Path (Join-Path $Outgoing 'RUN_STARTED.json') -Value $runStarted
  $inBuild = $true

  # 1. extract the committed code archive into C:\SynovaLab\work\repo
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $codeZip = Join-Path $Incoming ([string]$manifest.codeArchivePath)
  if (-not (Test-Path -LiteralPath $codeZip)) { throw "code archive missing: $codeZip" }
  if ((Get-Sha256Hex $codeZip) -ne [string]$manifest.codeArchiveSha256) { throw 'code archive hash does not match input-manifest' }
  if (Test-Path -LiteralPath $RepoRoot) { Remove-Item -LiteralPath $RepoRoot -Recurse -Force }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($codeZip, $RepoRoot)
  if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'package.json'))) { throw 'code archive did not produce a repo tree' }

  # 2. extract the portable Node runtime into C:\SynovaLab\work\node
  $nodeEntry = @($manifest.files) | Where-Object { [string]$_.path -eq 'node-v24.21.0-win-x64.zip' }
  if ($null -eq $nodeEntry) { throw 'node zip is not listed in input-manifest' }
  $nodeZip = Join-Path $Incoming 'node-v24.21.0-win-x64.zip'
  if (Test-Path -LiteralPath $NodeDir) { Remove-Item -LiteralPath $NodeDir -Recurse -Force }
  $nodeExtract = Join-Path $WorkRoot 'node-extract'
  if (Test-Path -LiteralPath $nodeExtract) { Remove-Item -LiteralPath $nodeExtract -Recurse -Force }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($nodeZip, $nodeExtract)
  $nodeInner = Get-ChildItem -LiteralPath $nodeExtract -Directory | Select-Object -First 1
  if ($null -eq $nodeInner) { throw 'node zip did not contain a directory' }
  Move-Item -LiteralPath $nodeInner.FullName -Destination $NodeDir
  Remove-Item -LiteralPath $nodeExtract -Recurse -Force
  $nodeExe = Join-Path $NodeDir 'node.exe'
  if (-not (Test-Path -LiteralPath $nodeExe)) { throw 'portable node.exe missing after extraction' }
  $env:PATH = "$NodeDir;$env:PATH"
  $nodeVersion = (& $nodeExe --version | Out-String).Trim()
  if ($nodeVersion -ne $ExpectedNode) { throw "node version=$nodeVersion, expected $ExpectedNode" }
  $npm = Join-Path $NodeDir 'npm.cmd'

  # 3. install repo dependencies, run the test slice and the type check
  $logsDir = Join-Path $Outgoing 'build-evidence'
  New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
  $testsLog = Join-Path $logsDir 'tests.log'
  $lintLog = Join-Path $logsDir 'lint.log'
  $installLog = Join-Path $logsDir 'npm-ci.log'

  $npmInstall = Run-Captured -LogPath $installLog -WorkingDirectory $RepoRoot -Exe $npm -Arguments @('ci', '--no-audit', '--no-fund', '--loglevel=error')
  if ($npmInstall.exitCode -ne 0) { throw "npm ci failed rc=$($npmInstall.exitCode)" }
  foreach ($required in @('node_modules\.bin\tsx.cmd', 'node_modules\.bin\vitest.cmd', 'node_modules\better-sqlite3')) {
    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot $required))) { throw "repo dependency missing after npm ci: $required" }
  }

  $testJson = Join-Path $WorkRoot 'vitest-result.json'
  $vitest = Join-Path $RepoRoot 'node_modules\.bin\vitest.cmd'
  $env:CI = '1'
  $tests = Run-Captured -LogPath $testsLog -WorkingDirectory $RepoRoot -Exe $vitest -Arguments @('run', 'tests/runtime/dsh', '--reporter=default', '--reporter=json', "--outputFile.json=$testJson")
  if ($tests.exitCode -ne 0) { throw "repo tests failed rc=$($tests.exitCode)" }
  if (-not (Test-Path -LiteralPath $testJson)) { throw 'vitest did not produce a JSON report' }
  $testReport = Get-Content -LiteralPath $testJson -Raw -Encoding UTF8 | ConvertFrom-Json
  $testTotal = [long]$testReport.numTotalTests
  $testPassed = [long]$testReport.numPassedTests
  $testFailed = [long]$testReport.numFailedTests
  if ($testTotal -le 0) { throw 'vitest report has zero total tests' }
  if ($testFailed -ne 0 -or $testPassed -ne $testTotal) { throw "vitest report not green (total=$testTotal passed=$testPassed failed=$testFailed)" }

  $tsc = Join-Path $RepoRoot 'node_modules\.bin\tsc.cmd'
  $lint = Run-Captured -LogPath $lintLog -WorkingDirectory $RepoRoot -Exe $tsc -Arguments @('--noEmit')
  if ($lint.exitCode -ne 0) { throw "type check failed rc=$($lint.exitCode)" }

  # 4. install both pinned DSH versions from the local tarballs
  $installScript = Join-Path $RepoRoot 'scripts\dsh-sidecar\install-dsh-runtime.ps1'
  if (-not (Test-Path -LiteralPath $installScript)) { throw "install-dsh-runtime.ps1 missing from repo: $installScript" }
  $rc2 = @($manifest.files) | Where-Object { [string]$_.path -eq 'dsh-0.2.2-rc.2.tgz' }
  $rc1 = @($manifest.files) | Where-Object { [string]$_.path -eq 'dsh-0.2.2-rc.1.tgz' }
  if ($null -eq $rc2 -or $null -eq $rc1) { throw 'pinned dsh tarballs are not listed in input-manifest' }
  $rc2Integrity = [string]$manifest.dshIntegrity.'0.2.2-rc.2'
  $rc1Integrity = [string]$manifest.dshIntegrity.'0.2.2-rc.1'
  if ($rc2Integrity -eq '') { $rc2Integrity = 'sha512-J727r2C471x2cYXGjqZ0D9T1zYaYQDFH/Ynx8iq+85oslM4nky5YTBnbAuTtxMhW7nhY8wuAEfjjFCQ+K6Swgw==' }
  if ($rc1Integrity -eq '') { $rc1Integrity = 'sha512-ijR9UEVYkG15Q/Q79JzvzLBzQOQfc63VLr9n6flpwHPhr5IKn2UxthnSoto/P9l7qGd7pPvI1Ra6TW7LH3oKpg==' }
  foreach ($version in @('0.2.2-rc.2', '0.2.2-rc.1')) {
    $tarball = Join-Path $Incoming ("dsh-$version.tgz")
    $integrity = if ($version -eq '0.2.2-rc.2') { $rc2Integrity } else { $rc1Integrity }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $installScript -Version $version -Integrity $integrity -InstallRoot (Join-Path $InstallRoot $version) -TarballPath $tarball -NodeDir $NodeDir
    if ($LASTEXITCODE -ne 0) { throw "install-dsh-runtime.ps1 failed for $version rc=$LASTEXITCODE" }
  }

  # 5. assemble the runtime bundle
  $bundle = Join-Path $WorkRoot 'bundle'
  if (Test-Path -LiteralPath $bundle) { Remove-Item -LiteralPath $bundle -Recurse -Force }
  New-Item -ItemType Directory -Path $bundle -Force | Out-Null
  Copy-Item -LiteralPath $NodeDir -Destination (Join-Path $bundle 'node') -Recurse -Force
  Copy-Item -LiteralPath $InstallRoot -Destination (Join-Path $bundle 'dsh') -Recurse -Force
  Copy-Item -LiteralPath $RepoRoot -Destination (Join-Path $bundle 'repo') -Recurse -Force
  foreach ($required in @('node\node.exe', 'repo\node_modules\.bin\tsx.cmd', 'repo\node_modules\.bin\vitest.cmd', 'repo\node_modules\better-sqlite3', 'dsh\0.2.2-rc.2\node_modules\@deepseek-ai\dsh\lib\bin.js', 'dsh\0.2.2-rc.1\node_modules\@deepseek-ai\dsh\lib\bin.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $bundle $required))) { throw "runtime bundle is missing: $required" }
  }
  $bundleFiles = @()
  foreach ($file in @(Get-ChildItem -LiteralPath $bundle -Recurse -File -Force)) {
    $relative = $file.FullName.Substring($bundle.Length + 1).Replace('\', '/')
    $bundleFiles += [ordered]@{ path = $relative; bytes = $file.Length; sha256 = (Get-Sha256Hex $file.FullName) }
  }
  $nonEmptyCount = @($bundleFiles | Where-Object { [long]$_.bytes -gt 0 }).Count
  if ($bundleFiles.Count -eq 0 -or $nonEmptyCount -eq 0) { throw 'runtime bundle file list is empty' }
  $bundleManifest = [ordered]@{
    schemaVersion = 1
    issue = $Issue
    baseSha = [string]$manifest.baseSha
    codeSha = [string]$manifest.codeSha
    codeArchiveSha256 = [string]$manifest.codeArchiveSha256
    nodeVersion = $ExpectedNode
    dshVersions = @('0.2.2-rc.2', '0.2.2-rc.1')
    fileCount = $bundleFiles.Count
    nonEmptyFileCount = $nonEmptyCount
    files = $bundleFiles
  }
  Write-JsonFile -Path (Join-Path $bundle 'manifest.json') -Value $bundleManifest
  $bundleZip = Join-Path $Outgoing 'runtime-bundle.zip'
  if (Test-Path -LiteralPath $bundleZip) { Remove-Item -LiteralPath $bundleZip -Force }
  [System.IO.Compression.ZipFile]::CreateFromDirectory($bundle, $bundleZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
  $bundleSha256 = Get-Sha256Hex $bundleZip

  # 6. build-result.json (additionalProperties=false)
  $buildResult = [ordered]@{
    schemaVersion = 1
    issue = $Issue
    codeSha = [string]$manifest.codeSha
    codeArchiveSha256 = [string]$manifest.codeArchiveSha256
    tests = [ordered]@{
      command = 'node_modules/.bin/vitest.cmd run tests/runtime/dsh'
      exitCode = 0
      total = $testTotal
      passed = $testPassed
      failed = 0
      logPath = 'build-evidence/tests.log'
      logSha256 = (Get-Sha256Hex $testsLog)
    }
    lint = [ordered]@{
      command = 'node_modules/.bin/tsc.cmd --noEmit'
      exitCode = 0
      logPath = 'build-evidence/lint.log'
      logSha256 = (Get-Sha256Hex $lintLog)
    }
  }
  Write-JsonFile -Path (Join-Path $logsDir 'build-result.json') -Value $buildResult
  $scriptExitCode = 0
} catch {
  $failure = $_.Exception.Message
  if ($inBuild) { $scriptExitCode = 1 } else { $scriptExitCode = 2 }
  Write-JsonFile -Path (Join-Path $Outgoing 'failure.json') -Value ([ordered]@{
      time = (Get-Date).ToUniversalTime().ToString('o')
      component = 'invoke-build'
      code = 'BUILD_FAILED'
      phase = 'build'
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
Write-JsonFile -Path $artifactsPath -Value ([ordered]@{ schemaVersion = 1; issue = $Issue; mode = 'build'; files = $artifacts })
$artifactManifestSha256 = Get-Sha256Hex $artifactsPath
$finishedAt = (Get-Date).ToUniversalTime().ToString('o')
$runFinished = [ordered]@{
  issue = $Issue
  mode = 'build'
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
