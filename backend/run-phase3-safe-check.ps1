$BaseUrl = "https://p2p-tracker.taheito26.workers.dev"
$SkipDeploy = $false
$UserId = "phase3-safe-user"
$IdempotencyKey = $null
$RequestTimeoutMs = 15000
$CfAccessClientId = $null
$CfAccessClientSecret = $null

for ($i = 0; $i -lt $args.Count; $i++) {
  $arg = [string]$args[$i]
  switch -Regex ($arg) {
    '^(-|--)?skip-?deploy$' { $SkipDeploy = $true; continue }

    '^(-|--)?base-?url$' {
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++; $BaseUrl = [string]$args[$i]; continue
    }

    '^(-|--)?user-?id$' {
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++; $UserId = [string]$args[$i]; continue
    }

    '^(-|--)?idempotency-?key$' {
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++; $IdempotencyKey = [string]$args[$i]; continue
    }

    '^(-|--)?request-?timeout-?ms$' {
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++
      $timeoutRaw = [string]$args[$i]
      if (-not [int]::TryParse($timeoutRaw, [ref]$RequestTimeoutMs)) {
        throw "Invalid integer for ${arg}: $timeoutRaw"
      }
      continue
    }


    '^(-|--)?cf-?access-?client-?id$' {
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++; $CfAccessClientId = [string]$args[$i]; continue
    }

    '^(-|--)?cf-?access-?client-?secret$' {
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++; $CfAccessClientSecret = [string]$args[$i]; continue
    }

    '^(-|--)?kebab-?case$' {
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
if ($CfAccessClientId) { $nodeArgs += @("--cf-access-client-id", $CfAccessClientId) }
if ($CfAccessClientSecret) { $nodeArgs += @("--cf-access-client-secret", $CfAccessClientSecret) }

node @nodeArgs
exit $LASTEXITCODE
