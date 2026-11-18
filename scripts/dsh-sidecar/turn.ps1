# turn.ps1 - drive one authenticated 1A run through the SSE entry (ops helper).
#
# Usage:
#   powershell -File scripts/dsh-sidecar/turn.ps1 -Token <jwt> -Input "problem text" `
#     [-BaseUrl http://127.0.0.1:3000] [-RunId <id>] [-SessionId <acp-session>] [-TimeoutSec 120]
#
# Contract:
#   POST /api/dsh/runs (Bearer token) -> poll GET /api/dsh/runs/:runId until a
#   terminal status appears, then print one JSON line {ok, runId, status, terminal, stats}.
#   exit 0 = terminal reached (completed/failed/cancelled all visible);
#   exit 1 = timeout or HTTP/API error (typed JSON printed); exit 2 = wrapper broken.
#   This script never reads credentials on disk and never calls a model directly.

param(
  [Parameter(Mandatory = $true)][string]$Token,
  [Parameter(Mandatory = $true)][string]$Input,
  [string]$BaseUrl = 'http://127.0.0.1:3000',
  [string]$RunId = '',
  [string]$SessionId = '',
  [int]$TimeoutSec = 120
)

$ErrorActionPreference = 'Stop'

function Write-Json($obj) { Write-Output ($obj | ConvertTo-Json -Compress -Depth 8) }

try {
  $headers = @{ Authorization = "Bearer $Token" }
  $body = @{ input = $Input }
  if ($RunId -ne '') { $body['runId'] = $RunId }
  if ($SessionId -ne '') { $body['sessionId'] = $SessionId }
  $payload = $body | ConvertTo-Json -Compress

  $created = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/dsh/runs" -Headers $headers -Body $payload -ContentType 'application/json'
  if (-not $created.ok) { Write-Json $created; exit 1 }

  $effectiveRunId = [string]$created.runId
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 200
    $snapshot = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/dsh/runs/$effectiveRunId" -Headers $headers
    if ($snapshot.status -ne 'running') {
      Write-Json $snapshot
      exit 0
    }
  }
  Write-Json @{ ok = $false; code = 'RUN_TIMEOUT'; phase = 'run'; retryable = $true; message = "run $effectiveRunId did not reach a terminal state within ${TimeoutSec}s" }
  exit 1
} catch {
  $detail = $_.Exception.Message
  if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }
  Write-Json @{ ok = $false; code = 'RUN_FAILED'; phase = 'request'; retryable = $false; message = [string]$detail }
  exit 1
}
