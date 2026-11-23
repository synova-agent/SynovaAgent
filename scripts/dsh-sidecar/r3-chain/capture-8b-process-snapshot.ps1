<#
capture-8b-process-snapshot.ps1 -- Done 8(b) process-exit observation for Issue #1455 (T7).

WHY THIS EXISTS (and why the old boolean is not evidence):
  docs/.../r3-chain-1455/02-acp-initialize.json:100-106 "pidCheckAfterStop" was assembled by
  _r3chain-20261123/ops/make-02-acp-initialize.mjs, which takes supervisorAlive / acpAlive /
  stateFilePresent straight from process.argv (mjs:16) and hardcodes the two PIDs as literals
  (mjs:70,72). A caller-supplied boolean is not an observation. This collector instead queries the
  OS directly, twice, around the product stop wrapper:

      start.ps1  ->  read state PIDs  ->  snapshot BEFORE stop  ->  stop.ps1  ->  snapshot AFTER stop

  `allGone` is derived mechanically from the AFTER observation. It is never taken from the stop
  wrapper's exit code, and never from an argument.

WHAT IS RAW:
  Every command line and its verbatim output is written to T7-8b-process-snapshot-before.txt /
  -after.txt. The only permitted alteration is the transient loopback supervisor control token
  (`--control-token <hex>` on the supervisor command line, and `"controlToken": "<hex>"` in the
  start wrapper's JSON stdout), which is replaced by `<redacted>`. Same discipline as deviation D6
  / T2-raw-redaction.txt: it is not a model credential, but it does not get committed either.

PID REUSE:
  A live PID alone does not prove "the same process is still running". Identity is therefore
  (pid, CreationDate). A target PID that is still present with a DIFFERENT CreationDate is recorded
  as pidReused and does NOT count as the original process surviving.

USAGE:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dsh-sidecar/r3-chain/capture-8b-process-snapshot.ps1 `
    -InstanceDir <instance> -DshHome <dsh-home> -InstallDir <install/0.2.2-rc.5> `
    -EvidenceDir <repo>/docs/synova/product-lines/evidence/r3-chain-1455

CONTRACT (three-state, per measurement discipline):
  exit 0 = observation complete AND every target process gone        -> 8(b) PASS
  exit 1 = observation complete AND a target process still alive     -> 8(b) FAIL
  exit 2 = collection/wrapper failure, cannot judge                  -> complete=false, `allGone` omitted

COST: zero model rounds, zero outbound network. Local start/stop of the local sidecar only.
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstanceDir,
  [Parameter(Mandatory = $true)][string]$DshHome,
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$EvidenceDir,
  [string]$RepoRoot = '',
  [string]$ExpectedVersion = '0.2.2-rc.5',
  [int]$StartTimeoutSec = 120,
  [int]$StopTimeoutSec = 20
)

$ErrorActionPreference = 'Stop'

# Native command output (tasklist) is written in the console code page; pin UTF-8 so the captured
# text is not mojibake and the committed file is readable. This changes no value, only the decoding.
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  & cmd /c "chcp 65001>nul" 2>&1 | Out-Null
} catch { }

$script:redactionApplied = $false
$script:collectionErrors = New-Object System.Collections.ArrayList
# The live control-token value, held in memory only so it can be scrubbed verbatim from any captured
# text. It is never written to any evidence file.
$script:secretToken = ''

function Protect-Text {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return '' }
  $before = $Text
  # (a) the CLI form: `--control-token <value>`
  $after = [regex]::Replace($Text, '(?s)(--control-token\s+)(?!<redacted>)\S+', '$1<redacted>')
  # (b) display wrapping can split a long token across lines, leaving a hex tail after the marker.
  $after = [regex]::Replace($after, '(?s)(<redacted>[ \t]*(?:\r?\n[ \t]*)?)[0-9a-fA-F]{16,}', '$1')
  # (c) the JSON form: "controlToken": "<value>"
  $after = [regex]::Replace($after, '("controlToken"\s*:\s*")(?!<redacted>)[^"]*(")', '$1<redacted>$2')
  # (d) verbatim scrub of the known live value (belt and braces; catches any layout we did not foresee)
  if (-not [string]::IsNullOrEmpty($script:secretToken)) {
    $after = $after.Replace($script:secretToken, '<redacted>')
  }
  if ($after -ne $before) { $script:redactionApplied = $true }
  return $after
}

