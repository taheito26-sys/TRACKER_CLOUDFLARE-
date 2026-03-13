# Deployment Quickstart

## Step 1: Setup (one-time)

```bash
cd worker/

# Install wrangler
npm install

# Login to Cloudflare
npx wrangler login

# Create the D1 database
npx wrangler d1 create taheito-pro-db
# → Copy the database_id from output

# Create KV namespace for caching
npx wrangler kv namespace create CACHE
# → Copy the namespace id from output
```

## Step 2: Configure

Edit `wrangler.jsonc` and replace:
- `REPLACE_WITH_YOUR_D1_DATABASE_ID` with your D1 database ID
- `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` with your KV namespace ID

## Step 3: Create database tables

```bash
npx wrangler d1 execute taheito-pro-db --file=schema.sql
```

## Step 4: Deploy

```bash
npx wrangler deploy
```

You'll get a URL like: `https://taheito-pro-api.taheito26.workers.dev`

## Step 5: Test

```bash
# Check P2P rates (public endpoint, no auth needed)
curl https://taheito-pro-api.taheito26.workers.dev/api/p2p/rates
```

## Step 6: Migrate existing data

After logging in via the frontend, call:
```javascript
await TaheitoAPI.importFromLocalStorage();
```

This reads your current localStorage data and imports it into D1.

## Step 7: Update frontend

In your `frontend/index.html`:
1. Add `<script src="frontend-api-client.js"></script>` before the main script
2. Update `API_BASE` in the client to your worker URL
3. Start replacing `save()`/`localStorage` calls with `TaheitoAPI.*` calls
   (see the migration guide at the bottom of `frontend-api-client.js`)

## Local development

```bash
# Run worker locally with D1
npx wrangler dev

# Run schema on local D1
npx wrangler d1 execute taheito-pro-db --local --file=schema.sql
```

## File structure

```
worker/
├── package.json
├── wrangler.jsonc           ← Cloudflare config (D1 + KV + cron)
├── schema.sql               ← Full D1 database schema
├── frontend-api-client.js   ← Drop-in frontend client + migration guide
└── src/
    ├── index.js             ← Main router + CORS + cron handler
    ├── middleware/
    │   └── auth.js          ← Session validation
    ├── services/
    │   └── fifo.js          ← Server-side FIFO engine
    └── routes/
        ├── auth.js          ← Google OAuth + sessions
        ├── batches.js       ← USDT inventory CRUD
        ├── trades.js        ← Trade CRUD + FIFO trigger
        ├── dashboard.js     ← KPI computation (trading + merchant)
        ├── deals.js         ← 4 deal types + repay/settle lifecycle
        ├── customers.js     ← Customer + Supplier CRUD
        ├── suppliers.js     ← (re-export from customers.js)
        └── merchants.js     ← Profiles, invites, relationships,
                                messages, approvals, settlements,
                                journal, P2P, import/export
```
