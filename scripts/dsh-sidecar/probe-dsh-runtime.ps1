# probe-dsh-runtime.ps1 -- the ten rc.5 probes (run only inside the offline probe sandbox).
#
# Called by Invoke-DshSandboxProbe.ps1 from C:\SynovaLab\work\repo\scripts\dsh-sidecar\.
# It writes evidence.json plus one log per probe into the outgoing directory.
#
# Contract (DEV DOC v6 SS6.3):
#   #1 portable node runs rc.5 lib/bin.js --version (exact 0.2.2-rc.5)
#   #2 rc.5 install lockfile version + integrity equal the pinned record
#   #3 isolated DSH_HOME --dump-config: exit 0 and stderr without "skipping profile bundle"
#   #4 active config: mode read-only, policy ask, zero 0.0.0.0 occurrences
#   #5 real ACP initialize + session/new roundtrip obtains a sessionId
#   #6 rc.5 tool dispatch for a registered/unregistered tool (-32000/-32601); if the shipped
#      protocol cannot reach tool dispatch without a model this records NOT DONE and stops
#   #7 start.ps1 -> stop.ps1 -> status.ps1; pid/state gone, SIDECAR_NOT_RUNNING, log has stopped
#   #8 backup/restore only on the sandbox home, then a status + session/new roundtrip
#   #9 rc.2 with explicit ExpectedVersion, then rc.5; rc.2 without ExpectedVersion must not spawn
#   #10 packaged repo/node_modules/.bin/vitest.cmd runs tests/runtime/dsh/isolation.test.ts
#   Any probe not executed/failed/NOT DONE => no lock record; the script stops (non-zero exit).
#
# exit 0 = ten probes green; 1 = a probe failed; 2 = setup/self failure or NOT DONE stop.

param(
  [Parameter(Mandatory = $true)][string]$WorkRoot,
  [Parameter(Mandatory = $true)][string]$Outgoing,
  [Parameter(Mandatory = $true)][string]$EvidencePath,
  [Parameter(Mandatory = $true)][string]$SandboxId,
  [Parameter(Mandatory = $true)][string]$Nonce,
  [Parameter(Mandatory = $true)][string]$BaseSha,
  [Parameter(Mandatory = $true)][string]$CodeSha,
  [Parameter(Mandatory = $true)][string]$ConfigSha256,
  [Parameter(Mandatory = $true)][string]$InputManifestSha256,
  [Parameter(Mandatory = $true)][string]$RuntimeBundleSha256
)

$ErrorActionPreference = 'Stop'

$Issue = 1411
$NodeVersion = 'v24.21.0'
$DshVersion = '0.2.2-rc.5'
$PreviousVersion = '0.2.2-rc.2'
$PinnedIntegrity = 'sha512-cNbp12tLYLUTXaVli7zwwMjzmmEVCD1PRldg4oKtXM4+lFYckcaliMS2PU/FoThB4iAN/fKOSID0nrtRZU4Gjw=='

$StartedAt = (Get-Date).ToUniversalTime().ToString('o')
$RepoRoot = Join-Path $WorkRoot 'repo'
$NodeDir = Join-Path $WorkRoot 'node'
$InstallRoot = Join-Path $WorkRoot 'install'
$DshHome = Join-Path $WorkRoot 'home'
$InstanceDir = Join-Path $WorkRoot 'instance'
$ProbeWork = Join-Path $WorkRoot 'probe'
$LogsDir = Join-Path $Outgoing 'logs'
$NodeExe = Join-Path $NodeDir 'node.exe'
$BinPinned = Join-Path $InstallRoot "$DshVersion\node_modules\@deepseek-ai\dsh\lib\bin.js"
$BinPrevious = Join-Path $InstallRoot "$PreviousVersion\node_modules\@deepseek-ai\dsh\lib\bin.js"
$SidecarScripts = Join-Path $RepoRoot 'scripts\dsh-sidecar'

