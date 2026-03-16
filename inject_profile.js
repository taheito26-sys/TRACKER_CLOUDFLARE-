const fs = require('fs');
let code = fs.readFileSync('frontend/index.html', 'utf8');

if (code.includes('renderUserProfile')) {
  const renderProfileMatch = code.match(/function renderUserProfile\(\)\s*\{[\s\S]*?\}/);
  if (renderProfileMatch) {
    console.log("Found renderUserProfile");
    
    const updatedFunc = `function renderUserProfile() {
  var el = document.getElementById("userProfile");
  if (!el) return;
  if (!window._authUser || (!window._authUser.email && !window._authUser.id)) { el.innerHTML = ""; return; }
  var ident = window._authUser.email || window._authUser.id;
  var initials = ident.slice(0, 2).toUpperCase();
  el.innerHTML = "<div style='display:flex;align-items:center;gap:8px;cursor:pointer;' onclick='authSignOut()'>" +
    "<div style='width:24px;height:24px;border-radius:50%;background:var(--brand);color:white;display:grid;place-items:center;font-size:10px;font-weight:bold;'>" + initials + "</div>" +
    "<span style='font-size:11px;font-weight:600;color:var(--text);'>" + escHtml(ident) + "</span>" +
    "</div>";
}`;
    
    code = code.replace(renderProfileMatch[0], updatedFunc);
    console.log("Updated renderUserProfile function");
  } else {
    console.log("Could not find renderUserProfile strict match.");
  }
} else {
    console.log("No renderUserProfile found");
}

fs.writeFileSync('frontend/index.html', code);
