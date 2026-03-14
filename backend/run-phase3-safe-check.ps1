param(
  [Parameter(Mandatory=$false)]
  [string]$BaseUrl = "https://p2p-tracker.taheito26.workers.dev",

  [switch]$SkipDeploy,

  [Parameter(Mandatory=$false)]
  [string]$UserId = "phase3-safe-user"
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptRoot

$args = @(".\run-phase3-safe-check.mjs", "--base-url", $BaseUrl, "--user-id", $UserId)
if ($SkipDeploy) { $args += "--skip-deploy" }

node @args
exit $LASTEXITCODE