# Final gate before anything is written: the live token must not appear anywhere in the payload.
function Assert-NoSecret {
  param([string]$Text, [string]$Where)
  if ([string]::IsNullOrEmpty($script:secretToken)) { return $Text }
  if ($Text.Contains($script:secretToken)) {
    [void]$script:collectionErrors.Add('secret remnant scrubbed from ' + $Where)
    $Text = $Text.Replace($script:secretToken, '<redacted>')
    $script:redactionApplied = $true
  }
  if ($Text.Contains($script:secretToken)) {
    [void]$script:collectionErrors.Add('SECRET STILL PRESENT in ' + $Where + ' after scrubbing')
  }
  return $Text
}

function ConvertTo-LfText {
  param([string]$Text)
  if ($null -eq $Text) { return '' }
  return (($Text -replace "`r`n", "`n").TrimEnd())
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Text)
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

function Quote-Arg {
  param([string]$Value)
  if ($Value -match '[\s"]') { return '"' + $Value + '"' }
  return $Value
}

# Captures a wrapper's stdout/stderr through FILE redirection, never through a PowerShell pipeline.
# Why: the sidecar supervisor is spawned detached and can keep an inherited pipe handle open, so a
# pipeline would wait for EOF that never comes (this bit the T2 cycle-1 capture, deviation D7).
# File redirection plus an explicit process timeout cannot block on a lingering grandchild handle.
function Invoke-Wrapper {
  param([string]$ScriptPath, [string[]]$WrapperArguments, [string]$Label, [int]$TimeoutMs)
  $display = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + $ScriptPath + '" ' + ($WrapperArguments -join ' ')
  $output = ''
  $code = $null
  $exitNote = ''
  $stamp = [guid]::NewGuid().ToString('N')
  $outFile = Join-Path ([System.IO.Path]::GetTempPath()) ('t7-8b-' + $Label + '-' + $stamp + '.out.txt')
  $errFile = Join-Path ([System.IO.Path]::GetTempPath()) ('t7-8b-' + $Label + '-' + $stamp + '.err.txt')
  try {
    $argString = (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Quote-Arg $ScriptPath)) + ($WrapperArguments | ForEach-Object { Quote-Arg $_ })) -join ' '
    $proc = Start-Process -FilePath 'powershell' -ArgumentList $argString -NoNewWindow -PassThru `
      -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    if (-not $proc.WaitForExit($TimeoutMs)) {
      try { $proc.Kill() } catch { }
      [void]$script:collectionErrors.Add($Label + ' wrapper did not exit within ' + $TimeoutMs + ' ms')
      $exitNote = 'wrapper did not exit within ' + $TimeoutMs + ' ms'
    } else {
      # Windows PowerShell 5.1 quirk: Start-Process -PassThru leaves ExitCode unset unless -Wait is
      # used, and -Wait would block on the detached supervisor subtree. Recorded as "not observed"
      # rather than guessed. The verdict never depends on it: the wrapper's own JSON is preserved
      # verbatim in the *RawStdout fields AS THE WRAPPER'S CLAIM, and Done 8(b) is judged only from
      # the OS process observation.
      if ($null -eq $proc.ExitCode) {
        $exitNote = 'Windows PowerShell 5.1 Start-Process -PassThru does not populate ExitCode without -Wait (and -Wait would block on the detached supervisor subtree)'
      } else {
        $code = [int]$proc.ExitCode
        $exitNote = 'observed'
      }
    }
    $stdout = ''
    $stderr = ''
    if (Test-Path $outFile) { $stdout = Get-Content -Path $outFile -Raw }
    if (Test-Path $errFile) { $stderr = Get-Content -Path $errFile -Raw }
    $output = $stdout
    if (-not [string]::IsNullOrWhiteSpace($stderr)) {
      $output = $output + "`n--- stderr ---`n" + $stderr
    }
  } catch {
    $output = 'ERROR: ' + $_.Exception.Message
    [void]$script:collectionErrors.Add($Label + ' wrapper threw: ' + $_.Exception.Message)
  } finally {
    foreach ($f in @($outFile, $errFile)) {
      if (Test-Path $f) { try { Remove-Item -Path $f -Force } catch { } }
    }
  }
  return [pscustomobject]@{
    label        = $Label
    command      = $display
    exitCode     = $code
    exitCodeNote = $exitNote
    output       = (ConvertTo-LfText (Protect-Text $output))
  }
}

# Observes one PID through three independent OS channels and returns the raw text of each.
function Get-ProcObservation {
  param([int]$ProcessId, [string]$Role)

  $tlRaw = ''
  $tlCode = -1
  try {
    $tlRaw = & tasklist /FI "PID eq $ProcessId" 2>&1 | Out-String
    $tlCode = $LASTEXITCODE
  } catch {
    $tlRaw = 'ERROR: ' + $_.Exception.Message
    [void]$script:collectionErrors.Add('tasklist pid=' + $ProcessId + ': ' + $_.Exception.Message)
  }
  $tlRaw = ConvertTo-LfText (Protect-Text $tlRaw)
  $tlRowPresent = [bool]($tlRaw -match ('(^|\s)' + $ProcessId + '(\s|$)'))

  $gpFound = $false
  $gpRaw = ''
  $gpErr = $null
  $gpStartTime = ''
  try {
    $proc = Get-Process -Id $ProcessId -ErrorAction Stop
    $gpFound = $true
    $gpStartTime = $proc.StartTime.ToString('o')
    $gpRaw = $proc | Format-List Id, ProcessName, StartTime, Path | Out-String
  } catch {
    # Absence is a legitimate observation, not a collection failure.
    $gpErr = $_.Exception.Message
    $gpRaw = 'ERROR: ' + $gpErr
  }
  $gpRaw = ConvertTo-LfText (Protect-Text $gpRaw)

  $cimFound = $false
  $cimRaw = ''
  $cimErr = $null
  $cimObj = $null
  try {
    $cimObj = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $ProcessId) -ErrorAction Stop
    if ($null -eq $cimObj) {
      $cimRaw = 'CIM: no Win32_Process row for pid ' + $ProcessId
    } else {
      $cimFound = $true
      # Values are emitted verbatim and UNWRAPPED. `Format-List` pads and wraps long values at the
      # display width, which can split a token mid-value and defeat redaction; printing the property
      # values ourselves keeps them intact and is therefore both safer and more faithful.
      $cimRaw = "`nProcessId       : " + [string]$cimObj.ProcessId +
                "`nParentProcessId : " + [string]$cimObj.ParentProcessId +
                "`nCreationDate    : " + [string]$cimObj.CreationDate +
                "`nCommandLine     : " + [string]$cimObj.CommandLine + "`n"
    }
  } catch {
    $cimErr = $_.Exception.Message
    $cimRaw = 'ERROR: ' + $cimErr
    [void]$script:collectionErrors.Add('cim pid=' + $ProcessId + ': ' + $cimErr)
  }
  $cimRaw = ConvertTo-LfText (Protect-Text $cimRaw)

  $creationDate = ''
  $cmdline = ''
  $imageName = ''
  if ($cimFound) {
    if ($null -ne $cimObj.CreationDate) { $creationDate = $cimObj.CreationDate.ToString('o') }
    $cmdline = Protect-Text ([string]$cimObj.CommandLine)
    $imageName = [string]$cimObj.Name
  }

  # Channel disagreement means we cannot state presence or absence confidently.
  $present = ($gpFound -or $cimFound -or $tlRowPresent)
  $channels = @($gpFound, $cimFound, $tlRowPresent)
  if (($channels -contains $true) -and ($channels -contains $false)) {
    [void]$script:collectionErrors.Add('pid=' + $ProcessId + ' channels disagree: getProcess=' + $gpFound + ' cim=' + $cimFound + ' tasklist=' + $tlRowPresent)
  }

  return [pscustomobject]@{
    role         = $Role
    pid          = $ProcessId
    present      = $present
    imageName    = $imageName
    creationDate = $creationDate
    startTime    = $gpStartTime
    cmdline      = $cmdline
    tasklist     = [pscustomobject]@{ command = ('tasklist /FI "PID eq ' + $ProcessId + '"'); exitCode = $tlCode; rowPresent = $tlRowPresent; raw = $tlRaw }
    getProcess   = [pscustomobject]@{ command = ('Get-Process -Id ' + $ProcessId); found = $gpFound; error = $gpErr; raw = $gpRaw }
    cim          = [pscustomobject]@{ command = ('Get-CimInstance Win32_Process -Filter "ProcessId=' + $ProcessId + '"'); found = $cimFound; error = $cimErr; raw = $cimRaw }
  }
}

