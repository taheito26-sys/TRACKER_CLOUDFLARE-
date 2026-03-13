# P2P Tracker — Enterprise Deployment Guide

## Architecture
```
GitHub (source) → Cloudflare Pages (frontend) + Cloudflare Workers (backend)
                                                         ↑
                                              Cron every 2 min polls Binance
                                              Stores 24h history in KV
```

---

## PHASE 1 — One-time local setup (15 min)

### 1.1 Install Node.js
Download from https://nodejs.org — install the LTS version.

### 1.2 Install Wrangler (Cloudflare's CLI)
Open Terminal (Mac) or Command Prompt (Windows):
```
npm install -g wrangler
```

### 1.3 Log Wrangler into your Cloudflare account
```
wrangler login
```
A browser window opens. Log in. Come back to Terminal.

### 1.4 Create the KV namespace
```
cd backend
wrangler kv namespace create P2P_KV
```
You will see output like:
```
{ binding = "P2P_KV", id = "abc123def456..." }
```
**Copy that ID.** Open `backend/wrangler.toml` and replace `PLACEHOLDER_KV_ID` with it.

### 1.5 Deploy the Worker once manually (tests it works)
```
wrangler deploy
```
You will see: `Deployed to https://p2p-monitor.YOUR-SUBDOMAIN.workers.dev`

**Copy that URL** — you will need it in Step 4.

### 1.6 Test the Worker API
Open in browser:
```
https://p2p-monitor.YOUR-SUBDOMAIN.workers.dev/api/status
```
You should see JSON with `"ok": true` and a `lastUpdate` timestamp.

---

## PHASE 2 — GitHub repository (10 min)

### 2.1 Create a GitHub account
Go to https://github.com and sign up (free).

### 2.2 Create a private repository
- Click **+** → **New repository**
- Name: `p2p-tracker`
- Set to **Private**
- Check **Add a README file**
- Click **Create repository**

### 2.3 Upload all files
In your new repo, click **Add file → Upload files** and upload:
```
frontend/index.html
backend/src/index.js
backend/wrangler.toml
.github/workflows/deploy-backend.yml
.github/workflows/deploy-frontend.yml
```
Keep the folder structure — GitHub preserves it.

Commit message: `Initial enterprise deploy`

---

## PHASE 3 — Connect Cloudflare Pages to GitHub (5 min)

1. Log into https://cloudflare.com
2. **Workers & Pages → Create → Pages → Connect to Git**
3. Connect your GitHub account, select `p2p-tracker` repo
4. Configure:
   - **Production branch:** `main`
   - **Build command:** (leave empty)
   - **Build output directory:** `frontend`
5. Click **Save and Deploy**

Your frontend is now live at `https://p2p-tracker.pages.dev`

---

## PHASE 4 — GitHub Secrets for CI/CD (5 min)

The GitHub Actions workflows need your Cloudflare credentials.

### 4.1 Get your Cloudflare Account ID
- Log into Cloudflare dashboard
- Click any domain (or just stay on the main page)
- Your Account ID is shown in the right sidebar — copy it

### 4.2 Create a Cloudflare API Token
1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click **Create Token**
3. Use template: **Edit Cloudflare Workers**
4. Under Account Resources: select your account
5. Under Zone Resources: All zones (or None if you have no domains yet)
6. Click **Continue to Summary → Create Token**
7. **Copy the token** (shown once only)

### 4.3 Add secrets to GitHub
In your GitHub repo:
1. **Settings → Secrets and variables → Actions → New repository secret**

Add these three:

| Name | Value |
|------|-------|
| `CLOUDFLARE_API_TOKEN` | The API token from 4.2 |
| `CLOUDFLARE_ACCOUNT_ID` | Your Account ID from 4.1 |
| `CF_SUBDOMAIN` | Your workers.dev subdomain (e.g. `mohmedtaha` — the part before `.workers.dev`) |

---

## PHASE 5 — Wire the frontend to the backend (2 min)

Open `frontend/index.html`, find this line near the top of the P2P section:
```javascript
const P2P_API_URL = "";   // ← FILL THIS IN after Step 4 of the guide
```

Change it to your Worker URL:
```javascript
const P2P_API_URL = "https://p2p-monitor.YOUR-SUBDOMAIN.workers.dev";
```

Save the file. In GitHub, edit `frontend/index.html`, make this change, commit with message `Connect frontend to backend API`.

The GitHub Action deploys it automatically. Done.

---

## PHASE 6 — Fix Google OAuth for pages.dev domain (2 min)

1. Go to https://console.cloud.google.com
2. **APIs & Services → Credentials → your OAuth Client ID**
3. Under **Authorized JavaScript origins**, add:
   - `https://p2p-tracker.pages.dev`
4. Click **Save**

---

## PHASE 7 — Enterprise extras (Phase 4 of the guide)

### How to update the app in the future
1. Edit `frontend/index.html` in GitHub (pencil icon)
2. Write commit message describing the change
3. Click **Commit changes**
4. GitHub Action deploys it automatically in ~15 seconds

### How to test before going live (preview deployments)
1. In GitHub, click **Branch dropdown → View all branches → New branch**
2. Name it `feature/your-change-name`
3. Make your edits in that branch
4. Cloudflare automatically creates a **preview URL** (e.g. `abc123.p2p-tracker.pages.dev`)
5. Test it — your live site is untouched
6. When happy: **Pull requests → New pull request → Merge into main**
7. Cloudflare deploys to production

### How to rollback instantly
1. Cloudflare dashboard → **Workers & Pages → p2p-tracker → Deployments**
2. Find any previous deployment
3. Click **⋯ → Rollback to this deployment**
4. Live immediately

### How to update the backend Worker
Edit `backend/src/index.js` or `backend/wrangler.toml` in GitHub and commit to `main`. The `deploy-backend.yml` workflow deploys it automatically.

---

## Free tier usage summary

| Resource | Limit | Your usage | Status |
|----------|-------|-----------|--------|
| Workers requests | 100,000/day | ~800/day | ✅ Safe |
| KV writes | 1,000/day | 720/day (every 2min) | ✅ Safe |
| KV reads | 100,000/day | ~2,000/day | ✅ Safe |
| Pages deploys | 500/month | 1 per push | ✅ Safe |
| Bandwidth | Unlimited | — | ✅ Free |
