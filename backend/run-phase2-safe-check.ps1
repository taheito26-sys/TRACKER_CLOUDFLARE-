param(
  [Parameter(Mandatory=$false)]
  [string]$BaseUrl = "https://p2p-tracker.taheito26.workers.dev",

  [switch]$SkipDeploy,

  [Parameter(Mandatory=$false)]
  [int]$ExpectStatus = 401,

  [Parameter(Mandatory=$false)]
  [int]$VerifyRetries = 3,

  [Parameter(Mandatory=$false)]
  [int]$VerifyRetryDelayMs = 1500
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptRoot

$args = @(
  ".\run-phase2-safe-check.mjs",
  "--base-url", $BaseUrl,
  "--expect-status", "$ExpectStatus",
  "--verify-retries", "$VerifyRetries",
  "--verify-retry-delay-ms", "$VerifyRetryDelayMs"
)
if ($SkipDeploy) { $args += "--skip-deploy" }

node @args
exit $LASTEXITCODE