# Independent leftover sweep: any process still shaped like THIS sidecar's supervisor or ACP child.
function Get-LeftoverProcesses {
  param([string]$InstallDirPath)
  $found = New-Object System.Collections.ArrayList
  try {
    foreach ($p in (Get-CimInstance Win32_Process -ErrorAction Stop)) {
      if ($null -eq $p.CommandLine) { continue }
      $cl = [string]$p.CommandLine
      $isSupervisor = ($cl -match 'sidecar\.(ts|js)') -and ($cl -match '--action\s+supervise')
      $isAcp = ($cl -match [regex]::Escape($InstallDirPath)) -and ($cl -match 'bin\.js')
      if ($isSupervisor -or $isAcp) {
        [void]$found.Add([pscustomobject]@{
          pid          = $p.ProcessId
          imageName    = [string]$p.Name
          creationDate = $(if ($null -ne $p.CreationDate) { $p.CreationDate.ToString('o') } else { '' })
          shape        = $(if ($isSupervisor) { 'supervisor' } else { 'acp' })
          cmdline      = (Protect-Text $cl)
        })
      }
    }
  } catch {
    [void]$script:collectionErrors.Add('leftover scan: ' + $_.Exception.Message)
  }
  return $found
}

function Format-ObservationBlock {
  param([object]$Observation, [int]$Index)
  $sb = New-Object System.Text.StringBuilder
  $role = $Observation.role
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('=== [' + $Index + '] raw observation: ' + $role + ' pid ' + $Observation.pid + ' ===')
  [void]$sb.AppendLine('cmd: ' + $Observation.tasklist.command)
  [void]$sb.AppendLine('exit: ' + $Observation.tasklist.exitCode)
  [void]$sb.AppendLine('--- raw output ---')
  [void]$sb.AppendLine($Observation.tasklist.raw)
  [void]$sb.AppendLine('--- end raw output ---')
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('cmd: ' + $Observation.getProcess.command)
  [void]$sb.AppendLine('--- raw output ---')
  [void]$sb.AppendLine($Observation.getProcess.raw)
  [void]$sb.AppendLine('--- end raw output ---')
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('cmd: ' + $Observation.cim.command)
  [void]$sb.AppendLine('--- raw output ---')
  [void]$sb.AppendLine($Observation.cim.raw)
  [void]$sb.AppendLine('--- end raw output ---')
  return $sb.ToString()
}

