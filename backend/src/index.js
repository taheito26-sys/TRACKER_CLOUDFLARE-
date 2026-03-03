/**
 * p2p-monitor — Cloudflare Worker
 *
 * Two responsibilities:
 *   1. scheduled()  → runs every 2 min via Cron Trigger, polls Binance,
 *                     stores results in KV
 *   2. fetch()      → HTTP API, serves stored KV data to the frontend
 *
 * KV keys:
 *   p2p:latest        current snapshot  (TTL 1h)
 *   p2p:history       array of 720 mini-snapshots = 24h at 2min  (TTL 25h)
 *   p2p:day:YYYY-MM-DD  day high/low stats  (TTL 48h)
 */

const BINANCE = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";

// ── Fetch one side from Binance ───────────────────────────────────
async function fetchSide(tradeType) {
  const body = JSON.stringify({
    page: 1, rows: 10,
    payTypes: [], publisherType: null,
    asset: "USDT", tradeType,
    fiat: "QAR", merchantCheck: false,
  });
  const res = await fetch(BINANCE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Binance ${tradeType} HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json?.data)) throw new Error(`Binance ${tradeType} bad payload`);
  return json.data;
}

// ── Parse raw offers into clean shape ────────────────────────────
function parseSide(data, side) {
  const offers = (data || [])
    .map(r => ({
      price:     parseFloat(r?.adv?.price) || 0,
      min:       parseFloat(r?.adv?.minSingleTransAmount) || 0,
      max:       parseFloat(r?.adv?.dynamicMaxSingleTransAmount ?? r?.adv?.maxSingleTransAmount) || 0,
      nick:      String(r?.advertiser?.nickName || ""),
      methods:   (r?.adv?.tradeMethods || []).map(x => x.tradeMethodName).filter(Boolean),
      available: parseFloat(r?.adv?.tradableQuantity || r?.adv?.surplusAmount || 0),
    }))
    .filter(o => o.price > 0);

  const sorted = offers.slice().sort((a, b) =>
    side === "sell" ? b.price - a.price : a.price - b.price
  );

  const top5  = sorted.slice(0, 5);
  const avg   = top5.length ? top5.reduce((s, x) => s + x.price, 0) / top5.length : null;
  const best  = sorted[0]?.price || null;
  const depth = top5.reduce((s, x) => {
    return side === "sell"
      ? s + Math.min(x.max, x.available > 0 ? x.available * x.price : x.max)
      : s + Math.min(x.max / (x.price || 1), x.available > 0 ? x.available : x.max / (x.price || 1));
  }, 0);

  return { avg, best, depth, offers };
}

// ── Core poll: fetch both sides, persist to KV ───────────────────
async function pollAndStore(env) {
  // Binance tradeType "BUY"  = advertisers buying USDT  = YOU can sell to them
  // Binance tradeType "SELL" = advertisers selling USDT = YOU can buy/restock from them
  const [buyRaw, sellRaw] = await Promise.all([
    fetchSide("BUY"),
    fetchSide("SELL"),
  ]);

  const sellSide = parseSide(buyRaw,  "sell");
  const buySide  = parseSide(sellRaw, "buy");

  const ts       = Date.now();
  const spread   = sellSide.avg && buySide.avg ? sellSide.avg - buySide.avg : null;
  const spreadPct= spread && buySide.avg ? (spread / buySide.avg) * 100 : null;

  const snapshot = {
    ts,
    sellAvg:   sellSide.avg,
    buyAvg:    buySide.avg,
    bestSell:  sellSide.best,
    bestBuy:   buySide.best,
    sellDepth: sellSide.depth,
    buyDepth:  buySide.depth,
    spread,
    spreadPct,
    sellOffers: sellSide.offers,
    buyOffers:  buySide.offers,
  };

  // ── Persist latest ────────────────────────────────────────────
  await env.P2P_KV.put("p2p:latest", JSON.stringify(snapshot), {
    expirationTtl: 3600,  // 1h safety TTL
  });

  // ── Persist rolling 24h history (720 points @ 2min) ──────────
  let history = [];
  try {
    const raw = await env.P2P_KV.get("p2p:history");
    if (raw) history = JSON.parse(raw);
    if (!Array.isArray(history)) history = [];
  } catch (_) {}

  history.push({ ts, sellAvg: sellSide.avg, buyAvg: buySide.avg, spread, spreadPct });
  if (history.length > 720) history = history.slice(-720);

  await env.P2P_KV.put("p2p:history", JSON.stringify(history), {
    expirationTtl: 90000,  // 25h
  });

  // ── Persist daily high/low stats ─────────────────────────────
  const today = new Date(ts).toISOString().slice(0, 10);
  let day = { date: today, highSell: 0, lowSell: null, highBuy: 0, lowBuy: null, polls: 0 };
  try {
    const raw = await env.P2P_KV.get(`p2p:day:${today}`);
    if (raw) day = JSON.parse(raw);
    if (!day.polls) day.polls = 0;
  } catch (_) {}

  if (sellSide.avg) {
    day.highSell = Math.max(day.highSell || 0, sellSide.avg);
    day.lowSell  = day.lowSell === null ? sellSide.avg : Math.min(day.lowSell, sellSide.avg);
  }
  if (buySide.avg) {
    day.highBuy = Math.max(day.highBuy || 0, buySide.avg);
    day.lowBuy  = day.lowBuy === null ? buySide.avg : Math.min(day.lowBuy, buySide.avg);
  }
  day.polls += 1;

  await env.P2P_KV.put(`p2p:day:${today}`, JSON.stringify(day), {
    expirationTtl: 172800,  // 48h
  });

  return { snapshot, history, day };
}

