param(
  [Parameter(Mandatory=$false)]
  [string]$BaseUrl = "https://p2p-tracker.taheito26.workers.dev"
)

$ErrorActionPreference = "Stop"
$ScriptVersion = "2026-03-13-v2"

function Get-JsonOrError([string]$Url) {
  try {
    $data = Invoke-RestMethod -Method GET -Uri $Url
    return @{ ok = $true; status = 200; data = $data; raw = ($data | ConvertTo-Json -Depth 20) }
  }
  catch {
    $statusCode = 0
    $body = ""
    if ($_.Exception.Response) {
      try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {}
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = $reader.ReadToEnd()
        $reader.Close()
      }
      catch {}
    }
    return @{ ok = $false; status = $statusCode; error = $_.Exception.Message; raw = $body }
  }
}

Write-Host "[verify] Script: verify-system-endpoints.ps1 $ScriptVersion"
Write-Host "[verify] Tip: run directly (no `. $args[0]` wrapper)."
Write-Host "[verify] Base URL: $BaseUrl"

$healthUrl = "$BaseUrl/api/system/health"
$migrationsUrl = "$BaseUrl/api/system/migrations"
$versionUrl = "$BaseUrl/api/system/version"
$statusUrl = "$BaseUrl/api/status"

Write-Host "[verify] GET $healthUrl"
$healthRes = Get-JsonOrError $healthUrl
if ($healthRes.ok) {
  Write-Host "[result] /api/system/health"
  Write-Output $healthRes.raw
} else {
  Write-Host "[error] /api/system/health status=$($healthRes.status) message=$($healthRes.error)"
  if ($healthRes.raw) { Write-Host "[error-body] $($healthRes.raw)" }
}

Write-Host "[verify] GET $migrationsUrl"
$migrationsRes = Get-JsonOrError $migrationsUrl
if ($migrationsRes.ok) {
  Write-Host "[result] /api/system/migrations"
  Write-Output $migrationsRes.raw
} else {
  Write-Host "[error] /api/system/migrations status=$($migrationsRes.status) message=$($migrationsRes.error)"
  if ($migrationsRes.raw) { Write-Host "[error-body] $($migrationsRes.raw)" }
}

Write-Host "[verify] GET $versionUrl"
$versionRes = Get-JsonOrError $versionUrl
if ($versionRes.ok) {
  Write-Host "[result] /api/system/version"
  Write-Output $versionRes.raw
} else {
  Write-Host "[error] /api/system/version status=$($versionRes.status) message=$($versionRes.error)"
  if ($versionRes.raw) { Write-Host "[error-body] $($versionRes.raw)" }
}

$healthOk = $false
$hasVersion001 = $false

if ($healthRes.ok -and $null -ne $healthRes.data.ok -and $healthRes.data.ok -eq $true) {
  $healthOk = $true
}

if ($migrationsRes.ok -and $null -ne $migrationsRes.data.migrations) {
  foreach ($m in $migrationsRes.data.migrations) {
    if ($m.version -eq "001") {
      $hasVersion001 = $true
      break
    }
  }
}

if (-not $healthRes.ok -or -not $migrationsRes.ok -or -not $versionRes.ok) {
  Write-Host "[diag] /api/system endpoints are not reachable on this deployment. Checking fallback endpoint..."
  $statusRes = Get-JsonOrError $statusUrl
  if ($statusRes.ok) {
    Write-Host "[diag] /api/status is reachable. This likely means the deployed Worker is running older code without /api/system routes."
    Write-Output $statusRes.raw
  }
  else {
    Write-Host "[diag] /api/status also failed status=$($statusRes.status). Possible DNS/TLS/proxy issue."
    if ($statusRes.raw) { Write-Host "[diag-body] $($statusRes.raw)" }
  }
}

Write-Host "[summary] health.ok=$healthOk version001=$hasVersion001"

if (-not $healthOk -or -not $hasVersion001) {
  Write-Error "Verification failed. If 404 on /api/system/* but /api/status works, deploy latest backend worker code and retry."
}

Write-Host "[verify] PASS"
