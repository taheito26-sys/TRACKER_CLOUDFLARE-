param(
  [Parameter(Mandatory=$false)]
  [string]$BaseUrl = "https://p2p-tracker.taheito26.workers.dev"
)

$ErrorActionPreference = "Stop"

Write-Host "[verify] Base URL: $BaseUrl"

$healthUrl = "$BaseUrl/api/system/health"
$migrationsUrl = "$BaseUrl/api/system/migrations"

Write-Host "[verify] GET $healthUrl"
$health = Invoke-RestMethod -Method GET -Uri $healthUrl
$healthJson = $health | ConvertTo-Json -Depth 20
Write-Host "[result] /api/system/health"
Write-Output $healthJson

Write-Host "[verify] GET $migrationsUrl"
$migrations = Invoke-RestMethod -Method GET -Uri $migrationsUrl
$migrationsJson = $migrations | ConvertTo-Json -Depth 20
Write-Host "[result] /api/system/migrations"
Write-Output $migrationsJson

$healthOk = $false
if ($null -ne $health.ok -and $health.ok -eq $true) { $healthOk = $true }

$hasVersion001 = $false
if ($null -ne $migrations.migrations) {
  foreach ($m in $migrations.migrations) {
    if ($m.version -eq "001") {
      $hasVersion001 = $true
      break
    }
  }
}

Write-Host "[summary] health.ok=$healthOk version001=$hasVersion001"

if (-not $healthOk) {
  Write-Error "Health endpoint check failed: expected ok=true"
}
if (-not $hasVersion001) {
  Write-Error "Migrations endpoint check failed: expected version 001"
}

Write-Host "[verify] PASS"