# -- resolve paths ------------------------------------------------------------
if ([string]::IsNullOrEmpty($RepoRoot)) {
  $RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
}
$InstanceDir = [System.IO.Path]::GetFullPath($InstanceDir)
$DshHome = [System.IO.Path]::GetFullPath($DshHome)
$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$EvidenceDir = [System.IO.Path]::GetFullPath($EvidenceDir)
if (-not (Test-Path $EvidenceDir)) { New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null }

$startPs1 = Join-Path $RepoRoot 'scripts\dsh-sidecar\start.ps1'
$stopPs1 = Join-Path $RepoRoot 'scripts\dsh-sidecar\stop.ps1'
$stateFile = Join-Path $DshHome 'run\synova-sidecar.json'

$beforeTxtPath = Join-Path $EvidenceDir 'T7-8b-process-snapshot-before.txt'
$afterTxtPath = Join-Path $EvidenceDir 'T7-8b-process-snapshot-after.txt'
$resultPath = Join-Path $EvidenceDir 'T7-8b-result.json'

$generatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$codeSha = ''
try { $codeSha = (& git -C $RepoRoot rev-parse HEAD 2>$null | Out-String).Trim() } catch { }

$notes = New-Object System.Collections.ArrayList
[void]$notes.Add('Cost: zero model rounds, zero outbound network. The sidecar start path never reads model credentials (start.ps1 header), so no credential file is needed or read.')
[void]$notes.Add('This collector is acceptance infrastructure we own (delegation ruling 2026-11-23 sec.5: 8(b) process-liveness observation = R/self-built), not a DSH capability.')
[void]$notes.Add('stop.ps1 itself verifies supervisor disappearance (sidecar.ts:479-513); this file records an INDEPENDENT OS observation so the claim does not rest on the wrapper self-reporting.')

