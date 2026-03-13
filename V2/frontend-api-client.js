/**
 * TAHEITO PRO X — Frontend API Client
 * ====================================
 * Drop this into your index.html to replace all localStorage operations.
 *
 * USAGE:
 *   1. Include this script BEFORE the main app script
 *   2. Replace save()/load() calls with API calls
 *   3. Remove all localStorage references for business data
 *
 * The only thing stored client-side is the auth token (in memory, not localStorage).
 */

const TaheitoAPI = (function() {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────────
  const API_BASE = 'https://taheito-pro-api.taheito26.workers.dev';
  let _token = null;   // Auth token — held in memory only
  let _userId = null;
  let _merchantId = null;

  // ── Core HTTP ──────────────────────────────────────────────────────

  async function _fetch(method, path, body) {
    const opts = {
      method,
      headers: {}
    };
    if (_token) opts.headers['Authorization'] = 'Bearer ' + _token;
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(API_BASE + path, opts);
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch(e) { data = { raw: text }; }
    if (!res.ok) throw new Error(data.error || 'API error ' + res.status);
    return data;
  }

  const api = {
    get:    (path) => _fetch('GET', path),
    post:   (path, body) => _fetch('POST', path, body),
    put:    (path, body) => _fetch('PUT', path, body),
    delete: (path) => _fetch('DELETE', path),
  };

  // ── Auth ───────────────────────────────────────────────────────────

  async function loginWithGoogle(credential) {
    const data = await api.post('/api/auth/google', { credential });
    _token = data.token;
    _userId = data.user?.id;
    _merchantId = data.merchant_id;
    return data;
  }

  async function logout() {
    try { await api.post('/api/auth/logout'); } catch(e) {}
    _token = null; _userId = null; _merchantId = null;
  }

  async function getMe() {
    return api.get('/api/auth/me');
  }

  function isLoggedIn() { return !!_token; }
  function setToken(t) { _token = t; }

  // ── Batches (replaces state.batches + localStorage) ────────────────

  async function getBatches() {
    return api.get('/api/batches');
  }

  async function getBatchSummary() {
    return api.get('/api/batches/summary');
  }

  async function createBatch(batch) {
    // batch = { source, initial_usdt, buy_price_qar, fee_qar, notes, supplier_id }
    return api.post('/api/batches', batch);
  }

  async function updateBatch(id, updates) {
    return api.put('/api/batches/' + id, updates);
  }

  async function deleteBatch(id) {
    return api.delete('/api/batches/' + id);
  }

  // ── Trades (replaces state.trades + FIFO) ──────────────────────────

  async function getTrades(range) {
    const q = range ? '?range=' + range : '';
    return api.get('/api/trades' + q);
  }

  async function createTrade(trade) {
    // trade = { customer_id, customer_name, amount_usdt, sell_price_qar, fee_qar, uses_stock, notes }
    return api.post('/api/trades', trade);
  }

  async function updateTrade(id, updates) {
    return api.put('/api/trades/' + id, updates);
  }

  async function voidTrade(id) {
    return api.put('/api/trades/' + id + '/void');
  }

  async function deleteTrade(id) {
    return api.delete('/api/trades/' + id);
  }

  // ── Dashboard KPIs (replaces kpiFor + _mchKpis + getWACOP) ────────

  async function getDashboardKPIs(range) {
    const q = range ? '?range=' + range : '';
    return api.get('/api/dashboard/kpis' + q);
  }

  async function getCalendarData(month) {
    const q = month ? '?month=' + month : '';
    return api.get('/api/dashboard/calendar' + q);
  }

  // ── CRM ────────────────────────────────────────────────────────────

  async function getCustomers() { return api.get('/api/customers'); }
  async function createCustomer(c) { return api.post('/api/customers', c); }
  async function updateCustomer(id, c) { return api.put('/api/customers/' + id, c); }
  async function deleteCustomer(id) { return api.delete('/api/customers/' + id); }

  async function getSuppliers() { return api.get('/api/suppliers'); }
  async function createSupplier(s) { return api.post('/api/suppliers', s); }
  async function updateSupplier(id, s) { return api.put('/api/suppliers/' + id, s); }
  async function deleteSupplier(id) { return api.delete('/api/suppliers/' + id); }

  // ── Merchants ──────────────────────────────────────────────────────

  async function getMyMerchant() { return api.get('/api/merchants/me'); }
  async function upsertMerchant(m) { return api.post('/api/merchants', m); }
  async function searchMerchants(q) { return api.get('/api/merchants/search?q=' + encodeURIComponent(q)); }

  // ── Invites ────────────────────────────────────────────────────────

  async function getInvites() { return api.get('/api/invites'); }
  async function sendInvite(inv) { return api.post('/api/invites', inv); }
  async function acceptInvite(id) { return api.put('/api/invites/' + id + '/accept'); }
  async function rejectInvite(id) { return api.put('/api/invites/' + id + '/reject'); }

  // ── Relationships ──────────────────────────────────────────────────

  async function getRelationships() { return api.get('/api/relationships'); }
  async function getRelationship(id) { return api.get('/api/relationships/' + id); }

  // ── Deals (replaces MS.advances/purchases/profitShares/pools) ─────

  async function getDeals(filters) {
    const params = new URLSearchParams(filters || {});
    return api.get('/api/deals?' + params.toString());
  }

  async function getDeal(id) { return api.get('/api/deals/' + id); }
  async function getDealKPIs() { return api.get('/api/deals/kpis'); }

  async function createDeal(deal) {
    // deal = { deal_type, relationship_id, principal, currency, ... }
    return api.post('/api/deals', deal);
  }

  async function repayDeal(id, data) {
    // data = { amount, reference, notes }
    return api.put('/api/deals/' + id + '/repay', data);
  }

  async function settleDeal(id, data) {
    return api.put('/api/deals/' + id + '/settle', data || {});
  }

  async function cancelDeal(id) {
    return api.put('/api/deals/' + id + '/cancel');
  }

  // ── Messages ───────────────────────────────────────────────────────

  async function getMessages(relId) { return api.get('/api/messages/' + relId); }
  async function sendMessage(msg) { return api.post('/api/messages', msg); }

  // ── P2P Rates ──────────────────────────────────────────────────────

  async function getP2PRates() { return api.get('/api/p2p/rates'); }

  // ── Import/Export ──────────────────────────────────────────────────

  async function importFromLocalStorage() {
    // Read current localStorage data and send to server
    var SK = Object.keys(localStorage).find(function(k) {
      return k.startsWith('usdt_pro') || k.startsWith('taheito') || k.startsWith('p2p_tracker');
    });
    var state = SK ? JSON.parse(localStorage.getItem(SK) || '{}') : {};

    var MKEY = 'mch_platform_v3';
    var merchantState = null;
    try { merchantState = JSON.parse(localStorage.getItem(MKEY) || 'null'); } catch(e) {}

    return api.post('/api/import/json', { state: state, merchantState: merchantState });
  }

  async function exportData() { return api.get('/api/export/json'); }

  // ── Public API ─────────────────────────────────────────────────────

  return {
    // Auth
    loginWithGoogle, logout, getMe, isLoggedIn, setToken,

    // Trading
    getBatches, getBatchSummary, createBatch, updateBatch, deleteBatch,
    getTrades, createTrade, updateTrade, voidTrade, deleteTrade,

    // Dashboard
    getDashboardKPIs, getCalendarData,

    // CRM
    getCustomers, createCustomer, updateCustomer, deleteCustomer,
    getSuppliers, createSupplier, updateSupplier, deleteSupplier,

    // Merchants
    getMyMerchant, upsertMerchant, searchMerchants,

    // Invites & Relationships
    getInvites, sendInvite, acceptInvite, rejectInvite,
    getRelationships, getRelationship,

    // Deals
    getDeals, getDeal, getDealKPIs, createDeal, repayDeal, settleDeal, cancelDeal,

    // Messages
    getMessages, sendMessage,

    // P2P
    getP2PRates,

    // Import/Export
    importFromLocalStorage, exportData,
  };
})();

