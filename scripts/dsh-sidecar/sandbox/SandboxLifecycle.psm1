# SandboxLifecycle.psm1 -- the single production state machine for one Windows Sandbox run.
#
# Contract (DEV DOC v6 SS5.1 / v7 SSB13):
#   Invoke-SandboxLifecycle is the only implementation of: start record, PID + StartTime
#   identity, sentinel wait, finished/failed/timeout, CloseMainWindow, same-PID Stop when
#   needed, DESTROYED decision and orchestration writes. Start-DshSandbox.ps1 is a thin CLI
#   that injects RealSandboxProcessAdapter.ps1; tests inject a synthetic adapter.
#
#   The adapter is dot-sourced inside Invoke-SandboxLifecycle's scope and must provide:
#     Start-SandboxProcess    -ConfigPath <string>                        -> {Pid, StartTime}
#     Get-SandboxProcess      -Pid <int>                                  -> {Pid, StartTime} | $null
#     Wait-SandboxProcessExit -Pid <int> -TimeoutMs <int>                 -> [bool]
#     Close-SandboxMainWindow -Pid <int>                                  -> [bool]
#     Stop-SandboxProcess     -Pid <int>                                  -> [bool]
#   Only the PID returned by Start-SandboxProcess and its recorded StartTime may be closed
#   or stopped. Name-based process termination is never used.
#
# Exit contract: 0 = script finished and sandbox destroyed; 1 = script failed or timed out
# (sandbox destroyed when possible); 2 = config/hash/identity/destroy/validator failure.

