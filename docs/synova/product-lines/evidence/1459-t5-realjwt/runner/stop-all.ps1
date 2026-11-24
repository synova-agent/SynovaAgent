# stop-all.ps1 -- stop ONLY the processes this run started (matched by the worktree path in their command line).
# Never kills by image name alone: other sessions' node/electron processes must stay untouched.
param([Parameter(Mandatory = $true)][string]$Worktree)
$ErrorActionPreference = 'Continue'
$tmp = Join-Path $Worktree '.tmp-m1m2'
$out = Join-Path $tmp 'out'
$log = Join-Path $tmp 'logs'

$killed = @()
$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  ($_.CommandLine -ne $null) -and ($_.CommandLine -like "*$Worktree*") -and ($_.Name -match '^(node|electron)')
}
foreach ($p in $procs) {
  try {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
    $killed += ("{0} {1} pid={2}" -f $p.Name, 'stopped', $p.ProcessId)
  } catch {
    $killed += ("{0} pid={1} stop-failed: {2}" -f $p.Name, $p.ProcessId, $_.Exception.Message)
  }
}
$killed | Out-File (Join-Path $log 'stop-killed.txt') -Encoding utf8
$killed | ForEach-Object { Write-Output $_ }

Start-Sleep -Seconds 3
$still = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  ($_.CommandLine -ne $null) -and ($_.CommandLine -like "*$Worktree*") -and ($_.Name -match '^(node|electron)')
}
Write-Output ("remaining_matched={0}" -f (($still | Measure-Object).Count))
foreach ($port in 18790, 5173, 9222) {
  $listen = netstat -ano | Select-String (":{0}\s" -f $port) | Select-String 'LISTENING'
  if ($listen) { Write-Output ("port {0}: STILL LISTENING" -f $port) } else { Write-Output ("port {0}: closed" -f $port) }
}