function Write-JsonFile([string]$Path, $Value) {
  $json = $Value | ConvertTo-Json -Depth 12
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

function Get-Sha256Hex([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
}

function Write-Log([string]$Name, [string]$Text) {
  $path = Join-Path $LogsDir $Name
  [System.IO.File]::WriteAllText($path, $Text, (New-Object System.Text.UTF8Encoding($false)))
  return $path
}

function Run-Node([string]$LogName, [string]$Arguments, [string]$WorkingDirectory) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $NodeExe
  $psi.Arguments = $Arguments
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $process = [System.Diagnostics.Process]::Start($psi)
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  $path = Write-Log $LogName ("COMMAND: node " + $Arguments + "`nCWD: " + $WorkingDirectory + "`nEXIT: " + $process.ExitCode + "`n--- stdout ---`n" + $stdout + "`n--- stderr ---`n" + $stderr)
  return [pscustomobject]@{ exitCode = $process.ExitCode; stdout = $stdout; stderr = $stderr; logPath = $path }
}

function Run-PowerShellFile([string]$LogName, [string]$ScriptPath, [string[]]$Arguments) {
  $all = New-Object System.Collections.Generic.List[string]
  $all.Add(('COMMAND: powershell -File {0} {1}' -f $ScriptPath, ($Arguments -join ' ')))
  $output = (& powershell -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments 2>&1 | Out-String)
  $code = $LASTEXITCODE
  $all.Add($output)
  $all.Add(('EXIT: {0}' -f $code))
  $path = Write-Log $LogName ($all -join "`n")
  return [pscustomobject]@{ exitCode = $code; output = $output; logPath = $path }
}

function Run-Native([string]$LogName, [string]$Exe, [string[]]$Arguments, [string]$WorkingDirectory) {
  $all = New-Object System.Collections.Generic.List[string]
  $all.Add(('COMMAND: {0} {1}' -f $Exe, ($Arguments -join ' ')))
  Push-Location $WorkingDirectory
  try {
    $output = (& $Exe @Arguments 2>&1 | Out-String)
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  $all.Add($output)
  $all.Add(('EXIT: {0}' -f $code))
  $path = Write-Log $LogName ($all -join "`n")
  return [pscustomobject]@{ exitCode = $code; output = $output; logPath = $path }
}

function New-ProbeRecord([int]$Id, [string]$Name, [string]$Command, [bool]$Executed, [bool]$Ok, [int]$ExitCode, [string]$Observed, [string]$LogPath) {
  $sha = ''
  if (Test-Path -LiteralPath $LogPath) { $sha = Get-Sha256Hex $LogPath }
  return [ordered]@{
    id = $Id
    name = $Name
    executed = $Executed
    ok = $Ok
    command = $Command
    exitCode = $ExitCode
    expectedExitCode = 0
    observed = $Observed
    logPath = ('logs/' + (Split-Path -Leaf $LogPath))
    logSha256 = $sha
  }
}

function Write-Evidence($Probes) {
  $evidence = [ordered]@{
    schemaVersion = 1
    issue = $Issue
    mode = 'probe'
    baseSha = $BaseSha
    codeSha = $CodeSha
    sandboxId = $SandboxId
    nonce = $Nonce
    startedAt = $StartedAt
    finishedAt = (Get-Date).ToUniversalTime().ToString('o')
    configSha256 = $ConfigSha256
    inputManifestSha256 = $InputManifestSha256
    runtimeBundleSha256 = $RuntimeBundleSha256
    nodeVersion = $NodeVersion
    dshVersion = $DshVersion
    probes = $Probes
  }
  Write-JsonFile -Path $EvidencePath -Value $evidence
}

if (-not (Test-Path -LiteralPath $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null }
if (-not (Test-Path -LiteralPath $ProbeWork)) { New-Item -ItemType Directory -Path $ProbeWork -Force | Out-Null }
if (-not (Test-Path -LiteralPath $InstanceDir)) { New-Item -ItemType Directory -Path $InstanceDir -Force | Out-Null }
if (-not (Test-Path -LiteralPath $DshHome)) { New-Item -ItemType Directory -Path $DshHome -Force | Out-Null }
$env:DSH_HOME = $DshHome

foreach ($required in @($NodeExe, $BinPinned, $BinPrevious)) {
  if (-not (Test-Path -LiteralPath $required)) {
    Write-Evidence @()
    Write-JsonFile -Path (Join-Path $Outgoing 'probe-failure.json') -Value ([ordered]@{ code = 'PROBE_SETUP'; message = "missing $required" })
    exit 2
  }
}

$probes = @()
$stop = $false
$probesExited = 0

# #1 -- portable node runs the rc.5 bin --version
$r1 = Run-Node '01-version.log' ('"' + $BinPinned + '" --version') $RepoRoot
$observed1 = $r1.stdout.Trim()
$probes += New-ProbeRecord 1 'rc.5 bin --version' 'node <install>/node_modules/@deepseek-ai/dsh/lib/bin.js --version' ($r1.exitCode -eq 0) (($r1.exitCode -eq 0) -and ($observed1 -eq $DshVersion)) $r1.exitCode $observed1 $r1.logPath
if ($r1.exitCode -ne 0 -or $observed1 -ne $DshVersion) { $stop = $true }

# #2 -- lockfile version + integrity
$lockPath = Join-Path $InstallRoot "$DshVersion\dsh-install-lock.json"
$lockOk = $false
$lockObserved = 'lockfile missing'
if (Test-Path -LiteralPath $lockPath) {
  $lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $lockObserved = 'version=' + [string]$lock.version + ' integrity=' + [string]$lock.integrity
  $lockOk = ([string]$lock.version -eq $DshVersion) -and ([string]$lock.integrity -eq $PinnedIntegrity)
}
$lockLog = Write-Log '02-lock.log' ("LOCK: " + $lockPath + "`n" + $lockObserved)
$probes += New-ProbeRecord 2 'rc.5 lockfile version + integrity' 'read <install>/0.2.2-rc.5/dsh-install-lock.json' $true $lockOk $(if ($lockOk) { 0 } else { 1 }) $lockObserved $lockLog
if (-not $lockOk) { $stop = $true }

# #3 -- isolated home --dump-config, stderr clean
$dump = Run-Node '03-dump-config.log' ('"' + $BinPinned + '" --profile synova-sidecar --dump-config') $RepoRoot
$skipWarning = $dump.stderr -match 'skipping profile bundle'
$probes += New-ProbeRecord 3 'isolated --dump-config' 'node <bin.js> --profile synova-sidecar --dump-config' ($dump.exitCode -eq 0) (($dump.exitCode -eq 0) -and (-not $skipWarning)) $dump.exitCode ('exit=' + $dump.exitCode + ' skipping-profile-bundle=' + $skipWarning) $dump.logPath
if ($dump.exitCode -ne 0 -or $skipWarning) { $stop = $true }
$dumpConfigText = $dump.stdout

# #4 -- active config posture
$modeOk = $dumpConfigText -match 'mode:\s*read-only'
$policyOk = $dumpConfigText -match 'policy:\s*ask'
$zeroBindCount = ([regex]::Matches($dumpConfigText, '0\.0\.0\.0')).Count
$extraBindCount = ([regex]::Matches($dumpConfigText, '127\.0\.0\.1')).Count
$configOk = $modeOk -and $policyOk -and ($zeroBindCount -eq 0)
$observed4 = "mode-read-only=$modeOk policy-ask=$policyOk 0.0.0.0-count=$zeroBindCount 127.0.0.1-count=$extraBindCount"
$log4 = Write-Log '04-config-posture.log' $observed4
$probes += New-ProbeRecord 4 'active config posture' 'inspect --dump-config output' $true $configOk $(if ($configOk) { 0 } else { 1 }) $observed4 $log4
if (-not $configOk) { $stop = $true }

# #5 -- real ACP initialize + session/new roundtrip
$roundtripScript = Join-Path $ProbeWork 'acp-roundtrip.mjs'
$roundtripSource = @'
import { spawn } from 'node:child_process';
const [ , , binPath, cwd, dshHome ] = process.argv;
const child = spawn(process.execPath, [binPath, '--profile', 'synova-sidecar'], {
  cwd, env: { ...process.env, DSH_HOME: dshHome }, stdio: ['pipe', 'pipe', 'pipe'],
});
let buffer = '';
let done = false;
const finish = (code, payload) => {
  if (done) return;
  done = true;
  process.stdout.write(JSON.stringify(payload) + '\n');
  try { child.kill(); } catch { /* already gone */ }
  process.exit(code);
};
const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
const timer = setTimeout(() => finish(2, { ok: false, code: 'ACP_TIMEOUT', message: 'no session/new within 120s' }), 120000);
child.stderr.on('data', () => { /* stderr is captured by the caller's log */ });
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let message;
    try { message = JSON.parse(trimmed); } catch { continue; }
    if (message.id === 1 && message.result) {
      send({ jsonrpc: '2.0', method: 'session/new', id: 2, params: { cwd, mcpServers: [] } });
    } else if (message.id === 2) {
      clearTimeout(timer);
      if (message.result && typeof message.result.sessionId === 'string') {
        finish(0, { ok: true, sessionId: message.result.sessionId });
      } else {
        finish(1, { ok: false, code: 'ACP_SESSION_NEW_FAILED', error: message.error ?? null });
      }
    } else if (message.error && message.id === 1) {
      clearTimeout(timer);
      finish(1, { ok: false, code: 'ACP_INITIALIZE_FAILED', error: message.error });
    }
  }
});
child.on('exit', (code) => { clearTimeout(timer); finish(1, { ok: false, code: 'ACP_EXITED', exitCode: code }); });
send({ jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: 1, clientInfo: { name: 'synova-probe', version: '1.0.0' }, capabilities: {} } });
'@
[System.IO.File]::WriteAllText($roundtripScript, $roundtripSource, (New-Object System.Text.UTF8Encoding($false)))
$r5 = Run-Node '05-acp-roundtrip.log' ('"' + $roundtripScript + '" "' + $BinPinned + '" "' + $InstanceDir + '" "' + $DshHome + '"') $ProbeWork
$r5Json = $null
try { $r5Json = $r5.stdout.Trim() | ConvertFrom-Json } catch { $r5Json = $null }
$r5Ok = ($r5.exitCode -eq 0) -and ($null -ne $r5Json) -and ($r5Json.ok -eq $true) -and ([string]$r5Json.sessionId -ne '')
$observed5 = if ($null -ne $r5Json) { 'ok=' + [string]$r5Json.ok + ' sessionId=' + [string]$r5Json.sessionId } else { 'no JSON result' }
$probes += New-ProbeRecord 5 'ACP initialize + session/new' 'node acp-roundtrip.mjs <bin.js> <instanceDir> <dshHome>' $true $r5Ok $(if ($r5Ok) { 0 } else { 1 }) $observed5 $r5.logPath
if (-not $r5Ok) { $stop = $true } else {
  $sessionId = [string]$r5Json.sessionId
  $probesExited += 1
}

