param(
  [Parameter(Mandatory=$false)]
  [string]$BaseUrl = "https://p2p-tracker.taheito26.workers.dev",

  [switch]$SkipDeploy,

  [Parameter(Mandatory=$false)]
  [string]$UserId = "phase3-safe-user",

  [Parameter(Mandatory=$false)]
  [string]$IdempotencyKey,

  [Parameter(Mandatory=$false)]
  [int]$RequestTimeoutMs = 15000
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptRoot

$args = @(".\run-phase3-safe-check.mjs", "--base-url", $BaseUrl, "--user-id", $UserId)
if ($SkipDeploy) { $args += "--skip-deploy" }
if ($IdempotencyKey) { $args += @("--idempotency-key", $IdempotencyKey) }
if ($RequestTimeoutMs -gt 0) { $args += @("--request-timeout-ms", "$RequestTimeoutMs") }

node @args
exit $LASTEXITCODE
