<#
.SYNOPSIS
  Resolves recurring migration PR conflicts with a safe, repeatable workflow.

.DESCRIPTION
  - Checks out your branch
  - Fetches origin
  - Merges or rebases against target branch
  - Optionally auto-resolves known generated/operational files with --ours
  - Validates no conflict markers remain
  - Prints exact next commands to finish/push

.EXAMPLE
  pwsh -File V2/scripts/resolve-migration-conflicts.ps1 -Branch codex/continue-migration -TargetBranch main -Mode merge

.EXAMPLE
  pwsh -File V2/scripts/resolve-migration-conflicts.ps1 -Branch codex/continue-migration -TargetBranch main -Mode rebase -AutoResolveKnownFiles
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Branch,

  [string]$TargetBranch = 'main',

  [ValidateSet('merge', 'rebase')]
  [string]$Mode = 'merge',

  [switch]$AutoResolveKnownFiles = $true,

  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$KnownConflictFiles = @(
  'V2/EXECUTION_UPDATE_FORMAT.md',
  'V2/GO_LIVE_READINESS.md',
  'V2/PHASE8_READINESS_REPORT.md',
  'V2/scripts/go-live-gap-check.mjs',
  'V2/scripts/phase8-readiness-check.mjs',
  'V2/scripts/update-migration-progress.mjs'
)

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)][string[]]$Args,
    [switch]$AllowFailure
  )

  Write-Host ("> git " + ($Args -join ' ')) -ForegroundColor Cyan
  if ($DryRun) { return @{ ExitCode = 0; StdOut = @(); StdErr = @() } }

  $out = & git @Args 2>&1
  $code = $LASTEXITCODE

  if (-not $AllowFailure -and $code -ne 0) {
    throw "Git command failed (exit $code): git $($Args -join ' ')`n$($out -join [Environment]::NewLine)"
  }

  return @{ ExitCode = $code; StdOut = $out; StdErr = @() }
}

function Get-UnmergedFiles {
  $res = Invoke-Git -Args @('diff', '--name-only', '--diff-filter=U') -AllowFailure
  return @($res.StdOut | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
}

Write-Host "=== Migration Conflict Resolver ===" -ForegroundColor Green
Write-Host "Branch       : $Branch"
Write-Host "TargetBranch : $TargetBranch"
Write-Host "Mode         : $Mode"
Write-Host "AutoResolve  : $AutoResolveKnownFiles"
Write-Host "DryRun       : $DryRun"

Invoke-Git -Args @('checkout', $Branch)
Invoke-Git -Args @('fetch', 'origin')

if ($Mode -eq 'merge') {
  $mergeRes = Invoke-Git -Args @('merge', "origin/$TargetBranch") -AllowFailure
  if ($mergeRes.ExitCode -eq 0) {
    Write-Host "Merge completed without conflicts." -ForegroundColor Green
  } else {
    Write-Host "Merge reported conflicts (expected in this workflow)." -ForegroundColor Yellow
  }
} else {
  $rebaseRes = Invoke-Git -Args @('rebase', "origin/$TargetBranch") -AllowFailure
  if ($rebaseRes.ExitCode -eq 0) {
    Write-Host "Rebase completed without conflicts." -ForegroundColor Green
  } else {
    Write-Host "Rebase reported conflicts (expected in this workflow)." -ForegroundColor Yellow
  }
}

$unmerged = Get-UnmergedFiles
if (-not $unmerged.Count) {
  Write-Host "No unmerged files detected." -ForegroundColor Green
} else {
  Write-Host "Unmerged files:" -ForegroundColor Yellow
  $unmerged | ForEach-Object { Write-Host " - $_" }

  if ($AutoResolveKnownFiles) {
    $toResolve = @($unmerged | Where-Object { $KnownConflictFiles -contains $_ })

    if ($toResolve.Count) {
      Write-Host "Auto-resolving known migration artifacts with --ours..." -ForegroundColor Yellow
      foreach ($file in $toResolve) {
        Invoke-Git -Args @('checkout', '--ours', '--', $file)
        Invoke-Git -Args @('add', '--', $file)
      }
    }

    $remaining = Get-UnmergedFiles
    if ($remaining.Count) {
      Write-Host "Still unmerged (manual review required):" -ForegroundColor Yellow
      $remaining | ForEach-Object { Write-Host " - $_" }
    } else {
      Write-Host "All current unmerged files are resolved/staged." -ForegroundColor Green
    }
  }
}

Write-Host "Checking for unresolved conflict markers..." -ForegroundColor Cyan
$grepRes = Invoke-Git -Args @('grep', '-n', '-e', '^<<<<<<< ', '-e', '^=======$', '-e', '^>>>>>>> ') -AllowFailure
if ($grepRes.ExitCode -eq 0) {
  Write-Host "Conflict markers found (manual fix needed):" -ForegroundColor Red
  $grepRes.StdOut | ForEach-Object { Write-Host $_ }
} else {
  Write-Host "No conflict markers found." -ForegroundColor Green
}

Write-Host "\nNext steps:" -ForegroundColor Green
if ($Mode -eq 'merge') {
  Write-Host "  1) git status"
  Write-Host "  2) Resolve any remaining files, then: git add <files>"
  Write-Host "  3) git commit"
  Write-Host "  4) git push origin $Branch"
} else {
  Write-Host "  1) git status"
  Write-Host "  2) Resolve any remaining files, then: git add <files>"
  Write-Host "  3) git rebase --continue"
  Write-Host "  4) git push --force-with-lease origin $Branch"
}
