const fs = require('fs');
let code = fs.readFileSync('frontend/index.html', 'utf8');

const bootstrapCode = `
// --- Injected User Preferences Bootstrap ---
let _prefDebounce;
async function debouncedSyncPrefs(prefs) {
  if (!window._authUser || !window._authUser.email) return;
  clearTimeout(_prefDebounce);
  _prefDebounce = setTimeout(async () => {
    try {
      await api("/api/user/preferences", { method: "PATCH", body: JSON.stringify(prefs) });
    } catch(e) { console.warn("Pref sync fail", e); }
  }, 1000);
}

async function bootPreferences() {
  if (!window._authUser || !window._authUser.email) return false;
  try {
    const res = await api("/api/user/bootstrap");
    if (res && res.preferences) {
      state.theme = res.preferences.theme || state.theme;
      state.layout = res.preferences.layout || state.layout;
      state.page = res.preferences.last_page || state.page;
      return true;
    } else {
      // One-time migration
      debouncedSyncPrefs({ theme: state.theme, layout: state.layout, last_page: state.page });
      return false;
    }
  } catch(e) {
    console.warn("Bootstrap pref fail", e);
    return false;
  }
}
// -------------------------------------------
`;

if (!code.includes('debouncedSyncPrefs(')) {
  code = code.replace('function render() {', bootstrapCode + '\nfunction render() {');
  console.log('Injected Bootstrap function definitions.');
}

const authModeHandler = `
    const modeStr = localStorage.getItem("taheito_auth_mode");
    if (res.user) {
      window._authUser = res.user;
      await bootPreferences(); // --- Injected Prefs ---
      applyLayout();
      if (typeof window.renderUserProfile === "function") window.renderUserProfile();
    }
`;
if (!code.includes('await bootPreferences()')) {
  // Try to find the auth success block, or just patch init()
  code = code.replace(
    'if (window._authUser && window._authUser.email) {',
    'if (window._authUser && window._authUser.email) {\n    await bootPreferences(); applyLayout(); render();'
  );
  console.log('Injected bootPreferences into auth flow if found.');
}

// Hook navigation
if (!code.includes('debouncedSyncPrefs({ last_page: page }')) {
  const navPatch = `
function nav(page) {
  if (!page) return;
  state.page = page;
  debouncedSyncPrefs({ last_page: page });
`;
  code = code.replace('function nav(page) {', navPatch);
  console.log('Injected nav interception');
}

// Hook theme changes
if (!code.includes('debouncedSyncPrefs({ theme: state.theme })')) {
  code = code.replace(
    'settingsDraftSet_("ui.theme", c.dataset.tc);',
    'settingsDraftSet_("ui.theme", c.dataset.tc); debouncedSyncPrefs({ theme: c.dataset.tc });'
  );
  console.log('Injected theme click interception');
}

fs.writeFileSync('frontend/index.html', code);
