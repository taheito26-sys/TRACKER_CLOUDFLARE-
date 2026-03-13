/**
 * Dashboard routes — KPI computation, entirely server-side.
 * Replaces: kpiFor() line ~2847, _mchKpis() line ~11259,
 *           totalStock(), stockCostQAR(), getWACOP()
 */

export async function handleDashboard(c) {
  const path = c.path;

  // GET /api/dashboard/kpis?range=all|today|7d|30d
  if (c.method === 'GET' && path === '/api/dashboard/kpis') {
    const range = c.url.searchParams.get('range') || 'all';
    let rangeFilter = '';
    if (range === 'today') rangeFilter = `AND t.created_at >= date('now', 'start of day')`;
    else if (range === '7d') rangeFilter = `AND t.created_at >= date('now', '-7 days')`;
    else if (range === '30d') rangeFilter = `AND t.created_at >= date('now', '-30 days')`;

    // ── Trading KPIs (replaces kpiFor) ─────────────────────────

    const tradingRaw = await c.db.prepare(`
      SELECT
        COUNT(*) AS trade_count,
        COALESCE(SUM(t.amount_usdt), 0) AS total_qty,
        COALESCE(SUM(t.amount_usdt * t.sell_price_qar), 0) AS revenue,
        COALESCE(SUM(t.fee_qar), 0) AS total_fees
      FROM trades t
      WHERE t.user_id = ? AND t.voided = 0 ${rangeFilter}
    `).bind(c.userId).first();

    // Net profit from FIFO allocations
    const netResult = await c.db.prepare(`
      SELECT COALESCE(SUM(
        t.amount_usdt * t.sell_price_qar - COALESCE(alloc.cost, 0) - t.fee_qar
      ), 0) AS net_profit
      FROM trades t
      LEFT JOIN (
        SELECT trade_id, SUM(cost_qar) AS cost
        FROM trade_allocations GROUP BY trade_id
      ) alloc ON alloc.trade_id = t.id
      WHERE t.user_id = ? AND t.voided = 0 AND t.uses_stock = 1 ${rangeFilter}
    `).bind(c.userId).first();

    // Non-stock trade profit
    const noStockNet = await c.db.prepare(`
      SELECT COALESCE(SUM(amount_usdt * sell_price_qar - fee_qar), 0) AS net
      FROM trades
      WHERE user_id = ? AND voided = 0 AND uses_stock = 0 ${rangeFilter}
    `).bind(c.userId).first();

    // Average margin
    const marginResult = await c.db.prepare(`
      SELECT AVG(
        CASE WHEN alloc.cost > 0 THEN
          ((t.amount_usdt * t.sell_price_qar - alloc.cost - t.fee_qar) / alloc.cost) * 100
        ELSE 0 END
      ) AS avg_margin
      FROM trades t
      INNER JOIN (
        SELECT trade_id, SUM(cost_qar) AS cost
        FROM trade_allocations GROUP BY trade_id
      ) alloc ON alloc.trade_id = t.id
      WHERE t.user_id = ? AND t.voided = 0 AND t.uses_stock = 1 ${rangeFilter}
    `).bind(c.userId).first();

    // ── Stock KPIs (replaces totalStock, stockCostQAR, getWACOP) ──

    const stockResult = await c.db.prepare(`
      SELECT
        COALESCE(SUM(b.initial_usdt - COALESCE(a.allocated, 0)), 0) AS remaining_usdt,
        COALESCE(SUM(
          (b.initial_usdt - COALESCE(a.allocated, 0)) * b.buy_price_qar
        ), 0) AS stock_cost
      FROM batches b
      LEFT JOIN (
        SELECT batch_id, SUM(qty_usdt) AS allocated
        FROM trade_allocations GROUP BY batch_id
      ) a ON a.batch_id = b.id
      WHERE b.user_id = ?
    `).bind(c.userId).first();

    const wacop = stockResult.remaining_usdt > 0
      ? stockResult.stock_cost / stockResult.remaining_usdt
      : null;

    // ── Merchant Deal KPIs (replaces _mchKpis) ────────────────

    let merchantKpis = null;
    if (c.merchantId) {
      // Active advances — principal outstanding
      const advResult = await c.db.prepare(`
        SELECT
          COUNT(*) AS active_count,
          COALESCE(SUM(principal - returned_amount - approved_offsets), 0) AS principal_out
        FROM deals
        WHERE creator_id = ? AND deal_type = 'advance'
          AND status IN ('sent', 'acknowledged', 'active', 'due')
      `).bind(c.merchantId).first();

      // Overdue advances
      const advOverdue = await c.db.prepare(`
        SELECT COUNT(*) AS count,
          COALESCE(SUM(principal - returned_amount - approved_offsets), 0) AS amount
        FROM deals
        WHERE creator_id = ? AND deal_type = 'advance' AND status = 'overdue'
      `).bind(c.merchantId).first();

      // Purchase receivable + realized margin
      const purchResult = await c.db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status IN ('active', 'sent')
            THEN total_sale_value - paid_amount ELSE 0 END), 0) AS receivable,
          COALESCE(SUM(CASE WHEN status IN ('paid', 'settled')
            THEN sale_margin ELSE 0 END), 0) AS realized_margin,
          COUNT(CASE WHEN status IN ('active', 'sent') THEN 1 END) AS active_count
        FROM deals
        WHERE creator_id = ? AND deal_type = 'purchase'
      `).bind(c.merchantId).first();

      // Profit-share capital out + realized
      const psResult = await c.db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'active' THEN principal ELSE 0 END), 0) AS capital_out,
          COUNT(CASE WHEN status = 'active' THEN 1 END) AS active_count,
          COALESCE(SUM(CASE WHEN status IN ('settled', 'closed')
            THEN (final_proceeds - principal - final_fees) * owner_ratio / 100 ELSE 0 END), 0) AS realized
        FROM deals
        WHERE creator_id = ? AND deal_type = 'profit_share'
      `).bind(c.merchantId).first();

      // Pool capital + profit
      const poolResult = await c.db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN d.status = 'active'
            THEN d.initial_capital + d.top_ups - d.withdrawals ELSE 0 END), 0) AS capital,
          COUNT(CASE WHEN d.status = 'active' THEN 1 END) AS active_count,
          COALESCE(pp.profit, 0) AS realized_profit
        FROM deals d
        LEFT JOIN (
          SELECT deal_id, SUM(owner_share) AS profit
          FROM pool_periods WHERE payout_status = 'paid' GROUP BY deal_id
        ) pp ON pp.deal_id = d.id
        WHERE d.creator_id = ? AND d.deal_type = 'pool'
      `).bind(c.merchantId).first();

      // Counts
      const countsResult = await c.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM deals WHERE creator_id = ?) AS total_deals,
          (SELECT COUNT(*) FROM settlements WHERE relationship_id IN
            (SELECT id FROM relationships WHERE merchant_a = ? OR merchant_b = ?)) AS settlement_count,
          (SELECT COUNT(*) FROM corrections WHERE requested_by = ? AND status = 'pending') AS pending_corrections,
          (SELECT COUNT(*) FROM approvals WHERE reviewer_id = ? AND status = 'pending') AS pending_approvals,
          (SELECT COUNT(*) FROM notifications WHERE merchant_id = ? AND read_at IS NULL) AS unread_notifications,
          (SELECT COUNT(*) FROM relationships WHERE (merchant_a = ? OR merchant_b = ?) AND status = 'active') AS active_relationships
      `).bind(
        c.merchantId, c.merchantId, c.merchantId,
        c.merchantId, c.merchantId, c.merchantId,
        c.merchantId, c.merchantId
      ).first();

      const totalDeployed = advResult.principal_out + purchResult.receivable +
                           psResult.capital_out + poolResult.capital;
      const totalRealized = purchResult.realized_margin + psResult.realized + poolResult.realized_profit;

      merchantKpis = {
        total_deployed: totalDeployed,
        outstanding_principal: advResult.principal_out,
        overdue_principal: advOverdue.amount,
        overdue_count: advOverdue.count,
        realized_profit: totalRealized,
        purchase_receivable: purchResult.receivable,
        purchase_margin: purchResult.realized_margin,
        ps_capital_out: psResult.capital_out,
        ps_realized: psResult.realized,
        pool_capital: poolResult.capital,
        pool_profit: poolResult.realized_profit,
        advance_active: advResult.active_count,
        purchase_active: purchResult.active_count,
        ps_active: psResult.active_count,
        pool_active: poolResult.active_count,
        total_deals: countsResult.total_deals,
        settlement_count: countsResult.settlement_count,
        pending_corrections: countsResult.pending_corrections,
        pending_approvals: countsResult.pending_approvals,
        unread_notifications: countsResult.unread_notifications,
        active_relationships: countsResult.active_relationships
      };
    }

    return c.json({
      trading: {
        trade_count: tradingRaw.trade_count,
        total_qty: tradingRaw.total_qty,
        revenue: tradingRaw.revenue,
        total_fees: tradingRaw.total_fees,
        net_profit: (netResult.net_profit || 0) + (noStockNet.net || 0),
        avg_margin: marginResult.avg_margin || 0,
      },
      stock: {
        remaining_usdt: stockResult.remaining_usdt,
        stock_cost: stockResult.stock_cost,
        wacop
      },
      merchant: merchantKpis,
      range,
      computed_at: new Date().toISOString()
    });
  }

  // GET /api/dashboard/calendar?month=2026-03
  if (c.method === 'GET' && path === '/api/dashboard/calendar') {
    const month = c.url.searchParams.get('month') || new Date().toISOString().slice(0, 7);

    const days = await c.db.prepare(`
      SELECT
        strftime('%d', created_at) AS day,
        COUNT(*) AS trade_count,
        SUM(amount_usdt) AS total_usdt,
        SUM(amount_usdt * sell_price_qar) AS total_revenue
      FROM trades
      WHERE user_id = ? AND voided = 0
        AND strftime('%Y-%m', created_at) = ?
      GROUP BY strftime('%d', created_at)
      ORDER BY day
    `).bind(c.userId, month).all();

    return c.json({ month, days: days.results });
  }

  return c.jsonError(404, 'Dashboard route not found');
}
