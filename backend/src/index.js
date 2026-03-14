
const BINANCE = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
const JWKS_CACHE = new Map();
const JWKS_TTL_MS = 60 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
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
  if (!txt) return {};
  try {
    return JSON.parse(txt);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function requireStringField(body, field, { min = 1, max = 500 } = {}) {
  const v = String(body?.[field] ?? '').trim();
  if (v.length < min) throw new HttpError(400, `${field} is required`);
  if (v.length > max) throw new HttpError(400, `${field} is too long (max ${max})`);
  return v;
}
function optionalStringField(body, field, { max = 2000, fallback = '' } = {}) {
  const raw = body?.[field];
  if (raw == null) return fallback;
  const v = String(raw).trim();
  if (v.length > max) throw new HttpError(400, `${field} is too long (max ${max})`);
  return v;
}
function requirePositiveNumberField(body, field) {
  const n = Number(body?.[field]);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, `${field} must be greater than zero`);
  return n;
}
function optionalNumberField(body, field, fallback = null) {
  if (body?.[field] == null) return fallback;
  const n = Number(body[field]);
  if (!Number.isFinite(n)) throw new HttpError(400, `${field} must be a valid number`);
  return n;
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
async function ensureSchemaMigrationsTable(db) {
  await d1Run(db, `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}
async function listSchemaMigrations(db) {
  await ensureSchemaMigrationsTable(db);
  return await d1All(
    db,
    `SELECT id, version, description, applied_at FROM schema_migrations ORDER BY id ASC`
  );
}

function isWriteMethod(method) {
  const m = String(method || '').toUpperCase();
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
}
function getCloudflareAccessActor(request) {
  const email = normalizeEmail(request.headers.get('cf-access-authenticated-user-email'));
  if (email) return { actor: email, source: 'cf-access-authenticated-user-email' };

  const userId = String(request.headers.get('cf-access-authenticated-user-id') || '').trim();
  if (userId) return { actor: userId, source: 'cf-access-authenticated-user-id' };

  const serviceTokenId = String(request.headers.get('cf-access-service-token-id') || '').trim();
  if (serviceTokenId) return { actor: `service-token:${serviceTokenId}`, source: 'cf-access-service-token-id' };

  const serviceTokenName = String(request.headers.get('cf-access-service-token-name') || '').trim();
  if (serviceTokenName) return { actor: `service-token:${serviceTokenName}`, source: 'cf-access-service-token-name' };

  const clientId = String(request.headers.get('cf-access-client-id') || '').trim();
  if (clientId) return { actor: `service-token-client:${clientId}`, source: 'cf-access-client-id' };

  const jwtAssertion = String(request.headers.get('cf-access-jwt-assertion') || '').trim();
  if (jwtAssertion) return { actor: 'cf-access-jwt', source: 'cf-access-jwt-assertion' };

  return null;
}
function resolveWriteAuth(request, env) {
  const enabled = String(env.AUTH_SOURCE || '').trim().toLowerCase() === 'cloudflare-access';
  if (!enabled) {
    return { ok: true, actor: 'auth-disabled', mode: 'off' };
  }
  const actor = getCloudflareAccessActor(request);
  if (!actor) {
    return {
      ok: false,
      mode: 'cloudflare-access',
      actor: 'anonymous',
      response: bad(request, env, 'Unauthorized: missing Cloudflare Access identity headers (expected one of cf-access-authenticated-user-*, cf-access-service-token-*, cf-access-client-id, cf-access-jwt-assertion)', 401),
    };
  }
  return { ok: true, actor: actor.actor, mode: 'cloudflare-access', source: actor.source };
}
function auditWrite(request, meta = {}) {
  const payload = {
    type: 'mutation_audit',
    method: request.method,
    path: new URL(request.url).pathname,
    actor: meta.actor || 'unknown',
    auth_mode: meta.mode || 'unknown',
    auth_source: meta.source || null,
    status: meta.status ?? null,
    outcome: meta.outcome || 'unknown',
    at: nowIso(),
  };
  if (meta.error) payload.error = String(meta.error);
  console.log(JSON.stringify(payload));
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
      const body = asPlainObject(await readJson(request));
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
      const body = asPlainObject(await readJson(request));
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
  const body = asPlainObject(await readJson(request));
  const relId = requireStringField(body, "relationship_id", { min: 3, max: 120 });
  const rel = await assertRelationshipAccess(db, relId, user.userId);
  const myProfile = await getMyProfile(db, user.userId);
  const payload = {
    id: randomId("deal_"),
    relationship_id: relId,
    deal_type: String(body.deal_type || "general"),
    title: requireStringField(body, "title", { min: 3, max: 160 }),
    amount: requirePositiveNumberField(body, "amount"),
    currency: String(body.currency || "USDT"),
    status: String(body.status || "draft"),
    metadata: JSON.stringify(asPlainObject(body.metadata)),
    issue_date: body.issue_date || nowIso().slice(0, 10),
    due_date: body.due_date || null,
    close_date: null,
    expected_return: body.expected_return == null ? null : Number(body.expected_return),
    realized_pnl: body.realized_pnl == null ? null : Number(body.realized_pnl),
    created_by: user.userId,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
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
    title: body.title == null ? String(deal.title || "").trim() : requireStringField(body, "title", { min: 3, max: 160 }),
    amount: body.amount == null ? Number(deal.amount || 0) : requirePositiveNumberField(body, "amount"),
    currency: String(body.currency ?? deal.currency),
    status: String(body.status ?? deal.status),
    metadata: JSON.stringify(body.metadata == null ? safeJsonParse(deal.metadata, {}) : asPlainObject(body.metadata)),
    issue_date: body.issue_date ?? deal.issue_date,
    due_date: body.due_date ?? deal.due_date,
    close_date: body.close_date ?? deal.close_date,
    expected_return: optionalNumberField(body, "expected_return", deal.expected_return),
    realized_pnl: optionalNumberField(body, "realized_pnl", deal.realized_pnl),
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
  const body = asPlainObject(await readJson(request));
  const amount = requirePositiveNumberField(body, "amount");
  const settlementId = randomId("set_");
  await d1Run(db, `
    INSERT INTO merchant_settlements
      (id, relationship_id, deal_id, submitted_by_user_id, amount, currency, note, status, submitted_at, approved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    settlementId, deal.relationship_id, deal.id, user.userId, amount, optionalStringField(body, "currency", { max: 12, fallback: String(deal.currency || "USDT") }),
    optionalStringField(body, "note", { max: 1000, fallback: "" }), "pending", nowIso(), null, nowIso(), nowIso()
  );
  const approvalId = randomId("apr_");
  await d1Run(db, `
    INSERT INTO merchant_approvals
      (id, relationship_id, type, target_entity_type, target_entity_id, proposed_payload, status, submitted_by_user_id, submitted_by_merchant_id, reviewer_user_id, resolution_note, submitted_at, resolved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    approvalId, deal.relationship_id, "settlement_submit", "settlement", settlementId,
    JSON.stringify({ deal_id: deal.id, amount, currency: optionalStringField(body, "currency", { max: 12, fallback: String(deal.currency || "USDT") }), note: optionalStringField(body, "note", { max: 1000, fallback: "" }) }),
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
  const body = asPlainObject(await readJson(request));
  const amount = requirePositiveNumberField(body, "amount");
  const profitId = randomId("prf_");
  await d1Run(db, `
    INSERT INTO merchant_profit_records
      (id, relationship_id, deal_id, period_key, amount, currency, note, status, submitted_by_user_id, approved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    profitId, deal.relationship_id, deal.id, optionalStringField(body, "period_key", { max: 20, fallback: nowIso().slice(0, 7) }),
    amount, optionalStringField(body, "currency", { max: 12, fallback: String(deal.currency || "USDT") }), optionalStringField(body, "note", { max: 1000, fallback: "" }),
    "pending", user.userId, null, nowIso(), nowIso()
  );
  const approvalId = randomId("apr_");
  await d1Run(db, `
    INSERT INTO merchant_approvals
      (id, relationship_id, type, target_entity_type, target_entity_id, proposed_payload, status, submitted_by_user_id, submitted_by_merchant_id, reviewer_user_id, resolution_note, submitted_at, resolved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    approvalId, deal.relationship_id, "profit_record_submit", "profit_record", profitId,
    JSON.stringify({ deal_id: deal.id, amount, period_key: optionalStringField(body, "period_key", { max: 20, fallback: nowIso().slice(0, 7) }), note: optionalStringField(body, "note", { max: 1000, fallback: "" }) }),
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
    JSON.stringify({ close_date: optionalStringField(body, "close_date", { max: 20, fallback: nowIso().slice(0, 10) }), note: optionalStringField(body, "note", { max: 1000, fallback: "" }) }),
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
      const body = asPlainObject(await readJson(request));
      const text = requireStringField(body, "body", { min: 1, max: 2000 });
      const row = {
        id: randomId("msg_"),
        relationship_id: relId,
        sender_user_id: user.userId,
        sender_merchant_id: myProfile.id,
        body: text,
        message_type: String(body.message_type || "text"),
        metadata: JSON.stringify(asPlainObject(body.metadata)),
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
    const status = Number(err?.status) || (/Forbidden/.test(err?.message || "") ? 403 : 500);
    return bad(request, env, err?.message || "Merchant API error", status);
  }
}



async function ensureImportBridgeTables(db) {
  await d1Run(db, `
    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      actor_user_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      totals_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Phase 3 bridge currently imports into trading domain tables.
  // Keep these CREATE IF NOT EXISTS guards so import can run even before 002 is explicitly applied.
  await d1Run(db, `
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      asset_symbol TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await d1Run(db, `
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      asset_symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
      traded_at TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit_price REAL NOT NULL CHECK (unit_price >= 0),
      fee REAL NOT NULL DEFAULT 0 CHECK (fee >= 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),
      source_batch_id TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await d1Run(db, `
    CREATE TABLE IF NOT EXISTS trade_allocations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      trade_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      allocated_qty REAL NOT NULL CHECK (allocated_qty > 0),
      batch_unit_cost REAL NOT NULL CHECK (batch_unit_cost >= 0),
      allocated_cost REAL NOT NULL CHECK (allocated_cost >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(trade_id, batch_id)
    )
  `);
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function summarizeImportPayload(payload) {
  const p = asPlainObject(payload);
  const deals = Array.isArray(p.deals) ? p.deals.length : 0;
  const trades = Array.isArray(p.trades) ? p.trades.length : 0;
  const journal = Array.isArray(p.journal) ? p.journal.length : 0;
  const settlements = Array.isArray(p.settlements) ? p.settlements.length : 0;
  const batches = Array.isArray(p.batches) ? p.batches.length : 0;
  const totalRows = deals + trades + journal + settlements + batches;
  if (totalRows <= 0) throw new HttpError(400, 'Import payload is empty');
  return { deals, trades, journal, settlements, batches, totalRows };
}

async function getTradingCounts(db, userId) {
  const [batches, trades, allocations] = await Promise.all([
    d1First(db, `SELECT COUNT(*) AS c FROM batches WHERE user_id = ?`, userId),
    d1First(db, `SELECT COUNT(*) AS c FROM trades WHERE user_id = ?`, userId),
    d1First(db, `SELECT COUNT(*) AS c FROM trade_allocations WHERE user_id = ?`, userId),
  ]);
  return {
    batches: Number(batches?.c || 0),
    trades: Number(trades?.c || 0),
    trade_allocations: Number(allocations?.c || 0),
  };
}

function parseImportBatches(payload) {
  const rows = Array.isArray(payload?.batches) ? payload.batches : [];
  return rows.map((r, idx) => {
    const row = asPlainObject(r);
    return {
      id: String(row.id || randomId('bat_imp_')).trim(),
      asset_symbol: normalizeAssetSymbol(row.asset_symbol || row.asset || 'USDT'),
      acquired_at: toIsoTimestamp(row.acquired_at || row.date || row.created_at, `batches[${idx}].acquired_at`),
      quantity: Number(row.quantity),
      unit_cost: row.unit_cost == null ? 0 : Number(row.unit_cost),
      notes: optionalStringField(row, 'notes', { max: 1000, fallback: '' }),
    };
  }).map((row, idx) => {
    if (!row.id) throw new HttpError(400, `batches[${idx}].id is required`);
    if (!Number.isFinite(row.quantity) || row.quantity <= 0) throw new HttpError(400, `batches[${idx}].quantity must be greater than zero`);
    if (!Number.isFinite(row.unit_cost) || row.unit_cost < 0) throw new HttpError(400, `batches[${idx}].unit_cost must be zero or greater`);
    return row;
  });
}

function parseImportTrades(payload) {
  const rows = Array.isArray(payload?.trades) ? payload.trades : [];
  return rows.map((r, idx) => {
    const row = asPlainObject(r);
    const side = String(row.side || '').trim().toLowerCase();
    const status = String(row.status || 'active').trim().toLowerCase();
    return {
      id: String(row.id || randomId('trd_imp_')).trim(),
      asset_symbol: normalizeAssetSymbol(row.asset_symbol || row.asset || 'USDT'),
      side,
      status,
      traded_at: toIsoTimestamp(row.traded_at || row.date || row.created_at, `trades[${idx}].traded_at`),
      quantity: Number(row.quantity),
      unit_price: row.unit_price == null ? 0 : Number(row.unit_price),
      fee: row.fee == null ? 0 : Number(row.fee),
      notes: optionalStringField(row, 'notes', { max: 1000, fallback: '' }),
    };
  }).map((row, idx) => {
    if (!row.id) throw new HttpError(400, `trades[${idx}].id is required`);
    if (!['buy', 'sell'].includes(row.side)) throw new HttpError(400, `trades[${idx}].side must be buy or sell`);
    if (!['active', 'void'].includes(row.status)) throw new HttpError(400, `trades[${idx}].status must be active or void`);
    if (!Number.isFinite(row.quantity) || row.quantity <= 0) throw new HttpError(400, `trades[${idx}].quantity must be greater than zero`);
    if (!Number.isFinite(row.unit_price) || row.unit_price < 0) throw new HttpError(400, `trades[${idx}].unit_price must be zero or greater`);
    if (!Number.isFinite(row.fee) || row.fee < 0) throw new HttpError(400, `trades[${idx}].fee must be zero or greater`);
    return row;
  });
}

async function handleImport(request, env) {
  if (!env.DB) return bad(request, env, 'D1 binding DB is not configured', 500);
  const db = env.DB;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/import/, '') || '/';
  const method = request.method.toUpperCase();

  let user;
  try {
    user = await getUserContext(request, env);
  } catch (err) {
    return bad(request, env, err.message || 'Unauthorized', 401);
  }

  try {
    await ensureImportBridgeTables(db);

    if (method === 'POST' && path === '/json') {
      const body = asPlainObject(await readJson(request));
      const idempotencyKey = requireStringField(body, 'idempotency_key', { min: 8, max: 120 });
      const totals = summarizeImportPayload(body);
      const payloadHash = await sha256Hex(JSON.stringify(body));

      const existing = await d1First(db, `SELECT id, idempotency_key, actor_user_id, payload_hash, totals_json, status, created_at, updated_at FROM import_jobs WHERE idempotency_key = ? LIMIT 1`, idempotencyKey);
      if (existing) {
        return json(request, env, {
          ok: true,
          reused: true,
          import_job: { ...existing, totals: safeJsonParse(existing.totals_json, {}) },
        });
      }

      const batches = parseImportBatches(body);
      const trades = parseImportTrades(body);
      const assetsTouched = new Set([...batches.map((b) => b.asset_symbol), ...trades.map((t) => t.asset_symbol)]);
      const before = await getTradingCounts(db, user.userId);

      for (const b of batches) {
        await d1Run(db, `
          INSERT OR REPLACE INTO batches
            (id, user_id, asset_symbol, acquired_at, quantity, unit_cost, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, b.id, user.userId, b.asset_symbol, b.acquired_at, b.quantity, b.unit_cost, b.notes, nowIso(), nowIso());
      }
      for (const t of trades) {
        await d1Run(db, `
          INSERT OR REPLACE INTO trades
            (id, user_id, asset_symbol, side, traded_at, quantity, unit_price, fee, status, source_batch_id, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, t.id, user.userId, t.asset_symbol, t.side, t.traded_at, t.quantity, t.unit_price, t.fee, t.status, null, t.notes, nowIso(), nowIso());
      }
      const fifo = [];
      for (const symbol of assetsTouched) {
        fifo.push(await recomputeFifoForAsset(db, user.userId, symbol));
      }
      const after = await getTradingCounts(db, user.userId);
      const reconciliation = {
        before,
        imported: { batches: batches.length, trades: trades.length },
        after,
        delta: {
          batches: after.batches - before.batches,
          trades: after.trades - before.trades,
          trade_allocations: after.trade_allocations - before.trade_allocations,
        },
      };

      const row = {
        id: randomId('imp_'),
        idempotency_key: idempotencyKey,
        actor_user_id: user.userId,
        payload_hash: payloadHash,
        payload_json: JSON.stringify(body),
        totals_json: JSON.stringify({ ...totals, reconciliation }),
        status: 'completed',
        created_at: nowIso(),
        updated_at: nowIso(),
      };

      await d1Run(db, `
        INSERT INTO import_jobs
          (id, idempotency_key, actor_user_id, payload_hash, payload_json, totals_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        row.id, row.idempotency_key, row.actor_user_id, row.payload_hash, row.payload_json,
        row.totals_json, row.status, row.created_at, row.updated_at
      );

      await createAudit(db, {
        actor_user_id: user.userId,
        entity_type: 'import_job',
        entity_id: row.id,
        action: 'import_json_completed',
        detail: { idempotency_key: row.idempotency_key, totals, reconciliation },
      });

      return json(request, env, {
        ok: true,
        reused: false,
        import_job: { ...row, totals: { ...totals, reconciliation } },
        reconciliation,
        fifo,
      }, 202);
    }

    if (method === 'GET' && path.match(/^\/json\/[^/]+$/)) {
      const id = path.split('/')[2];
      const row = await d1First(db, `SELECT id, idempotency_key, actor_user_id, payload_hash, totals_json, status, created_at, updated_at FROM import_jobs WHERE id = ? LIMIT 1`, id);
      if (!row) return bad(request, env, 'Import job not found', 404);
      return json(request, env, { ok: true, import_job: { ...row, totals: safeJsonParse(row.totals_json, {}) } });
    }

    return bad(request, env, 'Not found', 404);
  } catch (err) {
    const status = Number(err?.status) || 500;
    return bad(request, env, err?.message || 'Import API error', status);
  }
}



function toIsoTimestamp(value, fieldName) {
  const raw = String(value || '').trim();
  if (!raw) throw new HttpError(400, `${fieldName} is required`);
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) throw new HttpError(400, `${fieldName} must be a valid datetime`);
  return dt.toISOString();
}
function normalizeAssetSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  if (!symbol) throw new HttpError(400, 'asset_symbol is required');
  if (!/^[A-Z0-9_-]{2,15}$/.test(symbol)) throw new HttpError(400, 'asset_symbol format is invalid');
  return symbol;
}

async function recomputeFifoForAsset(db, userId, assetSymbol) {
  const batches = await d1All(db, `
    SELECT id, acquired_at, quantity, unit_cost
    FROM batches
    WHERE user_id = ? AND asset_symbol = ?
    ORDER BY acquired_at ASC, id ASC
  `, userId, assetSymbol);
  const trades = await d1All(db, `
    SELECT id, traded_at, quantity
    FROM trades
    WHERE user_id = ? AND asset_symbol = ? AND side = 'sell' AND status = 'active'
    ORDER BY traded_at ASC, id ASC
  `, userId, assetSymbol);

  await d1Run(db, `
    DELETE FROM trade_allocations
    WHERE user_id = ?
      AND trade_id IN (
        SELECT id FROM trades WHERE user_id = ? AND asset_symbol = ?
      )
  `, userId, userId, assetSymbol);

  const remaining = new Map();
  for (const b of batches) remaining.set(b.id, Number(b.quantity || 0));

  const shortages = [];
  for (const trade of trades) {
    let qtyLeft = Number(trade.quantity || 0);
    let firstBatchId = null;

    for (const batch of batches) {
      const rem = Number(remaining.get(batch.id) || 0);
      if (qtyLeft <= 0) break;
      if (rem <= 0) continue;
      const allocatedQty = Math.min(rem, qtyLeft);
      if (allocatedQty <= 0) continue;
      if (!firstBatchId) firstBatchId = batch.id;

      await d1Run(db, `
        INSERT INTO trade_allocations
          (id, user_id, trade_id, batch_id, allocated_qty, batch_unit_cost, allocated_cost, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        randomId('alloc_'),
        userId,
        trade.id,
        batch.id,
        allocatedQty,
        Number(batch.unit_cost || 0),
        allocatedQty * Number(batch.unit_cost || 0),
        nowIso(),
        nowIso()
      );

      remaining.set(batch.id, rem - allocatedQty);
      qtyLeft -= allocatedQty;
    }

    await d1Run(db, `UPDATE trades SET source_batch_id = ?, updated_at = ? WHERE id = ?`, firstBatchId, nowIso(), trade.id);

    if (qtyLeft > 0) shortages.push({ trade_id: trade.id, unallocated_qty: qtyLeft });
  }

  return {
    asset_symbol: assetSymbol,
    batches: batches.length,
    trades: trades.length,
    shortages,
  };
}

async function handleTrading(request, env) {
  if (!env.DB) return bad(request, env, 'D1 binding DB is not configured', 500);
  const db = env.DB;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  let user;
  try {
    user = await getUserContext(request, env);
  } catch (err) {
    return bad(request, env, err.message || 'Unauthorized', 401);
  }

  try {
    const batchMatch = url.pathname.match(/^\/api\/batches\/([^/]+)$/);
    const tradeMatch = url.pathname.match(/^\/api\/trades\/([^/]+)$/);
    const tradeVoidMatch = url.pathname.match(/^\/api\/trades\/([^/]+)\/void$/);

    if (method === 'GET' && url.pathname === '/api/batches') {
      const assetFilter = String(url.searchParams.get('asset_symbol') || '').trim().toUpperCase();
      const rows = assetFilter
        ? await d1All(db, `
            SELECT b.*,
              COALESCE(SUM(ta.allocated_qty), 0) AS allocated_qty,
              (b.quantity - COALESCE(SUM(ta.allocated_qty), 0)) AS remaining_qty
            FROM batches b
            LEFT JOIN trade_allocations ta ON ta.batch_id = b.id AND ta.user_id = b.user_id
            WHERE b.user_id = ? AND b.asset_symbol = ?
            GROUP BY b.id
            ORDER BY b.acquired_at ASC, b.id ASC
          `, user.userId, assetFilter)
        : await d1All(db, `
            SELECT b.*,
              COALESCE(SUM(ta.allocated_qty), 0) AS allocated_qty,
              (b.quantity - COALESCE(SUM(ta.allocated_qty), 0)) AS remaining_qty
            FROM batches b
            LEFT JOIN trade_allocations ta ON ta.batch_id = b.id AND ta.user_id = b.user_id
            WHERE b.user_id = ?
            GROUP BY b.id
            ORDER BY b.acquired_at ASC, b.id ASC
          `, user.userId);
      return json(request, env, { batches: rows });
    }

    if (method === 'POST' && url.pathname === '/api/batches') {
      const body = asPlainObject(await readJson(request));
      const row = {
        id: randomId('bat_'),
        user_id: user.userId,
        asset_symbol: normalizeAssetSymbol(body.asset_symbol),
        acquired_at: toIsoTimestamp(body.acquired_at, 'acquired_at'),
        quantity: requirePositiveNumberField(body, 'quantity'),
        unit_cost: optionalNumberField(body, 'unit_cost', 0),
        notes: optionalStringField(body, 'notes', { max: 1000, fallback: '' }),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      if (row.unit_cost < 0) throw new HttpError(400, 'unit_cost must be zero or greater');
      await d1Run(db, `
        INSERT INTO batches (id, user_id, asset_symbol, acquired_at, quantity, unit_cost, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, row.id, row.user_id, row.asset_symbol, row.acquired_at, row.quantity, row.unit_cost, row.notes, row.created_at, row.updated_at);
      const fifo = await recomputeFifoForAsset(db, user.userId, row.asset_symbol);
      return json(request, env, { ok: true, batch: row, fifo }, 201);
    }

    if ((method === 'PUT' || method === 'PATCH') && batchMatch) {
      const id = batchMatch[1];
      const existing = await d1First(db, `SELECT * FROM batches WHERE id = ? AND user_id = ? LIMIT 1`, id, user.userId);
      if (!existing) return bad(request, env, 'Batch not found', 404);
      const body = asPlainObject(await readJson(request));
      const updated = {
        asset_symbol: body.asset_symbol != null ? normalizeAssetSymbol(body.asset_symbol) : existing.asset_symbol,
        acquired_at: body.acquired_at != null ? toIsoTimestamp(body.acquired_at, 'acquired_at') : existing.acquired_at,
        quantity: body.quantity != null ? requirePositiveNumberField(body, 'quantity') : Number(existing.quantity),
        unit_cost: body.unit_cost != null ? optionalNumberField(body, 'unit_cost', 0) : Number(existing.unit_cost),
        notes: body.notes != null ? optionalStringField(body, 'notes', { max: 1000, fallback: '' }) : String(existing.notes || ''),
      };
      if (updated.unit_cost < 0) throw new HttpError(400, 'unit_cost must be zero or greater');
      await d1Run(db, `
        UPDATE batches
        SET asset_symbol = ?, acquired_at = ?, quantity = ?, unit_cost = ?, notes = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `, updated.asset_symbol, updated.acquired_at, updated.quantity, updated.unit_cost, updated.notes, nowIso(), id, user.userId);
      const fifo = await recomputeFifoForAsset(db, user.userId, updated.asset_symbol);
      if (updated.asset_symbol !== existing.asset_symbol) await recomputeFifoForAsset(db, user.userId, existing.asset_symbol);
      return json(request, env, { ok: true, batch: { ...existing, ...updated, id }, fifo });
    }

    if (method === 'DELETE' && batchMatch) {
      const id = batchMatch[1];
      const existing = await d1First(db, `SELECT * FROM batches WHERE id = ? AND user_id = ? LIMIT 1`, id, user.userId);
      if (!existing) return bad(request, env, 'Batch not found', 404);
      await d1Run(db, `DELETE FROM batches WHERE id = ? AND user_id = ?`, id, user.userId);
      const fifo = await recomputeFifoForAsset(db, user.userId, existing.asset_symbol);
      return json(request, env, { ok: true, deleted: id, fifo });
    }

    if (method === 'GET' && url.pathname === '/api/trades') {
      const rows = await d1All(db, `
        SELECT t.*,
          COALESCE(SUM(ta.allocated_qty), 0) AS allocated_qty,
          COALESCE(SUM(ta.allocated_cost), 0) AS allocated_cost
        FROM trades t
        LEFT JOIN trade_allocations ta ON ta.trade_id = t.id AND ta.user_id = t.user_id
        WHERE t.user_id = ?
        GROUP BY t.id
        ORDER BY t.traded_at ASC, t.id ASC
      `, user.userId);
      return json(request, env, { trades: rows });
    }

    if (method === 'POST' && url.pathname === '/api/trades') {
      const body = asPlainObject(await readJson(request));
      const row = {
        id: randomId('trd_'),
        user_id: user.userId,
        asset_symbol: normalizeAssetSymbol(body.asset_symbol),
        side: String(body.side || '').trim().toLowerCase(),
        traded_at: toIsoTimestamp(body.traded_at, 'traded_at'),
        quantity: requirePositiveNumberField(body, 'quantity'),
        unit_price: optionalNumberField(body, 'unit_price', 0),
        fee: optionalNumberField(body, 'fee', 0),
        status: String(body.status || 'active').trim().toLowerCase(),
        notes: optionalStringField(body, 'notes', { max: 1000, fallback: '' }),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      if (!['buy', 'sell'].includes(row.side)) throw new HttpError(400, 'side must be buy or sell');
      if (!['active', 'void'].includes(row.status)) throw new HttpError(400, 'status must be active or void');
      if (row.unit_price < 0) throw new HttpError(400, 'unit_price must be zero or greater');
      if (row.fee < 0) throw new HttpError(400, 'fee must be zero or greater');

      await d1Run(db, `
        INSERT INTO trades
          (id, user_id, asset_symbol, side, traded_at, quantity, unit_price, fee, status, source_batch_id, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        row.id, row.user_id, row.asset_symbol, row.side, row.traded_at, row.quantity, row.unit_price,
        row.fee, row.status, null, row.notes, row.created_at, row.updated_at
      );
      const fifo = await recomputeFifoForAsset(db, user.userId, row.asset_symbol);
      return json(request, env, { ok: true, trade: row, fifo }, 201);
    }

    if ((method === 'PUT' || method === 'PATCH') && tradeMatch) {
      const id = tradeMatch[1];
      const existing = await d1First(db, `SELECT * FROM trades WHERE id = ? AND user_id = ? LIMIT 1`, id, user.userId);
      if (!existing) return bad(request, env, 'Trade not found', 404);
      const body = asPlainObject(await readJson(request));
      const updated = {
        asset_symbol: body.asset_symbol != null ? normalizeAssetSymbol(body.asset_symbol) : existing.asset_symbol,
        side: body.side != null ? String(body.side).trim().toLowerCase() : existing.side,
        traded_at: body.traded_at != null ? toIsoTimestamp(body.traded_at, 'traded_at') : existing.traded_at,
        quantity: body.quantity != null ? requirePositiveNumberField(body, 'quantity') : Number(existing.quantity),
        unit_price: body.unit_price != null ? optionalNumberField(body, 'unit_price', 0) : Number(existing.unit_price),
        fee: body.fee != null ? optionalNumberField(body, 'fee', 0) : Number(existing.fee),
        status: body.status != null ? String(body.status).trim().toLowerCase() : existing.status,
        notes: body.notes != null ? optionalStringField(body, 'notes', { max: 1000, fallback: '' }) : String(existing.notes || ''),
      };
      if (!['buy', 'sell'].includes(updated.side)) throw new HttpError(400, 'side must be buy or sell');
      if (!['active', 'void'].includes(updated.status)) throw new HttpError(400, 'status must be active or void');
      if (updated.unit_price < 0) throw new HttpError(400, 'unit_price must be zero or greater');
      if (updated.fee < 0) throw new HttpError(400, 'fee must be zero or greater');

      await d1Run(db, `
        UPDATE trades
        SET asset_symbol = ?, side = ?, traded_at = ?, quantity = ?, unit_price = ?, fee = ?, status = ?, notes = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `,
        updated.asset_symbol, updated.side, updated.traded_at, updated.quantity, updated.unit_price,
        updated.fee, updated.status, updated.notes, nowIso(), id, user.userId
      );
      const fifo = await recomputeFifoForAsset(db, user.userId, updated.asset_symbol);
      if (updated.asset_symbol !== existing.asset_symbol) await recomputeFifoForAsset(db, user.userId, existing.asset_symbol);
      return json(request, env, { ok: true, trade: { ...existing, ...updated, id }, fifo });
    }

    if ((method === 'PUT' || method === 'PATCH') && tradeVoidMatch) {
      const id = tradeVoidMatch[1];
      const existing = await d1First(db, `SELECT * FROM trades WHERE id = ? AND user_id = ? LIMIT 1`, id, user.userId);
      if (!existing) return bad(request, env, 'Trade not found', 404);
      const body = asPlainObject(await readJson(request));
      const nextStatus = String(body.status || (existing.status === 'void' ? 'active' : 'void')).trim().toLowerCase();
      if (!['active', 'void'].includes(nextStatus)) throw new HttpError(400, 'status must be active or void');
      await d1Run(db, `UPDATE trades SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?`, nextStatus, nowIso(), id, user.userId);
      const fifo = await recomputeFifoForAsset(db, user.userId, existing.asset_symbol);
      return json(request, env, { ok: true, id, status: nextStatus, fifo });
    }

    if (method === 'DELETE' && tradeMatch) {
      const id = tradeMatch[1];
      const existing = await d1First(db, `SELECT * FROM trades WHERE id = ? AND user_id = ? LIMIT 1`, id, user.userId);
      if (!existing) return bad(request, env, 'Trade not found', 404);
      await d1Run(db, `DELETE FROM trades WHERE id = ? AND user_id = ?`, id, user.userId);
      const fifo = await recomputeFifoForAsset(db, user.userId, existing.asset_symbol);
      return json(request, env, { ok: true, deleted: id, fifo });
    }

    return bad(request, env, 'Not found', 404);
  } catch (err) {
    const status = Number(err?.status) || 500;
    return bad(request, env, err?.message || 'Trading API error', status);
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


async function ensurePhase5FinancialTables(db) {
  await d1Run(db, `
    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      deal_type TEXT NOT NULL,
      title TEXT NOT NULL,
      principal_amount REAL NOT NULL CHECK (principal_amount > 0),
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      due_at TEXT,
      settled_at TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await d1Run(db, `CREATE INDEX IF NOT EXISTS idx_deals_user_status_time ON deals(user_id, status, issued_at, id)`);

  await d1Run(db, `
    CREATE TABLE IF NOT EXISTS settlements (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      deal_ids_json TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      settled_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await d1Run(db, `CREATE INDEX IF NOT EXISTS idx_settlements_user_time ON settlements(user_id, settled_at, id)`);

  await d1Run(db, `
    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      debit_account TEXT,
      credit_account TEXT,
      note TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await d1Run(db, `CREATE INDEX IF NOT EXISTS idx_journal_entries_user_time ON journal_entries(user_id, created_at, id)`);
}

function normalizeCurrency(value, fieldName = 'currency') {
  const c = String(value || '').trim().toUpperCase();
  if (!c) throw new HttpError(400, `${fieldName} is required`);
  if (!/^[A-Z]{3,8}$/.test(c)) throw new HttpError(400, `${fieldName} format is invalid`);
  return c;
}

function parseDealType(value) {
  const v = String(value || '').trim().toLowerCase();
  const allowed = ['advance', 'purchase', 'profit_share', 'pool', 'general'];
  if (!allowed.includes(v)) throw new HttpError(400, `deal_type must be one of: ${allowed.join(', ')}`);
  return v;
}

function parseDealStatus(value) {
  const v = String(value || '').trim().toLowerCase();
  const allowed = ['active', 'due', 'overdue', 'settled', 'cancelled'];
  if (!allowed.includes(v)) throw new HttpError(400, `status must be one of: ${allowed.join(', ')}`);
  return v;
}

async function writeJournalEntry(db, userId, entry) {
  const row = {
    id: randomId('jrn_'),
    user_id: userId,
    entry_type: String(entry.entry_type || 'event').trim().toLowerCase(),
    ref_type: String(entry.ref_type || 'unknown').trim().toLowerCase(),
    ref_id: String(entry.ref_id || '').trim(),
    amount: Number(entry.amount || 0),
    currency: normalizeCurrency(entry.currency || 'QAR'),
    debit_account: optionalStringField(entry, 'debit_account', { max: 120, fallback: '' }),
    credit_account: optionalStringField(entry, 'credit_account', { max: 120, fallback: '' }),
    note: optionalStringField(entry, 'note', { max: 1000, fallback: '' }),
    metadata_json: JSON.stringify(asPlainObject(entry.metadata)),
    created_at: nowIso(),
  };
  if (!row.ref_id) throw new HttpError(400, 'Journal ref_id is required');
  if (!Number.isFinite(row.amount)) throw new HttpError(400, 'Journal amount must be a valid number');

  await d1Run(db, `
    INSERT INTO journal_entries
      (id, user_id, entry_type, ref_type, ref_id, amount, currency, debit_account, credit_account, note, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, row.id, row.user_id, row.entry_type, row.ref_type, row.ref_id, row.amount, row.currency, row.debit_account, row.credit_account, row.note, row.metadata_json, row.created_at);
  return row;
}

async function handleFinancials(request, env) {
  if (!env.DB) return bad(request, env, 'D1 binding DB is not configured', 500);
  const db = env.DB;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  let user;
  try {
    user = await getUserContext(request, env);
  } catch (err) {
    return bad(request, env, err.message || 'Unauthorized', 401);
  }

  try {
    await ensurePhase5FinancialTables(db);

    const dealByIdMatch = url.pathname.match(/^\/api\/deals\/([^/]+)$/);
    const dealSettleMatch = url.pathname.match(/^\/api\/deals\/([^/]+)\/settle$/);
    const settlementByIdMatch = url.pathname.match(/^\/api\/settlements\/([^/]+)$/);

    if (method === 'GET' && url.pathname === '/api/deals') {
      const status = String(url.searchParams.get('status') || '').trim().toLowerCase();
      const dealType = String(url.searchParams.get('deal_type') || '').trim().toLowerCase();
      let rows;
      if (status && dealType) {
        rows = await d1All(db, `SELECT * FROM deals WHERE user_id = ? AND status = ? AND deal_type = ? ORDER BY issued_at DESC, id DESC`, user.userId, status, dealType);
      } else if (status) {
        rows = await d1All(db, `SELECT * FROM deals WHERE user_id = ? AND status = ? ORDER BY issued_at DESC, id DESC`, user.userId, status);
      } else if (dealType) {
        rows = await d1All(db, `SELECT * FROM deals WHERE user_id = ? AND deal_type = ? ORDER BY issued_at DESC, id DESC`, user.userId, dealType);
      } else {
        rows = await d1All(db, `SELECT * FROM deals WHERE user_id = ? ORDER BY issued_at DESC, id DESC`, user.userId);
      }
      return json(request, env, { deals: rows.map(r => ({ ...r, metadata: safeJsonParse(r.metadata_json, {}) })) });
    }

    if (method === 'POST' && url.pathname === '/api/deals') {
      const body = asPlainObject(await readJson(request));
      const row = {
        id: randomId('deal_'),
        user_id: user.userId,
        deal_type: parseDealType(body.deal_type || 'general'),
        title: requireStringField(body, 'title', { min: 3, max: 160 }),
        principal_amount: requirePositiveNumberField(body, 'principal_amount'),
        currency: normalizeCurrency(body.currency || 'QAR'),
        status: parseDealStatus(String(body.status || 'active')),
        issued_at: toIsoTimestamp(body.issued_at || nowIso(), 'issued_at'),
        due_at: body.due_at ? toIsoTimestamp(body.due_at, 'due_at') : null,
        settled_at: null,
        metadata_json: JSON.stringify(asPlainObject(body.metadata)),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      await d1Run(db, `
        INSERT INTO deals
          (id, user_id, deal_type, title, principal_amount, currency, status, issued_at, due_at, settled_at, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, row.id, row.user_id, row.deal_type, row.title, row.principal_amount, row.currency, row.status, row.issued_at, row.due_at, row.settled_at, row.metadata_json, row.created_at, row.updated_at);

      const journal = await writeJournalEntry(db, user.userId, {
        entry_type: 'deal_created',
        ref_type: 'deal',
        ref_id: row.id,
        amount: row.principal_amount,
        currency: row.currency,
        debit_account: 'deal_receivable',
        credit_account: 'cash_out',
        note: `Deal created: ${row.title}`,
        metadata: { deal_type: row.deal_type },
      });

      return json(request, env, { ok: true, deal: { ...row, metadata: safeJsonParse(row.metadata_json, {}) }, journal }, 201);
    }

    if (method === 'GET' && dealByIdMatch) {
      const id = dealByIdMatch[1];
      const row = await d1First(db, `SELECT * FROM deals WHERE id = ? AND user_id = ? LIMIT 1`, id, user.userId);
      if (!row) return bad(request, env, 'Deal not found', 404);
      return json(request, env, { deal: { ...row, metadata: safeJsonParse(row.metadata_json, {}) } });
    }

    if ((method === 'PUT' || method === 'PATCH') && dealByIdMatch) {
      const id = dealByIdMatch[1];
      const existing = await d1First(db, `SELECT * FROM deals WHERE id = ? AND user_id = ? LIMIT 1`, id, user.userId);
      if (!existing) return bad(request, env, 'Deal not found', 404);
      const body = asPlainObject(await readJson(request));
      const next = {
        deal_type: body.deal_type != null ? parseDealType(body.deal_type) : existing.deal_type,
        title: body.title != null ? requireStringField(body, 'title', { min: 3, max: 160 }) : existing.title,
        principal_amount: body.principal_amount != null ? requirePositiveNumberField(body, 'principal_amount') : Number(existing.principal_amount),
        currency: body.currency != null ? normalizeCurrency(body.currency) : existing.currency,
        status: body.status != null ? parseDealStatus(body.status) : existing.status,
        issued_at: body.issued_at != null ? toIsoTimestamp(body.issued_at, 'issued_at') : existing.issued_at,
        due_at: body.due_at != null ? (body.due_at ? toIsoTimestamp(body.due_at, 'due_at') : null) : existing.due_at,
        settled_at: body.settled_at != null ? (body.settled_at ? toIsoTimestamp(body.settled_at, 'settled_at') : null) : existing.settled_at,
        metadata_json: body.metadata != null ? JSON.stringify(asPlainObject(body.metadata)) : existing.metadata_json,
      };
      await d1Run(db, `
        UPDATE deals
        SET deal_type = ?, title = ?, principal_amount = ?, currency = ?, status = ?, issued_at = ?, due_at = ?, settled_at = ?, metadata_json = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `, next.deal_type, next.title, next.principal_amount, next.currency, next.status, next.issued_at, next.due_at, next.settled_at, next.metadata_json, nowIso(), id, user.userId);
      const row = await d1First(db, `SELECT * FROM deals WHERE id = ? AND user_id = ? LIMIT 1`, id, user.userId);
      return json(request, env, { ok: true, deal: { ...row, metadata: safeJsonParse(row.metadata_json, {}) } });
    }

    if ((method === 'PUT' || method === 'PATCH') && dealSettleMatch) {
      const id = dealSettleMatch[1];
      const deal = await d1First(db, `SELECT * FROM deals WHERE id = ? AND user_id = ? LIMIT 1`, id, user.userId);
      if (!deal) return bad(request, env, 'Deal not found', 404);
      const body = asPlainObject(await readJson(request));
      const amount = body.amount == null ? Number(deal.principal_amount) : requirePositiveNumberField(body, 'amount');
      const currency = normalizeCurrency(body.currency || deal.currency);
      const settledAt = body.settled_at ? toIsoTimestamp(body.settled_at, 'settled_at') : nowIso();
      const settlement = {
        id: randomId('set_'),
        user_id: user.userId,
        deal_ids_json: JSON.stringify([deal.id]),
        amount,
        currency,
        status: 'completed',
        note: optionalStringField(body, 'note', { max: 1000, fallback: '' }),
        settled_at: settledAt,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      await d1Run(db, `
        INSERT INTO settlements
          (id, user_id, deal_ids_json, amount, currency, status, note, settled_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, settlement.id, settlement.user_id, settlement.deal_ids_json, settlement.amount, settlement.currency, settlement.status, settlement.note, settlement.settled_at, settlement.created_at, settlement.updated_at);
      await d1Run(db, `UPDATE deals SET status = 'settled', settled_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`, settledAt, nowIso(), deal.id, user.userId);
      const journal = await writeJournalEntry(db, user.userId, {
        entry_type: 'deal_settled',
        ref_type: 'settlement',
        ref_id: settlement.id,
        amount: settlement.amount,
        currency: settlement.currency,
        debit_account: 'cash_in',
        credit_account: 'deal_receivable',
        note: settlement.note || `Deal settled: ${deal.title}`,
        metadata: { deal_id: deal.id },
      });
      return json(request, env, { ok: true, settlement: { ...settlement, deal_ids: [deal.id] }, journal });
    }

    if (method === 'GET' && url.pathname === '/api/settlements') {
      const rows = await d1All(db, `SELECT * FROM settlements WHERE user_id = ? ORDER BY settled_at DESC, id DESC`, user.userId);
      return json(request, env, { settlements: rows.map(r => ({ ...r, deal_ids: safeJsonParse(r.deal_ids_json, []) })) });
    }

    if (method === 'POST' && url.pathname === '/api/settlements') {
      const body = asPlainObject(await readJson(request));
      const dealIds = Array.isArray(body.deal_ids) ? body.deal_ids.map(x => String(x || '').trim()).filter(Boolean) : [];
      if (!dealIds.length) throw new HttpError(400, 'deal_ids must contain at least one deal id');
      const amount = requirePositiveNumberField(body, 'amount');
      const currency = normalizeCurrency(body.currency || 'QAR');
      const settledAt = body.settled_at ? toIsoTimestamp(body.settled_at, 'settled_at') : nowIso();
      const status = String(body.status || 'pending').trim().toLowerCase();
      if (!['pending', 'completed', 'cancelled'].includes(status)) throw new HttpError(400, 'status must be pending, completed, or cancelled');

      const existingDeals = await d1All(db, `SELECT id FROM deals WHERE user_id = ? AND id IN (${dealIds.map(() => '?').join(',')})`, user.userId, ...dealIds);
      if (existingDeals.length !== dealIds.length) throw new HttpError(400, 'One or more deal_ids do not exist');

      const row = {
        id: randomId('set_'),
        user_id: user.userId,
        deal_ids_json: JSON.stringify(dealIds),
        amount,
        currency,
        status,
        note: optionalStringField(body, 'note', { max: 1000, fallback: '' }),
        settled_at: settledAt,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      await d1Run(db, `
        INSERT INTO settlements
          (id, user_id, deal_ids_json, amount, currency, status, note, settled_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, row.id, row.user_id, row.deal_ids_json, row.amount, row.currency, row.status, row.note, row.settled_at, row.created_at, row.updated_at);

      if (status === 'completed') {
        await d1Run(db, `UPDATE deals SET status = 'settled', settled_at = ?, updated_at = ? WHERE user_id = ? AND id IN (${dealIds.map(() => '?').join(',')})`, settledAt, nowIso(), user.userId, ...dealIds);
      }

      const journal = await writeJournalEntry(db, user.userId, {
        entry_type: 'settlement_recorded',
        ref_type: 'settlement',
        ref_id: row.id,
        amount: row.amount,
        currency: row.currency,
        debit_account: 'cash_in',
        credit_account: 'deal_receivable',
        note: row.note || 'Settlement recorded',
        metadata: { deal_ids: dealIds, status: row.status },
      });

      return json(request, env, { ok: true, settlement: { ...row, deal_ids: dealIds }, journal }, 201);
    }

    if ((method === 'PUT' || method === 'PATCH') && settlementByIdMatch) {
      const id = settlementByIdMatch[1];
      const existing = await d1First(db, `SELECT * FROM settlements WHERE id = ? AND user_id = ? LIMIT 1`, id, user.userId);
      if (!existing) return bad(request, env, 'Settlement not found', 404);
      const body = asPlainObject(await readJson(request));
      const nextStatus = body.status != null ? String(body.status).trim().toLowerCase() : String(existing.status || '').trim().toLowerCase();
      if (!['pending', 'completed', 'cancelled'].includes(nextStatus)) throw new HttpError(400, 'status must be pending, completed, or cancelled');
      const nextNote = body.note != null ? optionalStringField(body, 'note', { max: 1000, fallback: '' }) : String(existing.note || '');
      await d1Run(db, `UPDATE settlements SET status = ?, note = ?, updated_at = ? WHERE id = ? AND user_id = ?`, nextStatus, nextNote, nowIso(), id, user.userId);
      const row = await d1First(db, `SELECT * FROM settlements WHERE id = ? AND user_id = ? LIMIT 1`, id, user.userId);
      return json(request, env, { ok: true, settlement: { ...row, deal_ids: safeJsonParse(row.deal_ids_json, []) } });
    }

    if (method === 'GET' && url.pathname === '/api/journal') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
      const rows = await d1All(db, `SELECT * FROM journal_entries WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`, user.userId, limit);
      return json(request, env, { journal: rows.map(r => ({ ...r, metadata: safeJsonParse(r.metadata_json, {}) })) });
    }

    if (method === 'GET' && url.pathname === '/api/deals/kpis') {
      const statusFilter = String(url.searchParams.get('status') || '').trim().toLowerCase();
      const typeFilter = String(url.searchParams.get('deal_type') || '').trim().toLowerCase();
      const args = [user.userId];
      let where = 'WHERE user_id = ?';
      if (statusFilter) {
        where += ' AND status = ?';
        args.push(statusFilter);
      }
      if (typeFilter) {
        where += ' AND deal_type = ?';
        args.push(typeFilter);
      }

      const totals = await d1First(db, `
        SELECT
          COUNT(*) AS total_deals,
          COALESCE(SUM(principal_amount), 0) AS principal_total,
          COALESCE(SUM(CASE WHEN status IN ('active','due','overdue') THEN principal_amount ELSE 0 END), 0) AS open_principal,
          COALESCE(SUM(CASE WHEN status = 'settled' THEN principal_amount ELSE 0 END), 0) AS settled_principal
        FROM deals
        ${where}
      `, ...args);
      const byStatus = await d1All(db, `
        SELECT status, COUNT(*) AS count, COALESCE(SUM(principal_amount), 0) AS principal
        FROM deals
        ${where}
        GROUP BY status
        ORDER BY status ASC
      `, ...args);
      const byType = await d1All(db, `
        SELECT deal_type, COUNT(*) AS count, COALESCE(SUM(principal_amount), 0) AS principal
        FROM deals
        ${where}
        GROUP BY deal_type
        ORDER BY deal_type ASC
      `, ...args);
      const settlements = await d1First(db, `
        SELECT
          COUNT(*) AS settlement_count,
          COALESCE(SUM(amount), 0) AS settlement_amount
        FROM settlements
        WHERE user_id = ?
      `, user.userId);

      return json(request, env, {
        kpis: {
          total_deals: Number(totals?.total_deals || 0),
          principal_total: Number(totals?.principal_total || 0),
          open_principal: Number(totals?.open_principal || 0),
          settled_principal: Number(totals?.settled_principal || 0),
          settlement_count: Number(settlements?.settlement_count || 0),
          settlement_amount: Number(settlements?.settlement_amount || 0),
        },
        by_status: byStatus.map(r => ({ status: r.status, count: Number(r.count || 0), principal: Number(r.principal || 0) })),
        by_type: byType.map(r => ({ deal_type: r.deal_type, count: Number(r.count || 0), principal: Number(r.principal || 0) })),
      });
    }

    if (method === 'GET' && url.pathname === '/api/dashboard/kpis') {
      const trading = await d1First(db, `
        SELECT
          COALESCE(SUM(CASE WHEN side = 'sell' AND status = 'active' THEN quantity * unit_price ELSE 0 END), 0) AS sell_revenue,
          COALESCE(SUM(CASE WHEN side = 'sell' AND status = 'active' THEN fee ELSE 0 END), 0) AS sell_fees,
          COALESCE(SUM(CASE WHEN side = 'sell' AND status = 'active' THEN quantity ELSE 0 END), 0) AS sell_qty,
          COUNT(CASE WHEN side = 'sell' AND status = 'active' THEN 1 END) AS sell_count
        FROM trades
        WHERE user_id = ?
      `, user.userId);
      const cost = await d1First(db, `
        SELECT COALESCE(SUM(allocated_cost), 0) AS cogs
        FROM trade_allocations
        WHERE user_id = ?
      `, user.userId);
      const deals = await d1First(db, `
        SELECT
          COUNT(*) AS total_deals,
          COALESCE(SUM(CASE WHEN status IN ('active','due','overdue') THEN principal_amount ELSE 0 END), 0) AS deals_open_principal,
          COALESCE(SUM(CASE WHEN status = 'settled' THEN principal_amount ELSE 0 END), 0) AS deals_settled_principal
        FROM deals
        WHERE user_id = ?
      `, user.userId);
      const settlements = await d1First(db, `
        SELECT
          COUNT(*) AS settlement_count,
          COALESCE(SUM(amount), 0) AS settlement_amount
        FROM settlements
        WHERE user_id = ?
      `, user.userId);

      const sellRevenue = Number(trading?.sell_revenue || 0);
      const sellFees = Number(trading?.sell_fees || 0);
      const cogs = Number(cost?.cogs || 0);
      const grossProfit = sellRevenue - cogs;
      const netProfit = grossProfit - sellFees;
      const marginPct = sellRevenue > 0 ? (netProfit / sellRevenue) * 100 : 0;

      return json(request, env, {
        kpis: {
          sell_revenue: sellRevenue,
          cogs,
          gross_profit: grossProfit,
          sell_fees: sellFees,
          net_profit: netProfit,
          margin_pct: marginPct,
          sell_qty: Number(trading?.sell_qty || 0),
          sell_count: Number(trading?.sell_count || 0),
          total_deals: Number(deals?.total_deals || 0),
          deals_open_principal: Number(deals?.deals_open_principal || 0),
          deals_settled_principal: Number(deals?.deals_settled_principal || 0),
          settlement_count: Number(settlements?.settlement_count || 0),
          settlement_amount: Number(settlements?.settlement_amount || 0),
        },
      });
    }

    return bad(request, env, 'Not found', 404);
  } catch (err) {
    const status = Number(err?.status) || 500;
    return bad(request, env, err?.message || 'Financial API error', status);
  }
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



async function computeKpiParity(db, userId) {
  const dashboardTrading = await d1First(db, `
    SELECT
      COALESCE(SUM(CASE WHEN side = 'sell' AND status = 'active' THEN quantity * unit_price ELSE 0 END), 0) AS sell_revenue,
      COALESCE(SUM(CASE WHEN side = 'sell' AND status = 'active' THEN fee ELSE 0 END), 0) AS sell_fees
    FROM trades
    WHERE user_id = ?
  `, userId);
  const dashboardCost = await d1First(db, `SELECT COALESCE(SUM(allocated_cost),0) AS cogs FROM trade_allocations WHERE user_id = ?`, userId);
  const dealsTotals = await d1First(db, `
    SELECT
      COUNT(*) AS total_deals,
      COALESCE(SUM(CASE WHEN status IN ('active','due','overdue') THEN principal_amount ELSE 0 END), 0) AS deals_open_principal,
      COALESCE(SUM(CASE WHEN status = 'settled' THEN principal_amount ELSE 0 END), 0) AS deals_settled_principal
    FROM deals
    WHERE user_id = ?
  `, userId);
  const settlementsTotals = await d1First(db, `
    SELECT
      COUNT(*) AS settlement_count,
      COALESCE(SUM(amount), 0) AS settlement_amount
    FROM settlements
    WHERE user_id = ?
  `, userId);

  const sellRevenue = Number(dashboardTrading?.sell_revenue || 0);
  const sellFees = Number(dashboardTrading?.sell_fees || 0);
  const cogs = Number(dashboardCost?.cogs || 0);
  const grossProfit = sellRevenue - cogs;
  const netProfit = grossProfit - sellFees;

  // Independent baseline recompute using raw tables
  const baseline = await d1First(db, `
    SELECT
      COALESCE(SUM(CASE WHEN side = 'sell' AND status = 'active' THEN quantity * unit_price ELSE 0 END), 0) AS sell_revenue,
      COALESCE(SUM(CASE WHEN side = 'sell' AND status = 'active' THEN fee ELSE 0 END), 0) AS sell_fees,
      COUNT(CASE WHEN side = 'sell' AND status = 'active' THEN 1 END) AS sell_count
    FROM trades
    WHERE user_id = ?
  `, userId);
  const baselineDeals = await d1First(db, `
    SELECT
      COUNT(*) AS total_deals,
      COALESCE(SUM(CASE WHEN status IN ('active','due','overdue') THEN principal_amount ELSE 0 END), 0) AS open_principal,
      COALESCE(SUM(CASE WHEN status = 'settled' THEN principal_amount ELSE 0 END), 0) AS settled_principal
    FROM deals
    WHERE user_id = ?
  `, userId);

  const checks = {
    sell_revenue: Number(baseline?.sell_revenue || 0) === sellRevenue,
    sell_fees: Number(baseline?.sell_fees || 0) === sellFees,
    total_deals: Number(baselineDeals?.total_deals || 0) === Number(dealsTotals?.total_deals || 0),
    deals_open_principal: Number(baselineDeals?.open_principal || 0) === Number(dealsTotals?.deals_open_principal || 0),
    deals_settled_principal: Number(baselineDeals?.settled_principal || 0) === Number(dealsTotals?.deals_settled_principal || 0),
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    dashboard: {
      sell_revenue: sellRevenue,
      sell_fees: sellFees,
      cogs,
      gross_profit: grossProfit,
      net_profit: netProfit,
      total_deals: Number(dealsTotals?.total_deals || 0),
      deals_open_principal: Number(dealsTotals?.deals_open_principal || 0),
      deals_settled_principal: Number(dealsTotals?.deals_settled_principal || 0),
      settlement_count: Number(settlementsTotals?.settlement_count || 0),
      settlement_amount: Number(settlementsTotals?.settlement_amount || 0),
    },
  };
}



async function computeCutoverReadiness(db, userId) {
  await ensureSchemaMigrationsTable(db);
  await ensureImportBridgeTables(db);
  await ensurePhase5FinancialTables(db);

  const migrations = await d1All(db, `SELECT version FROM schema_migrations ORDER BY id ASC`);
  const migrationVersions = migrations.map(r => String(r.version || ''));

  const [batchCount, tradeCount, allocCount, dealCount, settlementCount, journalCount] = await Promise.all([
    d1First(db, `SELECT COUNT(*) AS c FROM batches WHERE user_id = ?`, userId),
    d1First(db, `SELECT COUNT(*) AS c FROM trades WHERE user_id = ?`, userId),
    d1First(db, `SELECT COUNT(*) AS c FROM trade_allocations WHERE user_id = ?`, userId),
    d1First(db, `SELECT COUNT(*) AS c FROM deals WHERE user_id = ?`, userId),
    d1First(db, `SELECT COUNT(*) AS c FROM settlements WHERE user_id = ?`, userId),
    d1First(db, `SELECT COUNT(*) AS c FROM journal_entries WHERE user_id = ?`, userId),
  ]);

  const parity = await computeKpiParity(db, userId);

  const checks = {
    migration_001_applied: migrationVersions.includes('001'),
    migration_002_applied: migrationVersions.includes('002'),
    trading_seeded: Number(batchCount?.c || 0) > 0 || Number(tradeCount?.c || 0) > 0,
    financial_seeded: Number(dealCount?.c || 0) > 0 || Number(settlementCount?.c || 0) > 0,
    kpi_parity_ok: !!parity.ok,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    migrations: migrationVersions,
    counts: {
      batches: Number(batchCount?.c || 0),
      trades: Number(tradeCount?.c || 0),
      trade_allocations: Number(allocCount?.c || 0),
      deals: Number(dealCount?.c || 0),
      settlements: Number(settlementCount?.c || 0),
      journal_entries: Number(journalCount?.c || 0),
    },
    parity,
  };
}



async function computeReconciliationSummary(db, userId) {
  await ensureImportBridgeTables(db);
  await ensurePhase5FinancialTables(db);

  const [
    batches,
    trades,
    allocations,
    deals,
    settlements,
    journal,
    trading,
    dealsAgg,
    settlementsAgg,
  ] = await Promise.all([
    d1First(db, `SELECT COUNT(*) AS c, COALESCE(SUM(quantity),0) AS qty, COALESCE(SUM(quantity * unit_cost),0) AS cost FROM batches WHERE user_id = ?`, userId),
    d1First(db, `SELECT COUNT(*) AS c, COALESCE(SUM(CASE WHEN side='sell' AND status='active' THEN quantity ELSE 0 END),0) AS sell_qty, COALESCE(SUM(CASE WHEN side='sell' AND status='active' THEN quantity*unit_price ELSE 0 END),0) AS sell_rev FROM trades WHERE user_id = ?`, userId),
    d1First(db, `SELECT COUNT(*) AS c, COALESCE(SUM(allocated_qty),0) AS allocated_qty, COALESCE(SUM(allocated_cost),0) AS allocated_cost FROM trade_allocations WHERE user_id = ?`, userId),
    d1First(db, `SELECT COUNT(*) AS c FROM deals WHERE user_id = ?`, userId),
    d1First(db, `SELECT COUNT(*) AS c FROM settlements WHERE user_id = ?`, userId),
    d1First(db, `SELECT COUNT(*) AS c FROM journal_entries WHERE user_id = ?`, userId),
    d1First(db, `SELECT COALESCE(SUM(CASE WHEN side='sell' AND status='active' THEN fee ELSE 0 END),0) AS sell_fees FROM trades WHERE user_id = ?`, userId),
    d1First(db, `SELECT COALESCE(SUM(CASE WHEN status IN ('active','due','overdue') THEN principal_amount ELSE 0 END),0) AS open_principal, COALESCE(SUM(CASE WHEN status='settled' THEN principal_amount ELSE 0 END),0) AS settled_principal FROM deals WHERE user_id = ?`, userId),
    d1First(db, `SELECT COALESCE(SUM(amount),0) AS settlement_amount FROM settlements WHERE user_id = ?`, userId),
  ]);

  const sellRevenue = Number(trades?.sell_rev || 0);
  const allocatedCost = Number(allocations?.allocated_cost || 0);
  const sellFees = Number(trading?.sell_fees || 0);
  const netProfit = sellRevenue - allocatedCost - sellFees;

  return {
    counts: {
      batches: Number(batches?.c || 0),
      trades: Number(trades?.c || 0),
      trade_allocations: Number(allocations?.c || 0),
      deals: Number(deals?.c || 0),
      settlements: Number(settlements?.c || 0),
      journal_entries: Number(journal?.c || 0),
    },
    trading: {
      total_batch_qty: Number(batches?.qty || 0),
      total_batch_cost: Number(batches?.cost || 0),
      sell_qty: Number(trades?.sell_qty || 0),
      sell_revenue: sellRevenue,
      allocated_qty: Number(allocations?.allocated_qty || 0),
      allocated_cost: allocatedCost,
      sell_fees: sellFees,
      net_profit: netProfit,
    },
    deals: {
      open_principal: Number(dealsAgg?.open_principal || 0),
      settled_principal: Number(dealsAgg?.settled_principal || 0),
      settlement_amount: Number(settlementsAgg?.settlement_amount || 0),
    },
  };
}

async function handleSystem(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/system/health") {
    const health = {
      ok: true,
      service: "p2p-tracker",
      timestamp: nowIso(),
      bindings: {
        db: !!env.DB,
        kv: !!env.P2P_KV,
      },
    };

    if (env.DB) {
      try {
        const ping = await d1First(env.DB, "SELECT 1 AS ok");
        health.bindings.dbCheck = ping?.ok === 1;
      } catch (err) {
        health.ok = false;
        health.bindings.dbCheck = false;
        health.errors = [{ scope: "db", message: err.message || "DB check failed" }];
      }
    }

    return json(request, env, health, health.ok ? 200 : 503);
  }

  if (url.pathname === "/api/system/migrations") {
    if (!env.DB) return bad(request, env, "D1 binding DB is not configured", 500);
    try {
      const rows = await listSchemaMigrations(env.DB);
      return json(request, env, { migrations: rows, count: rows.length });
    } catch (err) {
      return bad(request, env, err.message || "Failed to list migrations", 500);
    }
  }

  if (url.pathname === "/api/system/version") {
    const version = String(env.WORKER_VERSION || env.CF_VERSION_METADATA || "unknown");
    return json(request, env, {
      ok: true,
      service: "p2p-tracker",
      version,
      timestamp: nowIso(),
      endpoints: ["/api/system/health", "/api/system/migrations", "/api/system/version", "/api/system/kpi-parity", "/api/system/cutover-readiness", "/api/system/reconciliation-summary"],
    });
  }

  if (url.pathname === "/api/system/kpi-parity") {
    if (!env.DB) return bad(request, env, "D1 binding DB is not configured", 500);
    let user;
    try {
      user = await getUserContext(request, env);
    } catch (err) {
      return bad(request, env, err.message || "Unauthorized", 401);
    }
    try {
      await ensureImportBridgeTables(env.DB);
      await ensurePhase5FinancialTables(env.DB);
      const parity = await computeKpiParity(env.DB, user.userId);
      return json(request, env, { ok: parity.ok, parity, timestamp: nowIso() }, parity.ok ? 200 : 409);
    } catch (err) {
      return bad(request, env, err.message || "Failed to compute KPI parity", 500);
    }
  }

  if (url.pathname === "/api/system/cutover-readiness") {
    if (!env.DB) return bad(request, env, "D1 binding DB is not configured", 500);
    let user;
    try {
      user = await getUserContext(request, env);
    } catch (err) {
      return bad(request, env, err.message || "Unauthorized", 401);
    }
    try {
      const readiness = await computeCutoverReadiness(env.DB, user.userId);
      return json(request, env, { ok: readiness.ok, readiness, timestamp: nowIso() }, readiness.ok ? 200 : 409);
    } catch (err) {
      return bad(request, env, err.message || "Failed to compute cutover readiness", 500);
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
    const isApiPath = url.pathname.startsWith('/api/');
    const isWrite = isApiPath && isWriteMethod(request.method);
    let authMeta = { ok: true, actor: 'system', mode: 'off' };

    if (isWrite) {
      authMeta = resolveWriteAuth(request, env);
      if (!authMeta.ok) {
        auditWrite(request, {
          actor: authMeta.actor,
          mode: authMeta.mode,
          source: authMeta.source,
          status: authMeta.response?.status || 401,
          outcome: 'denied',
          error: 'missing_or_invalid_access_identity',
        });
        return authMeta.response;
      }
    }

    let response;
    try {
      if (url.pathname.startsWith("/api/system")) {
        const system = await handleSystem(request, env);
        if (system) response = system;
      }
      if (!response && url.pathname.startsWith("/api/merchant")) {
        response = await handleMerchant(request, env);
      }
      if (!response && url.pathname.startsWith('/api/import')) {
        response = await handleImport(request, env);
      }
      if (!response && (url.pathname.startsWith('/api/batches') || url.pathname.startsWith('/api/trades'))) {
        response = await handleTrading(request, env);
      }
      if (!response && (url.pathname.startsWith('/api/deals') || url.pathname.startsWith('/api/settlements') || url.pathname.startsWith('/api/journal'))) {
        response = await handleFinancials(request, env);
      }
      if (!response) {
        const p2p = await handleP2P(request, env);
        if (p2p) response = p2p;
      }
      if (!response) response = bad(request, env, "Not found", 404);
    } catch (err) {
      console.error('[worker] unhandled fetch error:', err?.stack || err?.message || String(err));
      response = bad(request, env, err?.message || 'Internal error', err?.status || 500);
    }

    if (isWrite) {
      auditWrite(request, {
        actor: authMeta.actor,
        mode: authMeta.mode,
        source: authMeta.source,
        status: response.status,
        outcome: response.ok ? 'success' : 'error',
      });
    }

    return response;
  },
};
