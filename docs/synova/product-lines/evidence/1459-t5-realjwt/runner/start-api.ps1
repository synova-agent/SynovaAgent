# start-api.ps1 -- #1459 M1/M2 isolated API launcher (one-shot run; never touches the main tree DB).
# Writes: logs/api-console.out.txt, logs/api-console.err.txt, out/api.pid
# Env (isolated): DEV_MODE=true, PORT=18790, SYNOVA_DB_PATH=<T0 scan db>, SYNOVA_ORG_ID=org-a,
#                 SYNOVA_DSH_HOME=<fresh per-run dsh home>, SYNOVA_DSH_INSTALL_DIR=<rc.5 physical>,
#                 SYNOVA_DSH_INSTANCE_DIR=<fresh per-run instance>, JWT_SECRET=<random, file-backed>.
# ELECTRON_RUN_AS_NODE is removed for the whole process tree (else electron would run as plain node).
param(
  [Parameter(Mandatory = $true)][string]$Worktree,
  [string]$ScanDb = 'C:\Users\Administrator\AppData\Local\Temp\1459-scan\synova.db',
  [string]$InstallDir = 'D:\novis-backup-20260526\Novis\_r3chain-20261123\install\0.2.2-rc.5',
  [int]$Port = 18790
)
$ErrorActionPreference = 'Stop'
$tmp = Join-Path $Worktree '.tmp-m1m2'
$logs = Join-Path $tmp 'logs'
$out = Join-Path $tmp 'out'
$dshHome = Join-Path $tmp 'dsh-home'
$instanceDir = Join-Path $tmp 'instance'
New-Item -ItemType Directory -Force -Path $logs, $out, $dshHome, $instanceDir | Out-Null

if (-not (Test-Path -LiteralPath $ScanDb -PathType Leaf)) { throw "scan db missing: $ScanDb" }
if (-not (Test-Path (Join-Path $InstallDir 'node_modules\@deepseek-ai\dsh\lib\bin.js'))) { throw "rc.5 physical package missing under $InstallDir" }

# JWT_SECRET: random per run, persisted only inside .tmp-m1m2 (deleted at cleanup). Never in evidence.
$secretFile = Join-Path $tmp '.jwt-secret'
if (-not (Test-Path $secretFile)) {
  $bytes = New-Object 'System.Byte[]' 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  ($bytes | ForEach-Object { $_.ToString('x2') }) -join '' | Set-Content -Path $secretFile -Encoding ascii -NoNewline
  Remove-Variable rng
}

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:DEV_MODE = 'true'
$env:PORT = [string]$Port
$env:SYNOVA_DB_PATH = $ScanDb
$env:SYNOVA_ORG_ID = 'org-a'
$env:SYNOVA_DSH_HOME = $dshHome
$env:SYNOVA_DSH_INSTALL_DIR = $InstallDir
$env:SYNOVA_DSH_INSTANCE_DIR = $instanceDir
$env:JWT_SECRET = (Get-Content $secretFile -Raw).Trim()

$node = (Get-Command node).Source
$tsxCli = Join-Path $Worktree 'node_modules\tsx\dist\cli.mjs'
$entry = Join-Path $Worktree 'src\index.ts'
if (-not (Test-Path $tsxCli)) { throw "tsx cli missing: $tsxCli" }
if (-not (Test-Path $entry)) { throw "entry missing: $entry" }

$p = Start-Process -FilePath $node -ArgumentList @($tsxCli, $entry) -WorkingDirectory $Worktree `
  -RedirectStandardOutput (Join-Path $logs 'api-console.out.txt') `
  -RedirectStandardError (Join-Path $logs 'api-console.err.txt') `
  -PassThru -WindowStyle Hidden
$p.Id | Set-Content -Path (Join-Path $out 'api.pid') -Encoding ascii
Write-Output ("api_pid={0}" -f $p.Id)
Write-Output ("env: DEV_MODE=true PORT={0} SYNOVA_DB_PATH={1} SYNOVA_ORG_ID=org-a SYNOVA_DSH_HOME={2} SYNOVA_DSH_INSTALL_DIR={3} JWT_SECRET=<random,not logged>" -f $Port, $ScanDb, $dshHome, $InstallDir)
