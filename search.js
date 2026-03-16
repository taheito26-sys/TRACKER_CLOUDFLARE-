const fs = require('fs');
const lines = fs.readFileSync('frontend/index.html', 'utf8').split('\n');
let count = 0;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.includes('localStorage') || l.includes('theme') || l.includes('function nav(') || l.includes('_authUser')) {
    console.log(`Line ${i+1}: ${l.substring(0, 150).trim()}`);
    count++;
  }
}
