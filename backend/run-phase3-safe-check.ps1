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
  $rawArg = [string]$args[$i]
  $arg = $rawArg
  $inlineValue = $null

  if ($rawArg.StartsWith('-')) {
    $eqIndex = $rawArg.IndexOf('=')
    $colonIndex = $rawArg.IndexOf(':')
    $sepIndex = -1
    if ($eqIndex -ge 0) { $sepIndex = $eqIndex }
    elseif ($colonIndex -ge 0) { $sepIndex = $colonIndex }

    if ($sepIndex -gt 0) {
      $arg = $rawArg.Substring(0, $sepIndex)
      $inlineValue = $rawArg.Substring($sepIndex + 1)
    }
  }

  $argKey = $arg.TrimStart('-').ToLowerInvariant().Replace('_','').Replace('-','')
  switch ($argKey) {
    'skipdeploy' { $SkipDeploy = $true; continue }

    'baseurl' {
      if ($inlineValue -ne $null) { $BaseUrl = [string]$inlineValue; continue }
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++; $BaseUrl = [string]$args[$i]; continue
    }

    'userid' {
      if ($inlineValue -ne $null) { $UserId = [string]$inlineValue; continue }
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++; $UserId = [string]$args[$i]; continue
    }

    'idempotencykey' {
      if ($inlineValue -ne $null) { $IdempotencyKey = [string]$inlineValue; continue }
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++; $IdempotencyKey = [string]$args[$i]; continue
    }

    'requesttimeoutms' {
      $timeoutRaw = $inlineValue
      if ($timeoutRaw -eq $null) {
        if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
        $i++; $timeoutRaw = [string]$args[$i]
      }
      if (-not [int]::TryParse([string]$timeoutRaw, [ref]$RequestTimeoutMs)) {
        throw "Invalid integer for ${arg}: $timeoutRaw"
      }
      continue
    }

    'verifyretries' {
      $raw = $inlineValue
      if ($raw -eq $null) {
        if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
        $i++; $raw = [string]$args[$i]
      }
      if (-not [int]::TryParse([string]$raw, [ref]$VerifyRetries)) {
        throw "Invalid integer for ${arg}: $raw"
      }
      continue
    }

    'verifyretrydelayms' {
      $raw = $inlineValue
      if ($raw -eq $null) {
        if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
        $i++; $raw = [string]$args[$i]
      }
      if (-not [int]::TryParse([string]$raw, [ref]$VerifyRetryDelayMs)) {
        throw "Invalid integer for ${arg}: $raw"
      }
      continue
    }

    'cfaccessclientid' {
      if ($inlineValue -ne $null) { $CfAccessClientId = [string]$inlineValue; continue }
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++; $CfAccessClientId = [string]$args[$i]; continue
    }

    'cfaccessclientsecret' {
      if ($inlineValue -ne $null) { $CfAccessClientSecret = [string]$inlineValue; continue }
      if ($i + 1 -ge $args.Count) { throw "Missing value for $arg" }
      $i++; $CfAccessClientSecret = [string]$args[$i]; continue
    }

    'kebabcase' {
      # Compatibility no-op flag for prior guidance.
      continue
    }

    default {
      throw "Unknown argument: $rawArg. Supported: -SkipDeploy -BaseUrl -UserId -RequestTimeoutMs -VerifyRetries -VerifyRetryDelayMs -CfAccessClientId -CfAccessClientSecret. If this looks valid, update your local script from latest branch."
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
