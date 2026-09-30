// Serves the built Angular app (dist/client/browser) on port 4201, with no dependencies.
// Unknown paths get index.html so that deep links like /stock/3 work (client-side routing).
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 4201);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.txt': 'text/plain', '.woff2': 'font/woff2',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.normalize(path.join(root, urlPath));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }   // no escaping public/
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) file = path.join(root, 'index.html');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(port, () => console.log(`InventoryDashboard on http://localhost:${port}`));
