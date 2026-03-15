param(
  [Parameter(Mandatory=$false)]
  [string]$DbName = "",

  [Parameter(Mandatory=$false)]
  [string]$DbBinding = "",

  [Parameter(Mandatory=$false)]
  [string]$D1Target = "",

  [Parameter(Mandatory=$false)]
  [string]$BaseUrl = "https://p2p-tracker-api.taheito26.workers.dev",

  [switch]$SkipDeploy,
  [switch]$SkipMigration,
  [switch]$SkipVerify,
  [switch]$LocalD1
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptRoot

$args = @(".\run-phase1-oneshot.mjs", "--base-url", $BaseUrl)
if ($DbName) { $args += @("--db-name", $DbName) }
if ($DbBinding) { $args += @("--db-binding", $DbBinding) }
if ($D1Target) { $args += @("--d1-target", $D1Target) }
if ($SkipDeploy) { $args += "--skip-deploy" }
if ($SkipMigration) { $args += "--skip-migration" }
if ($SkipVerify) { $args += "--skip-verify" }
if ($LocalD1) { $args += "--local-d1" }

node @args
exit $LASTEXITCODE
