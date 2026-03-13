/**
 * TAHEITO PRO X — Unified API Worker
 * Cloudflare Worker + D1 + KV
 *
 * Replaces: localStorage state, client-side FIFO, client-side KPI computation
 * Keeps:    Frontend rendering only (thin shell)
 */

import { handleAuth }          from './routes/auth.js';
import { handleBatches }       from './routes/batches.js';
import { handleTrades }        from './routes/trades.js';
import { handleDashboard }     from './routes/dashboard.js';
import { handleCustomers }     from './routes/customers.js';
import { handleSuppliers }     from './routes/suppliers.js';
import { handleMerchants }     from './routes/merchants.js';
import { handleInvites }       from './routes/invites.js';
import { handleRelationships } from './routes/relationships.js';
import { handleDeals }         from './routes/deals.js';
import { handleSettlements }   from './routes/settlements.js';
import { handleJournal }       from './routes/journal.js';
import { handleMessages }      from './routes/messages.js';
import { handleApprovals }     from './routes/approvals.js';
import { handleP2P }           from './routes/p2p.js';
import { handleImportExport }  from './routes/importexport.js';
import { validateSession }     from './middleware/auth.js';
import { runFIFO }             from './services/fifo.js';

// ── Helpers ──────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function jsonError(status, message) {
  return json({ error: message }, status);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function withCORS(response, origin) {
  const headers = corsHeaders(origin);
  for (const [k, v] of Object.entries(headers)) {
    response.headers.set(k, v);
  }
  return response;
}

// ── Route context builder ────────────────────────────────────────────

function ctx(request, env, url) {
  return {
    req: request,
    env,
    db: env.DB,
    kv: env.CACHE,
    url,
    path: url.pathname,
    method: request.method,
    userId: request._userId || null,
    merchantId: request._merchantId || null,
    json,
    jsonError,
    params: {},
  };
}

// ── Main fetch handler ───────────────────────────────────────────────

export default {
  async fetch(request, env, execCtx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const path = url.pathname;

    // Public routes (no auth required)
    const publicPrefixes = ['/api/auth/', '/api/p2p/'];
    const isPublic = publicPrefixes.some(p => path.startsWith(p));

    // Auth check
    if (!isPublic) {
      const auth = await validateSession(request, env);
      if (!auth.valid) {
        return withCORS(jsonError(401, 'Unauthorized — session invalid or expired'), origin);
      }
      request._userId = auth.userId;
      request._merchantId = auth.merchantId;
    }

    const c = ctx(request, env, url);

    try {
      let response;

      if (path.startsWith('/api/auth'))           response = await handleAuth(c);
      else if (path.startsWith('/api/batches'))    response = await handleBatches(c);
      else if (path.startsWith('/api/trades'))     response = await handleTrades(c);
      else if (path.startsWith('/api/dashboard'))  response = await handleDashboard(c);
      else if (path.startsWith('/api/customers'))  response = await handleCustomers(c);
      else if (path.startsWith('/api/suppliers'))  response = await handleSuppliers(c);
      else if (path.startsWith('/api/merchants'))  response = await handleMerchants(c);
      else if (path.startsWith('/api/invites'))    response = await handleInvites(c);
      else if (path.startsWith('/api/relationships')) response = await handleRelationships(c);
      else if (path.startsWith('/api/deals'))      response = await handleDeals(c);
      else if (path.startsWith('/api/settlements')) response = await handleSettlements(c);
      else if (path.startsWith('/api/journal'))    response = await handleJournal(c);
      else if (path.startsWith('/api/messages'))   response = await handleMessages(c);
      else if (path.startsWith('/api/approvals'))  response = await handleApprovals(c);
      else if (path.startsWith('/api/p2p'))        response = await handleP2P(c);
      else if (path.startsWith('/api/import') || path.startsWith('/api/export'))
                                                   response = await handleImportExport(c);
      else response = jsonError(404, 'Not found');

      return withCORS(response, origin);

    } catch (err) {
      console.error('Unhandled error:', err.message, err.stack);
      // Audit log the error
      try {
        await env.DB.prepare(
          `INSERT INTO audit_log (user_id, entity_type, action, detail, created_at)
           VALUES (?, 'system', 'error', ?, datetime('now'))`
        ).bind(c.userId, JSON.stringify({ path, error: err.message })).run();
      } catch (_) {}

      return withCORS(jsonError(500, 'Internal server error'), origin);
    }
  },

  // ── Cron: Binance poll + overdue detection ──────────────────────────

  async scheduled(event, env, execCtx) {
    // 1. Poll Binance P2P rates → store in KV
    try {
      const body = JSON.stringify({
        fiat: 'QAR', asset: 'USDT', tradeType: 'SELL',
        page: 1, rows: 10, payTypes: []
      });
      const res = await fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.data)) {
          await env.CACHE.put('p2p_sell_raw', JSON.stringify(data.data), { expirationTtl: 300 });
          const prices = data.data.map(d => parseFloat(d.adv?.price || 0)).filter(p => p > 0);
          if (prices.length) {
            await env.CACHE.put('p2p_sell_avg', String(prices.reduce((a, b) => a + b, 0) / prices.length));
          }
        }
      }
      // Buy side
      const bodyBuy = JSON.stringify({
        fiat: 'QAR', asset: 'USDT', tradeType: 'BUY',
        page: 1, rows: 10, payTypes: []
      });
      const resBuy = await fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyBuy,
        signal: AbortSignal.timeout(8000)
      });
      if (resBuy.ok) {
        const dataBuy = await resBuy.json();
        if (Array.isArray(dataBuy?.data)) {
          await env.CACHE.put('p2p_buy_raw', JSON.stringify(dataBuy.data), { expirationTtl: 300 });
          const prices = dataBuy.data.map(d => parseFloat(d.adv?.price || 0)).filter(p => p > 0);
          if (prices.length) {
            await env.CACHE.put('p2p_buy_avg', String(prices.reduce((a, b) => a + b, 0) / prices.length));
          }
        }
      }
    } catch (e) {
      console.error('Binance poll error:', e.message);
    }

    // 2. Mark overdue deals
    try {
      await env.DB.prepare(`
        UPDATE deals
        SET status = 'overdue', updated_at = datetime('now')
        WHERE status IN ('sent', 'acknowledged', 'active', 'due')
          AND due_date IS NOT NULL
          AND due_date < datetime('now')
      `).run();
    } catch (e) {
      console.error('Overdue check error:', e.message);
    }
  }
};
