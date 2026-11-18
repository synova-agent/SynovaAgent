# RealSandboxProcessAdapter.ps1 -- the only adapter allowed to touch a real Windows Sandbox.
#
# Contract (DEV DOC v7 SSB13.3):
#   - This file is the single place that calls WindowsSandbox.exe, CloseMainWindow,
#     WaitForExit and Stop-Process.
#   - Every operation targets only the PID (+ StartTime) handed back by Start-SandboxProcess.
#     Name-based mass termination (Stop-Process -Name) is forbidden and never used.
#   - The lifecycle module dot-sources this file; the functions are intentionally not exported.

function Get-SandboxExecutable {
  $systemRoot = $env:SystemRoot
  if ([string]::IsNullOrEmpty($systemRoot)) {
    throw 'WINDOWS_SANDBOX_MISSING: SystemRoot is not set'
  }
  $candidate = Join-Path $systemRoot 'System32\WindowsSandbox.exe'
  if (-not (Test-Path -LiteralPath $candidate)) {
    throw "WINDOWS_SANDBOX_MISSING: $candidate does not exist (do not enable Windows features for this ticket)"
  }
  return $candidate
}

function Start-SandboxProcess {
  param([Parameter(Mandatory = $true)][string]$ConfigPath)
  $exe = Get-SandboxExecutable
  $process = Start-Process -FilePath $exe -ArgumentList @($ConfigPath) -PassThru
  return [pscustomobject]@{ Pid = $process.Id; StartTime = $process.StartTime }
}

function Get-SandboxProcess {
  param([Parameter(Mandatory = $true)][int]$Pid)
  try {
    $process = Get-Process -Id $Pid -ErrorAction Stop
    return [pscustomobject]@{ Pid = $process.Id; StartTime = $process.StartTime }
  } catch {
    return $null
  }
}

function Wait-SandboxProcessExit {
  param([Parameter(Mandatory = $true)][int]$Pid, [int]$TimeoutMs = 30000)
  try {
    $process = Get-Process -Id $Pid -ErrorAction Stop
  } catch {
    return $true
  }
  return $process.WaitForExit($TimeoutMs)
}

function Close-SandboxMainWindow {
  param([Parameter(Mandatory = $true)][int]$Pid)
  try {
    $process = Get-Process -Id $Pid -ErrorAction Stop
  } catch {
    return $true
  }
  return $process.CloseMainWindow()
}

function Stop-SandboxProcess {
  param([Parameter(Mandatory = $true)][int]$Pid)
  try {
    $process = Get-Process -Id $Pid -ErrorAction Stop
  } catch {
    return $true
  }
  Stop-Process -Id $process.Id -Force
  return $true
}
