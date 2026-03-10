(function(){
  var legacyRender = (typeof window.renderMerchants === "function") ? window.renderMerchants : null;
  var hub = window._merchantHubLite = window._merchantHubLite || {
    booted: false,
    loading: false,
    profile: null,
    relationships: [],
    deals: [],
    notifications: [],
    error: "",
    authMode: "",
    workerBase: "",
    lastLoaded: 0
  };

  function q(sel){ return document.querySelector(sel); }
  function appState(){ return (typeof window !== "undefined" && window.state) ? window.state : null; }
  function onMerchantsPage(){ var s = appState(); return !!(s && s.page === "merchants"); }
  function host(){ return q("#pageBody"); }
  function safeToast(msg, tone){ try { if (typeof window.toast === "function") window.toast(msg, tone || "warn"); } catch(_) {} }
  function esc(v){
    return String(v == null ? "" : v).replace(/[&<>\"]/g, function(c){
      return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"})[c];
    });
  }
  function money(v){
    var n = Number(v || 0);
    try {
      if (typeof window.fmtU === "function") return window.fmtU(n, 0);
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    } catch(_) {
      return String(n);
    }
  }
  function workerBase(){
    var saved = "";
    try { saved = localStorage.getItem("merchant_worker_url") || ""; } catch(_) {}
    if (saved) return String(saved).replace(/\/+$/, "");
    try {
      if (typeof window.P2P_API_URL !== "undefined" && window.P2P_API_URL) {
        return String(window.P2P_API_URL).replace(/\/+$/, "");
      }
    } catch(_) {}
    return "";
  }
  async function authHeaders(){
    var headers = { "Content-Type": "application/json" };
    try {
      if (window.Clerk && window.Clerk.session && typeof window.Clerk.session.getToken === "function") {
        var token = await window.Clerk.session.getToken();
        if (token) headers.Authorization = "Bearer " + token;
      }
    } catch(_) {}
    if (!headers.Authorization) {
      try {
        if (window._authUser && window._authUser.email) {
          var em = String(window._authUser.email).trim().toLowerCase();
          headers["X-User-Email"] = em;
          headers["X-User-Id"] = "compat:" + em;
        }
      } catch(_) {}
    }
    return headers;
  }
  async function api(path, init){
    var base = workerBase();
    hub.workerBase = base;
    if (!base) throw new Error("Worker URL is not configured");
    var opts = init || {};
    opts.headers = Object.assign({}, await authHeaders(), opts.headers || {});
    var res = await fetch(base + path, opts);
    var text = await res.text();
    var data = {};
    try { data = text ? JSON.parse(text) : {}; } catch(_) {}
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    return data;
  }
  async function boot(force){
    if (hub.loading) return;
    if (!force && hub.booted && (Date.now() - hub.lastLoaded) < 10000) return;
    hub.loading = true;
    hub.error = "";
    try {
      var base = workerBase();
      hub.workerBase = base;
      if (!base) {
        hub.profile = null;
        hub.relationships = [];
        hub.deals = [];
        hub.notifications = [];
        hub.authMode = "";
      } else {
        var me = await api("/api/merchant/profile/me");
        hub.profile = me.profile || null;
        hub.authMode = me.authMode || "";
        if (hub.profile) {
          var rels = [];
          var deals = [];
          var notifs = [];
          try { rels = (await api("/api/merchant/relationships")).relationships || []; } catch(_) {}
          try { deals = (await api("/api/merchant/deals")).deals || []; } catch(_) {}
          try { notifs = (await api("/api/merchant/notifications?limit=10")).notifications || []; } catch(_) {}
          hub.relationships = rels;
          hub.deals = deals;
          hub.notifications = notifs;
        } else {
          hub.relationships = [];
          hub.deals = [];
          hub.notifications = [];
        }
      }
      hub.booted = true;
      hub.lastLoaded = Date.now();
    } catch(err) {
      hub.error = err && err.message ? err.message : String(err);
      hub.booted = true;
    } finally {
      hub.loading = false;
      if (onMerchantsPage()) {
        try { window.renderMerchants(); } catch(_) {}
      }
    }
  }
  function panel(title, body){
    return '<div class="panel"><div class="panel-head"><h2>' + esc(title) + '</h2></div><div class="panel-body">' + body + '</div></div>';
  }
  function configCard(){
    var base = hub.workerBase || workerBase();
    return panel(
      'Merchant connection',
      '<div class="muted" style="font-size:10px;margin-bottom:10px;">Set the merchant Worker URL. This should normally be your backend Worker base URL.</div>' +
      '<div class="form-field"><label class="form-label">Worker URL</label><input id="m_worker_url" class="inp-field" placeholder="https://p2p-tracker.taheito26.workers.dev" value="' + esc(base) + '"></div>' +
      '<div class="msg" id="m_worker_msg"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button class="btn" id="m_save_worker">Save Worker URL</button>' +
      '<button class="btn secondary" id="m_test_worker">Test connection</button>' +
      '</div>'
    );
  }
  function onboardingCard(){
    var authText = hub.authMode ? ('Signed in via ' + hub.authMode) : 'Sign in first, or make sure _authUser.email exists';
    return panel(
      'Merchant onboarding',
      '<div class="muted" style="font-size:10px;margin-bottom:10px;">' + esc(authText) + '</div>' +
      '<div class="form-field"><label class="form-label">Display name</label><input id="m_name" class="inp-field" placeholder="Taheito Trading"></div>' +
      '<div class="form-field"><label class="form-label">Nickname</label><input id="m_nickname" class="inp-field" placeholder="taheito"></div>' +
      '<div class="form-field"><label class="form-label">Type</label><select id="m_type" class="inp-field"><option value="independent">Independent</option><option value="desk">Desk</option><option value="partner">Partner</option><option value="other">Other</option></select></div>' +
      '<div class="form-field"><label class="form-label">Region</label><input id="m_region" class="inp-field" placeholder="Qatar"></div>' +
      '<div class="form-field"><label class="form-label">Bio</label><textarea id="m_bio" class="inp-field" style="min-height:84px;" placeholder="Primary merchant profile"></textarea></div>' +
      '<div class="msg" id="m_create_msg"></div>' +
      '<button class="btn" id="m_create_profile">Create merchant profile</button>'
    );
  }
  function dashboard(){
    var exposure = 0;
    for (var i = 0; i < hub.deals.length; i++) {
      var d = hub.deals[i] || {};
      if (["active","due","overdue"].indexOf(String(d.status || "")) >= 0) exposure += Number(d.amount || 0);
    }
    var notifHtml = hub.notifications.length
      ? hub.notifications.slice(0, 6).map(function(n){
          return '<div style="padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--panel);margin-bottom:8px;">' +
            '<div style="font-weight:700;font-size:11px;">' + esc(n.title || n.category || "Notification") + '</div>' +
            '<div class="muted" style="font-size:10px;margin-top:4px;">' + esc(n.body || "") + '</div>' +
          '</div>';
        }).join('')
      : '<div class="muted" style="font-size:10px;">No notifications yet.</div>';
    return '' +
      '<div class="kpis">' +
        '<div class="kpi-card"><div class="kpi-lbl">PROFILE</div><div class="kpi-val">' + esc(hub.profile.display_name || hub.profile.nickname || "Merchant") + '</div><div class="kpi-sub">' + esc(hub.profile.merchant_id || "") + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-lbl">RELATIONSHIPS</div><div class="kpi-val">' + hub.relationships.length + '</div><div class="kpi-sub">Active network</div></div>' +
        '<div class="kpi-card"><div class="kpi-lbl">DEALS</div><div class="kpi-val">' + hub.deals.length + '</div><div class="kpi-sub">Global deal count</div></div>' +
        '<div class="kpi-card"><div class="kpi-lbl">EXPOSURE</div><div class="kpi-val">' + esc(money(exposure)) + '</div><div class="kpi-sub">Open commercial exposure</div></div>' +
      '</div>' +
      '<div class="twoColPage" style="grid-template-columns:1.1fr .9fr;gap:12px;">' +
        panel(
          'Profile',
          '<div style="display:grid;grid-template-columns:150px 1fr;gap:8px 12px;font-size:11px;">' +
            '<div class="muted">Display name</div><div>' + esc(hub.profile.display_name || "") + '</div>' +
            '<div class="muted">Nickname</div><div>' + esc(hub.profile.nickname || "") + '</div>' +
            '<div class="muted">Merchant ID</div><div>' + esc(hub.profile.merchant_id || "") + '</div>' +
            '<div class="muted">Type</div><div>' + esc(hub.profile.merchant_type || "") + '</div>' +
            '<div class="muted">Region</div><div>' + esc(hub.profile.region || "") + '</div>' +
            '<div class="muted">Discoverability</div><div>' + esc(hub.profile.discoverability || "") + '</div>' +
          '</div>' +
          '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="btn secondary" id="m_refresh">Refresh</button>' +
            '<button class="btn secondary" id="m_open_settings">Connection settings</button>' +
          '</div>'
        ) +
        panel('Recent notifications', notifHtml) +
      '</div>';
  }
  function bodyHtml(){
    if (hub.loading && !hub.booted) return panel('Merchants', '<div class="muted">Loading merchant workspace...</div>');
    if (!hub.workerBase && !workerBase()) return configCard() + onboardingCard();
    if (hub.error && !hub.profile) return '<div class="msg err" style="display:block;margin-bottom:10px;">' + esc(hub.error) + '</div>' + configCard() + onboardingCard();
    if (!hub.profile) return configCard() + onboardingCard();
    return (hub.error ? '<div class="msg warn" style="display:block;margin-bottom:10px;">' + esc(hub.error) + '</div>' : '') + dashboard();
  }
  function wire(){
    var saveBtn = q("#m_save_worker");
    if (saveBtn) {
      saveBtn.addEventListener("click", function(){
        var input = q("#m_worker_url");
        var msg = q("#m_worker_msg");
        var value = input ? String(input.value || "").trim().replace(/\/+$/, "") : "";
        try {
          localStorage.setItem("merchant_worker_url", value);
          hub.workerBase = value;
          if (msg) { msg.textContent = value ? "Worker URL saved." : "Worker URL cleared."; msg.className = "msg good"; }
          boot(true);
        } catch(err) {
          if (msg) { msg.textContent = err.message || String(err); msg.className = "msg err"; }
        }
      });
    }
    var testBtn = q("#m_test_worker");
    if (testBtn) {
      testBtn.addEventListener("click", async function(){
        var msg = q("#m_worker_msg");
        try {
          var base = workerBase();
          if (!base) throw new Error("Save the Worker URL first");
          var res = await fetch(base + "/api/status");
          if (!res.ok) throw new Error("Status check failed: HTTP " + res.status);
          if (msg) { msg.textContent = "Worker connection is healthy."; msg.className = "msg good"; }
        } catch(err) {
          if (msg) { msg.textContent = err.message || String(err); msg.className = "msg err"; }
        }
      });
    }
    var createBtn = q("#m_create_profile");
    if (createBtn) {
      createBtn.addEventListener("click", async function(){
        var msg = q("#m_create_msg");
        try {
          createBtn.disabled = true;
          var payload = {
            display_name: q("#m_name") ? q("#m_name").value.trim() : "",
            nickname: q("#m_nickname") ? q("#m_nickname").value.trim().toLowerCase() : "",
            merchant_type: q("#m_type") ? q("#m_type").value : "independent",
            region: q("#m_region") ? q("#m_region").value.trim() : "",
            default_currency: "USDT",
            discoverability: "public",
            bio: q("#m_bio") ? q("#m_bio").value.trim() : ""
          };
          if (!payload.display_name || !payload.nickname) throw new Error("Display name and nickname are required");
          await api("/api/merchant/profile", { method: "POST", body: JSON.stringify(payload) });
          if (msg) { msg.textContent = "Merchant profile created."; msg.className = "msg good"; }
          await boot(true);
        } catch(err) {
          if (msg) { msg.textContent = err.message || String(err); msg.className = "msg err"; }
        } finally {
          createBtn.disabled = false;
        }
      });
    }
    var refreshBtn = q("#m_refresh");
    if (refreshBtn) refreshBtn.addEventListener("click", function(){ boot(true); });
    var settingsBtn = q("#m_open_settings");
    if (settingsBtn) settingsBtn.addEventListener("click", function(){
      hub.profile = null;
      try { window.renderMerchants(); } catch(_) {}
    });
  }
  window.renderMerchants = function(){
    try {
      if (typeof window.setHeader === "function") {
        window.setHeader("Merchants & Collaboration", "Safe merchant workspace backed by the Worker API");
      }
      var h = host();
      if (!h) {
        if (legacyRender) return legacyRender.apply(this, arguments);
        return;
      }
      h.innerHTML = bodyHtml();
      wire();
      if (!hub.booted && !hub.loading) boot(true);
    } catch(err) {
      console.error("[merchant-bridge] render failed", err);
      if (legacyRender) return legacyRender.apply(this, arguments);
      var h2 = host();
      if (h2) h2.innerHTML = panel("Merchants", '<div class="msg err" style="display:block;">Merchant workspace failed to load.</div>');
      safeToast("Merchant workspace failed to load", "warn");
    }
  };
  if (!window._merchantHubLitePoll) {
    window._merchantHubLitePoll = setInterval(function(){
      if (onMerchantsPage() && hub.profile) boot(true);
    }, 15000);
  }
})();