# #6 -- rc.5 tool dispatch without a model: NOT DONE + stop
$observed6 = 'NOT DONE: the shipped rc.5 ACP surface reaches tool dispatch only through a model turn; no model/credential is allowed in this ticket, so probe #6 stops instead of degrading to a function test'
$log6 = Write-Log '06-tool-dispatch-not-done.log' $observed6
$probes += [ordered]@{
  id = 6
  name = 'rc.5 tool dispatch (-32000/-32601)'
  executed = $false
  ok = $false
  command = 'n/a (stopped)'
  exitCode = 2
  expectedExitCode = 0
  observed = $observed6
  logPath = 'logs/06-tool-dispatch-not-done.log'
  logSha256 = (Get-Sha256Hex $log6)
}
Write-Evidence $probes
Write-JsonFile -Path (Join-Path $Outgoing 'probe-failure.json') -Value ([ordered]@{ code = 'PROBE_6_NOT_DONE'; message = $observed6 })
exit 2

# ---------------------------------------------------------------------------
# Probes #7-#10.
#
# Policy note (DEV DOC v6 SS6.3): probe #6 above records NOT DONE and stops before this point
# whenever the shipped rc.5 ACP surface cannot reach tool dispatch without a model. The code
# below stays in this single probe script (the DEV DOC requires all ten probes here) and is
# reached only in an environment where probe #6 can be executed; today the ticket forbids any
# model/credential, so T3/T4 stops at #6 and no lock record may be produced.
# ---------------------------------------------------------------------------

