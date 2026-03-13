param(
  [Parameter(Mandatory=$false)]
  [string]$BaseUrl = "https://p2p-tracker.taheito26.workers.dev"
)

Write-Host "[launcher] Running Node verifier from backend root..."
node ".\scripts\verify-system-endpoints.mjs" --base-url "$BaseUrl"
