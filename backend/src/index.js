
const BINANCE = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
const JWKS_CACHE = new Map();
const JWKS_TTL_MS = 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}
function randomId(prefix = "") {
  return `${prefix}${crypto.randomUUID()}`;
}
function b64urlToBytes(input) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function parseJwt(token) {
  const [h, p, s] = String(token || "").split(".");
  if (!h || !p || !s) throw new Error("Malformed token");
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  return { header, payload, signingInput: `${h}.${p}`, signature: b64urlToBytes(s) };
}
async function importJwk(jwk) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}
async function getJwksKeys(url) {
  const cached = JWKS_CACHE.get(url);
  if (cached && (Date.now() - cached.ts) < JWKS_TTL_MS) return cached.keys;
  const res = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const json = await res.json();
  const keys = new Map();
  for (const jwk of (json.keys || [])) {
    if (jwk.kty === "RSA" && jwk.kid) keys.set(jwk.kid, await importJwk(jwk));
  }
  JWKS_CACHE.set(url, { ts: Date.now(), keys });
  return keys;
}
async function verifyRs256Jwt(token, jwksUrl) {
  const parsed = parseJwt(token);
  const kid = parsed.header.kid;
  if (!kid) throw new Error("Missing kid");
  const keys = await getJwksKeys(jwksUrl);
  const key = keys.get(kid);
  if (!key) throw new Error("Unknown signing key");
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    parsed.signature,
    new TextEncoder().encode(parsed.signingInput)
  );
  if (!ok) throw new Error("Invalid token signature");
  const payload = parsed.payload || {};
  const now = Math.floor(Date.now() / 1000);
  if (payload.nbf && now < payload.nbf) throw new Error("Token not active yet");
  if (payload.exp && now >= payload.exp) throw new Error("Token expired");
  if (!payload.sub) throw new Error("Token missing sub");
  return payload;
}
function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}
function allowedOrigin(origin, env) {
  const raw = String(env.ALLOWED_ORIGINS || "*").trim();
  if (!origin) return raw === "*" ? "*" : raw.split(",")[0].trim();
  if (raw === "*") return "*";
  const allowed = raw.split(",").map(s => s.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : allowed[0] || "*";
}
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": allowedOrigin(origin, env),
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Email, X-User-Id, X-Compat-User",
    "Access-Control-Allow-Credentials": "true",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}
