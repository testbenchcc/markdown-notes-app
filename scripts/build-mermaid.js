const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const destDir = path.join(__dirname, '..', 'static');
const dest = path.join(destDir, 'mermaid.min.js');

if (!fs.existsSync(src)) {
  console.error('[build-mermaid] mermaid.min.js not found at', src);
  process.exit(1);
}

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

fs.copyFileSync(src, dest);
console.log('[build-mermaid] Copied', src, 'to', dest);