# -- guard: never adopt a pre-existing sidecar --------------------------------
$preState = $null
if (Test-Path $stateFile) {
  try { $preState = Get-Content -Path $stateFile -Raw | ConvertFrom-Json } catch { $preState = $null }
}
if ($null -ne $preState) {
  $msg = 'A sidecar state file already exists at ' + $stateFile + ' (supervisorPid=' + $preState.supervisorPid + '). Refusing to start: adopting a pre-existing supervisor would make the before/after observation meaningless.'
  [void]$notes.Add($msg)
  $head = @(
    '# T7-8b-process-snapshot-before.txt -- NOT COLLECTED (Issue #1455, Done 8(b))',
    ('# generated: ' + $generatedAt),
    ('# reason: ' + $msg)
  ) -join "`n"
  Write-Utf8NoBom -Path $beforeTxtPath -Text ($head + "`n")
  Write-Utf8NoBom -Path $afterTxtPath -Text ($head + "`n")
  Write-Utf8NoBom -Path $resultPath -Text ((@{
    file = 'T7-8b-result.json'; issue = 1455; phase = 'T7-8b'; generatedAt = $generatedAt; codeSha = $codeSha
    stopIssued = $false; complete = $false; notes = @($notes)
  } | ConvertTo-Json -Depth 8) + "`n")
  Write-Output ('NOT COLLECTED: ' + $msg)
  exit 2
}

# -- step 1: start through the product wrapper --------------------------------
$startResult = Invoke-Wrapper -ScriptPath $startPs1 -Label 'start' -TimeoutMs (($StartTimeoutSec + 60) * 1000) -WrapperArguments @(
  '-InstanceDir', $InstanceDir, '-DshHome', $DshHome, '-InstallDir', $InstallDir,
  '-ExpectedVersion', $ExpectedVersion, '-TimeoutSec', [string]$StartTimeoutSec
)

$stateFound = $false
$supervisorPid = 0
$acpPid = 0
$stateReady = $false
if (Test-Path $stateFile) {
  try {
    $state = Get-Content -Path $stateFile -Raw | ConvertFrom-Json
    if (($null -ne $state.supervisorPid) -and ($null -ne $state.acpPid)) {
      $supervisorPid = [int]$state.supervisorPid
      $acpPid = [int]$state.acpPid
      $stateReady = [bool]$state.ready
      $stateFound = $true
    }
  } catch {
    [void]$script:collectionErrors.Add('state file parse: ' + $_.Exception.Message)
  }
} else {
  [void]$script:collectionErrors.Add('state file missing after start: ' + $stateFile)
}

$targets = @()
if ($stateFound) {
  $targets = @(
    [pscustomobject]@{ role = 'supervisor'; pid = $supervisorPid },
    [pscustomobject]@{ role = 'acp'; pid = $acpPid }
  )
}

# The live control token is read here only so it can be scrubbed verbatim from captured text; it is
# never written to any evidence file. The start wrapper's stdout was captured before the value was
# known, so it is re-scrubbed now.
if ($stateFound -and $null -ne $state -and $null -ne $state.controlToken) {
  $script:secretToken = [string]$state.controlToken
  $startResult.output = Assert-NoSecret -Text $startResult.output -Where 'start wrapper stdout'
}

# Exit codes are displayed as "not observed" when unobservable -- never as 0 and never silently blank.
$startExitText = $(if ($null -ne $startResult.exitCode) { [string]$startResult.exitCode } else { 'not observed (' + $startResult.exitCodeNote + ')' })

# -- step 2: snapshot BEFORE stop ---------------------------------------------
$beforeAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$beforeObs = @()
foreach ($t in $targets) { $beforeObs += Get-ProcObservation -ProcessId $t.pid -Role $t.role }
$leftoversBefore = @(Get-LeftoverProcesses -InstallDirPath $InstallDir)

