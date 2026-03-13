/**
 * Trades routes — USDT sales with server-side FIFO allocation
 * Replaces: state.trades in localStorage, addTrade(), toggleVoidTrade(), editTrade()
 */

import { runFIFO } from '../services/fifo.js';

export async function handleTrades(c) {
  const path = c.path;
  const id = path.match(/^\/api\/trades\/([^/]+)$/)?.[1];
  const voidMatch = path.match(/^\/api\/trades\/([^/]+)\/void$/);

  // GET /api/trades — list trades with FIFO allocation data
  if (c.method === 'GET' && path === '/api/trades') {
    const range = c.url.searchParams.get('range') || 'all';
    let rangeFilter = '';
    if (range === 'today') rangeFilter = `AND t.created_at >= date('now', 'start of day')`;
    else if (range === '7d') rangeFilter = `AND t.created_at >= date('now', '-7 days')`;
    else if (range === '30d') rangeFilter = `AND t.created_at >= date('now', '-30 days')`;

    const trades = await c.db.prepare(`
      SELECT t.*,
        cu.name AS customer_name_resolved,
        COALESCE(alloc.total_cost, 0) AS fifo_cost,
        COALESCE(alloc.slice_count, 0) AS slice_count,
        CASE
          WHEN t.uses_stock = 0 THEN t.amount_usdt * t.sell_price_qar - t.fee_qar
          WHEN alloc.total_cost IS NOT NULL THEN t.amount_usdt * t.sell_price_qar - alloc.total_cost - t.fee_qar
          ELSE NULL
        END AS net_profit,
        CASE
          WHEN alloc.total_cost > 0 THEN
            ((t.amount_usdt * t.sell_price_qar - alloc.total_cost - t.fee_qar) / alloc.total_cost) * 100
          ELSE 0
        END AS margin_pct,
        CASE
          WHEN t.amount_usdt > 0 AND alloc.total_cost IS NOT NULL THEN alloc.total_cost / t.amount_usdt
          ELSE 0
        END AS avg_buy_qar
      FROM trades t
      LEFT JOIN customers cu ON cu.id = t.customer_id
      LEFT JOIN (
        SELECT trade_id, SUM(cost_qar) AS total_cost, COUNT(*) AS slice_count
        FROM trade_allocations GROUP BY trade_id
      ) alloc ON alloc.trade_id = t.id
      WHERE t.user_id = ? ${rangeFilter}
      ORDER BY t.created_at DESC
    `).bind(c.userId).all();

    return c.json({ trades: trades.results });
  }

  // POST /api/trades — create trade → runs FIFO
  if (c.method === 'POST' && path === '/api/trades') {
    const body = await c.req.json();
    const { customer_id, customer_name, amount_usdt, sell_price_qar, fee_qar, uses_stock, notes } = body;

    if (!amount_usdt || amount_usdt <= 0) return c.jsonError(400, 'amount_usdt required');
    if (!sell_price_qar || sell_price_qar <= 0) return c.jsonError(400, 'sell_price_qar required');

    const id = crypto.randomUUID();

    // If customer_name provided but no customer_id, auto-create/find customer
    let resolvedCustomerId = customer_id || null;
    if (!resolvedCustomerId && customer_name) {
      const existing = await c.db.prepare(
        'SELECT id FROM customers WHERE user_id = ? AND name = ?'
      ).bind(c.userId, customer_name.trim()).first();

      if (existing) {
        resolvedCustomerId = existing.id;
      } else {
        resolvedCustomerId = crypto.randomUUID();
        await c.db.prepare(
          `INSERT INTO customers (id, user_id, name, created_at)
           VALUES (?, ?, ?, datetime('now'))`
        ).bind(resolvedCustomerId, c.userId, customer_name.trim()).run();
      }
    }

    await c.db.prepare(`
      INSERT INTO trades (id, user_id, customer_id, customer_name, amount_usdt, sell_price_qar,
                          fee_qar, uses_stock, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      id, c.userId, resolvedCustomerId, customer_name || '',
      amount_usdt, sell_price_qar, fee_qar || 0,
      uses_stock !== undefined ? (uses_stock ? 1 : 0) : 1,
      notes || ''
    ).run();

    // Re-run FIFO to allocate this trade
    const fifoResult = await runFIFO(c.db, c.userId);
    const tradeResult = fifoResult.trades.find(t => t.trade_id === id);

    // Audit
    await c.db.prepare(
      `INSERT INTO audit_log (user_id, entity_type, entity_id, action, detail, created_at)
       VALUES (?, 'trade', ?, 'created', ?, datetime('now'))`
    ).bind(c.userId, id, `Trade: ${amount_usdt} USDT @ ${sell_price_qar} QAR`).run();

    const trade = await c.db.prepare('SELECT * FROM trades WHERE id = ?').bind(id).first();
    return c.json({ trade, fifo: tradeResult }, 201);
  }

  // PUT /api/trades/:id/void — toggle void
  if (c.method === 'PUT' && voidMatch) {
    const tradeId = voidMatch[1];
    const existing = await c.db.prepare(
      'SELECT * FROM trades WHERE id = ? AND user_id = ?'
    ).bind(tradeId, c.userId).first();
    if (!existing) return c.jsonError(404, 'Trade not found');

    const newVoided = existing.voided ? 0 : 1;
    await c.db.prepare(
      'UPDATE trades SET voided = ? WHERE id = ?'
    ).bind(newVoided, tradeId).run();

    // Re-run FIFO (voided trades are excluded from allocation)
    await runFIFO(c.db, c.userId);

    return c.json({ id: tradeId, voided: !!newVoided });
  }

  // PUT /api/trades/:id — edit trade
  if (c.method === 'PUT' && id && !voidMatch) {
    const existing = await c.db.prepare(
      'SELECT * FROM trades WHERE id = ? AND user_id = ?'
    ).bind(id, c.userId).first();
    if (!existing) return c.jsonError(404, 'Trade not found');

    const body = await c.req.json();
    const fields = ['customer_id', 'customer_name', 'amount_usdt', 'sell_price_qar', 'fee_qar', 'uses_stock', 'notes'];
    const updates = [];
    const values = [];

    for (const f of fields) {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(f === 'uses_stock' ? (body[f] ? 1 : 0) : body[f]);
      }
    }

    if (updates.length === 0) return c.jsonError(400, 'No fields to update');

    values.push(id, c.userId);
    await c.db.prepare(
      `UPDATE trades SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
    ).bind(...values).run();

    // Re-run FIFO
    await runFIFO(c.db, c.userId);

    const updated = await c.db.prepare('SELECT * FROM trades WHERE id = ?').bind(id).first();
    return c.json(updated);
  }

  // DELETE /api/trades/:id
  if (c.method === 'DELETE' && id) {
    const existing = await c.db.prepare(
      'SELECT * FROM trades WHERE id = ? AND user_id = ?'
    ).bind(id, c.userId).first();
    if (!existing) return c.jsonError(404, 'Trade not found');

    await c.db.batch([
      c.db.prepare('DELETE FROM trade_allocations WHERE trade_id = ?').bind(id),
      c.db.prepare('DELETE FROM trades WHERE id = ?').bind(id),
      c.db.prepare(
        `INSERT INTO audit_log (user_id, entity_type, entity_id, action, detail, created_at)
         VALUES (?, 'trade', ?, 'deleted', ?, datetime('now'))`
      ).bind(c.userId, id, `Deleted: ${existing.amount_usdt} USDT @ ${existing.sell_price_qar}`)
    ]);

    // Re-run FIFO (freed stock goes back to batches)
    await runFIFO(c.db, c.userId);

    return c.json({ ok: true, deleted: id });
  }

  return c.jsonError(404, 'Trade route not found');
}
