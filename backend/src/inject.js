const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const handleUserCode = `
async function handleUser(request, env) {
  const url = new URL(request.url);
  const method = request.method;
  const db = env.DB;
  if (!db) return bad(request, env, "D1 binding DB is not configured", 500);

  let user;
  try { user = await getUserContext(request, env); }
  catch (err) { return bad(request, env, err.message || "Unauthorized", 401); }

  if (method === "GET" && url.pathname === "/api/user/bootstrap") {
    try {
      const p = await db.prepare("SELECT * FROM user_preferences WHERE user_key = ?").bind(user.email).first();
      return json(request, env, {
        user: { id: user.userId, email: user.email },
        preferences: p ? { theme: p.theme, layout: p.layout, last_page: p.last_page } : null
      });
    } catch (e) {
      return bad(request, env, "Failed to bootstrap", 500);
    }
  }

  if (method === "PATCH" && url.pathname === "/api/user/preferences") {
    try {
      const body = await request.json();
      await db.prepare(\`
        INSERT INTO user_preferences (user_key, theme, layout, last_page, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_key) DO UPDATE SET
          theme = coalesce(?, user_preferences.theme),
          layout = coalesce(?, user_preferences.layout),
          last_page = coalesce(?, user_preferences.last_page),
          updated_at = CURRENT_TIMESTAMP
      \`).bind(
        user.email,
        body.theme || null,
        body.layout || null,
        body.last_page || null,
        body.theme || null,
        body.layout || null,
        body.last_page || null
      ).run();
      return new Response("OK", { status: 200, headers: {
        "Access-Control-Allow-Origin": env.ALLOWED_ORIGINS || "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,X-User-Id,X-User-Email,X-Compat-User"
      }});
    } catch (e) {
      return bad(request, env, "Failed to update preferences " + e.message, 500);
    }
  }
}
`;

if (!code.includes('async function handleUser')) {
  code = code.replace('export default {', handleUserCode + '\nexport default {');
  console.log('Injected handleUser');
}

if (!code.includes('handleUser(request, env)')) {
  code = code.replace(
    'if (url.pathname.startsWith("/api/system")) {',
    'if (url.pathname.startsWith("/api/user")) {\n        const userResp = await handleUser(request, env);\n        if (userResp) response = userResp;\n      }\n      if (!response && url.pathname.startsWith("/api/system")) {'
  );
  console.log('Injected routing');
}

fs.writeFileSync('index.js', code);