function Get-FileSha256Hex([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
}

function Write-JsonFile([string]$Path, $Value) {
  $temp = "$Path.tmp-$([guid]::NewGuid().ToString('N'))"
  $json = $Value | ConvertTo-Json -Depth 12
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($temp, $json, $utf8NoBom)
  Move-Item -LiteralPath $temp -Destination $Path -Force
}

function Write-FailureRecord([string]$RunDir, [string]$Code, [string]$Message, [int]$Retryable = 0) {
  $record = [ordered]@{
    time = (Get-Date).ToUniversalTime().ToString('o')
    component = 'sandbox-lifecycle'
    code = $Code
    phase = 'lifecycle'
    retryable = ($Retryable -eq 1)
    message = $Message
  }
  Write-JsonFile -Path (Join-Path $RunDir 'failure.json') -Value $record
}

function Get-TaskRoot([string]$RunDir, [string]$ModeLower) {
  $modeDir = Split-Path -Parent $RunDir
  if ((Split-Path -Leaf $modeDir) -ne $ModeLower) {
    throw "run dir is not under <taskroot>/$ModeLower"
  }
  return (Split-Path -Parent $modeDir)
}

function Get-RelativeTaskPath([string]$TaskRoot, [string]$Path) {
  $rootFull = [System.IO.Path]::GetFullPath($TaskRoot).TrimEnd('\')
  $pathFull = [System.IO.Path]::GetFullPath($Path)
  if (-not $pathFull.StartsWith($rootFull + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "path escapes the task root: $pathFull"
  }
  return $pathFull.Substring($rootFull.Length + 1).Replace('\', '/')
}

function New-Orchestration([hashtable]$Field) {
  return [ordered]@{
    schemaVersion = 1
    issue = 1411
    mode = $Field.mode
    baseSha = $Field.baseSha
    codeSha = $Field.codeSha
    codeArchivePath = $Field.codeArchivePath
    codeArchiveSha256 = $Field.codeArchiveSha256
    sandboxId = $Field.sandboxId
    nonce = $Field.nonce
    configSha256 = $Field.configSha256
    inputManifestSha256 = $Field.inputManifestSha256
    runtimeBundleSha256 = $Field.runtimeBundleSha256
    state = $Field.state
    hostPid = $Field.hostPid
    hostProcessStartTime = $Field.hostProcessStartTime
    startedAt = $Field.startedAt
    finishedAt = $Field.finishedAt
    destroyedAt = $Field.destroyedAt
    scriptExitCode = $Field.scriptExitCode
    hostExitCode = $Field.hostExitCode
    startedSentinel = $Field.startedSentinel
    finishedSentinel = $Field.finishedSentinel
    handoff = $Field.handoff
  }
}

function Read-Sentinel([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -eq 0) { return $null }
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    $data = $text | ConvertFrom-Json
    if ($null -eq $data) { return $null }
    $sha = [System.BitConverter]::ToString(
      [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
    ).Replace('-', '').ToLower()
    return [ordered]@{ data = $data; sha256 = $sha; bytes = $bytes.Length }
  } catch {
    return $null
  }
}

function Assert-SentinelBinding($Sentinel, [hashtable]$Expected, [string]$Label) {
  if ($null -eq $Sentinel) { return "$Label missing or unreadable" }
  $data = $Sentinel.data
  foreach ($key in @('issue', 'mode', 'sandboxId', 'nonce', 'configSha256', 'inputManifestSha256')) {
    $actual = [string]$data.$key
    $expectedValue = [string]$Expected[$key]
    if ($actual -ne $expectedValue) { return "$Label.$key=$actual, expected $expectedValue" }
  }
  return $null
}

function Test-ProcessIdentity($Process, [string]$RecordedStartTime) {
  if ($null -eq $Process) { return $false }
  try {
    $recorded = [datetime]::Parse($RecordedStartTime, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
  } catch {
    return $false
  }
  $actual = [datetime]$Process.StartTime
  $delta = [math]::Abs(($actual.ToUniversalTime() - $recorded.ToUniversalTime()).TotalSeconds)
  return ($delta -lt 1.0)
}

function Invoke-SandboxLifecycle {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('Build', 'Probe')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$OrchestrationPath,
    [Parameter(Mandatory = $true)][string]$IncomingDir,
    [Parameter(Mandatory = $true)][string]$OutgoingDir,
    [Parameter(Mandatory = $true)][string]$AdapterPath,
    [int]$FinishTimeoutSec = 3600,
    [int]$CloseGraceSec = 30,
    [int]$PollMilliseconds = 500
  )

  $modeLower = $Mode.ToLower()
  $orchestrationPath = [System.IO.Path]::GetFullPath($OrchestrationPath)
  $runDir = Split-Path -Parent $orchestrationPath
  $taskRoot = Get-TaskRoot -RunDir $runDir -ModeLower $modeLower

  if (-not (Test-Path -LiteralPath $AdapterPath)) {
    Write-FailureRecord -RunDir $runDir -Code 'ADAPTER_MISSING' -Message "adapter not found: $AdapterPath"
    return 2
  }
  . (Resolve-Path -LiteralPath $AdapterPath).Path
  foreach ($fn in @('Start-SandboxProcess', 'Get-SandboxProcess', 'Wait-SandboxProcessExit', 'Close-SandboxMainWindow', 'Stop-SandboxProcess')) {
    if ($null -eq (Get-Command $fn -ErrorAction SilentlyContinue)) {
      Write-FailureRecord -RunDir $runDir -Code 'ADAPTER_INCOMPLETE' -Message "adapter does not define $fn"
      return 2
    }
  }

  if (-not (Test-Path -LiteralPath $orchestrationPath)) {
    Write-FailureRecord -RunDir $runDir -Code 'ORCHESTRATION_MISSING' -Message "missing orchestration: $orchestrationPath"
    return 2
  }
  $state = Get-Content -LiteralPath $orchestrationPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([string]$state.state -ne 'PREPARED') {
    Write-FailureRecord -RunDir $runDir -Code 'ORCHESTRATION_NOT_PREPARED' -Message "state must be PREPARED, actual $($state.state)"
    return 2
  }
  if ([string]$state.mode -ne $modeLower) {
    Write-FailureRecord -RunDir $runDir -Code 'ORCHESTRATION_MODE' -Message "orchestration.mode=$($state.mode), expected $modeLower"
    return 2
  }
  $requiredHashes = @('baseSha', 'codeSha', 'sandboxId', 'nonce', 'configSha256', 'inputManifestSha256', 'codeArchivePath', 'codeArchiveSha256')
  foreach ($key in $requiredHashes) {
    if ([string]::IsNullOrEmpty([string]$state.$key)) {
      Write-FailureRecord -RunDir $runDir -Code 'ORCHESTRATION_FIELD' -Message "orchestration.$key is empty"
      return 2
    }
  }

  $configFull = [System.IO.Path]::GetFullPath($ConfigPath)
  if ((Split-Path -Parent $configFull) -ne $runDir) {
    Write-FailureRecord -RunDir $runDir -Code 'CONFIG_LOCATION' -Message "config must live in the run dir: $configFull"
    return 2
  }
  if (-not (Test-Path -LiteralPath $configFull)) {
    Write-FailureRecord -RunDir $runDir -Code 'CONFIG_MISSING' -Message "missing config: $configFull"
    return 2
  }
  $actualConfigSha = Get-FileSha256Hex $configFull
  if ($actualConfigSha -ne [string]$state.configSha256) {
    Write-FailureRecord -RunDir $runDir -Code 'CONFIG_HASH_MISMATCH' -Message "config sha256=$actualConfigSha, expected $($state.configSha256)"
    return 2
  }

  $manifestPath = Join-Path $IncomingDir 'input-manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    Write-FailureRecord -RunDir $runDir -Code 'MANIFEST_MISSING' -Message "missing input-manifest: $manifestPath"
    return 2
  }
  $actualManifestSha = Get-FileSha256Hex $manifestPath
  if ($actualManifestSha -ne [string]$state.inputManifestSha256) {
    Write-FailureRecord -RunDir $runDir -Code 'MANIFEST_HASH_MISMATCH' -Message "manifest sha256=$actualManifestSha, expected $($state.inputManifestSha256)"
    return 2
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($key in @('mode', 'sandboxId', 'nonce', 'baseSha', 'codeSha')) {
    if ([string]$manifest.$key -ne [string]$state.$key) {
      Write-FailureRecord -RunDir $runDir -Code 'MANIFEST_BINDING' -Message "input-manifest.$key=$($manifest.$key), orchestration.$key=$($state.$key)"
      return 2
    }
  }

  $fields = @{
    mode = $modeLower
    baseSha = [string]$state.baseSha
    codeSha = [string]$state.codeSha
    codeArchivePath = [string]$state.codeArchivePath
    codeArchiveSha256 = [string]$state.codeArchiveSha256
    sandboxId = [string]$state.sandboxId
    nonce = [string]$state.nonce
    configSha256 = [string]$state.configSha256
    inputManifestSha256 = [string]$state.inputManifestSha256
    runtimeBundleSha256 = $state.runtimeBundleSha256
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
    handoff = $state.handoff
  }

  # -- start ------------------------------------------------------------------
  try {
    $process = Start-SandboxProcess -ConfigPath $configFull
  } catch {
    $message = $_.Exception.Message
    $code = 'SANDBOX_START_FAILED'
    if ($message -match '^([A-Z_]+):') { $code = $matches[1] }
    $fields.state = 'FAILED'
    $fields.hostExitCode = 2
    Write-JsonFile -Path $orchestrationPath -Value (New-Orchestration -Field $fields)
    Write-FailureRecord -RunDir $runDir -Code $code -Message $message
    return 2
  }
  if ($null -eq $process -or $null -eq $process.Pid) {
    $fields.state = 'FAILED'
    $fields.hostExitCode = 2
    Write-JsonFile -Path $orchestrationPath -Value (New-Orchestration -Field $fields)
    Write-FailureRecord -RunDir $runDir -Code 'SANDBOX_START_INVALID' -Message 'adapter returned no process identity'
    return 2
  }
  $hostPid = [int]$process.Pid
  $hostStart = ([datetime]$process.StartTime).ToUniversalTime().ToString('o')
  $fields.state = 'RUNNING'
  $fields.hostPid = $hostPid
  $fields.hostProcessStartTime = $hostStart
  $fields.startedAt = (Get-Date).ToUniversalTime().ToString('o')
  Write-JsonFile -Path $orchestrationPath -Value (New-Orchestration -Field $fields)

  # -- wait for the finished sentinel ----------------------------------------
  $finishedSentinelPath = Join-Path $OutgoingDir 'RUN_FINISHED.json'
  $startedSentinelPath = Join-Path $OutgoingDir 'RUN_STARTED.json'
  $deadline = (Get-Date).AddSeconds($FinishTimeoutSec)
  $finishedSentinel = $null
  $timedOut = $false
  $exitedWithoutSentinel = $false
  while ((Get-Date) -lt $deadline) {
    $finishedSentinel = Read-Sentinel -Path $finishedSentinelPath
    if ($null -ne $finishedSentinel) { break }
    $alive = Get-SandboxProcess -Pid $hostPid
    if ($null -eq $alive) {
      Start-Sleep -Milliseconds 250
      $finishedSentinel = Read-Sentinel -Path $finishedSentinelPath
      if ($null -eq $finishedSentinel) { $exitedWithoutSentinel = $true }
      break
    }
    Start-Sleep -Milliseconds $PollMilliseconds
  }
  if ($null -eq $finishedSentinel -and -not $exitedWithoutSentinel) { $timedOut = $true }

  $binding = [hashtable]@{
    issue = '1411'
    mode = $modeLower
    sandboxId = [string]$state.sandboxId
    nonce = [string]$state.nonce
    configSha256 = [string]$state.configSha256
    inputManifestSha256 = [string]$state.inputManifestSha256
  }
  $startedSentinel = Read-Sentinel -Path $startedSentinelPath
  $scriptExitCode = $null
  $failureMessage = $null
  if ($null -ne $finishedSentinel) {
    $failureMessage = Assert-SentinelBinding -Sentinel $finishedSentinel -Expected $binding -Label 'RUN_FINISHED'
    if ($null -eq $failureMessage) {
      $scriptExitCode = $finishedSentinel.data.scriptExitCode
      if ($scriptExitCode -isnot [int] -and $scriptExitCode -isnot [long]) {
        $failureMessage = 'RUN_FINISHED.scriptExitCode must be an integer'
      }
    }
  } elseif ($timedOut) {
    $failureMessage = "no RUN_FINISHED sentinel within ${FinishTimeoutSec}s"
  } else {
    $failureMessage = 'sandbox process exited without RUN_FINISHED sentinel'
  }
  if ($null -eq $failureMessage) {
    $startedProblem = Assert-SentinelBinding -Sentinel $startedSentinel -Expected $binding -Label 'RUN_STARTED'
    if ($null -ne $startedProblem) { $failureMessage = $startedProblem }
  }

  $finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  if ($null -eq $failureMessage -and $null -ne $scriptExitCode -and [int]$scriptExitCode -eq 0) {
    $fields.state = 'FINISHED'
  } elseif ($timedOut) {
    $fields.state = 'TIMED_OUT'
  } else {
    $fields.state = 'FAILED'
  }
  $fields.finishedAt = $finishedAt
  $fields.scriptExitCode = if ($null -eq $scriptExitCode) { $null } else { [int]$scriptExitCode }
  if ($null -ne $failureMessage) {
    Write-FailureRecord -RunDir $runDir -Code ($(if ($timedOut) { 'RUN_TIMED_OUT' } else { 'RUN_FINISHED_INVALID' })) -Message $failureMessage
  }
  if ($null -ne $startedSentinel) {
    $fields.startedSentinel = [ordered]@{
      path = Get-RelativeTaskPath -TaskRoot $taskRoot -Path $startedSentinelPath
      sha256 = $startedSentinel.sha256
    }
  }
  if ($null -ne $finishedSentinel) {
    $fields.finishedSentinel = [ordered]@{
      path = Get-RelativeTaskPath -TaskRoot $taskRoot -Path $finishedSentinelPath
      sha256 = $finishedSentinel.sha256
    }
  }
  $fields.hostExitCode = if ($fields.state -eq 'FINISHED') { 0 } else { 1 }
  Write-JsonFile -Path $orchestrationPath -Value (New-Orchestration -Field $fields)

  # -- destroy (same PID only) ------------------------------------------------
  $destroyed = $true
  $destroyFailure = $null
  $current = Get-SandboxProcess -Pid $hostPid
  if ($null -ne $current) {
    if (-not (Test-ProcessIdentity -Process $current -RecordedStartTime $hostStart)) {
      $destroyed = $false
      $destroyFailure = 'process identity (PID + StartTime) no longer matches the start record'
    } else {
      Close-SandboxMainWindow -Pid $hostPid | Out-Null
      $exited = Wait-SandboxProcessExit -Pid $hostPid -TimeoutMs ([math]::Max(1000, $CloseGraceSec * 1000))
      if (-not $exited) {
        Stop-SandboxProcess -Pid $hostPid | Out-Null
        $exited = Wait-SandboxProcessExit -Pid $hostPid -TimeoutMs 15000
      }
      if ($null -ne (Get-SandboxProcess -Pid $hostPid)) {
        $destroyed = $false
        $destroyFailure = "process $hostPid still alive after CloseMainWindow/Stop-Process"
      }
    }
  }
  if ($destroyed) {
    $fields.destroyedAt = (Get-Date).ToUniversalTime().ToString('o')
    if ($fields.state -eq 'FINISHED') { $fields.state = 'DESTROYED' }
    $fields.hostExitCode = if ($fields.state -eq 'DESTROYED') { 0 } else { 1 }
  } else {
    $fields.state = 'FAILED'
    $fields.hostExitCode = 2
    Write-FailureRecord -RunDir $runDir -Code 'DESTROY_FAILED' -Message $destroyFailure -Retryable 1
  }
  Write-JsonFile -Path $orchestrationPath -Value (New-Orchestration -Field $fields)

  if (-not $destroyed) { return 2 }
  if ($fields.state -eq 'DESTROYED') { return 0 }
  return 1
}

Export-ModuleMember -Function Invoke-SandboxLifecycle
