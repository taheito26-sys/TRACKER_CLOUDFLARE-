param(
  [Parameter(Mandatory=$false)]
  [string]$BaseUrl = "https://p2p-tracker.taheito26.workers.dev",

  [Parameter(Mandatory=$false)]
  [switch]$SkipDeploy,

  [Parameter(Mandatory=$false)]
  [string]$UserId = "phase3-safe-user",

  [Parameter(Mandatory=$false)]
  [string]$IdempotencyKey,

  [Parameter(Mandatory=$false)]
  [int]$RequestTimeoutMs = 15000,

  [Parameter(Mandatory=$false)]
  [switch]$KebabCase,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArgs
)

for ($i = 0; $i -lt $RemainingArgs.Count; $i++) {
  $arg = [string]$RemainingArgs[$i]
  switch -Regex ($arg) {
    '^--skip-deploy$' { $SkipDeploy = $true; continue }
    '^--base-url$' {
      if ($i + 1 -ge $RemainingArgs.Count) { throw "Missing value for $arg" }
      $i++; $BaseUrl = [string]$RemainingArgs[$i]; continue
    }
    '^--user-id$' {
      if ($i + 1 -ge $RemainingArgs.Count) { throw "Missing value for $arg" }
      $i++; $UserId = [string]$RemainingArgs[$i]; continue
    }
    '^--idempotency-key$' {
      if ($i + 1 -ge $RemainingArgs.Count) { throw "Missing value for $arg" }
      $i++; $IdempotencyKey = [string]$RemainingArgs[$i]; continue
    }
    '^--request-timeout-ms$' {
      if ($i + 1 -ge $RemainingArgs.Count) { throw "Missing value for $arg" }
      $i++; $RequestTimeoutMs = [int]$RemainingArgs[$i]; continue
    }
    '^--kebab-case$' { $KebabCase = $true; continue }
    default { throw "Unknown argument: $arg" }
  }
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptRoot

$nodeArgs = @(".\run-phase3-safe-check.mjs", "--base-url", $BaseUrl, "--user-id", $UserId)
if ($SkipDeploy) { $nodeArgs += "--skip-deploy" }
if ($IdempotencyKey) { $nodeArgs += @("--idempotency-key", $IdempotencyKey) }
if ($RequestTimeoutMs -gt 0) { $nodeArgs += @("--request-timeout-ms", "$RequestTimeoutMs") }

node @nodeArgs
exit $LASTEXITCODE