$beforeHeader = @(
  '# T7-8b-process-snapshot-before.txt -- raw process observation BEFORE the product stop wrapper (Issue #1455, Done 8(b))',
  ('# generated: ' + $generatedAt),
  ('# observed at: ' + $beforeAt),
  '# collector: scripts/dsh-sidecar/r3-chain/capture-8b-process-snapshot.ps1',
  '# observation source: tasklist /FI "PID eq <pid>" | Get-Process -Id <pid> | Get-CimInstance Win32_Process (CommandLine + CreationDate)',
  '# identity for PID-reuse protection = (pid, CreationDate)',
  '# redaction: transient loopback supervisor control token only -- `--control-token <hex>` and "controlToken":"<hex>" are replaced by <redacted>. No other character is altered.',
  '# why: 02-acp-initialize.json:100-106 pidCheckAfterStop is NOT evidence (its booleans came from make-02-acp-initialize.mjs argv). This file replaces it with raw OS output.',
  ('# host: ' + $env:COMPUTERNAME + '  PSVersion: ' + $PSVersionTable.PSVersion.ToString() + '  codeSha: ' + $codeSha),
  '',
  '=== [1] product wrapper: start ===',
  ('cmd: ' + $startResult.command),
  ('exit: ' + $startExitText),
  '--- raw stdout (verbatim, controlToken redacted) ---',
  $startResult.output,
  '--- end raw stdout ---',
  '',
  '=== [2] state PIDs (read from <dshHome>\run\synova-sidecar.json; only these numbers are used, the file itself is not committed) ===',
  ('supervisorPid: ' + $supervisorPid),
  ('acpPid: ' + $acpPid),
  ('state.ready: ' + $stateReady)
) -join "`n"

$beforeBody = $beforeHeader
$idx = 3
foreach ($o in $beforeObs) { $beforeBody += Format-ObservationBlock -Observation $o -Index $idx; $idx++ }
$beforeBody += "`n`n=== [$idx] independent leftover sweep (processes shaped like this sidecar's supervisor/ACP) ===`n"
if ($leftoversBefore.Count -eq 0) { $beforeBody += "count: 0`n" }
else { foreach ($l in $leftoversBefore) { $beforeBody += ('pid=' + $l.pid + ' shape=' + $l.shape + ' creation=' + $l.creationDate + "`n  cmdline: " + $l.cmdline + "`n") } }

# -- step 3: issue the product stop -------------------------------------------
$stopIssued = $false
$stopResult = [pscustomobject]@{ label = 'stop'; command = '(not issued)'; exitCode = $null; exitCodeNote = 'wrapper not issued'; output = '' }
if ($stateFound) {
  $stopResult = Invoke-Wrapper -ScriptPath $stopPs1 -Label 'stop' -TimeoutMs (($StopTimeoutSec + 60) * 1000) -WrapperArguments @(
    '-InstanceDir', $InstanceDir, '-DshHome', $DshHome, '-TimeoutSec', [string]$StopTimeoutSec
  )
  $stopIssued = ($stopResult.command -ne '(not issued)')
} else {
  [void]$notes.Add('Stop was NOT issued because no state file with both PIDs was available after start; 8(b) cannot be judged.')
}
$stopExitText = $(if ($null -ne $stopResult.exitCode) { [string]$stopResult.exitCode } else { 'not observed (' + $stopResult.exitCodeNote + ')' })

# -- step 4: snapshot AFTER stop ----------------------------------------------
$afterAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$afterObs = @()
foreach ($o in $beforeObs) { $afterObs += Get-ProcObservation -ProcessId $o.pid -Role $o.role }
$leftoversAfter = @(Get-LeftoverProcesses -InstallDirPath $InstallDir)

