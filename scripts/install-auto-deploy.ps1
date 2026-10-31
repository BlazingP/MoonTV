<#
.SYNOPSIS
  Registers (or updates / removes) the "MoonTV Auto Deploy" scheduled task.

.EXAMPLE
  .\scripts\install-auto-deploy.ps1                      # every 5 minutes
  .\scripts\install-auto-deploy.ps1 -IntervalMinutes 10
  .\scripts\install-auto-deploy.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [int]$IntervalMinutes = 5,
  [string]$TaskName = 'MoonTV Auto Deploy',
  [string]$Branch = 'app',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($Uninstall) {
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'."
  } else {
    Write-Host "Scheduled task '$TaskName' not found; nothing to do."
  }
  return
}

if ($IntervalMinutes -lt 1) { throw 'IntervalMinutes must be >= 1.' }

$script = (Resolve-Path (Join-Path $PSScriptRoot 'auto-deploy.ps1')).Path
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Branch $Branch" `
  -WorkingDirectory $repoRoot

# Start one minute from now, then repeat (about 10 years, effectively forever).
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

# IgnoreNew: a build can outlast the interval; never start a second run on top.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
  -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# Run as the current user, only while that user is logged on (Interactive).
# Docker Desktop (its engine and the docker CLI context) lives in the user's
# session, so a SYSTEM / "run whether logged on or not" task may not reach it
# and would also need the account password stored. The NUC should therefore
# stay logged in (ideally auto-logon, with Docker Desktop starting at login).
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited

# -Force replaces an existing task of the same name, so re-running updates it.
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force `
  -Description "Polls origin/$Branch every $IntervalMinutes min and redeploys MoonTV via docker compose." | Out-Null

$verb = if ($existing) { 'Updated' } else { 'Installed' }
Write-Host "$verb scheduled task '$TaskName' (every $IntervalMinutes min, user $identity)."
Write-Host "Log file: $(Join-Path $repoRoot 'logs\auto-deploy.log')"
