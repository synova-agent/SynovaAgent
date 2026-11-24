# start-desktop.ps1 -- #1459 M1 desktop launcher (dev mode: vite renderer + Electron with CDP).
# Boots the SAME renderer code as the worktree under test (T-A/T-B/T-C merged in gitea/main).
# The backend is NOT spawned by Electron: it probes http://localhost:18790 first and reuses the
# already-running isolated API (backend-spawn.cjs `reused` path), so no second DB is ever opened.
param(
  [Parameter(Mandatory = $true)][string]$Worktree,
  [int]$VitePort = 5173,
  [int]$CdpPort = 9222
)
$ErrorActionPreference = 'Stop'
$tmp = Join-Path $Worktree '.tmp-m1m2'
$logs = Join-Path $tmp 'logs'
$out = Join-Path $tmp 'out'
New-Item -ItemType Directory -Force -Path $logs, $out | Out-Null

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$node = (Get-Command node).Source
$viteJs = Join-Path $Worktree 'electron-renderer\node_modules\vite\bin\vite.js'
$electronExe = Join-Path $Worktree 'node_modules\electron\dist\electron.exe'
$mainCjs = Join-Path $Worktree 'electron\main.cjs'
if (-not (Test-Path $viteJs)) { throw "vite missing: $viteJs" }
if (-not (Test-Path $electronExe)) { throw "electron missing: $electronExe" }
if (-not (Test-Path $mainCjs)) { throw "main.cjs missing: $mainCjs" }

$portBusy = [bool](netstat -ano | Select-String (":{0}\s" -f $VitePort) | Select-String 'LISTENING')
if ($portBusy) {
  Write-Output ("vite_reused=true port={0}" -f $VitePort)
  $viteReady = $true
} else {
$vite = Start-Process -FilePath $node -ArgumentList @($viteJs, '--port', [string]$VitePort, '--strictPort') `
  -WorkingDirectory (Join-Path $Worktree 'electron-renderer') `
  -RedirectStandardOutput (Join-Path $logs 'vite-console.out.txt') `
  -RedirectStandardError (Join-Path $logs 'vite-console.err.txt') `
  -PassThru -WindowStyle Hidden
$vite.Id | Set-Content -Path (Join-Path $out 'vite.pid') -Encoding ascii
Write-Output ("vite_pid={0} port={1}" -f $vite.Id, $VitePort)

$viteReady = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  $listen = netstat -ano | Select-String (":{0}\s" -f $VitePort) | Select-String 'LISTENING'
  if ($listen) { $viteReady = $true; break }
}
if (-not $viteReady) { throw "vite did not listen on $VitePort within 30s" }
Write-Output ("vite_url=http://localhost:{0}/" -f $VitePort)
}

# --no-sandbox: this Windows runner is an Administrator session where Chromium's sandbox init
# aborts electron.exe with STATUS_BREAKPOINT (measured: `electron.exe --version` dies, with
# `--no-sandbox` prints v33.4.11). Runtime-only launch flag; no product code is modified.
$electron = Start-Process -FilePath $electronExe `
  -ArgumentList @('--no-sandbox', "--remote-debugging-port=$CdpPort", $mainCjs) `
  -WorkingDirectory $Worktree `
  -RedirectStandardOutput (Join-Path $logs 'electron-console.out.txt') `
  -RedirectStandardError (Join-Path $logs 'electron-console.err.txt') `
  -PassThru
$electron.Id | Set-Content -Path (Join-Path $out 'electron.pid') -Encoding ascii
Write-Output ("electron_pid={0} cdp_port={1}" -f $electron.Id, $CdpPort)

$cdpOk = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $targets = Invoke-RestMethod ("http://127.0.0.1:{0}/json/list" -f $CdpPort) -TimeoutSec 3
    $page = $targets | Where-Object { $_.type -eq 'page' -and $_.url -like '*5173*' } | Select-Object -First 1
    if ($page) { $cdpOk = $true; break }
  } catch { }
}
if ($cdpOk) {
  Write-Output ("cdp_ok=true page_url={0} title={1}" -f $page.url, $page.title)
} else {
  Write-Output 'cdp_ok=false (no 5173 page target within 30s)'
  Get-Content (Join-Path $logs 'electron-console.err.txt') -Tail 20 -ErrorAction SilentlyContinue
}
