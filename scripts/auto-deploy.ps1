<#
.SYNOPSIS
  Polls origin/<Branch> and redeploys the docker compose stack when it moves.

.DESCRIPTION
  Intended to run from a Windows Scheduled Task (see install-auto-deploy.ps1).
  Never resets, stashes or discards anything: it only fast-forwards a clean
  checkout. Logs go to <repo>\logs\auto-deploy.log.

  Exit codes: 0 = up to date / deployed / skipped (another run active),
              1 = refused or failed (see log).
#>
[CmdletBinding()]
param(
  [string]$Branch = 'app',
  [string[]]$ComposeArgs = @(
    '--env-file', '.env.kazumi',
    '-f', 'docker-compose.yml',
    '-f', 'docker-compose.kazumi.yml',
    'up', '-d', '--build'
  ),
  # A lock older than this is considered stale even if the PID still exists.
  [int]$StaleLockHours = 2,
  [int]$MaxLogKB = 1024
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$logDir = Join-Path $repoRoot 'logs'
$logFile = Join-Path $logDir 'auto-deploy.log'
$lockFile = Join-Path $logDir 'auto-deploy.lock'
# Commit of the last successful deploy. Deploying is driven by HEAD != marker,
# so a failed build or an unreachable Docker engine is retried on the next run.
$deployedFile = Join-Path $logDir 'deployed-sha'
# Commit whose docker compose run failed; not rebuilt again until a new commit
# arrives, so a broken build doesn't rebuild every interval.
$failedFile = Join-Path $logDir 'failed-sha'
$script:LastOutput = ''

function Write-Log {
  param([string]$Message)
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
}

# Keep one previous generation (auto-deploy.log.1) once the log grows too big.
function Rotate-Log {
  if (-not (Test-Path -LiteralPath $logFile)) { return }
  if ((Get-Item -LiteralPath $logFile).Length -lt ($MaxLogKB * 1KB)) { return }
  Move-Item -LiteralPath $logFile -Destination "$logFile.1" -Force
}

# Runs a native command, logs each output line (unless -Quiet), returns its
# exit code. stderr is merged and EAP relaxed so PS 5.1 does not turn native
# stderr output into exceptions; success is judged by $LASTEXITCODE only.
function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments, [switch]$Quiet)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& $Exe @Arguments 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  if (-not $Quiet) {
    foreach ($l in $output) { if ($l.Trim()) { Write-Log "  $l" } }
  }
  $script:LastOutput = ($output -join "`n").Trim()
  return $code
}

# Returns stdout only, so git warnings on stderr never leak into compared values.
function Get-GitOutput {
  param([string[]]$Arguments)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& git @Arguments 2>$null | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($code -ne 0) {
    throw "git $($Arguments -join ' ') failed (exit $code)"
  }
  return ($output -join "`n").Trim()
}

function Get-MarkerSha {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  return (Get-Content -LiteralPath $Path -Raw).Trim()
}

function Test-LockStale {
  if (-not (Test-Path -LiteralPath $lockFile)) { return $true }
  $age = (Get-Date) - (Get-Item -LiteralPath $lockFile).LastWriteTime
  if ($age.TotalHours -gt $StaleLockHours) { return $true }
  try {
    $lockPid = [int](Get-Content -LiteralPath $lockFile -Raw).Trim()
  } catch {
    return $false  # lock just created and not yet written; treat as live
  }
  return -not (Get-Process -Id $lockPid -ErrorAction SilentlyContinue)
}

# Atomic create; returns $true if we now own the lock.
function Enter-Lock {
  for ($i = 0; $i -lt 2; $i++) {
    try {
      $fs = [System.IO.File]::Open($lockFile, 'CreateNew', 'Write', 'None')
      $bytes = [System.Text.Encoding]::ASCII.GetBytes("$PID")
      $fs.Write($bytes, 0, $bytes.Length)
      $fs.Close()
      return $true
    } catch [System.IO.IOException] {
      if (-not (Test-LockStale)) { return $false }
      Write-Log 'Removing stale lock file.'
      Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
    }
  }
  return $false
}

function Invoke-Deploy {
  $env:GIT_TERMINAL_PROMPT = '0'    # fail instead of hanging on a credential prompt
  $env:BUILDKIT_PROGRESS = 'plain'  # readable build output in the log
  $remoteRef = "refs/remotes/origin/$Branch"

  $code = Invoke-Native -Exe 'git' -Arguments @('fetch', 'origin', "+refs/heads/${Branch}:$remoteRef")
  if ($code -ne 0) { Write-Log "git fetch failed (exit $code)."; return 1 }

  $local = Get-GitOutput @('rev-parse', 'HEAD')
  $remote = Get-GitOutput @('rev-parse', $remoteRef)
  if ($local -eq $remote) {
    if ($local -eq (Get-MarkerSha $deployedFile)) { return 0 }
    if ($local -eq (Get-MarkerSha $failedFile)) { return 0 }
  }

  if ($local -ne $remote) {
    Write-Log "New commits on origin/${Branch}: $($local.Substring(0, 7)) -> $($remote.Substring(0, 7))"
  }

  $current = Get-GitOutput @('rev-parse', '--abbrev-ref', 'HEAD')
  if ($current -ne $Branch) {
    Write-Log "REFUSED: current branch is '$current', expected '$Branch'."
    return 1
  }
  $dirty = Get-GitOutput @('status', '--porcelain', '--untracked-files=no')
  if ($dirty) {
    Write-Log "REFUSED: tracked files have local modifications:`n$dirty"
    return 1
  }
  if ($local -ne $remote) {
    $ahead = Invoke-Native -Exe 'git' -Arguments @('merge-base', '--is-ancestor', $remoteRef, 'HEAD') -Quiet
    if ($ahead -eq 0) {
      Write-Log "REFUSED: local $Branch is ahead of origin/$Branch (unpushed commits)."
      return 1
    }

    $code = Invoke-Native -Exe 'git' -Arguments @('pull', '--ff-only', 'origin', $Branch)
    if ($code -ne 0) {
      Write-Log "git pull --ff-only failed (exit $code); not a fast-forward?"
      return 1
    }
  }

  # Docker Desktop can take a minute to start after logon; wait for the next run.
  $code = Invoke-Native -Exe 'docker' -Arguments @('info') -Quiet
  if ($code -ne 0) {
    Write-Log 'Docker engine not reachable yet; will retry on the next run.'
    return 1
  }

  $head = Get-GitOutput @('rev-parse', 'HEAD')
  Write-Log "Deploying $($head.Substring(0, 7)): docker compose $($ComposeArgs -join ' ')"
  $code = Invoke-Native -Exe 'docker' -Arguments (@('compose') + $ComposeArgs)
  if ($code -ne 0) {
    Set-Content -LiteralPath $failedFile -Value $head -Encoding ASCII
    Write-Log "DEPLOY FAILED (docker compose exit $code); this commit won't be rebuilt until a new one is pushed."
    return 1
  }
  Set-Content -LiteralPath $deployedFile -Value $head -Encoding ASCII
  Remove-Item -LiteralPath $failedFile -Force -ErrorAction SilentlyContinue
  Write-Log "Deploy OK at $($head.Substring(0, 7))."
  return 0
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Rotate-Log
Set-Location -LiteralPath $repoRoot

if (-not (Enter-Lock)) {
  Write-Log 'Another auto-deploy run is active; skipping.'
  exit 0
}
$exitCode = 1
try {
  $exitCode = Invoke-Deploy
} catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  $exitCode = 1
} finally {
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
exit $exitCode
