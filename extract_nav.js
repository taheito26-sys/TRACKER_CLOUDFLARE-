const fs = require('fs');
const code = fs.readFileSync('frontend/index.html', 'utf8');

// Find all elements with data-go
const matches = [...code.matchAll(/data-go="([^"]+)"/g)];
const values = new Set(matches.map(m => m[1]));
console.log('data-go values:', Array.from(values).join(', '));

// Find event delegation for data-go
const delegation = code.match(/function[^{]*\{[^}]*data-go[^}]*\}/i);
if (delegation) console.log(delegation[0].substring(0, 300));

// Find where state.page is set
const pageSet = code.match(/state\.page\s*=[^;]+;/g);
console.log('state.page sets:', pageSet);

// Find nav / applyLayout / render
const fnSearch = code.match(/function\s+nav\s*\([^)]*\)\s*\{[\s\S]*?\n\}/i);
if (fnSearch) console.log(fnSearch[0].substring(0, 500));