$statePath = Join-Path $DshHome 'run\synova-sidecar.json'
$startScript = Join-Path $SidecarScripts 'start.ps1'
$stopScript = Join-Path $SidecarScripts 'stop.ps1'
$statusScript = Join-Path $SidecarScripts 'status.ps1'
$logsScript = Join-Path $SidecarScripts 'logs.ps1'
$backupScript = Join-Path $SidecarScripts 'backup.ps1'
$restoreScript = Join-Path $SidecarScripts 'restore.ps1'
$installPinned = Join-Path $InstallRoot $DshVersion
$installPrevious = Join-Path $InstallRoot $PreviousVersion

# #7 -- start -> status -> stop -> status(exit 1) -> logs(stopped) -> state file gone
$r7start = Run-PowerShellFile '07-start.log' $startScript @('-InstanceDir', $InstanceDir, '-DshHome', $DshHome, '-InstallDir', $installPinned, '-ExpectedVersion', $DshVersion, '-TimeoutSec', '120')
$r7status = Run-PowerShellFile '07-status.log' $statusScript @('-InstanceDir', $InstanceDir, '-DshHome', $DshHome)
$r7stop = Run-PowerShellFile '07-stop.log' $stopScript @('-InstanceDir', $InstanceDir, '-DshHome', $DshHome)
$r7statusAfter = Run-PowerShellFile '07-status-after.log' $statusScript @('-InstanceDir', $InstanceDir, '-DshHome', $DshHome)
$r7logs = Run-PowerShellFile '07-logs.log' $logsScript @('-InstanceDir', $InstanceDir, '-DshHome', $DshHome, '-Lines', '200')
$stateGone = -not (Test-Path -LiteralPath $statePath)
$logStopped = $r7logs.output -match 'stopped'
$statusAfterOk = ($r7statusAfter.exitCode -eq 1) -and ($r7statusAfter.output -match 'SIDECAR_NOT_RUNNING')
$ok7 = ($r7start.exitCode -eq 0) -and ($r7status.exitCode -eq 0) -and ($r7stop.exitCode -eq 0) -and $statusAfterOk -and $stateGone -and $logStopped
$observed7 = "start=$($r7start.exitCode) status=$($r7status.exitCode) stop=$($r7stop.exitCode) status-after=$($r7statusAfter.exitCode) state-gone=$stateGone log-stopped=$logStopped"
$log7 = Write-Log '07-summary.log' $observed7
$probes += New-ProbeRecord 7 'start/stop/status/logs lifecycle' 'start.ps1 -> status.ps1 -> stop.ps1 -> status.ps1 -> logs.ps1' $true $ok7 $(if ($ok7) { 0 } else { 1 }) $observed7 $log7
if (-not $ok7) { Write-Evidence $probes; exit 1 }