$afterHeader = @(
  '# T7-8b-process-snapshot-after.txt -- raw process observation AFTER the product stop wrapper (Issue #1455, Done 8(b))',
  ('# generated: ' + $generatedAt),
  ('# observed at: ' + $afterAt),
  '# collector: scripts/dsh-sidecar/r3-chain/capture-8b-process-snapshot.ps1',
  '# observation source: tasklist /FI "PID eq <pid>" | Get-Process -Id <pid> | Get-CimInstance Win32_Process (CommandLine + CreationDate)',
  '# identity for PID-reuse protection = (pid, CreationDate); a live pid whose CreationDate changed is a DIFFERENT process',
  '# redaction: transient loopback supervisor control token only -- `--control-token <hex>` and "controlToken":"<hex>" are replaced by <redacted>. No other character is altered.',
  ('# host: ' + $env:COMPUTERNAME + '  PSVersion: ' + $PSVersionTable.PSVersion.ToString() + '  codeSha: ' + $codeSha),
  '',
  '=== [1] product wrapper: stop (issued) ===',
  ('cmd: ' + $stopResult.command),
  ('exit: ' + $stopExitText),
  '--- raw stdout (verbatim) ---',
  $stopResult.output,
  '--- end raw stdout ---'
) -join "`n"

$afterBody = $afterHeader
$idx = 2
foreach ($o in $afterObs) { $afterBody += Format-ObservationBlock -Observation $o -Index $idx; $idx++ }
$afterBody += "`n`n=== [$idx] independent leftover sweep (processes shaped like this sidecar's supervisor/ACP) ===`n"
if ($leftoversAfter.Count -eq 0) { $afterBody += "count: 0`n" }
else { foreach ($l in $leftoversAfter) { $afterBody += ('pid=' + $l.pid + ' shape=' + $l.shape + ' creation=' + $l.creationDate + "`n  cmdline: " + $l.cmdline + "`n") } }

# Final safety gate: nothing is written until the live token is provably absent from the payload.
$beforeBody = Assert-NoSecret -Text $beforeBody -Where 'before snapshot'
$afterBody = Assert-NoSecret -Text $afterBody -Where 'after snapshot'
Write-Utf8NoBom -Path $beforeTxtPath -Text ($beforeBody + "`n")
Write-Utf8NoBom -Path $afterTxtPath -Text ($afterBody + "`n")

# -- step 5: decide mechanically from the AFTER observation -------------------
$beforeComplete = ($beforeObs.Count -eq 2)
foreach ($o in $beforeObs) {
  if (-not $o.present) { $beforeComplete = $false; [void]$notes.Add('before snapshot: ' + $o.role + ' pid ' + $o.pid + ' was not present at observation time.') }
  if ([string]::IsNullOrEmpty($o.creationDate)) { $beforeComplete = $false; [void]$notes.Add('before snapshot: ' + $o.role + ' pid ' + $o.pid + ' has no CreationDate -> cannot guard against PID reuse.') }
  if ([string]::IsNullOrEmpty($o.cmdline)) { $beforeComplete = $false; [void]$notes.Add('before snapshot: ' + $o.role + ' pid ' + $o.pid + ' has no CommandLine.') }
}

$afterEvaluated = ($afterObs.Count -eq 2)
$allGone = $true
$afterPairs = @()
for ($i = 0; $i -lt $afterObs.Count; $i++) {
  $b = $beforeObs[$i]
  $a = $afterObs[$i]
  $sameInstance = $false
  $pidReused = $false
  if ($a.present) {
    if ((-not [string]::IsNullOrEmpty($a.creationDate)) -and ($a.creationDate -eq $b.creationDate)) { $sameInstance = $true }
    else { $pidReused = $true }
  }
  if ($sameInstance) { $allGone = $false }
  $afterPairs += [pscustomobject]@{
    role              = $a.role
    pid               = $a.pid
    presentAfter      = $a.present
    sameInstanceAlive = $sameInstance
    pidReused         = $pidReused
    creationDateBefore = $b.creationDate
    creationDateAfter  = $a.creationDate
    getProcessFound   = $a.getProcess.found
    cimFound          = $a.cim.found
    tasklistRowPresent = $a.tasklist.rowPresent
    absenceEvidence   = $(if (-not $a.present) { $a.tasklist.raw + ' | ' + $a.getProcess.raw } else { '' })
  }
}
if ($leftoversAfter.Count -gt 0) { $allGone = $false; [void]$notes.Add('Leftover sweep after stop still finds ' + $leftoversAfter.Count + ' supervisor/ACP-shaped process(es); see the after snapshot.') }

$complete = ($stateFound -and $stateReady -and $stopIssued -and $beforeComplete -and $afterEvaluated -and ($script:collectionErrors.Count -eq 0))
if (-not $complete) { [void]$notes.Add('complete=false: 8(b) is UNVERIFIED, not PASS. Required observations were not all collected (see collectionErrors).') }