// ── CORS headers ─────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control":                "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Worker export ────────────────────────────────────────────────
export default {

  // Cron Trigger — every 2 minutes
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      pollAndStore(env).catch(err =>
        console.error("[p2p-monitor] poll failed:", err.message)
      )
    );
  },

  // HTTP API — called by the frontend
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── GET /api/p2p  (main endpoint — latest + history + day stats)
    if (url.pathname === "/api/p2p" || url.pathname === "/") {
      try {
        const [latestRaw, historyRaw] = await Promise.all([
          env.P2P_KV.get("p2p:latest"),
          env.P2P_KV.get("p2p:history"),
        ]);

        const history = historyRaw ? JSON.parse(historyRaw) : [];

        // No cached data yet → do a live fetch right now
        if (!latestRaw) {
          console.log("[p2p-monitor] cache miss — fetching live");
          const { snapshot, day } = await pollAndStore(env);
          return json({ ...snapshot, history, dayStats: day, source: "fresh" });
        }

        const latest  = JSON.parse(latestRaw);
        const today   = new Date().toISOString().slice(0, 10);
        let dayStats  = null;
        try {
          const raw = await env.P2P_KV.get(`p2p:day:${today}`);
          if (raw) dayStats = JSON.parse(raw);
        } catch (_) {}

        const ageMs = Date.now() - latest.ts;

        return json({ ...latest, history, dayStats, ageMs, source: "cache" });

      } catch (err) {
        console.error("[p2p-monitor] /api/p2p error:", err.message);
        return json({ error: err.message }, 502);
      }
    }

    // ── GET /api/history  (just the 24h time-series for charts)
    if (url.pathname === "/api/history") {
      try {
        const raw     = await env.P2P_KV.get("p2p:history");
        const history = raw ? JSON.parse(raw) : [];
        return json({ history, count: history.length });
      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    // ── GET /api/status  (health check / last update time)
    if (url.pathname === "/api/status") {
      try {
        const raw    = await env.P2P_KV.get("p2p:latest");
        const latest = raw ? JSON.parse(raw) : null;
        const today  = new Date().toISOString().slice(0, 10);
        let day      = null;
        try { day = JSON.parse(await env.P2P_KV.get(`p2p:day:${today}`) || "null"); } catch (_) {}
        return json({
          ok:         !!latest,
          lastUpdate: latest?.ts   || null,
          ageMs:      latest ? Date.now() - latest.ts : null,
          sellAvg:    latest?.sellAvg  || null,
          buyAvg:     latest?.buyAvg   || null,
          pollsToday: day?.polls || 0,
        });
      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    return json({ error: "Not found" }, 404);
  },
};
