/**
 * Server-side FIFO Engine
 * Replaces client-side recomputeFor() from line ~2828 of index.html
 *
 * Allocates trades to batches in chronological order (First In, First Out).
 * Stores results in trade_allocations table for fast KPI queries.
 */

export async function runFIFO(db, userId) {
  // 1. Get all batches sorted by creation date
  const batches = await db.prepare(
    `SELECT id, initial_usdt, buy_price_qar, created_at
     FROM batches WHERE user_id = ? ORDER BY created_at ASC`
  ).bind(userId).all();

  // 2. Get all non-voided trades sorted by creation date
  const trades = await db.prepare(
    `SELECT id, amount_usdt, sell_price_qar, fee_qar, uses_stock, created_at
     FROM trades WHERE user_id = ? AND voided = 0 ORDER BY created_at ASC`
  ).bind(userId).all();

  // 3. Clear existing allocations for this user
  await db.prepare(
    `DELETE FROM trade_allocations WHERE trade_id IN
     (SELECT id FROM trades WHERE user_id = ?)`
  ).bind(userId).run();

  // 4. Build remaining map
  const remaining = new Map();
  for (const b of batches.results) {
    remaining.set(b.id, b.initial_usdt);
  }

  // 5. Allocate trades FIFO
  const insertStmts = [];
  const tradeResults = [];

  for (const trade of trades.results) {
    const revenue = trade.amount_usdt * trade.sell_price_qar;

    // Non-stock trades (no FIFO needed)
    if (!trade.uses_stock) {
      tradeResults.push({
        trade_id: trade.id,
        ok: true,
        revenue,
        cost: 0,
        fee: trade.fee_qar,
        net: revenue - trade.fee_qar,
        margin: 0,
        avg_buy: 0,
        slices: []
      });
      continue;
    }

    // FIFO allocation
    let need = trade.amount_usdt;
    let cost = 0;
    const slices = [];

    for (const batch of batches.results) {
      if (need <= 0.001) break;
      // Batch must be created before or at the same time as the trade
      if (batch.created_at > trade.created_at) continue;

      const avail = remaining.get(batch.id) || 0;
      if (avail <= 0) continue;

      const take = Math.min(avail, need);
      remaining.set(batch.id, avail - take);
      need -= take;
      cost += take * batch.buy_price_qar;

      slices.push({
        batch_id: batch.id,
        qty: take,
        cost: take * batch.buy_price_qar
      });
    }

    // Insufficient stock — rollback this trade's slices
    if (need > 0.001) {
      for (const s of slices) {
        remaining.set(s.batch_id, (remaining.get(s.batch_id) || 0) + s.qty);
      }
      tradeResults.push({
        trade_id: trade.id,
        ok: false,
        revenue,
        cost: 0,
        fee: trade.fee_qar,
        net: 0,
        margin: 0,
        avg_buy: 0,
        slices: [],
        reason: 'Insufficient stock'
      });
      continue;
    }

    // Successful allocation
    const net = revenue - cost - trade.fee_qar;
    const avgBuy = trade.amount_usdt > 0 ? cost / trade.amount_usdt : 0;
    const margin = cost > 0 ? (net / cost) * 100 : 0;

    tradeResults.push({
      trade_id: trade.id,
      ok: true,
      revenue,
      cost,
      fee: trade.fee_qar,
      net,
      margin,
      avg_buy: avgBuy,
      slices
    });

    // Queue INSERT statements for allocations
    for (const s of slices) {
      insertStmts.push(
        db.prepare(
          'INSERT INTO trade_allocations (trade_id, batch_id, qty_usdt, cost_qar) VALUES (?, ?, ?, ?)'
        ).bind(trade.id, s.batch_id, s.qty, s.cost)
      );
    }
  }

  // 6. Batch insert all allocations (D1 atomic batch)
  if (insertStmts.length > 0) {
    // D1 batch() limit is ~100 statements; chunk if needed
    const CHUNK = 80;
    for (let i = 0; i < insertStmts.length; i += CHUNK) {
      await db.batch(insertStmts.slice(i, i + CHUNK));
    }
  }

  // 7. Compute batch remaining for stock summary
  const batchSummary = [];
  for (const b of batches.results) {
    batchSummary.push({
      id: b.id,
      initial_usdt: b.initial_usdt,
      remaining_usdt: remaining.get(b.id) || 0,
      buy_price_qar: b.buy_price_qar
    });
  }

  return { trades: tradeResults, batches: batchSummary };
}

/**
 * Get stock summary from pre-computed allocations (fast path).
 * Only re-runs FIFO if allocations table is empty.
 */
export async function getStockSummary(db, userId) {
  // Check if allocations exist
  const count = await db.prepare(
    `SELECT COUNT(*) as c FROM trade_allocations WHERE trade_id IN
     (SELECT id FROM trades WHERE user_id = ?)`
  ).bind(userId).first();

  // If no allocations and there are trades, run FIFO first
  if (count.c === 0) {
    const tradeCount = await db.prepare(
      'SELECT COUNT(*) as c FROM trades WHERE user_id = ? AND voided = 0'
    ).bind(userId).first();
    if (tradeCount.c > 0) {
      await runFIFO(db, userId);
    }
  }

  // Now compute from allocation table
  const result = await db.prepare(`
    SELECT
      b.id,
      b.initial_usdt,
      b.buy_price_qar,
      b.source,
      b.created_at,
      b.status,
      COALESCE(a.allocated, 0) as allocated_usdt,
      (b.initial_usdt - COALESCE(a.allocated, 0)) as remaining_usdt
    FROM batches b
    LEFT JOIN (
      SELECT batch_id, SUM(qty_usdt) as allocated
      FROM trade_allocations GROUP BY batch_id
    ) a ON a.batch_id = b.id
    WHERE b.user_id = ?
    ORDER BY b.created_at ASC
  `).bind(userId).all();

  const batches = result.results;
  const totalStock = batches.reduce((s, b) => s + Math.max(0, b.remaining_usdt), 0);
  const stockCost = batches.reduce((s, b) => s + Math.max(0, b.remaining_usdt) * b.buy_price_qar, 0);
  const wacop = totalStock > 0 ? stockCost / totalStock : null;

  return { batches, totalStock, stockCost, wacop };
}
