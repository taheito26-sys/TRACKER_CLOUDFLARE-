$BaseUrl = "https://p2p-tracker.taheito26.workers.dev"
$SkipDeploy = $false
$UserId = "phase3-safe-user"
$IdempotencyKey = $null
$RequestTimeoutMs = 15000
$VerifyRetries = 3
$VerifyRetryDelayMs = 1500
$CfAccessClientId = $env:CF_ACCESS_CLIENT_ID
$CfAccessClientSecret = $env:CF_ACCESS_CLIENT_SECRET

for ($i = 0; $i -lt $args.Count; $i++) {
  $arg = [string]$args[$i]
  $argKey = $arg.TrimStart('-').ToLowerInvariant().Replace('_','').Replace('-','')
  switch ($argKey) {
    'skipdeploy' { $SkipDeploy = $true; continue }

    'baseurl' {
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++; $BaseUrl = [string]$args[$i]; continue
    }

    'userid' {
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++; $UserId = [string]$args[$i]; continue
    }

    'idempotencykey' {
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++; $IdempotencyKey = [string]$args[$i]; continue
    }

    'requesttimeoutms' {
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++
      $timeoutRaw = [string]$args[$i]
      if (-not [int]::TryParse($timeoutRaw, [ref]$RequestTimeoutMs)) {
        throw "Invalid integer for ${arg}: $timeoutRaw"
      }
      continue
    }



    'verifyretries' {
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++
      $raw = [string]$args[$i]
      if (-not [int]::TryParse($raw, [ref]$VerifyRetries)) {
        throw "Invalid integer for ${arg}: $raw"
      }
      continue
    }

    'verifyretrydelayms' {
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++
      $raw = [string]$args[$i]
      if (-not [int]::TryParse($raw, [ref]$VerifyRetryDelayMs)) {
        throw "Invalid integer for ${arg}: $raw"
      }
      continue
    }

    'cfaccessclientid' {
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++; $CfAccessClientId = [string]$args[$i]; continue
    }

    'cfaccessclientsecret' {
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++; $CfAccessClientSecret = [string]$args[$i]; continue
    }

    'kebabcase' {
      # Compatibility no-op flag for prior guidance.
      continue
    }

    default {
      throw "Unknown argument: $arg"
    }
  }
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptRoot

$nodeArgs = @(".\run-phase3-safe-check.mjs", "--base-url", $BaseUrl, "--user-id", $UserId)
if ($SkipDeploy) { $nodeArgs += "--skip-deploy" }
if ($IdempotencyKey) { $nodeArgs += @("--idempotency-key", $IdempotencyKey) }
if ($RequestTimeoutMs -gt 0) { $nodeArgs += @("--request-timeout-ms", "$RequestTimeoutMs") }
if ($VerifyRetries -gt 0) { $nodeArgs += @("--verify-retries", "$VerifyRetries") }
if ($VerifyRetryDelayMs -ge 0) { $nodeArgs += @("--verify-retry-delay-ms", "$VerifyRetryDelayMs") }
if ($CfAccessClientId) { $nodeArgs += @("--cf-access-client-id", $CfAccessClientId) }
if ($CfAccessClientSecret) { $nodeArgs += @("--cf-access-client-secret", $CfAccessClientSecret) }

node @nodeArgs
exit $LASTEXITCODE