$verdict = 'UNVERIFIED'
$exitCode = 2
if ($complete) {
  if ($allGone) { $verdict = 'PASS'; $exitCode = 0 } else { $verdict = 'FAIL'; $exitCode = 1 }
}

$result = [ordered]@{
  file              = 'T7-8b-result.json'
  issue             = 1455
  phase             = 'T7-8b'
  criterion         = 'Done 8(b): after the product stop wrapper, the supervisor and ACP processes are actually gone (raw OS observation before/after).'
  verdict           = $verdict
  generatedAt       = $generatedAt
  codeSha           = $codeSha
  codeShaSource     = 'git -C <repo> rev-parse HEAD: this evidence branch tip, computed by the collector itself. No value is passed in, so nothing here can be caller-injected. The product code under test (src/, electron/) is unchanged versus the ticket baseline; verify with: git diff --name-only caf61fcde..HEAD -- src electron (expected: empty).'
  host              = [ordered]@{ computerName = $env:COMPUTERNAME; psVersion = $PSVersionTable.PSVersion.ToString() }
  observationSource = @(
    'tasklist /FI "PID eq <pid>"',
    'Get-Process -Id <pid>',
    'Get-CimInstance Win32_Process -Filter "ProcessId=<pid>" (CommandLine + CreationDate)',
    'Get-CimInstance Win32_Process (independent leftover sweep by command-line shape)'
  )
  stopCommand       = $stopResult.command
  stopIssued        = $stopIssued
  stopExitCode      = $stopResult.exitCode
  stopExitCodeNote  = $stopExitText
  stopRawStdout     = $stopResult.output
  startCommand      = $startResult.command
  startExitCode     = $startResult.exitCode
  startExitCodeNote = $startExitText
  startRawStdout    = $startResult.output
  judgementBasis    = 'The verdict is decided ONLY from the before/after OS observations (pidsObservedBefore, pidsObservedAfter, afterComparison, leftoversAfter). The wrapper JSON in startRawStdout/stopRawStdout is preserved as the wrapper''s own claim and is NOT used to decide.'
  beforeObservedAt  = $beforeAt
  afterObservedAt   = $afterAt
  pidsObservedBefore = @($beforeObs)
  pidsObservedAfter  = @($afterObs)
  afterComparison    = @($afterPairs)
  leftoversAfter     = @($leftoversAfter)
  samePidSetInBothSnapshots = @($beforeObs | ForEach-Object { $_.pid })
  pidReuseGuard     = 'Identity = (pid, CreationDate). A target pid still present with a different CreationDate is recorded as pidReused and does NOT count as the original process surviving.'
  rawFiles          = @('T7-8b-process-snapshot-before.txt', 'T7-8b-process-snapshot-after.txt')
  redactions        = @('transient loopback supervisor control token: --control-token <hex> and "controlToken":"<hex>" -> <redacted> (same discipline as D6/T2-raw-redaction.txt; not a model credential)')
  redactionApplied  = $script:redactionApplied
  collectionErrors  = @($script:collectionErrors)
  notes             = @($notes)
  encoding          = 'UTF-8 (no BOM). Non-ASCII message text is escaped as \\uXXXX by Windows PowerShell 5.1 ConvertTo-Json; parsed values are unchanged.'
  complete          = $complete
}
# `allGone` is only reported when the observation is complete (an uncollected observation must not be
# coerced into false, which would read as a judgement).
if ($complete) { $result['allGone'] = $allGone }

Write-Utf8NoBom -Path $resultPath -Text (Assert-NoSecret -Text (($result | ConvertTo-Json -Depth 10) + "`n") -Where 'result json')

Write-Output ('T7-8b: verdict=' + $verdict + ' complete=' + $complete + ' allGone=' + $(if ($complete) { $allGone } else { 'n/a' }) + ' stopIssued=' + $stopIssued + ' redactionApplied=' + $script:redactionApplied)
Write-Output ('collectionErrors=' + $script:collectionErrors.Count)
foreach ($e in $script:collectionErrors) { Write-Output ('  - ' + $e) }
exit $exitCode
