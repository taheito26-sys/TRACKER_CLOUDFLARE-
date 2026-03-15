param(
  [Parameter(Mandatory=$false)]
  [string]$BaseUrl = "https://p2p-tracker-api.taheito26.workers.dev",

  [switch]$SkipDeploy,

  [Parameter(Mandatory=$false)]
  [int]$ExpectStatus = 401
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptRoot

$args = @(".\run-phase2-safe-check.mjs", "--base-url", $BaseUrl, "--expect-status", "$ExpectStatus")
if ($SkipDeploy) { $args += "--skip-deploy" }

node @args
exit $LASTEXITCODE