# #8 -- backup/restore only on the sandbox home, then status + session/new roundtrip
$backupDir = Join-Path $WorkRoot 'backup'
$r8backup = Run-PowerShellFile '08-backup.log' $backupScript @('-DshHome', $DshHome, '-BackupDir', $backupDir)
$backupTarget = ''
if ($r8backup.output -match '"target"\s*:\s*"([^"]+)"') { $backupTarget = $matches[1] }
$r8restore = Run-PowerShellFile '08-restore.log' $restoreScript @('-BackupDir', $backupTarget, '-TargetDshHome', $DshHome)
$r8start = Run-PowerShellFile '08-start.log' $startScript @('-InstanceDir', $InstanceDir, '-DshHome', $DshHome, '-InstallDir', $installPinned, '-ExpectedVersion', $DshVersion, '-TimeoutSec', '120')
$r8status = Run-PowerShellFile '08-status.log' $statusScript @('-InstanceDir', $InstanceDir, '-DshHome', $DshHome)
$r8roundtrip = Run-Node '08-roundtrip.log' ('"' + $roundtripScript + '" "' + $BinPinned + '" "' + $InstanceDir + '" "' + $DshHome + '"') $ProbeWork
$r8stop = Run-PowerShellFile '08-stop.log' $stopScript @('-InstanceDir', $InstanceDir, '-DshHome', $DshHome)
$r8Json = $null
try { $r8Json = $r8roundtrip.stdout.Trim() | ConvertFrom-Json } catch { $r8Json = $null }
$ok8 = ($r8backup.exitCode -eq 0) -and ($backupTarget -ne '') -and ($r8restore.exitCode -eq 0) -and
  ($r8start.exitCode -eq 0) -and ($r8status.exitCode -eq 0) -and ($r8roundtrip.exitCode -eq 0) -and
  ($null -ne $r8Json) -and ($r8Json.ok -eq $true) -and ([string]$r8Json.sessionId -ne '') -and ($r8stop.exitCode -eq 0)
