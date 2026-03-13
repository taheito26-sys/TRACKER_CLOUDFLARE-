/**
 * Deals routes — the 4 deal types + repayment + settlement lifecycle
 * Replaces: MS.advances, MS.purchases, MS.profitShares, MS.pools in localStorage
 * Also replaces: _openNewAdvanceModal(), _openNewPurchaseModal(), _openNewPSModal(), _openNewPoolModal()
 */

export async function handleDeals(c) {
  const path = c.path;
  const id = path.match(/^\/api\/deals\/([^/]+)$/)?.[1];
  const actionMatch = path.match(/^\/api\/deals\/([^/]+)\/(repay|settle|cancel|acknowledge)$/);

  // GET /api/deals — list deals (filterable)
  if (c.method === 'GET' && (path === '/api/deals' || path === '/api/deals/kpis')) {

    // /api/deals/kpis — just the KPIs, no deal list
    if (path === '/api/deals/kpis') {
      return await dealKPIs(c);
    }

    const type = c.url.searchParams.get('type');       // advance, purchase, profit_share, pool
    const status = c.url.searchParams.get('status');   // sent, active, overdue, settled, etc.
    const relId = c.url.searchParams.get('relationship_id');

    let where = ['d.creator_id = ?'];
    let binds = [c.merchantId];

    if (type) { where.push('d.deal_type = ?'); binds.push(type); }
    if (status) { where.push('d.status = ?'); binds.push(status); }
    if (relId) { where.push('d.relationship_id = ?'); binds.push(relId); }

    const deals = await c.db.prepare(`
      SELECT d.*,
        r.merchant_a, r.merchant_b,
        ma.display_name AS merchant_a_name,
        mb.display_name AS merchant_b_name
      FROM deals d
      LEFT JOIN relationships r ON r.id = d.relationship_id
      LEFT JOIN merchants ma ON ma.id = r.merchant_a
      LEFT JOIN merchants mb ON mb.id = r.merchant_b
      WHERE ${where.join(' AND ')}
      ORDER BY d.created_at DESC
    `).bind(...binds).all();

    return c.json({ deals: deals.results });
  }

  // GET /api/deals/:id — detail
  if (c.method === 'GET' && id) {
    const deal = await c.db.prepare(`
      SELECT d.*,
        r.merchant_a, r.merchant_b,
        ma.display_name AS merchant_a_name,
        mb.display_name AS merchant_b_name
      FROM deals d
      LEFT JOIN relationships r ON r.id = d.relationship_id
      LEFT JOIN merchants ma ON ma.id = r.merchant_a
      LEFT JOIN merchants mb ON mb.id = r.merchant_b
      WHERE d.id = ? AND d.creator_id = ?
    `).bind(id, c.merchantId).first();

    if (!deal) return c.jsonError(404, 'Deal not found');

    // Get related journal entries
    const journal = await c.db.prepare(
      `SELECT * FROM journal WHERE ref_id = ? ORDER BY created_at ASC`
    ).bind(id).all();

    // Get pool periods if applicable
    let poolPeriods = [];
    if (deal.deal_type === 'pool') {
      const pp = await c.db.prepare(
        'SELECT * FROM pool_periods WHERE deal_id = ? ORDER BY created_at ASC'
      ).bind(id).all();
      poolPeriods = pp.results;
    }

    return c.json({ deal, journal: journal.results, pool_periods: poolPeriods });
  }

  // POST /api/deals — create deal
  if (c.method === 'POST' && path === '/api/deals') {
    const body = await c.req.json();
    const { deal_type, relationship_id } = body;

    if (!deal_type) return c.jsonError(400, 'deal_type required');
    if (!relationship_id) return c.jsonError(400, 'relationship_id required');
    if (!['advance', 'purchase', 'profit_share', 'pool'].includes(deal_type)) {
      return c.jsonError(400, 'Invalid deal_type');
    }

    // Verify relationship exists and merchant is part of it
    const rel = await c.db.prepare(
      `SELECT * FROM relationships WHERE id = ? AND (merchant_a = ? OR merchant_b = ?)`
    ).bind(relationship_id, c.merchantId, c.merchantId).first();
    if (!rel) return c.jsonError(404, 'Relationship not found');

    const dealId = crypto.randomUUID();
    const prefix = { advance: 'ADV', purchase: 'SALE', profit_share: 'PS', pool: 'POOL' }[deal_type];
    const dealRef = `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // Build deal from body based on type
    const deal = {
      id: dealId,
      relationship_id,
      creator_id: c.merchantId,
      deal_type,
      deal_ref: dealRef,
      currency: body.currency || 'USDT',
      principal: body.principal || 0,
      usdt_qty: body.usdt_qty || body.principal || 0,
      rate_qar: body.rate_qar || 0,
      service_fee: body.service_fee || 0,
      sent_date: body.sent_date || new Date().toISOString(),
      due_date: body.due_date || null,
      status: 'sent',
      notes: body.notes || '',
      // Purchase
      sale_rate: body.sale_rate || 0,
      cost_basis: body.cost_basis || 0,
      sale_margin: body.sale_rate && body.cost_basis && body.usdt_qty
        ? (body.sale_rate - body.cost_basis) * body.usdt_qty : 0,
      total_sale_value: body.sale_rate && body.usdt_qty ? body.sale_rate * body.usdt_qty : 0,
      payment_method: body.payment_method || '',
      // Profit-share
      owner_ratio: body.owner_ratio || 0,
      operator_ratio: body.operator_ratio || (100 - (body.owner_ratio || 0)),
      loss_policy: body.loss_policy || '',
      principal_guarantee: body.principal_guarantee ? 1 : 0,
      // Pool
      initial_capital: body.initial_capital || body.principal || 0,
      monthly_target: body.monthly_target || 0,
    };

    await c.db.prepare(`
      INSERT INTO deals (
        id, relationship_id, creator_id, deal_type, deal_ref,
        currency, principal, usdt_qty, rate_qar, service_fee,
        sent_date, due_date, status, notes,
        sale_rate, cost_basis, sale_margin, total_sale_value, payment_method,
        owner_ratio, operator_ratio, loss_policy, principal_guarantee,
        initial_capital, monthly_target,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        datetime('now'), datetime('now')
      )
    `).bind(
      deal.id, deal.relationship_id, deal.creator_id, deal.deal_type, deal.deal_ref,
      deal.currency, deal.principal, deal.usdt_qty, deal.rate_qar, deal.service_fee,
      deal.sent_date, deal.due_date, deal.status, deal.notes,
      deal.sale_rate, deal.cost_basis, deal.sale_margin, deal.total_sale_value, deal.payment_method,
      deal.owner_ratio, deal.operator_ratio, deal.loss_policy, deal.principal_guarantee,
      deal.initial_capital, deal.monthly_target
    ).run();

    // Journal entry based on deal type
    const journalId = crypto.randomUUID();
    let drAccount, crAccount, amount, memo;

    if (deal_type === 'advance') {
      drAccount = 'Merchant Advance Receivable';
      crAccount = 'USDT Wallet';
      amount = deal.principal;
      memo = `Advance sent: ${dealRef}`;
    } else if (deal_type === 'purchase') {
      drAccount = 'Merchant Trade Receivable';
      crAccount = 'USDT Wallet';
      amount = deal.total_sale_value;
      memo = `Sale ${dealRef}: ${deal.usdt_qty} USDT @ ${deal.sale_rate}`;
    } else if (deal_type === 'profit_share') {
      drAccount = 'Profit-Share Capital';
      crAccount = 'USDT Wallet';
      amount = deal.principal;
      memo = `Profit-share: ${dealRef}`;
    } else {
      drAccount = 'Pool Capital Deployed';
      crAccount = 'USDT Wallet';
      amount = deal.initial_capital;
      memo = `Pool: ${dealRef}`;
    }

    if (amount > 0) {
      await c.db.prepare(`
        INSERT INTO journal (id, user_id, dr_account, cr_account, amount, currency, ref_type, ref_id, memo, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(journalId, c.userId, drAccount, crAccount, amount, deal.currency, deal_type, dealId, memo).run();
    }

    // Audit
    await c.db.prepare(
      `INSERT INTO audit_log (user_id, entity_type, entity_id, action, detail, created_at)
       VALUES (?, 'deal', ?, 'created', ?, datetime('now'))`
    ).bind(c.userId, dealId, memo).run();

    // System message in relationship chat
    await c.db.prepare(`
      INSERT INTO messages (id, relationship_id, sender_id, body, msg_type, ref_deal_id, created_at)
      VALUES (?, ?, ?, ?, 'deal_proposal', ?, datetime('now'))
    `).bind(crypto.randomUUID(), relationship_id, c.merchantId, memo, dealId).run();

    return c.json({ deal, deal_ref: dealRef }, 201);
  }

  // PUT /api/deals/:id/repay — record repayment (advance or purchase)
  if (c.method === 'PUT' && actionMatch && actionMatch[2] === 'repay') {
    const dealId = actionMatch[1];
    const body = await c.req.json();
    const { amount, reference, notes } = body;

    if (!amount || amount <= 0) return c.jsonError(400, 'Repayment amount required');

    const deal = await c.db.prepare(
      'SELECT * FROM deals WHERE id = ? AND creator_id = ?'
    ).bind(dealId, c.merchantId).first();
    if (!deal) return c.jsonError(404, 'Deal not found');

    const newReturned = (deal.returned_amount || 0) + amount;
    const newPaid = (deal.paid_amount || 0) + amount;

    // Determine new status
    let newStatus = deal.status;
    if (deal.deal_type === 'advance') {
      if (newReturned >= deal.principal) newStatus = 'returned';
      else newStatus = 'partially_returned';
    } else if (deal.deal_type === 'purchase') {
      if (newPaid >= deal.total_sale_value) newStatus = 'paid';
      else newStatus = 'active';
    }

    await c.db.batch([
      c.db.prepare(`
        UPDATE deals SET
          returned_amount = ?, paid_amount = ?,
          status = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(newReturned, newPaid, newStatus, dealId),

      // Journal: reverse the receivable
      c.db.prepare(`
        INSERT INTO journal (id, user_id, dr_account, cr_account, amount, currency, ref_type, ref_id, memo, created_at)
        VALUES (?, ?, 'USDT Wallet', 'Merchant Advance Receivable', ?, ?, 'repayment', ?, ?, datetime('now'))
      `).bind(crypto.randomUUID(), c.userId, amount, deal.currency, dealId, `Repayment on ${deal.deal_ref}: ${amount} ${deal.currency}`),

      // System message
      c.db.prepare(`
        INSERT INTO messages (id, relationship_id, sender_id, body, msg_type, ref_deal_id, created_at)
        VALUES (?, ?, ?, ?, 'payment_notice', ?, datetime('now'))
      `).bind(crypto.randomUUID(), deal.relationship_id, c.merchantId, `Repayment received: ${amount} ${deal.currency} on ${deal.deal_ref}`, dealId),

      // Audit
      c.db.prepare(
        `INSERT INTO audit_log (user_id, entity_type, entity_id, action, detail, created_at)
         VALUES (?, 'deal', ?, 'repayment', ?, datetime('now'))`
      ).bind(c.userId, dealId, `Repayment: ${amount} ${deal.currency}, new total: ${newReturned}`)
    ]);

    return c.json({
      deal_id: dealId,
      amount_repaid: amount,
      total_returned: newReturned,
      status: newStatus,
      fully_repaid: newStatus === 'returned' || newStatus === 'paid'
    });
  }

  // PUT /api/deals/:id/settle
  if (c.method === 'PUT' && actionMatch && actionMatch[2] === 'settle') {
    const dealId = actionMatch[1];
    const body = await c.req.json();

    const deal = await c.db.prepare(
      'SELECT * FROM deals WHERE id = ? AND creator_id = ?'
    ).bind(dealId, c.merchantId).first();
    if (!deal) return c.jsonError(404, 'Deal not found');

    await c.db.batch([
      c.db.prepare(`
        UPDATE deals SET status = 'settled', settled_at = datetime('now'), updated_at = datetime('now'),
          final_proceeds = ?, final_fees = ?
        WHERE id = ?
      `).bind(body.final_proceeds || deal.returned_amount, body.final_fees || 0, dealId),

      c.db.prepare(
        `INSERT INTO audit_log (user_id, entity_type, entity_id, action, detail, created_at)
         VALUES (?, 'deal', ?, 'settled', ?, datetime('now'))`
      ).bind(c.userId, dealId, `Deal ${deal.deal_ref} settled`),

      c.db.prepare(`
        INSERT INTO messages (id, relationship_id, sender_id, body, msg_type, ref_deal_id, created_at)
        VALUES (?, ?, ?, ?, 'settlement_notice', ?, datetime('now'))
      `).bind(crypto.randomUUID(), deal.relationship_id, c.merchantId, `Deal ${deal.deal_ref} settled`, dealId)
    ]);

    return c.json({ deal_id: dealId, status: 'settled' });
  }

  // PUT /api/deals/:id/cancel
  if (c.method === 'PUT' && actionMatch && actionMatch[2] === 'cancel') {
    const dealId = actionMatch[1];
    const deal = await c.db.prepare(
      'SELECT * FROM deals WHERE id = ? AND creator_id = ?'
    ).bind(dealId, c.merchantId).first();
    if (!deal) return c.jsonError(404, 'Deal not found');

    await c.db.prepare(
      `UPDATE deals SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`
    ).bind(dealId).run();

    return c.json({ deal_id: dealId, status: 'cancelled' });
  }

  // PUT /api/deals/:id — generic update
  if (c.method === 'PUT' && id && !actionMatch) {
    const body = await c.req.json();
    const allowedFields = ['notes', 'due_date', 'status', 'transfer_proof', 'top_ups', 'withdrawals'];
    const updates = [];
    const values = [];

    for (const f of allowedFields) {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(body[f]);
      }
    }
    updates.push('updated_at = datetime(\'now\')');

    if (updates.length <= 1) return c.jsonError(400, 'No fields to update');

    values.push(id, c.merchantId);
    await c.db.prepare(
      `UPDATE deals SET ${updates.join(', ')} WHERE id = ? AND creator_id = ?`
    ).bind(...values).run();

    const updated = await c.db.prepare('SELECT * FROM deals WHERE id = ?').bind(id).first();
    return c.json(updated);
  }

  return c.jsonError(404, 'Deal route not found');
}

// ── Deal KPIs endpoint ──────────────────────────────────────────────

async function dealKPIs(c) {
  if (!c.merchantId) return c.jsonError(400, 'Merchant profile required');

  const adv = await c.db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status IN ('sent','acknowledged','active','due')
        THEN principal - returned_amount - approved_offsets ELSE 0 END), 0) AS principal_out,
      COALESCE(SUM(CASE WHEN status = 'overdue'
        THEN principal - returned_amount - approved_offsets ELSE 0 END), 0) AS overdue,
      COUNT(CASE WHEN status IN ('sent','acknowledged','active','due') THEN 1 END) AS active,
      COUNT(CASE WHEN status = 'overdue' THEN 1 END) AS overdue_count
    FROM deals WHERE creator_id = ? AND deal_type = 'advance'
  `).bind(c.merchantId).first();

  const purch = await c.db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status IN ('active','sent')
        THEN total_sale_value - paid_amount ELSE 0 END), 0) AS receivable,
      COALESCE(SUM(CASE WHEN status IN ('paid','settled')
        THEN sale_margin ELSE 0 END), 0) AS margin
    FROM deals WHERE creator_id = ? AND deal_type = 'purchase'
  `).bind(c.merchantId).first();

  return c.json({
    advance: { principal_out: adv.principal_out, overdue: adv.overdue, active: adv.active, overdue_count: adv.overdue_count },
    purchase: { receivable: purch.receivable, realized_margin: purch.margin },
    total_deployed: adv.principal_out + purch.receivable
  });
}