function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(request, env), "Content-Type": "application/json; charset=utf-8" },
  });
}
function bad(request, env, message, status = 400, extra = {}) {
  return json(request, env, { error: message, ...extra }, status);
}
async function readJson(request) {
  const txt = await request.text();
  return txt ? JSON.parse(txt) : {};
}
async function getUserContext(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) {
    if (!env.CLERK_JWKS_URL) throw new Error("Bearer token provided but CLERK_JWKS_URL is not configured");
    const payload = await verifyRs256Jwt(auth.slice(7), env.CLERK_JWKS_URL);
    return {
      mode: "jwt",
      userId: String(payload.sub),
      email: normalizeEmail(payload.email || payload.email_address || payload.primary_email_address || ""),
    };
  }
  const compatUserId = request.headers.get("X-User-Id") || request.headers.get("X-Compat-User");
  if (compatUserId) {
    return { mode: "compat", userId: String(compatUserId), email: "" };
  }
  const compatEmail = normalizeEmail(request.headers.get("X-User-Email"));
  if (compatEmail) {
    return { mode: "compat", userId: `compat:${compatEmail}`, email: compatEmail };
  }
  throw new Error("Unauthorized");
}
async function d1First(db, sql, ...params) {
  return await db.prepare(sql).bind(...params).first();
}
async function d1All(db, sql, ...params) {
  const out = await db.prepare(sql).bind(...params).all();
  return out.results || [];
}
async function d1Run(db, sql, ...params) {
  return await db.prepare(sql).bind(...params).run();
}
function merchantId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return "MRC-" + [...bytes].map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function validateNickname(nick) {
  return /^[a-z0-9_]{3,30}$/.test(String(nick || ""));
}
function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}
async function getMyProfile(db, userId) {
  return await d1First(db, `SELECT * FROM merchant_profiles WHERE owner_user_id = ? LIMIT 1`, userId);
}
async function expireInvites(db) {
  await d1Run(
    db,
    `UPDATE merchant_invites
     SET status = 'expired', updated_at = ?
     WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?`,
    nowIso(),
    nowIso()
  );
}
async function assertRelationshipAccess(db, relId, userId) {
  const rel = await d1First(db, `
    SELECT r.*, pa.owner_user_id AS owner_a, pb.owner_user_id AS owner_b
    FROM merchant_relationships r
    JOIN merchant_profiles pa ON pa.id = r.merchant_a_id
    JOIN merchant_profiles pb ON pb.id = r.merchant_b_id
    WHERE r.id = ?
    LIMIT 1
  `, relId);
  if (!rel) throw new Error("Relationship not found");
  if (rel.owner_a !== userId && rel.owner_b !== userId) throw new Error("Forbidden");
  return rel;
}
async function counterpartyProfile(db, rel, myUserId) {
  const counterpartyId = rel.owner_a === myUserId ? rel.merchant_b_id : rel.merchant_a_id;
  return await d1First(db, `SELECT * FROM merchant_profiles WHERE id = ? LIMIT 1`, counterpartyId);
}
async function myRoleForRelationship(db, relId, userId) {
  const row = await d1First(db, `
    SELECT role
    FROM merchant_roles
    WHERE relationship_id = ? AND user_id = ?
    ORDER BY created_at ASC
    LIMIT 1
  `, relId, userId);
  return row?.role || "viewer";
}
async function createAudit(db, row) {
  await d1Run(db, `
    INSERT INTO merchant_audit_logs
      (id, relationship_id, actor_user_id, actor_merchant_id, entity_type, entity_id, action, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    row.id || randomId("aud_"),
    row.relationship_id || null,
    row.actor_user_id || null,
    row.actor_merchant_id || null,
    row.entity_type || null,
    row.entity_id || null,
    row.action || "",
    JSON.stringify(row.detail || {}),
    row.created_at || nowIso()
  );
}
async function createNotification(db, row) {
  await d1Run(db, `
    INSERT INTO merchant_notifications
      (id, user_id, relationship_id, category, title, body, data_json, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    row.id || randomId("ntf_"),
    row.user_id,
    row.relationship_id || null,
    row.category || "system",
    row.title || "",
    row.body || "",
    JSON.stringify(row.data || {}),
    row.read_at || null,
    row.created_at || nowIso()
  );
}
async function createSystemMessage(db, row) {
  await d1Run(db, `
    INSERT INTO merchant_messages
      (id, relationship_id, sender_user_id, sender_merchant_id, body, message_type, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    row.id || randomId("msg_"),
    row.relationship_id,
    row.sender_user_id || "system",
    row.sender_merchant_id || null,
    row.body || "",
    row.message_type || "system",
    JSON.stringify(row.metadata || {}),
    row.created_at || nowIso()
  );
}
async function relationshipSummary(db, relId, userId) {
  const totalDealsRow = await d1First(db, `SELECT COUNT(*) AS c FROM merchant_deals WHERE relationship_id = ?`, relId);
  const activeExposureRow = await d1First(db, `SELECT COALESCE(SUM(amount),0) AS v FROM merchant_deals WHERE relationship_id = ? AND status IN ('active','due','overdue')`, relId);
  const realizedProfitRow = await d1First(db, `SELECT COALESCE(SUM(COALESCE(realized_pnl,0)),0) AS v FROM merchant_deals WHERE relationship_id = ? AND status IN ('settled','closed')`, relId);
  const pendingApprovalsRow = await d1First(db, `SELECT COUNT(*) AS c FROM merchant_approvals WHERE relationship_id = ? AND reviewer_user_id = ? AND status = 'pending'`, relId, userId);
  return {
    totalDeals: Number(totalDealsRow?.c || 0),
    activeExposure: Number(activeExposureRow?.v || 0),
    realizedProfit: Number(realizedProfitRow?.v || 0),
    pendingApprovals: Number(pendingApprovalsRow?.c || 0),
  };
}
async function enrichDealRows(rows) {
  return rows.map(row => ({
    ...row,
    metadata: safeJsonParse(row.metadata, {}),
  }));
}


async function handleMerchant(request, env) {
  if (!env.DB) return bad(request, env, "D1 binding DB is not configured", 500);
  const db = env.DB;
  await expireInvites(db);

  let user;
  try {
    user = await getUserContext(request, env);
  } catch (err) {
    return bad(request, env, err.message || "Unauthorized", 401);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/merchant/, "") || "/";
  const method = request.method.toUpperCase();

  try {
    // Profiles
    if (method === "GET" && path === "/profile/me") {
      const profile = await getMyProfile(db, user.userId);
      return json(request, env, { profile: profile || null, authMode: user.mode });
    }
    if (method === "POST" && path === "/profile") {
      const existing = await getMyProfile(db, user.userId);
      if (existing) return bad(request, env, "Merchant profile already exists", 409);
      const body = await readJson(request);
      const nickname = String(body.nickname || "").trim().toLowerCase();
      if (!validateNickname(nickname)) return bad(request, env, "Nickname must be 3 to 30 chars using a-z, 0-9, _");
      const nicknameRow = await d1First(db, `SELECT id FROM merchant_profiles WHERE nickname = ? LIMIT 1`, nickname);
      if (nicknameRow) return bad(request, env, "Nickname already taken", 409);
      const displayName = String(body.display_name || "").trim();
      if (!displayName) return bad(request, env, "Display name is required");
      const profile = {
        id: randomId("mrc_row_"),
        owner_user_id: user.userId,
        merchant_id: merchantId(),
        nickname,
        display_name: displayName,
        merchant_type: String(body.merchant_type || "independent"),
        region: String(body.region || "").trim(),
        default_currency: String(body.default_currency || "USDT"),
        discoverability: String(body.discoverability || "public"),
        bio: String(body.bio || "").trim(),
        status: "active",
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      await d1Run(db, `
        INSERT INTO merchant_profiles
          (id, owner_user_id, merchant_id, nickname, display_name, merchant_type, region, default_currency, discoverability, bio, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        profile.id, profile.owner_user_id, profile.merchant_id, profile.nickname, profile.display_name, profile.merchant_type,
        profile.region, profile.default_currency, profile.discoverability, profile.bio, profile.status, profile.created_at, profile.updated_at
      );
      await createAudit(db, {
        actor_user_id: user.userId,
        actor_merchant_id: profile.id,
        entity_type: "merchant_profile",
        entity_id: profile.id,
        action: "profile_created",
        detail: { merchant_id: profile.merchant_id, nickname: profile.nickname },
      });
      return json(request, env, { ok: true, profile }, 201);
    }
    if (method === "PATCH" && path === "/profile/me") {
      const profile = await getMyProfile(db, user.userId);
      if (!profile) return bad(request, env, "Merchant profile not found", 404);
      const body = await readJson(request);
      const next = {
        display_name: String(body.display_name ?? profile.display_name).trim(),
        bio: String(body.bio ?? profile.bio ?? "").trim(),
        region: String(body.region ?? profile.region ?? "").trim(),
        discoverability: String(body.discoverability ?? profile.discoverability),
        merchant_type: String(body.merchant_type ?? profile.merchant_type),
        updated_at: nowIso(),
      };
      if (!next.display_name) return bad(request, env, "Display name is required");
      await d1Run(db, `
        UPDATE merchant_profiles
        SET display_name = ?, bio = ?, region = ?, discoverability = ?, merchant_type = ?, updated_at = ?
        WHERE id = ?
      `, next.display_name, next.bio, next.region, next.discoverability, next.merchant_type, next.updated_at, profile.id);
      const updated = await getMyProfile(db, user.userId);
      await createAudit(db, {
        actor_user_id: user.userId,
        actor_merchant_id: profile.id,
        entity_type: "merchant_profile",
        entity_id: profile.id,
        action: "profile_updated",
        detail: next,
      });
      return json(request, env, { ok: true, profile: updated });
    }
    if (method === "GET" && path.startsWith("/profile/")) {
      const key = decodeURIComponent(path.split("/").pop());
      const row = await d1First(db, `
        SELECT id, merchant_id, nickname, display_name, merchant_type, region, default_currency, discoverability, bio, status, created_at
        FROM merchant_profiles
        WHERE (id = ? OR merchant_id = ?)
          AND status = 'active'
        LIMIT 1
      `, key, key);
      if (!row) return bad(request, env, "Profile not found", 404);
      return json(request, env, { profile: row });
    }
    if (method === "GET" && path === "/search") {
      const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
      const my = await getMyProfile(db, user.userId);
      if (!q || q.length < 2) return json(request, env, { results: [] });
      const rows = await d1All(db, `
        SELECT id, merchant_id, nickname, display_name, merchant_type, region, bio, discoverability
        FROM merchant_profiles
        WHERE status = 'active'
          AND (
            merchant_id = ?
            OR (
              discoverability = 'public'
              AND (
                lower(display_name) LIKE ?
                OR lower(nickname) LIKE ?
              )
            )
          )
        ORDER BY display_name ASC
        LIMIT 25
      `, q.toUpperCase(), `%${q}%`, `%${q}%`);
      const filtered = rows.filter(r => !my || r.id !== my.id);
      return json(request, env, { results: filtered });
    }
    if (method === "GET" && path === "/check-nickname") {
      const nickname = String(url.searchParams.get("nickname") || "").trim().toLowerCase();
      if (!validateNickname(nickname)) return json(request, env, { available: false, valid: false });
      const row = await d1First(db, `SELECT id FROM merchant_profiles WHERE nickname = ? LIMIT 1`, nickname);
      return json(request, env, { available: !row, valid: true });
    }

    // Invites
    if (method === "POST" && path === "/invites") {
      const myProfile = await getMyProfile(db, user.userId);
      if (!myProfile) return bad(request, env, "Create your merchant profile first", 409);
      const body = await readJson(request);
      const toMerchantId = String(body.to_merchant_id || "").trim();
      const counterparty = await d1First(db, `SELECT * FROM merchant_profiles WHERE id = ? OR merchant_id = ? LIMIT 1`, toMerchantId, toMerchantId);
      if (!counterparty) return bad(request, env, "Target merchant not found", 404);
      if (counterparty.id === myProfile.id) return bad(request, env, "You cannot invite yourself", 400);
      const existingPending = await d1First(db, `
        SELECT id
        FROM merchant_invites
        WHERE from_merchant_id = ? AND to_merchant_id = ? AND status = 'pending'
        LIMIT 1
      `, myProfile.id, counterparty.id);
      if (existingPending) return bad(request, env, "A pending invite already exists", 409);
      const relExisting = await d1First(db, `
        SELECT id
        FROM merchant_relationships
        WHERE ((merchant_a_id = ? AND merchant_b_id = ?) OR (merchant_a_id = ? AND merchant_b_id = ?))
          AND status <> 'terminated'
        LIMIT 1
      `, myProfile.id, counterparty.id, counterparty.id, myProfile.id);
      if (relExisting) return bad(request, env, "Relationship already exists", 409);

      const invite = {
        id: randomId("inv_"),
        from_merchant_id: myProfile.id,
        to_merchant_id: counterparty.id,
        status: "pending",
        purpose: String(body.purpose || "").trim(),
        requested_role: String(body.requested_role || "operator"),
        message: String(body.message || "").trim(),
        requested_scope: JSON.stringify(Array.isArray(body.requested_scope) ? body.requested_scope : []),
        expires_at: body.expires_at || new Date(Date.now() + 14 * 86400000).toISOString(),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      await d1Run(db, `
        INSERT INTO merchant_invites
          (id, from_merchant_id, to_merchant_id, status, purpose, requested_role, message, requested_scope, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        invite.id, invite.from_merchant_id, invite.to_merchant_id, invite.status, invite.purpose,
        invite.requested_role, invite.message, invite.requested_scope, invite.expires_at, invite.created_at, invite.updated_at
      );
      await createNotification(db, {
        user_id: counterparty.owner_user_id,
        category: "invite",
        title: "New merchant invite",
        body: `${myProfile.display_name} invited you to collaborate`,
        data: { invite_id: invite.id, from_merchant_id: myProfile.merchant_id, from_display_name: myProfile.display_name },
      });
      await createAudit(db, {
        actor_user_id: user.userId,
        actor_merchant_id: myProfile.id,
        entity_type: "merchant_invite",
        entity_id: invite.id,
        action: "invite_sent",
        detail: { to_merchant_id: counterparty.id, purpose: invite.purpose },
      });
      return json(request, env, { ok: true, invite }, 201);
    }
    if (method === "GET" && path === "/invites/inbox") {
      const myProfile = await getMyProfile(db, user.userId);
      if (!myProfile) return json(request, env, { invites: [] });
      const invites = await d1All(db, `
        SELECT i.*, fp.display_name AS from_display_name, fp.nickname AS from_nickname, fp.merchant_id AS from_public_id
        FROM merchant_invites i
        JOIN merchant_profiles fp ON fp.id = i.from_merchant_id
        WHERE i.to_merchant_id = ?
        ORDER BY i.created_at DESC
      `, myProfile.id);
      return json(request, env, { invites });
    }
    if (method === "GET" && path === "/invites/sent") {
      const myProfile = await getMyProfile(db, user.userId);
      if (!myProfile) return json(request, env, { invites: [] });
      const invites = await d1All(db, `
        SELECT i.*, tp.display_name AS to_display_name, tp.nickname AS to_nickname, tp.merchant_id AS to_public_id
        FROM merchant_invites i
        JOIN merchant_profiles tp ON tp.id = i.to_merchant_id
        WHERE i.from_merchant_id = ?
        ORDER BY i.created_at DESC
      `, myProfile.id);
      return json(request, env, { invites });
    }
    if (method === "POST" && path.match(/^\/invites\/[^/]+\/accept$/)) {
      const inviteId = path.split("/")[2];
      const myProfile = await getMyProfile(db, user.userId);
      if (!myProfile) return bad(request, env, "Create your merchant profile first", 409);
      const invite = await d1First(db, `SELECT * FROM merchant_invites WHERE id = ? LIMIT 1`, inviteId);
      if (!invite) return bad(request, env, "Invite not found", 404);
      if (invite.to_merchant_id !== myProfile.id) return bad(request, env, "Forbidden", 403);
      if (invite.status !== "pending") return bad(request, env, `Invite is ${invite.status}`, 409);
      if (invite.expires_at && invite.expires_at < nowIso()) {
        await d1Run(db, `UPDATE merchant_invites SET status = 'expired', updated_at = ? WHERE id = ?`, nowIso(), inviteId);
        return bad(request, env, "Invite expired", 409);
      }
      const relId = randomId("rel_");
      const createdAt = nowIso();
      await d1Run(db, `
        INSERT INTO merchant_relationships
          (id, merchant_a_id, merchant_b_id, invite_id, relationship_type, status, shared_fields, approval_policy, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        relId, invite.from_merchant_id, invite.to_merchant_id, invite.id, "general", "active",
        JSON.stringify(["lending", "arbitrage", "partnership", "capital"]),
        JSON.stringify({ settlement_submit: "counterparty", profit_record_submit: "counterparty", deal_close: "counterparty" }),
        createdAt, createdAt
      );
      const inviter = await d1First(db, `SELECT * FROM merchant_profiles WHERE id = ? LIMIT 1`, invite.from_merchant_id);
      await d1Run(db, `
        INSERT INTO merchant_roles (id, relationship_id, merchant_id, user_id, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)
      `,
        randomId("role_"), relId, invite.from_merchant_id, inviter.owner_user_id, "owner", createdAt, createdAt,
        randomId("role_"), relId, invite.to_merchant_id, myProfile.owner_user_id, invite.requested_role || "operator", createdAt, createdAt
      );
      await d1Run(db, `UPDATE merchant_invites SET status = 'accepted', updated_at = ? WHERE id = ?`, nowIso(), inviteId);
      await createNotification(db, {
        user_id: inviter.owner_user_id,
        relationship_id: relId,
        category: "invite",
        title: "Invite accepted",
        body: `${myProfile.display_name} accepted your invite`,
        data: { invite_id: invite.id, relationship_id: relId },
      });
      await createAudit(db, {
        relationship_id: relId,
        actor_user_id: user.userId,
        actor_merchant_id: myProfile.id,
        entity_type: "merchant_invite",
        entity_id: invite.id,
        action: "invite_accepted",
        detail: { relationship_id: relId },
      });
      await createSystemMessage(db, {
        relationship_id: relId,
        body: `${myProfile.display_name} accepted the collaboration invite`,
        metadata: { invite_id: invite.id },
      });
      return json(request, env, { ok: true, relationship_id: relId });
    }
    if (method === "POST" && path.match(/^\/invites\/[^/]+\/reject$/)) {
      const inviteId = path.split("/")[2];
      const myProfile = await getMyProfile(db, user.userId);
      if (!myProfile) return bad(request, env, "Create your merchant profile first", 409);
      const invite = await d1First(db, `SELECT * FROM merchant_invites WHERE id = ? LIMIT 1`, inviteId);
      if (!invite) return bad(request, env, "Invite not found", 404);
      if (invite.to_merchant_id !== myProfile.id) return bad(request, env, "Forbidden", 403);
      if (invite.status !== "pending") return bad(request, env, `Invite is ${invite.status}`, 409);
      await d1Run(db, `UPDATE merchant_invites SET status = 'rejected', updated_at = ? WHERE id = ?`, nowIso(), inviteId);
      const inviter = await d1First(db, `SELECT * FROM merchant_profiles WHERE id = ? LIMIT 1`, invite.from_merchant_id);
      await createNotification(db, {
        user_id: inviter.owner_user_id,
        category: "invite",
        title: "Invite rejected",
        body: `${myProfile.display_name} rejected your invite`,
        data: { invite_id: invite.id },
      });
      await createAudit(db, {
        actor_user_id: user.userId,
        actor_merchant_id: myProfile.id,
        entity_type: "merchant_invite",
        entity_id: invite.id,
        action: "invite_rejected",
        detail: {},
      });
      return json(request, env, { ok: true });
    }
    if (method === "POST" && path.match(/^\/invites\/[^/]+\/withdraw$/)) {
      const inviteId = path.split("/")[2];
      const myProfile = await getMyProfile(db, user.userId);
      if (!myProfile) return bad(request, env, "Create your merchant profile first", 409);
      const invite = await d1First(db, `SELECT * FROM merchant_invites WHERE id = ? LIMIT 1`, inviteId);
      if (!invite) return bad(request, env, "Invite not found", 404);
      if (invite.from_merchant_id !== myProfile.id) return bad(request, env, "Forbidden", 403);
      if (invite.status !== "pending") return bad(request, env, `Invite is ${invite.status}`, 409);
      await d1Run(db, `UPDATE merchant_invites SET status = 'withdrawn', updated_at = ? WHERE id = ?`, nowIso(), inviteId);
      await createAudit(db, {
        actor_user_id: user.userId,
        actor_merchant_id: myProfile.id,
        entity_type: "merchant_invite",
        entity_id: invite.id,
        action: "invite_withdrawn",
        detail: {},
      });
      return json(request, env, { ok: true });
    }


// Relationships
if (method === "GET" && path === "/relationships") {
  const myProfile = await getMyProfile(db, user.userId);
  if (!myProfile) return json(request, env, { relationships: [] });
  const rows = await d1All(db, `
    SELECT r.*,
           pa.display_name AS merchant_a_name, pa.owner_user_id AS merchant_a_owner, pa.merchant_id AS merchant_a_public_id,
           pb.display_name AS merchant_b_name, pb.owner_user_id AS merchant_b_owner, pb.merchant_id AS merchant_b_public_id
    FROM merchant_relationships r
    JOIN merchant_profiles pa ON pa.id = r.merchant_a_id
    JOIN merchant_profiles pb ON pb.id = r.merchant_b_id
    WHERE r.merchant_a_id = ? OR r.merchant_b_id = ?
    ORDER BY r.updated_at DESC
  `, myProfile.id, myProfile.id);
  const relationships = [];
  for (const row of rows) {
    const summary = await relationshipSummary(db, row.id, user.userId);
    const myRole = await myRoleForRelationship(db, row.id, user.userId);
    const isA = row.merchant_a_id === myProfile.id;
    relationships.push({
      ...row,
      shared_fields: safeJsonParse(row.shared_fields, []),
      approval_policy: safeJsonParse(row.approval_policy, {}),
      my_role: myRole,
      counterparty: {
        id: isA ? row.merchant_b_id : row.merchant_a_id,
        merchant_id: isA ? row.merchant_b_public_id : row.merchant_a_public_id,
        display_name: isA ? row.merchant_b_name : row.merchant_a_name,
        owner_user_id: isA ? row.merchant_b_owner : row.merchant_a_owner,
      },
      summary,
    });
  }
  return json(request, env, { relationships });
}
if (method === "GET" && path.match(/^\/relationships\/[^/]+$/)) {
  const relId = path.split("/")[2];
  const rel = await assertRelationshipAccess(db, relId, user.userId);
  const summary = await relationshipSummary(db, relId, user.userId);
  const counterparty = await counterpartyProfile(db, rel, user.userId);
  const myRole = await myRoleForRelationship(db, relId, user.userId);
  return json(request, env, {
    relationship: {
      ...rel,
      shared_fields: safeJsonParse(rel.shared_fields, []),
      approval_policy: safeJsonParse(rel.approval_policy, {}),
      my_role: myRole,
      counterparty,
      summary,
    },
  });
}
if (method === "PATCH" && path.match(/^\/relationships\/[^/]+\/settings$/)) {
  const relId = path.split("/")[2];
  const rel = await assertRelationshipAccess(db, relId, user.userId);
  const body = await readJson(request);
  const nextType = String(body.relationship_type || rel.relationship_type || "general");
  const nextFields = JSON.stringify(Array.isArray(body.shared_fields) ? body.shared_fields : safeJsonParse(rel.shared_fields, []));
  const nextApproval = JSON.stringify(body.approval_policy || safeJsonParse(rel.approval_policy, {}));
  await d1Run(db, `
    UPDATE merchant_relationships
    SET relationship_type = ?, shared_fields = ?, approval_policy = ?, updated_at = ?
    WHERE id = ?
  `, nextType, nextFields, nextApproval, nowIso(), relId);
  await createAudit(db, {
    relationship_id: relId,
    actor_user_id: user.userId,
    entity_type: "merchant_relationship",
    entity_id: relId,
    action: "relationship_settings_updated",
    detail: { relationship_type: nextType, shared_fields: safeJsonParse(nextFields, []) },
  });
  const updated = await d1First(db, `SELECT * FROM merchant_relationships WHERE id = ? LIMIT 1`, relId);
  return json(request, env, {
    ok: true,
    relationship: {
      ...updated,
      shared_fields: safeJsonParse(updated.shared_fields, []),
      approval_policy: safeJsonParse(updated.approval_policy, {}),
    },
  });
}
if (method === "POST" && path.match(/^\/relationships\/[^/]+\/suspend$/)) {
  const relId = path.split("/")[2];
  const rel = await assertRelationshipAccess(db, relId, user.userId);
  const myProfile = await getMyProfile(db, user.userId);
  const counterparty = await counterpartyProfile(db, rel, user.userId);
  const approval = {
    id: randomId("apr_"),
    relationship_id: relId,
    type: "relationship_suspend",
    target_entity_type: "relationship",
    target_entity_id: relId,
    proposed_payload: JSON.stringify({ requested_status: "suspended" }),
    status: "pending",
    submitted_by_user_id: user.userId,
    submitted_by_merchant_id: myProfile.id,
    reviewer_user_id: counterparty.owner_user_id,
    resolution_note: null,
    submitted_at: nowIso(),
    resolved_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await d1Run(db, `
    INSERT INTO merchant_approvals
      (id, relationship_id, type, target_entity_type, target_entity_id, proposed_payload, status, submitted_by_user_id, submitted_by_merchant_id, reviewer_user_id, resolution_note, submitted_at, resolved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    approval.id, approval.relationship_id, approval.type, approval.target_entity_type, approval.target_entity_id,
    approval.proposed_payload, approval.status, approval.submitted_by_user_id, approval.submitted_by_merchant_id,
    approval.reviewer_user_id, approval.resolution_note, approval.submitted_at, approval.resolved_at, approval.created_at, approval.updated_at
  );
  await createNotification(db, {
    user_id: counterparty.owner_user_id,
    relationship_id: relId,
    category: "approval",
    title: "Relationship suspend request",
    body: `${myProfile.display_name} requested to suspend the relationship`,
    data: { approval_id: approval.id, relationship_id: relId },
  });
  await createSystemMessage(db, {
    relationship_id: relId,
    body: `${myProfile.display_name} requested to suspend this relationship`,
    metadata: { approval_id: approval.id },
  });
  return json(request, env, { ok: true, approval_id: approval.id });
}
if (method === "POST" && path.match(/^\/relationships\/[^/]+\/terminate$/)) {
  const relId = path.split("/")[2];
  const rel = await assertRelationshipAccess(db, relId, user.userId);
  const myProfile = await getMyProfile(db, user.userId);
  const counterparty = await counterpartyProfile(db, rel, user.userId);
  const approval = {
    id: randomId("apr_"),
    relationship_id: relId,
    type: "relationship_terminate",
    target_entity_type: "relationship",
    target_entity_id: relId,
    proposed_payload: JSON.stringify({ requested_status: "terminated" }),
    status: "pending",
    submitted_by_user_id: user.userId,
    submitted_by_merchant_id: myProfile.id,
    reviewer_user_id: counterparty.owner_user_id,
    resolution_note: null,
    submitted_at: nowIso(),
    resolved_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await d1Run(db, `
    INSERT INTO merchant_approvals
      (id, relationship_id, type, target_entity_type, target_entity_id, proposed_payload, status, submitted_by_user_id, submitted_by_merchant_id, reviewer_user_id, resolution_note, submitted_at, resolved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    approval.id, approval.relationship_id, approval.type, approval.target_entity_type, approval.target_entity_id,
    approval.proposed_payload, approval.status, approval.submitted_by_user_id, approval.submitted_by_merchant_id,
    approval.reviewer_user_id, approval.resolution_note, approval.submitted_at, approval.resolved_at, approval.created_at, approval.updated_at
  );
  await createNotification(db, {
    user_id: counterparty.owner_user_id,
    relationship_id: relId,
    category: "approval",
    title: "Relationship termination request",
    body: `${myProfile.display_name} requested to terminate the relationship`,
    data: { approval_id: approval.id, relationship_id: relId },
  });
  await createSystemMessage(db, {
    relationship_id: relId,
    body: `${myProfile.display_name} requested to terminate this relationship`,
    metadata: { approval_id: approval.id },
  });
  return json(request, env, { ok: true, approval_id: approval.id });
}

// Deals
if (method === "GET" && path === "/deals") {
  const relFilter = String(url.searchParams.get("relationship_id") || "").trim();
  let rows;
  if (relFilter) {
    await assertRelationshipAccess(db, relFilter, user.userId);
    rows = await d1All(db, `SELECT * FROM merchant_deals WHERE relationship_id = ? ORDER BY created_at DESC`, relFilter);
  } else {
    rows = await d1All(db, `
      SELECT d.*
      FROM merchant_deals d
      JOIN merchant_relationships r ON r.id = d.relationship_id
      JOIN merchant_profiles pa ON pa.id = r.merchant_a_id
      JOIN merchant_profiles pb ON pb.id = r.merchant_b_id
      WHERE pa.owner_user_id = ? OR pb.owner_user_id = ?
      ORDER BY d.created_at DESC
    `, user.userId, user.userId);
  }
  return json(request, env, { deals: await enrichDealRows(rows) });
}
if (method === "POST" && path === "/deals") {
  const body = await readJson(request);
  const relId = String(body.relationship_id || "").trim();
  const rel = await assertRelationshipAccess(db, relId, user.userId);
  const myProfile = await getMyProfile(db, user.userId);
  const payload = {
    id: randomId("deal_"),
    relationship_id: relId,
    deal_type: String(body.deal_type || "general"),
    title: String(body.title || "").trim(),
    amount: Number(body.amount || 0),
    currency: String(body.currency || "USDT"),
    status: String(body.status || "draft"),
    metadata: JSON.stringify(body.metadata || {}),
    issue_date: body.issue_date || nowIso().slice(0, 10),
    due_date: body.due_date || null,
    close_date: null,
    expected_return: body.expected_return == null ? null : Number(body.expected_return),
    realized_pnl: body.realized_pnl == null ? null : Number(body.realized_pnl),
    created_by: user.userId,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  if (!payload.title) return bad(request, env, "Deal title is required");
  await d1Run(db, `
    INSERT INTO merchant_deals
      (id, relationship_id, deal_type, title, amount, currency, status, metadata, issue_date, due_date, close_date, expected_return, realized_pnl, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    payload.id, payload.relationship_id, payload.deal_type, payload.title, payload.amount, payload.currency,
    payload.status, payload.metadata, payload.issue_date, payload.due_date, payload.close_date, payload.expected_return,
    payload.realized_pnl, payload.created_by, payload.created_at, payload.updated_at
  );
  await createAudit(db, {
    relationship_id: relId,
    actor_user_id: user.userId,
    actor_merchant_id: myProfile.id,
    entity_type: "merchant_deal",
    entity_id: payload.id,
    action: "deal_created",
    detail: { title: payload.title, deal_type: payload.deal_type, amount: payload.amount },
  });
  await createSystemMessage(db, {
    relationship_id: relId,
    body: `${myProfile.display_name} created deal "${payload.title}"`,
    metadata: { deal_id: payload.id },
  });
  return json(request, env, { ok: true, deal: { ...payload, metadata: safeJsonParse(payload.metadata, {}) } }, 201);
}
if (method === "PATCH" && path.match(/^\/deals\/[^/]+$/)) {
  const dealId = path.split("/")[2];
  const deal = await d1First(db, `SELECT * FROM merchant_deals WHERE id = ? LIMIT 1`, dealId);
  if (!deal) return bad(request, env, "Deal not found", 404);
  await assertRelationshipAccess(db, deal.relationship_id, user.userId);
  const body = await readJson(request);
  const next = {
    title: String(body.title ?? deal.title).trim(),
    amount: body.amount == null ? Number(deal.amount || 0) : Number(body.amount),
    currency: String(body.currency ?? deal.currency),
    status: String(body.status ?? deal.status),
    metadata: JSON.stringify(body.metadata ?? safeJsonParse(deal.metadata, {})),
    issue_date: body.issue_date ?? deal.issue_date,
    due_date: body.due_date ?? deal.due_date,
    close_date: body.close_date ?? deal.close_date,
    expected_return: body.expected_return == null ? deal.expected_return : Number(body.expected_return),
    realized_pnl: body.realized_pnl == null ? deal.realized_pnl : Number(body.realized_pnl),
    updated_at: nowIso(),
  };
  await d1Run(db, `
    UPDATE merchant_deals
    SET title = ?, amount = ?, currency = ?, status = ?, metadata = ?, issue_date = ?, due_date = ?, close_date = ?, expected_return = ?, realized_pnl = ?, updated_at = ?
    WHERE id = ?
  `, next.title, next.amount, next.currency, next.status, next.metadata, next.issue_date, next.due_date, next.close_date, next.expected_return, next.realized_pnl, next.updated_at, dealId);
  const updated = await d1First(db, `SELECT * FROM merchant_deals WHERE id = ? LIMIT 1`, dealId);
  return json(request, env, { ok: true, deal: { ...updated, metadata: safeJsonParse(updated.metadata, {}) } });
}
if (method === "POST" && path.match(/^\/deals\/[^/]+\/submit-settlement$/)) {
  const dealId = path.split("/")[2];
  const deal = await d1First(db, `SELECT * FROM merchant_deals WHERE id = ? LIMIT 1`, dealId);
  if (!deal) return bad(request, env, "Deal not found", 404);
  const rel = await assertRelationshipAccess(db, deal.relationship_id, user.userId);
  const myProfile = await getMyProfile(db, user.userId);
  const counterparty = await counterpartyProfile(db, rel, user.userId);
  const body = await readJson(request);
  const amount = Number(body.amount || 0);
  if (!(amount > 0)) return bad(request, env, "Settlement amount must be greater than zero");
  const settlementId = randomId("set_");
  await d1Run(db, `
    INSERT INTO merchant_settlements
      (id, relationship_id, deal_id, submitted_by_user_id, amount, currency, note, status, submitted_at, approved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    settlementId, deal.relationship_id, deal.id, user.userId, amount, String(body.currency || deal.currency || "USDT"),
    String(body.note || "").trim(), "pending", nowIso(), null, nowIso(), nowIso()
  );
  const approvalId = randomId("apr_");
  await d1Run(db, `
    INSERT INTO merchant_approvals
      (id, relationship_id, type, target_entity_type, target_entity_id, proposed_payload, status, submitted_by_user_id, submitted_by_merchant_id, reviewer_user_id, resolution_note, submitted_at, resolved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    approvalId, deal.relationship_id, "settlement_submit", "settlement", settlementId,
    JSON.stringify({ deal_id: deal.id, amount, currency: String(body.currency || deal.currency || "USDT"), note: String(body.note || "").trim() }),
    "pending", user.userId, myProfile.id, counterparty.owner_user_id, null, nowIso(), null, nowIso(), nowIso()
  );
  await createNotification(db, {
    user_id: counterparty.owner_user_id,
    relationship_id: deal.relationship_id,
    category: "approval",
    title: "Settlement approval needed",
    body: `${myProfile.display_name} submitted a settlement for ${deal.title}`,
    data: { approval_id: approvalId, deal_id: deal.id, settlement_id: settlementId },
  });
  await createSystemMessage(db, {
    relationship_id: deal.relationship_id,
    body: `${myProfile.display_name} submitted a settlement for "${deal.title}"`,
    metadata: { approval_id: approvalId, settlement_id: settlementId },
  });
  return json(request, env, { ok: true, settlement_id: settlementId, approval_id: approvalId }, 201);
}
if (method === "POST" && path.match(/^\/deals\/[^/]+\/record-profit$/)) {
  const dealId = path.split("/")[2];
  const deal = await d1First(db, `SELECT * FROM merchant_deals WHERE id = ? LIMIT 1`, dealId);
  if (!deal) return bad(request, env, "Deal not found", 404);
  const rel = await assertRelationshipAccess(db, deal.relationship_id, user.userId);
  const myProfile = await getMyProfile(db, user.userId);
  const counterparty = await counterpartyProfile(db, rel, user.userId);
  const body = await readJson(request);
  const amount = Number(body.amount || 0);
  if (!(amount > 0)) return bad(request, env, "Profit amount must be greater than zero");
  const profitId = randomId("prf_");
  await d1Run(db, `
    INSERT INTO merchant_profit_records
      (id, relationship_id, deal_id, period_key, amount, currency, note, status, submitted_by_user_id, approved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    profitId, deal.relationship_id, deal.id, String(body.period_key || nowIso().slice(0, 7)),
    amount, String(body.currency || deal.currency || "USDT"), String(body.note || "").trim(),
    "pending", user.userId, null, nowIso(), nowIso()
  );
  const approvalId = randomId("apr_");
  await d1Run(db, `
    INSERT INTO merchant_approvals
      (id, relationship_id, type, target_entity_type, target_entity_id, proposed_payload, status, submitted_by_user_id, submitted_by_merchant_id, reviewer_user_id, resolution_note, submitted_at, resolved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    approvalId, deal.relationship_id, "profit_record_submit", "profit_record", profitId,
    JSON.stringify({ deal_id: deal.id, amount, period_key: String(body.period_key || nowIso().slice(0, 7)), note: String(body.note || "").trim() }),
    "pending", user.userId, myProfile.id, counterparty.owner_user_id, null, nowIso(), null, nowIso(), nowIso()
  );
  await createNotification(db, {
    user_id: counterparty.owner_user_id,
    relationship_id: deal.relationship_id,
    category: "approval",
    title: "Profit record approval needed",
    body: `${myProfile.display_name} recorded profit for ${deal.title}`,
    data: { approval_id: approvalId, deal_id: deal.id, profit_id: profitId },
  });
  return json(request, env, { ok: true, profit_id: profitId, approval_id: approvalId }, 201);
}
if (method === "POST" && path.match(/^\/deals\/[^/]+\/close$/)) {
  const dealId = path.split("/")[2];
  const deal = await d1First(db, `SELECT * FROM merchant_deals WHERE id = ? LIMIT 1`, dealId);
  if (!deal) return bad(request, env, "Deal not found", 404);
  const rel = await assertRelationshipAccess(db, deal.relationship_id, user.userId);
  const myProfile = await getMyProfile(db, user.userId);
  const counterparty = await counterpartyProfile(db, rel, user.userId);
  const body = await readJson(request);
  const approvalId = randomId("apr_");
  await d1Run(db, `
    INSERT INTO merchant_approvals
      (id, relationship_id, type, target_entity_type, target_entity_id, proposed_payload, status, submitted_by_user_id, submitted_by_merchant_id, reviewer_user_id, resolution_note, submitted_at, resolved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    approvalId, deal.relationship_id, "deal_close", "deal", deal.id,
    JSON.stringify({ close_date: String(body.close_date || nowIso().slice(0, 10)), note: String(body.note || "").trim() }),
    "pending", user.userId, myProfile.id, counterparty.owner_user_id, null, nowIso(), null, nowIso(), nowIso()
  );
  await createNotification(db, {
    user_id: counterparty.owner_user_id,
    relationship_id: deal.relationship_id,
    category: "approval",
    title: "Deal close approval needed",
    body: `${myProfile.display_name} requested to close ${deal.title}`,
    data: { approval_id: approvalId, deal_id: deal.id },
  });
  await createSystemMessage(db, {
    relationship_id: deal.relationship_id,
    body: `${myProfile.display_name} requested to close "${deal.title}"`,
    metadata: { approval_id: approvalId, deal_id: deal.id },
  });
  return json(request, env, { ok: true, approval_id: approvalId }, 201);
}


    // Messages
    if (method === "GET" && path.match(/^\/messages\/[^/]+\/messages$/)) {
      const relId = path.split("/")[2];
      await assertRelationshipAccess(db, relId, user.userId);
      const rows = await d1All(db, `
        SELECT m.*,
               CASE WHEN mr.id IS NOT NULL THEN 1 ELSE 0 END AS is_read
        FROM merchant_messages m
        LEFT JOIN merchant_message_reads mr ON mr.message_id = m.id AND mr.user_id = ?
        WHERE m.relationship_id = ?
        ORDER BY m.created_at ASC
      `, user.userId, relId);
      return json(request, env, { messages: rows.map(r => ({ ...r, metadata: safeJsonParse(r.metadata, {}), is_read: !!r.is_read })) });
    }
    if (method === "POST" && path.match(/^\/messages\/[^/]+\/messages$/)) {
      const relId = path.split("/")[2];
      const rel = await assertRelationshipAccess(db, relId, user.userId);
      const myProfile = await getMyProfile(db, user.userId);
      const counterparty = await counterpartyProfile(db, rel, user.userId);
      const body = await readJson(request);
      const text = String(body.body || "").trim();
      if (!text) return bad(request, env, "Message body is required");
      const row = {
        id: randomId("msg_"),
        relationship_id: relId,
        sender_user_id: user.userId,
        sender_merchant_id: myProfile.id,
        body: text,
        message_type: String(body.message_type || "text"),
        metadata: JSON.stringify(body.metadata || {}),
        created_at: nowIso(),
      };
      await d1Run(db, `
        INSERT INTO merchant_messages
          (id, relationship_id, sender_user_id, sender_merchant_id, body, message_type, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, row.id, row.relationship_id, row.sender_user_id, row.sender_merchant_id, row.body, row.message_type, row.metadata, row.created_at);
      await createNotification(db, {
        user_id: counterparty.owner_user_id,
        relationship_id: relId,
        category: "message",
        title: "New relationship message",
        body: `${myProfile.display_name}: ${text.slice(0, 80)}`,
        data: { relationship_id: relId, message_id: row.id },
      });
      return json(request, env, { ok: true, message: { ...row, metadata: safeJsonParse(row.metadata, {}) } }, 201);
    }
    if (method === "POST" && path.match(/^\/messages\/mark-read\/[^/]+$/)) {
      const messageId = path.split("/")[3];
      const message = await d1First(db, `SELECT * FROM merchant_messages WHERE id = ? LIMIT 1`, messageId);
      if (!message) return bad(request, env, "Message not found", 404);
      await assertRelationshipAccess(db, message.relationship_id, user.userId);
      await d1Run(db, `
        INSERT OR REPLACE INTO merchant_message_reads (id, message_id, user_id, read_at)
        VALUES (?, ?, ?, ?)
      `, randomId("mr_"), messageId, user.userId, nowIso());
      return json(request, env, { ok: true });
    }

    // Approvals
    if (method === "GET" && path === "/approvals/inbox") {
      const rows = await d1All(db, `
        SELECT a.*
        FROM merchant_approvals a
        WHERE a.reviewer_user_id = ?
        ORDER BY a.submitted_at DESC
      `, user.userId);
      return json(request, env, { approvals: rows.map(r => ({ ...r, proposed_payload: safeJsonParse(r.proposed_payload, {}) })) });
    }
    if (method === "GET" && path === "/approvals/sent") {
      const rows = await d1All(db, `
        SELECT a.*
        FROM merchant_approvals a
        WHERE a.submitted_by_user_id = ?
        ORDER BY a.submitted_at DESC
      `, user.userId);
      return json(request, env, { approvals: rows.map(r => ({ ...r, proposed_payload: safeJsonParse(r.proposed_payload, {}) })) });
    }
    if (method === "POST" && path.match(/^\/approvals\/[^/]+\/approve$/)) {
      const approvalId = path.split("/")[2];
      const approval = await d1First(db, `SELECT * FROM merchant_approvals WHERE id = ? LIMIT 1`, approvalId);
      if (!approval) return bad(request, env, "Approval not found", 404);
      if (approval.reviewer_user_id !== user.userId) return bad(request, env, "Forbidden", 403);
      if (approval.status !== "pending") return bad(request, env, `Approval is ${approval.status}`, 409);
      const body = await readJson(request);
      const note = String(body.note || "").trim();
      const payload = safeJsonParse(approval.proposed_payload, {});
      await d1Run(db, `
        UPDATE merchant_approvals
        SET status = 'approved', resolution_note = ?, resolved_at = ?, updated_at = ?
        WHERE id = ?
      `, note, nowIso(), nowIso(), approvalId);

      if (approval.type === "settlement_submit") {
        await d1Run(db, `UPDATE merchant_settlements SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ?`, nowIso(), nowIso(), approval.target_entity_id);
        await d1Run(db, `UPDATE merchant_deals SET status = 'settled', updated_at = ? WHERE id = ?`, nowIso(), payload.deal_id);
      } else if (approval.type === "profit_record_submit") {
        await d1Run(db, `UPDATE merchant_profit_records SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ?`, nowIso(), nowIso(), approval.target_entity_id);
      } else if (approval.type === "deal_close") {
        await d1Run(db, `UPDATE merchant_deals SET status = 'closed', close_date = ?, updated_at = ? WHERE id = ?`, payload.close_date || nowIso().slice(0, 10), nowIso(), approval.target_entity_id);
      } else if (approval.type === "relationship_suspend") {
        await d1Run(db, `UPDATE merchant_relationships SET status = 'suspended', updated_at = ? WHERE id = ?`, nowIso(), approval.target_entity_id);
      } else if (approval.type === "relationship_terminate") {
        await d1Run(db, `UPDATE merchant_relationships SET status = 'terminated', updated_at = ? WHERE id = ?`, nowIso(), approval.target_entity_id);
      } else if (approval.type === "capital_adjustment") {
        const deal = await d1First(db, `SELECT * FROM merchant_deals WHERE id = ? LIMIT 1`, payload.deal_id);
        if (deal) {
          const meta = safeJsonParse(deal.metadata, {});
          meta.capital_adjustment = payload;
          await d1Run(db, `UPDATE merchant_deals SET metadata = ?, updated_at = ? WHERE id = ?`, JSON.stringify(meta), nowIso(), deal.id);
        }
      }

      await createAudit(db, {
        relationship_id: approval.relationship_id,
        actor_user_id: user.userId,
        entity_type: "merchant_approval",
        entity_id: approval.id,
        action: "approval_approved",
        detail: { type: approval.type, note },
      });
      await createNotification(db, {
        user_id: approval.submitted_by_user_id,
        relationship_id: approval.relationship_id,
        category: "approval",
        title: "Approval granted",
        body: `${approval.type.replace(/_/g, " ")} was approved`,
        data: { approval_id: approval.id, type: approval.type },
      });
      await createSystemMessage(db, {
        relationship_id: approval.relationship_id,
        body: `Approval granted, ${approval.type.replace(/_/g, " ")}`,
        metadata: { approval_id: approval.id, note },
      });
      return json(request, env, { ok: true });
    }
    if (method === "POST" && path.match(/^\/approvals\/[^/]+\/reject$/)) {
      const approvalId = path.split("/")[2];
      const approval = await d1First(db, `SELECT * FROM merchant_approvals WHERE id = ? LIMIT 1`, approvalId);
      if (!approval) return bad(request, env, "Approval not found", 404);
      if (approval.reviewer_user_id !== user.userId) return bad(request, env, "Forbidden", 403);
      if (approval.status !== "pending") return bad(request, env, `Approval is ${approval.status}`, 409);
      const body = await readJson(request);
      const note = String(body.note || "").trim();
      await d1Run(db, `
        UPDATE merchant_approvals
        SET status = 'rejected', resolution_note = ?, resolved_at = ?, updated_at = ?
        WHERE id = ?
      `, note, nowIso(), nowIso(), approvalId);
      if (approval.type === "settlement_submit") {
        await d1Run(db, `UPDATE merchant_settlements SET status = 'rejected', updated_at = ? WHERE id = ?`, nowIso(), approval.target_entity_id);
      }
      if (approval.type === "profit_record_submit") {
        await d1Run(db, `UPDATE merchant_profit_records SET status = 'rejected', updated_at = ? WHERE id = ?`, nowIso(), approval.target_entity_id);
      }
      await createAudit(db, {
        relationship_id: approval.relationship_id,
        actor_user_id: user.userId,
        entity_type: "merchant_approval",
        entity_id: approval.id,
        action: "approval_rejected",
        detail: { type: approval.type, note },
      });
      await createNotification(db, {
        user_id: approval.submitted_by_user_id,
        relationship_id: approval.relationship_id,
        category: "approval",
        title: "Approval rejected",
        body: `${approval.type.replace(/_/g, " ")} was rejected`,
        data: { approval_id: approval.id, type: approval.type, note },
      });
      await createSystemMessage(db, {
        relationship_id: approval.relationship_id,
        body: `Approval rejected, ${approval.type.replace(/_/g, " ")}`,
        metadata: { approval_id: approval.id, note },
      });
      return json(request, env, { ok: true });
    }

    // Audit
    if (method === "GET" && path.match(/^\/audit\/relationship\/[^/]+$/)) {
      const relId = path.split("/")[3];
      await assertRelationshipAccess(db, relId, user.userId);
      const logs = await d1All(db, `
        SELECT *
        FROM merchant_audit_logs
        WHERE relationship_id = ?
        ORDER BY created_at DESC
        LIMIT 200
      `, relId);
      return json(request, env, { logs: logs.map(r => ({ ...r, detail_json: safeJsonParse(r.detail_json, {}) })) });
    }
    if (method === "GET" && path === "/audit/activity") {
      const myProfile = await getMyProfile(db, user.userId);
      if (!myProfile) return json(request, env, { logs: [] });
      const logs = await d1All(db, `
        SELECT *
        FROM merchant_audit_logs
        WHERE actor_user_id = ? OR actor_merchant_id = ?
        ORDER BY created_at DESC
        LIMIT 200
      `, user.userId, myProfile.id);
      return json(request, env, { logs: logs.map(r => ({ ...r, detail_json: safeJsonParse(r.detail_json, {}) })) });
    }

    // Notifications
    if (method === "GET" && path === "/notifications") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
      const unread = String(url.searchParams.get("unread") || "").toLowerCase();
      const rows = (unread === "true" || unread === "1")
        ? await d1All(db, `SELECT * FROM merchant_notifications WHERE user_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT ?`, user.userId, limit)
        : await d1All(db, `SELECT * FROM merchant_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, user.userId, limit);
      return json(request, env, { notifications: rows.map(r => ({ ...r, data_json: safeJsonParse(r.data_json, {}) })) });
    }
    if (method === "GET" && path === "/notifications/count") {
      const row = await d1First(db, `SELECT COUNT(*) AS c FROM merchant_notifications WHERE user_id = ? AND read_at IS NULL`, user.userId);
      return json(request, env, { unread: Number(row?.c || 0) });
    }
    if (method === "POST" && path.match(/^\/notifications\/[^/]+\/read$/)) {
      const id = path.split("/")[2];
      await d1Run(db, `UPDATE merchant_notifications SET read_at = ? WHERE id = ? AND user_id = ?`, nowIso(), id, user.userId);
      return json(request, env, { ok: true });
    }
    if (method === "POST" && path === "/notifications/read-all") {
      await d1Run(db, `UPDATE merchant_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`, nowIso(), user.userId);
      return json(request, env, { ok: true });
    }

    return bad(request, env, "Not found", 404);
  } catch (err) {
    return bad(request, env, err.message || "Merchant API error", /Forbidden/.test(err.message || "") ? 403 : 500);
  }
}


async function fetchSide(tradeType) {
  const body = JSON.stringify({
    page: 1,
    rows: 10,
    payTypes: [],
    publisherType: null,
    asset: "USDT",
    tradeType,
    fiat: "QAR",
    merchantCheck: false,
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
function parseSide(data, side) {
  const offers = (data || [])
    .map(r => ({
      price: parseFloat(r?.adv?.price) || 0,
      min: parseFloat(r?.adv?.minSingleTransAmount) || 0,
      max: parseFloat(r?.adv?.dynamicMaxSingleTransAmount ?? r?.adv?.maxSingleTransAmount) || 0,
      nick: String(r?.advertiser?.nickName || ""),
      methods: (r?.adv?.tradeMethods || []).map(x => x.tradeMethodName).filter(Boolean),
      available: parseFloat(r?.adv?.tradableQuantity || r?.adv?.surplusAmount || 0),
    }))
    .filter(o => o.price > 0);
  const sorted = offers.slice().sort((a, b) => side === "sell" ? b.price - a.price : a.price - b.price);
  const top5 = sorted.slice(0, 5);
  const avg = top5.length ? top5.reduce((s, x) => s + x.price, 0) / top5.length : null;
  const best = sorted[0]?.price || null;
  const depth = top5.reduce((s, x) => {
    return side === "sell"
      ? s + Math.min(x.max, x.available > 0 ? x.available * x.price : x.max)
      : s + Math.min(x.max / (x.price || 1), x.available > 0 ? x.available : x.max / (x.price || 1));
  }, 0);
  return { avg, best, depth, offers };
}
async function pollAndStore(env) {
  const [buyRaw, sellRaw] = await Promise.all([fetchSide("BUY"), fetchSide("SELL")]);
  const sellSide = parseSide(buyRaw, "sell");
  const buySide = parseSide(sellRaw, "buy");
  const ts = Date.now();
  const spread = sellSide.avg && buySide.avg ? sellSide.avg - buySide.avg : null;
  const spreadPct = spread && buySide.avg ? (spread / buySide.avg) * 100 : null;
  const snapshot = {
    ts,
    sellAvg: sellSide.avg,
    buyAvg: buySide.avg,
    bestSell: sellSide.best,
    bestBuy: buySide.best,
    sellDepth: sellSide.depth,
    buyDepth: buySide.depth,
    spread,
    spreadPct,
    sellOffers: sellSide.offers,
    buyOffers: buySide.offers,
  };
  if (!env.P2P_KV) return { snapshot, history: [], day: null };
  await env.P2P_KV.put("p2p:latest", JSON.stringify(snapshot), { expirationTtl: 3600 });
  let history = [];
  try {
    const raw = await env.P2P_KV.get("p2p:history");
    if (raw) history = JSON.parse(raw);
    if (!Array.isArray(history)) history = [];
  } catch {}
  history.push({ ts, sellAvg: sellSide.avg, buyAvg: buySide.avg, spread, spreadPct });
  if (history.length > 720) history = history.slice(-720);
  await env.P2P_KV.put("p2p:history", JSON.stringify(history), { expirationTtl: 90000 });
  const today = new Date(ts).toISOString().slice(0, 10);
  let day = { date: today, highSell: 0, lowSell: null, highBuy: 0, lowBuy: null, polls: 0 };
  try {
    const raw = await env.P2P_KV.get(`p2p:day:${today}`);
    if (raw) day = JSON.parse(raw);
  } catch {}
  if (sellSide.avg) {
    day.highSell = Math.max(day.highSell || 0, sellSide.avg);
    day.lowSell = day.lowSell === null ? sellSide.avg : Math.min(day.lowSell, sellSide.avg);
  }
  if (buySide.avg) {
    day.highBuy = Math.max(day.highBuy || 0, buySide.avg);
    day.lowBuy = day.lowBuy === null ? buySide.avg : Math.min(day.lowBuy, buySide.avg);
  }
  day.polls = Number(day.polls || 0) + 1;
  await env.P2P_KV.put(`p2p:day:${today}`, JSON.stringify(day), { expirationTtl: 172800 });
  return { snapshot, history, day };
}
async function handleP2P(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/p2p" || url.pathname === "/") {
    try {
      if (!env.P2P_KV) {
        const fresh = await pollAndStore(env);
        return json(request, env, { ...fresh.snapshot, history: fresh.history, dayStats: fresh.day, source: "fresh-no-kv" });
      }
      const [latestRaw, historyRaw] = await Promise.all([env.P2P_KV.get("p2p:latest"), env.P2P_KV.get("p2p:history")]);
      const history = historyRaw ? JSON.parse(historyRaw) : [];
      if (!latestRaw) {
        const fresh = await pollAndStore(env);
        return json(request, env, { ...fresh.snapshot, history, dayStats: fresh.day, source: "fresh" });
      }
      const latest = JSON.parse(latestRaw);
      const today = new Date().toISOString().slice(0, 10);
      const dayRaw = await env.P2P_KV.get(`p2p:day:${today}`);
      const dayStats = dayRaw ? JSON.parse(dayRaw) : null;
      return json(request, env, { ...latest, history, dayStats, ageMs: Date.now() - latest.ts, source: "cache" });
    } catch (err) {
      return bad(request, env, err.message || "P2P error", 502);
    }
  }
  if (url.pathname === "/api/history") {
    try {
      const raw = env.P2P_KV ? await env.P2P_KV.get("p2p:history") : null;
      const history = raw ? JSON.parse(raw) : [];
      return json(request, env, { history, count: history.length });
    } catch (err) {
      return bad(request, env, err.message || "History error", 500);
    }
  }
  if (url.pathname === "/api/status") {
    try {
      const raw = env.P2P_KV ? await env.P2P_KV.get("p2p:latest") : null;
      const latest = raw ? JSON.parse(raw) : null;
      const today = new Date().toISOString().slice(0, 10);
      const dayRaw = env.P2P_KV ? await env.P2P_KV.get(`p2p:day:${today}`) : null;
      const day = dayRaw ? JSON.parse(dayRaw) : null;
      return json(request, env, {
        ok: !!latest,
        lastUpdate: latest?.ts || null,
        ageMs: latest ? Date.now() - latest.ts : null,
        sellAvg: latest?.sellAvg || null,
        buyAvg: latest?.buyAvg || null,
        pollsToday: day?.polls || 0,
      });
    } catch (err) {
      return bad(request, env, err.message || "Status error", 500);
    }
  }
  return null;
}

export default {
  async scheduled(_event, env, ctx) {
    if (!env.P2P_KV) return;
    ctx.waitUntil(pollAndStore(env).catch(err => console.error("[worker] poll failed:", err.message)));
  },
  async fetch(request, env, _ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/merchant")) {
      return handleMerchant(request, env);
    }
    const p2p = await handleP2P(request, env);
    if (p2p) return p2p;
    return bad(request, env, "Not found", 404);
  },
};