$observed8 = "backup=$($r8backup.exitCode) restore=$($r8restore.exitCode) start=$($r8start.exitCode) status=$($r8status.exitCode) roundtrip=$($r8roundtrip.exitCode) stop=$($r8stop.exitCode)"
$log8 = Write-Log '08-summary.log' $observed8
$probes += New-ProbeRecord 8 'backup/restore on sandbox home' 'backup.ps1 -> restore.ps1 -> start/status/roundtrip/stop' $true $ok8 $(if ($ok8) { 0 } else { 1 }) $observed8 $log8
if (-not $ok8) { Write-Evidence $probes; exit 1 }

# #9 -- rc.2 only with explicit ExpectedVersion; production rc.2 without it must not spawn
$r9previous = Run-PowerShellFile '09-previous-explicit.log' $startScript @('-InstanceDir', $InstanceDir, '-DshHome', $DshHome, '-InstallDir', $installPrevious, '-ExpectedVersion', $PreviousVersion, '-TimeoutSec', '120')
$r9status = Run-PowerShellFile '09-previous-status.log' $statusScript @('-InstanceDir', $InstanceDir, '-DshHome', $DshHome)
$r9stop = Run-PowerShellFile '09-previous-stop.log' $stopScript @('-InstanceDir', $InstanceDir, '-DshHome', $DshHome)
$r9negative = Run-PowerShellFile '09-previous-negative.log' $startScript @('-InstanceDir', $InstanceDir, '-DshHome', $DshHome, '-InstallDir', $installPrevious, '-TimeoutSec', '600')
$negativeStateGone = -not (Test-Path -LiteralPath $statePath)
$ok9 = ($r9previous.exitCode -eq 0) -and ($r9status.exitCode -eq 0) -and ($r9status.output -match '"installedVersion"\s*:\s*"' ) -and
  ($r9status.output -match [regex]::Escape($PreviousVersion)) -and ($r9stop.exitCode -eq 0) -and
  ($r9negative.exitCode -eq 1) -and ($r9negative.output -match 'DSH_VERSION_MISMATCH') -and $negativeStateGone
$observed9 = "previous-explicit=$($r9previous.exitCode) previous-status=$($r9status.exitCode) previous-stop=$($r9stop.exitCode) previous-without-expected=$($r9negative.exitCode) state-gone=$negativeStateGone"
$log9 = Write-Log '09-summary.log' $observed9
$probes += New-ProbeRecord 9 'explicit rc.2 fallback + production mismatch' 'start.ps1 -ExpectedVersion 0.2.2-rc.2 (then without it)' $true $ok9 $(if ($ok9) { 0 } else { 1 }) $observed9 $log9
if (-not $ok9) { Write-Evidence $probes; exit 1 }

# #10 -- packaged vitest runs the isolation test with DSH stopped; never npx
$vitest = Join-Path $RepoRoot 'node_modules\.bin\vitest.cmd'
$r10 = Run-Native '10-isolation.log' $vitest @('run', 'tests/runtime/dsh/isolation.test.ts') $RepoRoot
$usedNpx = $false
$ok10 = ($r10.exitCode -eq 0) -and (-not $usedNpx)
$observed10 = "vitest=$($r10.exitCode) npx-used=$usedNpx"
$log10 = Write-Log '10-summary.log' $observed10
$probes += New-ProbeRecord 10 'domain still usable after DSH stopped' 'node_modules/.bin/vitest.cmd run tests/runtime/dsh/isolation.test.ts' $true $ok10 $(if ($ok10) { 0 } else { 1 }) $observed10 $log10

Write-Evidence $probes
if ($ok10) { exit 0 }
exit 1