param(
  [Parameter(Mandatory=$false)]
  [string]$DbName = "crypto-tracker",

  [Parameter(Mandatory=$false)]
  [string]$BaseUrl = "https://p2p-tracker.taheito26.workers.dev",

  [switch]$SkipDeploy,
  [switch]$SkipMigration,
  [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptRoot

Write-Host "[phase1] Starting one-shot execution"
Write-Host "[phase1] DbName=$DbName BaseUrl=$BaseUrl"

if (-not $SkipDeploy) {
  Write-Host "[phase1] Step A: Deploy worker"
  npx wrangler deploy
}

if (-not $SkipMigration) {
  Write-Host "[phase1] Step B: Apply migration 001"
  npx wrangler d1 execute $DbName --file=".\migrations\001_schema_migrations.sql"
}

if (-not $SkipVerify) {
  Write-Host "[phase1] Step C: Verify system endpoints"
  node ".\scripts\verify-system-endpoints.mjs" --base-url "$BaseUrl"
}

Write-Host "[phase1] DONE"
