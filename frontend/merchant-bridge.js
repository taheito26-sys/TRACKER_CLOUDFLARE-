
(function(){
  var hub = window._merchantHub = window._merchantHub || {
    booted: false,
    loading: false,
    error: "",
    tab: window._mchTab || "overview",
    inviteView: "inbox",
    approvalView: "inbox",
    relTab: "overview",
    searchQ: "",
    searchResults: [],
    profile: null,
    relationships: [],
    selectedRelId: null,
    selectedRel: null,
    selectedRelDeals: [],
    selectedRelMessages: [],
    selectedRelAudit: [],
    deals: [],
    invitesInbox: [],
    invitesSent: [],
    approvalsInbox: [],
    approvalsSent: [],
    notifications: [],
    activity: [],
    unread: 0,
    lastLoaded: 0,
    workerBase: ""
  };

  function q(sel){ return document.querySelector(sel); }
  function qq(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function esc2(v){ try { return esc(v == null ? "" : String(v)); } catch(_) { return String(v == null ? "" : v).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); } }
  function money(v, c){
    var n = Number(v || 0);
    try { return (c === "QAR" ? fmtQ(n) : fmtU(n, 0)); } catch(_) { return n.toLocaleString(); }
  }
  function dt(v){
    if(!v) return "—";
    var d = new Date(v);
    return isNaN(+d) ? String(v) : d.toLocaleString();
  }
  function dshort(v){
    if(!v) return "—";
    var d = new Date(v);
    return isNaN(+d) ? String(v) : d.toLocaleDateString();
  }
  function relTime(v){
    try { return _relTime(new Date(v).getTime()); } catch(_) { return dshort(v); }
  }
  function statusBadge(status){
    var s = String(status || "unknown");
    var tone = /approved|active|settled|read/.test(s) ? "var(--good)" :
               /pending|draft|due/.test(s) ? "var(--warn)" :
               /rejected|terminated|cancelled|overdue|suspended/.test(s) ? "var(--bad)" :
               "var(--muted)";
    return '<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;border:1px solid color-mix(in srgb,'+tone+' 30%,transparent);background:color-mix(in srgb,'+tone+' 10%,transparent);color:'+tone+';font-size:9px;font-weight:800;text-transform:uppercase;">'+esc2(s.replace(/_/g,' '))+'</span>';
  }
  function ensureAuth(){
    return !!(window._authUser && (window._authUser.id || window._authUser.email));
  }
  function guessWorkerBase(){
    var saved = localStorage.getItem("merchant_worker_url") || "";
    if(saved) return saved.replace(/\/+$/,"");
    try { if(typeof P2P_API_URL !== "undefined" && P2P_API_URL) return String(P2P_API_URL).replace(/\/+$/,""); } catch(_) {}
    try { if(typeof window !== "undefined" && window.location && window.location.origin) return String(window.location.origin).replace(/\/+$/,""); } catch(_) {}
    return "";
  }
  async function getHeaders(){
    var headers = { "Content-Type": "application/json" };
    var authUser = null;
    try {
      if (typeof window !== "undefined" && window._authUser) authUser = window._authUser;
      else if (typeof _authUser !== "undefined" && _authUser) authUser = _authUser;
    } catch(_) {}
    if (authUser) {
      var userEmail = String(authUser.email || "").trim().toLowerCase();
      var userId = String(authUser.id || "").trim();
      if (userEmail) headers["X-User-Email"] = userEmail;
      if (userId) {
        headers["X-User-Id"] = userId;
      } else if (userEmail) {
        headers["X-User-Id"] = "compat:" + userEmail;
      }
    }
    return headers;
  }
  async function api(path, opts){
    var base = guessWorkerBase();
    hub.workerBase = base;
    var init = opts || {};
    var headers = await getHeaders();
    init.headers = Object.assign({}, headers, init.headers || {});
    var url = base ? (base + path) : path;
    var res = await fetch(url, init);
    var txt = await res.text();
    var data = {};
    try { data = txt ? JSON.parse(txt) : {}; } catch(_) {}
    if(!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    return data;
  }

  var merchantApi = {
    fetchMyProfile: function(){ return api("/api/merchant/profile/me").then(function(r){ return r.profile; }); },
    createProfile: function(body){ return api("/api/merchant/profile", { method:"POST", body: JSON.stringify(body) }); },
    updateProfile: function(body){ return api("/api/merchant/profile/me", { method:"PATCH", body: JSON.stringify(body) }); },
    searchMerchants: function(qs){ return api("/api/merchant/search?q=" + encodeURIComponent(qs)).then(function(r){ return r.results || []; }); },
    checkNickname: function(nick){ return api("/api/merchant/check-nickname?nickname=" + encodeURIComponent(nick)); },
    sendInvite: function(body){ return api("/api/merchant/invites", { method:"POST", body: JSON.stringify(body) }); },
    fetchInbox: function(){ return api("/api/merchant/invites/inbox").then(function(r){ return r.invites || []; }); },
    fetchSentInvites: function(){ return api("/api/merchant/invites/sent").then(function(r){ return r.invites || []; }); },
    acceptInvite: function(id){ return api("/api/merchant/invites/"+encodeURIComponent(id)+"/accept", { method:"POST" }); },
    rejectInvite: function(id){ return api("/api/merchant/invites/"+encodeURIComponent(id)+"/reject", { method:"POST" }); },
    withdrawInvite: function(id){ return api("/api/merchant/invites/"+encodeURIComponent(id)+"/withdraw", { method:"POST" }); },
    fetchRelationships: function(){ return api("/api/merchant/relationships").then(function(r){ return r.relationships || []; }); },
    fetchRelationship: function(id){ return api("/api/merchant/relationships/"+encodeURIComponent(id)).then(function(r){ return r.relationship; }); },
    updateRelationship: function(id, body){ return api("/api/merchant/relationships/"+encodeURIComponent(id)+"/settings", { method:"PATCH", body: JSON.stringify(body) }); },
    suspendRelationship: function(id){ return api("/api/merchant/relationships/"+encodeURIComponent(id)+"/suspend", { method:"POST" }); },
    terminateRelationship: function(id){ return api("/api/merchant/relationships/"+encodeURIComponent(id)+"/terminate", { method:"POST" }); },
    fetchDeals: function(relId){ return api("/api/merchant/deals" + (relId ? ("?relationship_id="+encodeURIComponent(relId)) : "")).then(function(r){ return r.deals || []; }); },
    createDeal: function(body){ return api("/api/merchant/deals", { method:"POST", body: JSON.stringify(body) }); },
    updateDeal: function(id, body){ return api("/api/merchant/deals/"+encodeURIComponent(id), { method:"PATCH", body: JSON.stringify(body) }); },
    submitSettlement: function(id, body){ return api("/api/merchant/deals/"+encodeURIComponent(id)+"/submit-settlement", { method:"POST", body: JSON.stringify(body) }); },
    recordProfit: function(id, body){ return api("/api/merchant/deals/"+encodeURIComponent(id)+"/record-profit", { method:"POST", body: JSON.stringify(body) }); },
    closeDeal: function(id, body){ return api("/api/merchant/deals/"+encodeURIComponent(id)+"/close", { method:"POST", body: JSON.stringify(body || {}) }); },
    fetchMessages: function(relId){ return api("/api/merchant/messages/"+encodeURIComponent(relId)+"/messages").then(function(r){ return r.messages || []; }); },
    sendMessage: function(relId, body){ return api("/api/merchant/messages/"+encodeURIComponent(relId)+"/messages", { method:"POST", body: JSON.stringify({ body: body }) }); },
    markMessageRead: function(id){ return api("/api/merchant/messages/mark-read/"+encodeURIComponent(id), { method:"POST" }); },
    fetchApprovalInbox: function(){ return api("/api/merchant/approvals/inbox").then(function(r){ return r.approvals || []; }); },
    fetchSentApprovals: function(){ return api("/api/merchant/approvals/sent").then(function(r){ return r.approvals || []; }); },
    approveRequest: function(id, note){ return api("/api/merchant/approvals/"+encodeURIComponent(id)+"/approve", { method:"POST", body: JSON.stringify({ note: note || "" }) }); },
    rejectRequest: function(id, note){ return api("/api/merchant/approvals/"+encodeURIComponent(id)+"/reject", { method:"POST", body: JSON.stringify({ note: note || "" }) }); },
    fetchRelAudit: function(relId){ return api("/api/merchant/audit/relationship/"+encodeURIComponent(relId)).then(function(r){ return r.logs || []; }); },
    fetchMyActivity: function(){ return api("/api/merchant/audit/activity").then(function(r){ return r.logs || []; }); },
    fetchNotifications: function(opts){
      opts = opts || {};
      var qs = [];
      if(opts.limit) qs.push("limit="+encodeURIComponent(opts.limit));
      if(opts.unread!=null) qs.push("unread="+encodeURIComponent(!!opts.unread));
      return api("/api/merchant/notifications" + (qs.length ? ("?"+qs.join("&")) : "")).then(function(r){ return r.notifications || []; });
    },
    fetchUnreadCount: function(){ return api("/api/merchant/notifications/count").then(function(r){ return Number(r.unread || 0); }); },
    markNotificationRead: function(id){ return api("/api/merchant/notifications/"+encodeURIComponent(id)+"/read", { method:"POST" }); },
    markAllRead: function(){ return api("/api/merchant/notifications/read-all", { method:"POST" }); },
  };

  async function boot(force){
    if(hub.loading) return;
    if(!force && hub.booted && Date.now() - hub.lastLoaded < 8000) return;
    hub.loading = true;
    hub.error = "";
    try {
      hub.profile = await merchantApi.fetchMyProfile();
      if (hub.profile) {
        hub.unread = await merchantApi.fetchUnreadCount();
        hub.relationships = await merchantApi.fetchRelationships();
        if (!hub.selectedRelId && hub.relationships[0]) hub.selectedRelId = hub.relationships[0].id;
        if (hub.selectedRelId) {
          try { hub.selectedRel = await merchantApi.fetchRelationship(hub.selectedRelId); } catch(_) { hub.selectedRel = null; }
        }
        if (hub.tab === "overview" || hub.tab === "deals") hub.deals = await merchantApi.fetchDeals();
        if (hub.tab === "invites") {
          hub.invitesInbox = await merchantApi.fetchInbox();
          hub.invitesSent = await merchantApi.fetchSentInvites();
        }
        if (hub.tab === "approvals") {
          hub.approvalsInbox = await merchantApi.fetchApprovalInbox();
          hub.approvalsSent = await merchantApi.fetchSentApprovals();
        }
        if (hub.tab === "notifications" || hub.tab === "overview") hub.notifications = await merchantApi.fetchNotifications({ limit: 20 });
        if (hub.tab === "audit") hub.activity = await merchantApi.fetchMyActivity();
        if (hub.selectedRelId && hub.tab === "relationships") {
          if (hub.relTab === "deals" || hub.relTab === "overview") hub.selectedRelDeals = await merchantApi.fetchDeals(hub.selectedRelId);
          if (hub.relTab === "messages") hub.selectedRelMessages = await merchantApi.fetchMessages(hub.selectedRelId);
          if (hub.relTab === "audit") hub.selectedRelAudit = await merchantApi.fetchRelAudit(hub.selectedRelId);
        }
      }
      hub.booted = true;
      hub.lastLoaded = Date.now();
    } catch(err) {
      hub.error = err && err.message ? err.message : String(err);
      hub.booted = true;
    } finally {
      hub.loading = false;
      if (state && state.page === "merchants" && typeof render === "function") render();
    }
  }

  function statCards(){
    var rels = hub.relationships || [];
    var deals = hub.deals || [];
    var exposure = deals.filter(function(d){ return ["active","due","overdue"].indexOf(d.status) >= 0; }).reduce(function(s,d){ return s + Number(d.amount||0); }, 0);
    var realized = deals.filter(function(d){ return ["settled","closed"].indexOf(d.status) >= 0; }).reduce(function(s,d){ return s + Number(d.realized_pnl||0); }, 0);
    return '<div class="kpis">'+
      '<div class="kpi-card"><div class="kpi-lbl">RELATIONSHIPS</div><div class="kpi-val">'+rels.length+'</div><div class="kpi-sub">Active network</div></div>'+
      '<div class="kpi-card"><div class="kpi-lbl">GLOBAL DEALS</div><div class="kpi-val">'+deals.length+'</div><div class="kpi-sub">Across all merchants</div></div>'+
      '<div class="kpi-card"><div class="kpi-lbl">ACTIVE EXPOSURE</div><div class="kpi-val">'+money(exposure,'USDT')+'</div><div class="kpi-sub">Open commercial exposure</div></div>'+
      '<div class="kpi-card"><div class="kpi-lbl">REALIZED P&L</div><div class="kpi-val">'+money(realized,'USDT')+'</div><div class="kpi-sub">'+hub.unread+' unread notifications</div></div>'+
    '</div>';
  }

  function onboardingHtml(){
    return '<div class="panel"><div class="panel-head"><h2>Merchant Onboarding</h2><span class="pill">'+(ensureAuth() ? 'Ready' : 'Login required')+'</span></div><div class="panel-body">'+
      '<div class="muted" style="font-size:10px;margin-bottom:10px;">This merchant workspace now expects the Cloudflare Worker API. Your repo already has the app shell, but the worker URL must be configured and you must be signed in.</div>'+
      '<div class="twoColPage" style="grid-template-columns:1.2fr .8fr;gap:12px;">'+
        '<div class="formPanel">'+
          '<div class="form-field"><label class="form-label">Display name</label><input id="m_on_name" class="inp-field" placeholder="Your merchant display name"/></div>'+
          '<div class="form-field"><label class="form-label">Nickname</label><input id="m_on_nick" class="inp-field" placeholder="lowercase_handle"/></div>'+
          '<div class="form-field"><label class="form-label">Type</label><select id="m_on_type" class="inp-field"><option value="independent">Independent</option><option value="desk">Desk</option><option value="partner">Partner</option><option value="other">Other</option></select></div>'+
          '<div class="form-field"><label class="form-label">Region</label><input id="m_on_region" class="inp-field" placeholder="Qatar"/></div>'+
          '<div class="form-field"><label class="form-label">Discoverability</label><select id="m_on_discover" class="inp-field"><option value="public">Public</option><option value="merchant_id_only">Merchant ID only</option><option value="hidden">Hidden</option></select></div>'+
          '<div class="form-field"><label class="form-label">Bio</label><textarea id="m_on_bio" class="inp-field" style="min-height:80px;" placeholder="Describe your merchant activity"></textarea></div>'+
          '<div class="msg" id="m_on_msg"></div>'+
          '<div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn" id="m_on_create">Create Merchant Profile</button><button class="btn secondary" id="m_on_check">Check Nickname</button></div>'+
        '</div>'+
        '<div class="panel"><div class="panel-head"><h2>Connection</h2></div><div class="panel-body">'+
          '<div class="form-field"><label class="form-label">Merchant Worker URL</label><input id="m_worker_url_inline" class="inp-field" value="'+esc2(guessWorkerBase())+'" placeholder="https://your-worker.workers.dev"/></div>'+
          '<div class="muted" style="font-size:10px;">By default this will reuse <code>P2P_API_URL</code> from the current app if set. If your merchant routes are on a different worker, store it here.</div>'+
        '</div></div>'+
      '</div></div></div>';
  }

  function overviewHtml(){
    var recentNotifs = (hub.notifications || []).slice(0, 6);
    var rels = hub.relationships || [];
    return statCards() +
      '<div class="twoColPage" style="grid-template-columns:1fr 1fr;gap:12px;">' +
        '<div class="panel"><div class="panel-head"><h2>Profile</h2><button class="rowBtn" id="m_edit_profile">Edit</button></div><div class="panel-body">'+
          '<div style="font-size:18px;font-weight:800;">'+esc2(hub.profile.display_name)+'</div>'+
          '<div class="muted" style="font-size:10px;margin-top:4px;">'+esc2(hub.profile.merchant_id)+' · @'+esc2(hub.profile.nickname)+'</div>'+
          '<div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">'+
            '<div style="padding:8px;background:var(--panel2);border-radius:var(--lt-radius-sm);"><div class="muted">Type</div><div>'+esc2(hub.profile.merchant_type)+'</div></div>'+
            '<div style="padding:8px;background:var(--panel2);border-radius:var(--lt-radius-sm);"><div class="muted">Region</div><div>'+esc2(hub.profile.region || '—')+'</div></div>'+
            '<div style="padding:8px;background:var(--panel2);border-radius:var(--lt-radius-sm);"><div class="muted">Discoverability</div><div>'+esc2(hub.profile.discoverability)+'</div></div>'+
            '<div style="padding:8px;background:var(--panel2);border-radius:var(--lt-radius-sm);"><div class="muted">Currency</div><div>'+esc2(hub.profile.default_currency || 'USDT')+'</div></div>'+
          '</div>'+
          '<div style="margin-top:10px;padding:10px;background:var(--panel2);border-radius:var(--lt-radius-sm);">'+esc2(hub.profile.bio || 'No bio yet')+'</div>'+
        '</div></div>'+
        '<div class="panel"><div class="panel-head"><h2>Unread Notifications</h2><button class="rowBtn" id="m_goto_notifs">Open</button></div><div class="panel-body">'+
          (recentNotifs.length ? recentNotifs.map(function(n){
            return '<div style="padding:8px 0;border-bottom:1px solid var(--line2);"><div style="display:flex;justify-content:space-between;gap:8px;"><strong style="font-size:10px;">'+esc2(n.title)+'</strong>'+(!n.read_at?'<span style="color:var(--warn);font-size:9px;">Unread</span>':'')+'</div><div class="muted" style="font-size:9px;margin-top:2px;">'+esc2(n.body || '')+'</div><div class="muted" style="font-size:8px;margin-top:2px;">'+relTime(n.created_at)+'</div></div>';
          }).join('') : '<div class="muted" style="font-size:10px;">Nothing pending.</div>')+
        '</div></div>'+
      '</div>'+
      '<div class="panel" style="margin-top:12px;"><div class="panel-head"><h2>Relationships</h2><button class="rowBtn" id="m_goto_rels">Open workspace</button></div><div class="panel-body">'+
        (rels.length ? '<div class="tableWrap"><table><thead><tr><th>Counterparty</th><th>Status</th><th>Role</th><th class="r">Deals</th><th class="r">Exposure</th></tr></thead><tbody>' + rels.map(function(r){
          return '<tr data-rel-open="'+esc2(r.id)+'" style="cursor:pointer;"><td><strong>'+esc2(r.counterparty.display_name)+'</strong><div class="muted" style="font-size:9px;">'+esc2(r.counterparty.merchant_id || '')+'</div></td><td>'+statusBadge(r.status)+'</td><td>'+esc2(r.my_role || 'viewer')+'</td><td class="mono r">'+Number((r.summary||{}).totalDeals || 0)+'</td><td class="mono r">'+money((r.summary||{}).activeExposure || 0, 'USDT')+'</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="muted" style="font-size:10px;">No relationships yet. Search the directory and send an invite.</div>')+
      '</div></div>';
  }

  function directoryHtml(){
    var results = hub.searchResults || [];
    return '<div class="panel"><div class="panel-head"><h2>Directory</h2><span class="pill">'+results.length+' results</span></div><div class="panel-body">'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;"><input id="m_dir_q" class="inp-field" style="flex:1;min-width:220px;" placeholder="Search by display name, nickname, or merchant ID" value="'+esc2(hub.searchQ || '')+'"/><button class="btn" id="m_dir_search">Search</button></div>'+
      (results.length ? '<div class="tableWrap"><table><thead><tr><th>Merchant</th><th>Type</th><th>Region</th><th>Action</th></tr></thead><tbody>' + results.map(function(r){
        return '<tr><td><strong>'+esc2(r.display_name)+'</strong><div class="muted" style="font-size:9px;">'+esc2(r.merchant_id)+' · @'+esc2(r.nickname)+'</div></td><td>'+esc2(r.merchant_type || '—')+'</td><td>'+esc2(r.region || '—')+'</td><td><button class="rowBtn m-invite-btn" data-mid="'+esc2(r.id)+'" data-name="'+esc2(r.display_name)+'">Send Invite</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="muted" style="font-size:10px;">Search to discover other merchants.</div>')+
    '</div></div>';
  }

  function invitesHtml(){
    var list = hub.inviteView === 'inbox' ? (hub.invitesInbox || []) : (hub.invitesSent || []);
    return '<div class="panel"><div class="panel-head"><h2>Invites</h2><div style="display:flex;gap:6px;"><button class="rowBtn '+(hub.inviteView==='inbox'?'':'secondary')+'" id="m_inv_inbox">Inbox</button><button class="rowBtn '+(hub.inviteView==='sent'?'':'secondary')+'" id="m_inv_sent">Sent</button></div></div><div class="panel-body">'+
      (list.length ? list.map(function(inv){
        var title = hub.inviteView === 'inbox' ? (inv.from_display_name || inv.from_public_id) : (inv.to_display_name || inv.to_public_id);
        return '<div style="padding:10px;border:1px solid var(--line);border-radius:var(--lt-radius-sm);margin-bottom:8px;background:var(--panel2);">'+
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;"><strong>'+esc2(title)+'</strong>'+statusBadge(inv.status)+'</div>'+
          '<div class="muted" style="font-size:9px;margin-top:4px;">Role: '+esc2(inv.requested_role || 'operator')+' · '+dshort(inv.created_at)+'</div>'+
          (inv.purpose?'<div style="margin-top:6px;font-size:10px;"><strong>Purpose:</strong> '+esc2(inv.purpose)+'</div>':'')+
          (inv.message?'<div class="muted" style="font-size:9px;margin-top:4px;">'+esc2(inv.message)+'</div>':'')+
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">'+
            (hub.inviteView==='inbox' && inv.status==='pending' ? '<button class="rowBtn m-accept-invite" data-id="'+esc2(inv.id)+'">Accept</button><button class="rowBtn m-reject-invite" data-id="'+esc2(inv.id)+'" style="color:var(--bad);">Reject</button>' : '')+
            (hub.inviteView==='sent' && inv.status==='pending' ? '<button class="rowBtn m-withdraw-invite" data-id="'+esc2(inv.id)+'" style="color:var(--bad);">Withdraw</button>' : '')+
          '</div></div>';
      }).join('') : '<div class="muted" style="font-size:10px;">No invites in this view.</div>')+
    '</div></div>';
  }

  function relationshipWorkspace(){
    var rels = hub.relationships || [];
    var rel = hub.selectedRel || null;
    return '<div class="twoColPage" style="grid-template-columns:.95fr 1.25fr;gap:12px;">'+
      '<div class="panel"><div class="panel-head"><h2>Relationships</h2><span class="pill">'+rels.length+'</span></div><div class="panel-body">'+
        (rels.length ? rels.map(function(r){
          var _border = hub.selectedRelId===r.id ? 'var(--brand)' : 'var(--line)';
          var _bg = hub.selectedRelId===r.id ? 'var(--brand3)' : 'var(--panel2)';
          return '<div class="m-rel-card" data-rel="'+esc2(r.id)+'" style="padding:10px;border:1px solid '+_border+';border-radius:var(--lt-radius-sm);margin-bottom:8px;cursor:pointer;background:'+_bg+';">'+
            '<div style="display:flex;justify-content:space-between;gap:8px;"><strong>'+esc2(r.counterparty.display_name)+'</strong>'+statusBadge(r.status)+'</div>'+
            '<div class="muted" style="font-size:9px;margin-top:3px;">'+esc2(r.counterparty.merchant_id || '')+' · '+esc2(r.my_role || 'viewer')+'</div>'+
            '<div style="display:flex;justify-content:space-between;margin-top:6px;font-size:9px;"><span>Deals: '+Number((r.summary||{}).totalDeals || 0)+'</span><span>'+money((r.summary||{}).activeExposure || 0, 'USDT')+'</span></div>'+
          '</div>';
        }).join('') : '<div class="muted" style="font-size:10px;">No relationships yet.</div>')+
      '</div></div>'+
      '<div class="panel"><div class="panel-head"><h2>'+(rel ? esc2(rel.counterparty.display_name || rel.id) : 'Workspace')+'</h2>'+(rel ? '<div style="display:flex;gap:6px;flex-wrap:wrap;"><button class="rowBtn '+(hub.relTab==='overview'?'':'secondary')+'" data-rel-tab="overview">Overview</button><button class="rowBtn '+(hub.relTab==='deals'?'':'secondary')+'" data-rel-tab="deals">Deals</button><button class="rowBtn '+(hub.relTab==='messages'?'':'secondary')+'" data-rel-tab="messages">Messages</button><button class="rowBtn '+(hub.relTab==='audit'?'':'secondary')+'" data-rel-tab="audit">Audit</button></div>' : '')+'</div><div class="panel-body">'+
      (rel ? relationshipWorkspaceBody(rel) : '<div class="muted" style="font-size:10px;">Select a relationship.</div>')+
      '</div></div>'+
    '</div>';
  }

  function relationshipWorkspaceBody(rel){
    if(hub.relTab === 'deals'){
      var deals = hub.selectedRelDeals || [];
      return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;"><button class="btn" id="m_new_deal">+ New Deal</button><button class="btn secondary" id="m_rel_refresh">Refresh</button></div>'+
        (deals.length ? '<div class="tableWrap"><table><thead><tr><th>Deal</th><th>Status</th><th class="r">Amount</th><th>Due</th><th>Action</th></tr></thead><tbody>'+deals.map(function(d){
          return '<tr><td><strong>'+esc2(d.title)+'</strong><div class="muted" style="font-size:9px;">'+esc2(d.deal_type)+'</div></td><td>'+statusBadge(d.status)+'</td><td class="mono r">'+money(d.amount,d.currency)+'</td><td>'+dshort(d.due_date)+'</td><td><div style="display:flex;gap:4px;flex-wrap:wrap;"><button class="rowBtn m-activate-deal" data-id="'+esc2(d.id)+'">Activate</button><button class="rowBtn m-settle-deal" data-id="'+esc2(d.id)+'">Settle</button><button class="rowBtn m-profit-deal" data-id="'+esc2(d.id)+'">Profit</button><button class="rowBtn m-close-deal" data-id="'+esc2(d.id)+'" style="color:var(--bad);">Close</button></div></td></tr>';
        }).join('')+'</tbody></table></div>' : '<div class="muted" style="font-size:10px;">No deals in this relationship.</div>');
    }
    if(hub.relTab === 'messages'){
      var msgs = hub.selectedRelMessages || [];
      return (msgs.length ? msgs.map(function(m){
        var mine = m.sender_user_id === ((window._authUser && ("compat:"+String(window._authUser.email).trim().toLowerCase())) || "");
        return '<div style="display:flex;justify-content:'+(mine?'flex-end':'flex-start')+';margin-bottom:8px;"><div style="max-width:78%;padding:8px 10px;border-radius:12px;background:'+(mine?'var(--brand3)':'var(--panel2)')+';border:1px solid var(--line);"><div style="font-size:10px;">'+esc2(m.body)+'</div><div class="muted" style="font-size:8px;margin-top:4px;">'+dt(m.created_at)+'</div></div></div>';
      }).join('') : '<div class="muted" style="font-size:10px;">No messages yet.</div>')+
      '<div style="display:flex;gap:8px;margin-top:10px;"><input id="m_msg_input" class="inp-field" style="flex:1;" placeholder="Type a message"/><button class="btn" id="m_msg_send">Send</button></div>';
    }
    if(hub.relTab === 'audit'){
      var logs = hub.selectedRelAudit || [];
      return logs.length ? logs.map(function(a){
        return '<div style="padding:8px 0;border-bottom:1px solid var(--line2);"><div style="display:flex;justify-content:space-between;gap:8px;"><strong style="font-size:10px;">'+esc2(a.action)+'</strong><span class="muted" style="font-size:8px;">'+relTime(a.created_at)+'</span></div><div class="muted" style="font-size:9px;margin-top:4px;">'+esc2(JSON.stringify(a.detail_json || {}))+'</div></div>';
      }).join('') : '<div class="muted" style="font-size:10px;">No audit events yet.</div>';
    }
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">'+
      '<div style="padding:10px;background:var(--panel2);border-radius:var(--lt-radius-sm);"><div class="muted">Counterparty</div><div style="font-weight:700;margin-top:4px;">'+esc2(rel.counterparty.display_name || '—')+'</div><div class="muted" style="font-size:9px;margin-top:2px;">'+esc2(rel.counterparty.merchant_id || '')+'</div></div>'+
      '<div style="padding:10px;background:var(--panel2);border-radius:var(--lt-radius-sm);"><div class="muted">Status</div><div style="margin-top:4px;">'+statusBadge(rel.status)+'</div></div>'+
      '<div style="padding:10px;background:var(--panel2);border-radius:var(--lt-radius-sm);"><div class="muted">Active Exposure</div><div style="font-weight:700;margin-top:4px;">'+money((rel.summary||{}).activeExposure || 0, 'USDT')+'</div></div>'+
      '<div style="padding:10px;background:var(--panel2);border-radius:var(--lt-radius-sm);"><div class="muted">Pending Approvals</div><div style="font-weight:700;margin-top:4px;">'+Number((rel.summary||{}).pendingApprovals || 0)+'</div></div>'+
    '</div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;"><button class="btn secondary" id="m_rel_settings">Update Settings</button><button class="btn secondary" id="m_rel_suspend">Request Suspend</button><button class="btn secondary" id="m_rel_terminate" style="color:var(--bad);border-color:var(--bad);">Request Terminate</button></div>';
  }

  function dealsHtml(){
    var deals = hub.deals || [];
    return '<div class="panel"><div class="panel-head"><h2>Global Deals</h2><span class="pill">'+deals.length+'</span></div><div class="panel-body">'+
      (deals.length ? '<div class="tableWrap"><table><thead><tr><th>Deal</th><th>Status</th><th class="r">Amount</th><th>Due</th></tr></thead><tbody>'+deals.map(function(d){
        return '<tr><td><strong>'+esc2(d.title)+'</strong><div class="muted" style="font-size:9px;">'+esc2(d.deal_type)+'</div></td><td>'+statusBadge(d.status)+'</td><td class="mono r">'+money(d.amount, d.currency)+'</td><td>'+dshort(d.due_date)+'</td></tr>';
      }).join('')+'</tbody></table></div>' : '<div class="muted" style="font-size:10px;">No deals yet.</div>')+
    '</div></div>';
  }

  function approvalsHtml(){
    var list = hub.approvalView === 'inbox' ? (hub.approvalsInbox || []) : (hub.approvalsSent || []);
    return '<div class="panel"><div class="panel-head"><h2>Approvals</h2><div style="display:flex;gap:6px;"><button class="rowBtn '+(hub.approvalView==='inbox'?'':'secondary')+'" id="m_apr_inbox">Inbox</button><button class="rowBtn '+(hub.approvalView==='sent'?'':'secondary')+'" id="m_apr_sent">Sent</button></div></div><div class="panel-body">'+
      (list.length ? list.map(function(a){
        return '<div style="padding:10px;border:1px solid var(--line);border-radius:var(--lt-radius-sm);margin-bottom:8px;background:var(--panel2);">'+
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;"><strong>'+esc2(String(a.type||'').replace(/_/g,' '))+'</strong>'+statusBadge(a.status)+'</div>'+
          '<div class="muted" style="font-size:9px;margin-top:4px;">Submitted '+relTime(a.submitted_at)+'</div>'+
          '<div style="font-size:9px;margin-top:6px;padding:8px;background:var(--panel);border-radius:var(--lt-radius-sm);">'+esc2(JSON.stringify(a.proposed_payload || {}))+'</div>'+
          (hub.approvalView==='inbox' && a.status==='pending' ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;"><button class="rowBtn m-approve" data-id="'+esc2(a.id)+'">Approve</button><button class="rowBtn m-reject" data-id="'+esc2(a.id)+'" style="color:var(--bad);">Reject</button></div>' : '')+
        '</div>';
      }).join('') : '<div class="muted" style="font-size:10px;">No approvals in this view.</div>')+
    '</div></div>';
  }

  function notificationsHtml(){
    var list = hub.notifications || [];
    return '<div class="panel"><div class="panel-head"><h2>Notifications</h2><div style="display:flex;gap:6px;"><button class="rowBtn" id="m_mark_all">Mark all read</button><button class="rowBtn secondary" id="m_notif_refresh">Refresh</button></div></div><div class="panel-body">'+
      (list.length ? list.map(function(n){
        var _nbg = !n.read_at ? 'var(--brand3)' : 'var(--panel2)';
        var _ncta = !n.read_at ? '<button class="rowBtn m-mark-one" data-id="'+esc2(n.id)+'">Read</button>' : statusBadge('read');
        return '<div style="padding:10px;border:1px solid var(--line);border-radius:var(--lt-radius-sm);margin-bottom:8px;background:'+_nbg+';">'+
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;"><strong>'+esc2(n.title)+'</strong>'+_ncta+'</div>'+
          '<div class="muted" style="font-size:9px;margin-top:4px;">'+esc2(n.body || '')+'</div>'+
          '<div class="muted" style="font-size:8px;margin-top:4px;">'+relTime(n.created_at)+'</div>'+
        '</div>';
      }).join('') : '<div class="muted" style="font-size:10px;">No notifications.</div>')+
    '</div></div>';
  }

  function auditHtml(){
    var logs = hub.activity || [];
    return '<div class="panel"><div class="panel-head"><h2>Activity Log</h2><button class="rowBtn" id="m_audit_refresh">Refresh</button></div><div class="panel-body">'+
      (logs.length ? logs.map(function(a){
        return '<div style="padding:8px 0;border-bottom:1px solid var(--line2);"><div style="display:flex;justify-content:space-between;gap:8px;"><strong style="font-size:10px;">'+esc2(a.action)+'</strong><span class="muted" style="font-size:8px;">'+relTime(a.created_at)+'</span></div><div class="muted" style="font-size:9px;margin-top:4px;">'+esc2(JSON.stringify(a.detail_json || {}))+'</div></div>';
      }).join('') : '<div class="muted" style="font-size:10px;">No audit events yet.</div>')+
    '</div></div>';
  }

  function settingsHtml(){
    return '<div class="panel"><div class="panel-head"><h2>Merchant Settings</h2><button class="rowBtn" id="m_save_settings">Save</button></div><div class="panel-body">'+
      '<div class="twoColPage" style="grid-template-columns:1fr 1fr;gap:12px;">'+
        '<div class="formPanel">'+
          '<div class="form-field"><label class="form-label">Merchant Worker URL</label><input id="m_set_worker" class="inp-field" value="'+esc2(guessWorkerBase())+'" placeholder="https://worker.workers.dev"/></div>'+
          '<div class="form-field"><label class="form-label">Display name</label><input id="m_set_name" class="inp-field" value="'+esc2((hub.profile||{}).display_name || '')+'"/></div>'+
          '<div class="form-field"><label class="form-label">Region</label><input id="m_set_region" class="inp-field" value="'+esc2((hub.profile||{}).region || '')+'"/></div>'+
          '<div class="form-field"><label class="form-label">Discoverability</label><select id="m_set_disc" class="inp-field"><option value="public"'+(((hub.profile||{}).discoverability==='public')?' selected':'')+'>Public</option><option value="merchant_id_only"'+(((hub.profile||{}).discoverability==='merchant_id_only')?' selected':'')+'>Merchant ID only</option><option value="hidden"'+(((hub.profile||{}).discoverability==='hidden')?' selected':'')+'>Hidden</option></select></div>'+
          '<div class="form-field"><label class="form-label">Bio</label><textarea id="m_set_bio" class="inp-field" style="min-height:90px;">'+esc2((hub.profile||{}).bio || '')+'</textarea></div>'+
          '<div class="msg" id="m_set_msg"></div>'+
        '</div>'+
        '<div class="panel"><div class="panel-head"><h2>Reality Check</h2></div><div class="panel-body"><div class="muted" style="font-size:10px;line-height:1.6;">The repo you linked was a static frontend plus a KV-based P2P worker. This merchant system is now wired for a D1-backed API with a compatibility auth bridge. That is functional, but it is still not the exact Clerk + React architecture described in the markdown unless you finish the auth migration too.</div></div></div>'+
      '</div>'+
    '</div></div>';
  }

  function bodyHtml(){
    if (!ensureAuth()) {
      return '<div class="panel"><div class="panel-head"><h2>Login Required</h2></div><div class="panel-body"><div class="muted" style="font-size:10px;">Use the existing app sign-in first. In compatibility mode the merchant worker uses your signed-in email as the user identity header.</div></div></div>';
    }
    if (hub.loading && !hub.booted) {
      return '<div class="panel"><div class="panel-head"><h2>Loading Merchant Hub</h2></div><div class="panel-body"><div class="muted" style="font-size:10px;">Connecting to Worker and loading profile, relationships, approvals, and notifications.</div></div></div>';
    }
    if (hub.error && !hub.profile) {
      return '<div class="panel"><div class="panel-head"><h2>Merchant Hub Error</h2></div><div class="panel-body"><div class="msg err" style="display:block;">'+esc2(hub.error)+'</div><div class="muted" style="font-size:10px;margin-top:8px;">Most likely the worker URL is missing, the D1 schema was not seeded, or the worker still only has the legacy P2P routes.</div></div></div>';
    }
    if (!hub.profile) return onboardingHtml();
    if (hub.tab === "directory") return directoryHtml();
    if (hub.tab === "invites") return invitesHtml();
    if (hub.tab === "relationships") return relationshipWorkspace();
    if (hub.tab === "deals") return dealsHtml();
    if (hub.tab === "approvals") return approvalsHtml();
    if (hub.tab === "notifications") return notificationsHtml();
    if (hub.tab === "audit") return auditHtml();
    if (hub.tab === "settings") return settingsHtml();
    return overviewHtml();
  }

  function tabBar(){
    var tabs = [
      ["overview","Overview"],
      ["directory","Directory"],
      ["invites","Invites"],
      ["relationships","Relationships"],
      ["deals","Deals"],
      ["approvals","Approvals"],
      ["notifications","Notifications"],
      ["audit","Audit"],
      ["settings","Settings"]
    ];
    return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">' + tabs.map(function(t){
      var badge = (t[0]==='notifications' && hub.unread) ? '<span class="pill" style="font-size:8px;padding:1px 6px;">'+hub.unread+'</span>' : '';
      return '<button class="m-tab-btn rowBtn '+(hub.tab===t[0]?'':'secondary')+'" data-tab="'+t[0]+'" style="display:flex;align-items:center;gap:6px;">'+t[1]+badge+'</button>';
    }).join('') + '</div>';
  }

  function wire(){
    qq('.m-tab-btn').forEach(function(b){
      b.addEventListener('click', function(){
        hub.tab = b.dataset.tab;
        window._mchTab = hub.tab;
        boot(true);
        render();
      });
    });
    qq('[data-rel-open], .m-rel-card').forEach(function(el){
      el.addEventListener('click', function(){
        hub.selectedRelId = el.getAttribute('data-rel-open') || el.getAttribute('data-rel');
        hub.relTab = 'overview';
        boot(true);
        render();
      });
    });
    qq('[data-rel-tab]').forEach(function(el){
      el.addEventListener('click', function(){
        hub.relTab = el.getAttribute('data-rel-tab');
        boot(true);
        render();
      });
    });
    q('#m_goto_notifs')?.addEventListener('click', function(){ hub.tab = 'notifications'; boot(true); render(); });
    q('#m_goto_rels')?.addEventListener('click', function(){ hub.tab = 'relationships'; boot(true); render(); });

    q('#m_dir_search')?.addEventListener('click', async function(){
      hub.searchQ = (q('#m_dir_q')?.value || '').trim();
      if (!hub.searchQ) { hub.searchResults = []; render(); return; }
      try {
        hub.searchResults = await merchantApi.searchMerchants(hub.searchQ);
        render();
      } catch(err){ toast(err.message || String(err), 'warn'); }
    });
    qq('.m-invite-btn').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        openInviteModal(btn.dataset.mid, btn.dataset.name);
      });
    });

    q('#m_inv_inbox')?.addEventListener('click', function(){ hub.inviteView = 'inbox'; render(); });
    q('#m_inv_sent')?.addEventListener('click', function(){ hub.inviteView = 'sent'; render(); });
    qq('.m-accept-invite').forEach(function(btn){ btn.addEventListener('click', async function(){ try { await merchantApi.acceptInvite(btn.dataset.id); toast('Invite accepted','good'); await boot(true); } catch(err){ toast(err.message,'warn'); } }); });
    qq('.m-reject-invite').forEach(function(btn){ btn.addEventListener('click', async function(){ try { await merchantApi.rejectInvite(btn.dataset.id); toast('Invite rejected','warn'); await boot(true); } catch(err){ toast(err.message,'warn'); } }); });
    qq('.m-withdraw-invite').forEach(function(btn){ btn.addEventListener('click', async function(){ try { await merchantApi.withdrawInvite(btn.dataset.id); toast('Invite withdrawn','warn'); await boot(true); } catch(err){ toast(err.message,'warn'); } }); });

    q('#m_new_deal')?.addEventListener('click', function(){ openDealModal(); });
    q('#m_rel_refresh')?.addEventListener('click', function(){ boot(true); });
    qq('.m-activate-deal').forEach(function(btn){ btn.addEventListener('click', async function(){ try { await merchantApi.updateDeal(btn.dataset.id, { status:'active' }); toast('Deal activated','good'); await boot(true); } catch(err){ toast(err.message,'warn'); } }); });
    qq('.m-settle-deal').forEach(function(btn){ btn.addEventListener('click', function(){ openSettlementModal(btn.dataset.id); }); });
    qq('.m-profit-deal').forEach(function(btn){ btn.addEventListener('click', function(){ openProfitModal(btn.dataset.id); }); });
    qq('.m-close-deal').forEach(function(btn){ btn.addEventListener('click', function(){ openCloseDealModal(btn.dataset.id); }); });

    q('#m_msg_send')?.addEventListener('click', async function(){
      var text = (q('#m_msg_input')?.value || '').trim();
      if(!text) return;
      try { await merchantApi.sendMessage(hub.selectedRelId, text); q('#m_msg_input').value=''; await boot(true); } catch(err){ toast(err.message,'warn'); }
    });

    q('#m_rel_settings')?.addEventListener('click', function(){ openRelationshipSettingsModal(); });
    q('#m_rel_suspend')?.addEventListener('click', async function(){ try { await merchantApi.suspendRelationship(hub.selectedRelId); toast('Suspend approval requested','good'); await boot(true); } catch(err){ toast(err.message,'warn'); } });
    q('#m_rel_terminate')?.addEventListener('click', async function(){ try { await merchantApi.terminateRelationship(hub.selectedRelId); toast('Termination approval requested','warn'); await boot(true); } catch(err){ toast(err.message,'warn'); } });

    q('#m_apr_inbox')?.addEventListener('click', function(){ hub.approvalView='inbox'; render(); });
    q('#m_apr_sent')?.addEventListener('click', function(){ hub.approvalView='sent'; render(); });
    qq('.m-approve').forEach(function(btn){ btn.addEventListener('click', async function(){ var note = prompt('Optional approval note','') || ''; try { await merchantApi.approveRequest(btn.dataset.id, note); toast('Approved','good'); await boot(true); } catch(err){ toast(err.message,'warn'); } }); });
    qq('.m-reject').forEach(function(btn){ btn.addEventListener('click', async function(){ var note = prompt('Optional rejection note','') || ''; try { await merchantApi.rejectRequest(btn.dataset.id, note); toast('Rejected','warn'); await boot(true); } catch(err){ toast(err.message,'warn'); } }); });

    q('#m_mark_all')?.addEventListener('click', async function(){ try { await merchantApi.markAllRead(); toast('All notifications marked read','good'); await boot(true); } catch(err){ toast(err.message,'warn'); } });
    q('#m_notif_refresh')?.addEventListener('click', function(){ boot(true); });
    qq('.m-mark-one').forEach(function(btn){ btn.addEventListener('click', async function(){ try { await merchantApi.markNotificationRead(btn.dataset.id); await boot(true); } catch(err){ toast(err.message,'warn'); } }); });
    q('#m_audit_refresh')?.addEventListener('click', function(){ boot(true); });

    q('#m_edit_profile')?.addEventListener('click', function(){ hub.tab = 'settings'; render(); });
    q('#m_save_settings')?.addEventListener('click', async function(){
      try {
        var worker = (q('#m_set_worker')?.value || '').trim().replace(/\/+$/,'');
        if(worker) localStorage.setItem('merchant_worker_url', worker);
        await merchantApi.updateProfile({
          display_name: q('#m_set_name')?.value || '',
          region: q('#m_set_region')?.value || '',
          discoverability: q('#m_set_disc')?.value || 'public',
          bio: q('#m_set_bio')?.value || ''
        });
        toast('Merchant settings saved','good');
        await boot(true);
      } catch(err){
        var msg = q('#m_set_msg');
        if(msg){ msg.textContent = err.message || String(err); msg.className = 'msg err'; }
      }
    });

    q('#m_on_check')?.addEventListener('click', async function(){
      try {
        var worker = (q('#m_worker_url_inline')?.value || '').trim().replace(/\/+$/,'');
        if(worker) localStorage.setItem('merchant_worker_url', worker);
        var nick = (q('#m_on_nick')?.value || '').trim().toLowerCase();
        var res = await merchantApi.checkNickname(nick);
        var msg = q('#m_on_msg');
        if(msg){ msg.textContent = res.valid ? (res.available ? 'Nickname is available' : 'Nickname is already taken') : 'Nickname must be 3 to 30 chars using a-z, 0-9, _'; msg.className = 'msg ' + (res.available && res.valid ? 'good' : 'warn'); }
      } catch(err){
        var msg2 = q('#m_on_msg');
        if(msg2){ msg2.textContent = err.message || String(err); msg2.className = 'msg err'; }
      }
    });
    q('#m_on_create')?.addEventListener('click', async function(){
      try {
        var worker = (q('#m_worker_url_inline')?.value || '').trim().replace(/\/+$/,'');
        if(worker) localStorage.setItem('merchant_worker_url', worker);
        await merchantApi.createProfile({
          display_name: q('#m_on_name')?.value || '',
          nickname: (q('#m_on_nick')?.value || '').trim().toLowerCase(),
          merchant_type: q('#m_on_type')?.value || 'independent',
          region: q('#m_on_region')?.value || '',
          discoverability: q('#m_on_discover')?.value || 'public',
          bio: q('#m_on_bio')?.value || ''
        });
        toast('Merchant profile created','good');
        await boot(true);
      } catch(err){
        var msg3 = q('#m_on_msg');
        if(msg3){ msg3.textContent = err.message || String(err); msg3.className = 'msg err'; }
      }
    });
  }

  function openInviteModal(targetId, targetName){
    openModal("Send Invite — " + esc2(targetName), '<div class="form-field"><label class="form-label">Purpose</label><input id="m_inv_purpose" class="inp-field" placeholder="Why do you want to collaborate?"/></div><div class="form-field"><label class="form-label">Requested Role</label><select id="m_inv_role" class="inp-field"><option value="operator">Operator</option><option value="finance">Finance</option><option value="viewer">Viewer</option><option value="commenter">Commenter</option><option value="admin">Admin</option></select></div><div class="form-field"><label class="form-label">Message</label><textarea id="m_inv_message" class="inp-field" style="min-height:80px;"></textarea></div><div class="msg" id="m_inv_msg"></div>', '<button class="btn secondary" id="m_c">Cancel</button><button class="btn" id="m_send_invite">Send Invite</button>');
    setTimeout(function(){
      q('#m_c')?.addEventListener('click', closeModal);
      q('#m_send_invite')?.addEventListener('click', async function(){
        try {
          await merchantApi.sendInvite({
            to_merchant_id: targetId,
            purpose: q('#m_inv_purpose')?.value || '',
            requested_role: q('#m_inv_role')?.value || 'operator',
            message: q('#m_inv_message')?.value || ''
          });
          toast('Invite sent','good');
          closeModal();
          hub.tab = 'invites';
          await boot(true);
        } catch(err){
          var msg = q('#m_inv_msg');
          if(msg){ msg.textContent = err.message || String(err); msg.className = 'msg err'; }
        }
      });
    },0);
  }

  function openDealModal(){
    if(!hub.selectedRelId) return toast('Select a relationship first','warn');
    openModal("New Deal", '<div class="form-field"><label class="form-label">Title</label><input id="m_deal_title" class="inp-field"/></div><div class="form-field"><label class="form-label">Type</label><select id="m_deal_type" class="inp-field"><option value="lending">Lending</option><option value="arbitrage">Arbitrage</option><option value="partnership">Partnership</option><option value="capital_placement">Capital Placement</option></select></div><div class="form-field"><label class="form-label">Amount</label><input id="m_deal_amount" class="inp-field" type="number" min="0" step="0.01"/></div><div class="form-field"><label class="form-label">Currency</label><select id="m_deal_currency" class="inp-field"><option value="USDT">USDT</option><option value="QAR">QAR</option></select></div><div class="form-field"><label class="form-label">Due date</label><input id="m_deal_due" class="inp-field" type="date"/></div><div class="msg" id="m_deal_msg"></div>', '<button class="btn secondary" id="m_c">Cancel</button><button class="btn" id="m_deal_create">Create Deal</button>');
    setTimeout(function(){
      q('#m_c')?.addEventListener('click', closeModal);
      q('#m_deal_create')?.addEventListener('click', async function(){
        try {
          await merchantApi.createDeal({
            relationship_id: hub.selectedRelId,
            title: q('#m_deal_title')?.value || '',
            deal_type: q('#m_deal_type')?.value || 'lending',
            amount: Number(q('#m_deal_amount')?.value || 0),
            currency: q('#m_deal_currency')?.value || 'USDT',
            due_date: q('#m_deal_due')?.value || null
          });
          toast('Deal created','good');
          closeModal();
          hub.relTab = 'deals';
          await boot(true);
        } catch(err){
          var msg = q('#m_deal_msg');
          if(msg){ msg.textContent = err.message || String(err); msg.className = 'msg err'; }
        }
      });
    },0);
  }

  function openSettlementModal(dealId){
    openModal("Submit Settlement", '<div class="form-field"><label class="form-label">Amount</label><input id="m_settle_amount" class="inp-field" type="number" min="0" step="0.01"/></div><div class="form-field"><label class="form-label">Currency</label><select id="m_settle_currency" class="inp-field"><option value="USDT">USDT</option><option value="QAR">QAR</option></select></div><div class="form-field"><label class="form-label">Note</label><textarea id="m_settle_note" class="inp-field" style="min-height:70px;"></textarea></div><div class="msg" id="m_settle_msg"></div>', '<button class="btn secondary" id="m_c">Cancel</button><button class="btn" id="m_settle_submit">Submit</button>');
    setTimeout(function(){
      q('#m_c')?.addEventListener('click', closeModal);
      q('#m_settle_submit')?.addEventListener('click', async function(){
        try {
          await merchantApi.submitSettlement(dealId, {
            amount: Number(q('#m_settle_amount')?.value || 0),
            currency: q('#m_settle_currency')?.value || 'USDT',
            note: q('#m_settle_note')?.value || ''
          });
          toast('Settlement submitted for approval','good');
          closeModal();
          await boot(true);
        } catch(err){
          var msg = q('#m_settle_msg');
          if(msg){ msg.textContent = err.message || String(err); msg.className = 'msg err'; }
        }
      });
    },0);
  }

  function openProfitModal(dealId){
    openModal("Record Profit", '<div class="form-field"><label class="form-label">Amount</label><input id="m_profit_amount" class="inp-field" type="number" min="0" step="0.01"/></div><div class="form-field"><label class="form-label">Period key</label><input id="m_profit_period" class="inp-field" placeholder="2026-03"/></div><div class="form-field"><label class="form-label">Note</label><textarea id="m_profit_note" class="inp-field" style="min-height:70px;"></textarea></div><div class="msg" id="m_profit_msg"></div>', '<button class="btn secondary" id="m_c">Cancel</button><button class="btn" id="m_profit_submit">Submit</button>');
    setTimeout(function(){
      q('#m_c')?.addEventListener('click', closeModal);
      q('#m_profit_submit')?.addEventListener('click', async function(){
        try {
          await merchantApi.recordProfit(dealId, {
            amount: Number(q('#m_profit_amount')?.value || 0),
            period_key: q('#m_profit_period')?.value || '',
            note: q('#m_profit_note')?.value || ''
          });
          toast('Profit submitted for approval','good');
          closeModal();
          await boot(true);
        } catch(err){
          var msg = q('#m_profit_msg');
          if(msg){ msg.textContent = err.message || String(err); msg.className = 'msg err'; }
        }
      });
    },0);
  }

  function openCloseDealModal(dealId){
    openModal("Close Deal", '<div class="form-field"><label class="form-label">Close date</label><input id="m_close_date" class="inp-field" type="date" value="'+new Date().toISOString().slice(0,10)+'"/></div><div class="form-field"><label class="form-label">Note</label><textarea id="m_close_note" class="inp-field" style="min-height:70px;"></textarea></div><div class="msg" id="m_close_msg"></div>', '<button class="btn secondary" id="m_c">Cancel</button><button class="btn" id="m_close_submit">Request Close</button>');
    setTimeout(function(){
      q('#m_c')?.addEventListener('click', closeModal);
      q('#m_close_submit')?.addEventListener('click', async function(){
        try {
          await merchantApi.closeDeal(dealId, {
            close_date: q('#m_close_date')?.value || '',
            note: q('#m_close_note')?.value || ''
          });
          toast('Close request submitted','good');
          closeModal();
          await boot(true);
        } catch(err){
          var msg = q('#m_close_msg');
          if(msg){ msg.textContent = err.message || String(err); msg.className = 'msg err'; }
        }
      });
    },0);
  }

  function openRelationshipSettingsModal(){
    if(!hub.selectedRel) return;
    openModal("Relationship Settings", '<div class="form-field"><label class="form-label">Relationship type</label><input id="m_rel_type" class="inp-field" value="'+esc2(hub.selectedRel.relationship_type || 'general')+'"/></div><div class="form-field"><label class="form-label">Shared fields (comma separated)</label><input id="m_rel_fields" class="inp-field" value="'+esc2((hub.selectedRel.shared_fields || []).join(','))+'"/></div><div class="msg" id="m_rel_msg"></div>', '<button class="btn secondary" id="m_c">Cancel</button><button class="btn" id="m_rel_save">Save</button>');
    setTimeout(function(){
      q('#m_c')?.addEventListener('click', closeModal);
      q('#m_rel_save')?.addEventListener('click', async function(){
        try {
          await merchantApi.updateRelationship(hub.selectedRelId, {
            relationship_type: q('#m_rel_type')?.value || 'general',
            shared_fields: String(q('#m_rel_fields')?.value || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean)
          });
          toast('Relationship settings updated','good');
          closeModal();
          await boot(true);
        } catch(err){
          var msg = q('#m_rel_msg');
          if(msg){ msg.textContent = err.message || String(err); msg.className = 'msg err'; }
        }
      });
    },0);
  }

  window.renderMerchants = function(){
    setHeader("Merchants & Collaboration", "Worker-backed invites, relationships, deals, approvals, notifications");
    hub.tab = window._mchTab || hub.tab || "overview";
    if (!hub.booted && !hub.loading) boot(true);
    var html = tabBar() + (hub.error && hub.profile ? '<div class="msg warn" style="display:block;margin-bottom:10px;">'+esc2(hub.error)+'</div>' : '') + bodyHtml();
    q('#pageBody').innerHTML = html;
    wire();
  };

  if (!window._merchantHubPoll) {
    window._merchantHubPoll = setInterval(function(){
      if (state && state.page === 'merchants' && hub.profile) boot(true);
    }, 15000);
  }
})();
