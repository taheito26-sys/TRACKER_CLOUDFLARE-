param(
  [Parameter(Mandatory=$false)]
  [string]$BaseUrl = "https://p2p-tracker-api.taheito26.workers.dev"
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "[launcher] Running Node verifier from backend root..."
node "$scriptRoot\scripts\verify-system-endpoints.mjs" --base-url "$BaseUrl"
