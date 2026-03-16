const fs = require('fs');
const lines = fs.readFileSync('frontend/index.html', 'utf8').split('\n');

function find(str) {
  const i = lines.findIndex(l => l.includes(str));
  console.log("Found: " + str + " at line " + (i + 1));
}

find('function render()');
find('function nav(');
find('function authBootstrap()');
find('settingsDraftSet_("ui.theme"');
find('function renderTopbarUser()');