// Make globally accessible
window.TaheitoAPI = TaheitoAPI;


/* ═══════════════════════════════════════════════════════════════════════
   MIGRATION GUIDE — How to rewire each function in index.html
   ═══════════════════════════════════════════════════════════════════════

   ┌─────────────────────────────────┬──────────────────────────────────────────┐
   │ CURRENT (localStorage)          │ NEW (API call)                           │
   ├─────────────────────────────────┼──────────────────────────────────────────┤
   │ load()                          │ await TaheitoAPI.getDashboardKPIs()      │
   │ save()                          │ (removed — each action saves to server)  │
   │ saveRecompute(msg, type)        │ (removed — server recomputes on write)   │
   │                                 │                                          │
   │ addBatch()                      │ await TaheitoAPI.createBatch({...})      │
   │ editBatch(id)                   │ await TaheitoAPI.updateBatch(id, {...})  │
   │ deleteBatch(id)                 │ await TaheitoAPI.deleteBatch(id)         │
   │                                 │                                          │
   │ addTrade()                      │ await TaheitoAPI.createTrade({...})      │
   │ editTrade(id)                   │ await TaheitoAPI.updateTrade(id, {...})  │
   │ toggleVoidTrade(id)             │ await TaheitoAPI.voidTrade(id)           │
   │ deleteTrade(id)                 │ await TaheitoAPI.deleteTrade(id)         │
   │                                 │                                          │
   │ recomputeFor(state)             │ (removed — server runs FIFO)             │
   │ recompute()                     │ (removed — server runs FIFO)             │
   │ kpiFor(range)                   │ await TaheitoAPI.getDashboardKPIs(range) │
   │ totalStock()                    │ (in getDashboardKPIs response)           │
   │ stockCostQAR()                  │ (in getDashboardKPIs response)           │
   │ getWACOP()                      │ (in getDashboardKPIs response)           │
   │ _mchKpis()                      │ (in getDashboardKPIs response)           │
   │                                 │                                          │
   │ _openNewAdvanceModal()          │ await TaheitoAPI.createDeal({            │
   │                                 │   deal_type: 'advance', ...})            │
   │ _openNewPurchaseModal()         │ await TaheitoAPI.createDeal({            │
   │                                 │   deal_type: 'purchase', ...})           │
   │ _openNewPSModal()               │ await TaheitoAPI.createDeal({            │
   │                                 │   deal_type: 'profit_share', ...})       │
   │ _openNewPoolModal()             │ await TaheitoAPI.createDeal({            │
   │                                 │   deal_type: 'pool', ...})               │
   │                                 │                                          │
   │ journalEntry(dr, cr, amt, ...)  │ (removed — server creates journal        │
   │                                 │  entries automatically on deal creation)  │
   │                                 │                                          │
   │ _apiSearch(q)                   │ await TaheitoAPI.searchMerchants(q)      │
   │ _apiSendInvite(inv)             │ await TaheitoAPI.sendInvite(inv)         │
   │ _apiAcceptInvite(id, mid)       │ await TaheitoAPI.acceptInvite(id)        │
   │ _apiSendMessage(msg)            │ await TaheitoAPI.sendMessage(msg)        │
   │ _pollD1()                       │ (removed — server is source of truth,    │
   │                                 │  frontend polls getDashboardKPIs)        │
   │                                 │                                          │
   │ localStorage.getItem(SK)        │ (removed entirely)                       │
   │ localStorage.setItem(SK, ...)   │ (removed entirely)                       │
   │ localStorage.getItem(MKEY)      │ (removed entirely)                       │
   │ localStorage.setItem(MKEY, ...) │ (removed entirely)                       │
   └─────────────────────────────────┴──────────────────────────────────────────┘

   EXAMPLE — Converting addBatch():

   BEFORE (line ~3117):
   ─────────────────────
   function addBatch() {
     const usdt = num($("#b_usdt").value, 0);
     const price = num($("#b_price").value, 0);
     if (!(usdt > 0 && price > 0)) return toast("Fill required fields", "warn");
     state.batches.push({
       id: uid(), ts: Date.now(), source: ..., initialUSDT: usdt,
       buyPriceQAR: price, feeQAR: fee, notes: ...
     });
     saveRecompute("Batch added ✓", "good");
   }

   AFTER:
   ──────
   async function addBatch() {
     const usdt = num($("#b_usdt").value, 0);
     const price = num($("#b_price").value, 0);
     if (!(usdt > 0 && price > 0)) return toast("Fill required fields", "warn");
     try {
       await TaheitoAPI.createBatch({
         source: ...,
         initial_usdt: usdt,
         buy_price_qar: price,
         fee_qar: fee,
         notes: ...
       });
       renderStock();  // Re-fetch and re-render
       toast("Batch added ✓", "good");
     } catch(e) {
       toast("Error: " + e.message, "warn");
     }
   }

   EXAMPLE — Converting renderDashboard():

   BEFORE (line ~3610):
   ─────────────────────
   function renderDashboard() {
     const kpi = kpiFor(state.range);     // client-side computation
     const stock = totalStock();           // client-side computation
     const wacop = getWACOP();             // client-side computation
     // ... render HTML with these values
   }

   AFTER:
   ──────
   async function renderDashboard() {
     showLoading();
     try {
       const data = await TaheitoAPI.getDashboardKPIs(state.range);
       // data.trading = { trade_count, total_qty, revenue, net_profit, ... }
       // data.stock = { remaining_usdt, stock_cost, wacop }
       // data.merchant = { total_deployed, outstanding_principal, ... }
       renderDashboardHTML(data);  // pure rendering, no computation
     } catch(e) {
       showError(e.message);
     }
   }

═══════════════════════════════════════════════════════════════════════ */
