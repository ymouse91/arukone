const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT || process.argv[2] || 8878);
const host = process.env.HOST || process.argv[3] || '127.0.0.1';
const certPath = process.env.CERT || process.argv[4];
const keyPath = process.env.KEY || process.argv[5];
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function handleRequest(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (req.method === 'POST' && urlPath === '/api/puzzles') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        const puzzle = JSON.parse(body);
        const outPath = path.join(root, 'builder_puzzles.json');
        let puzzles = [];
        if (fs.existsSync(outPath)) {
          const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
          puzzles = Array.isArray(existing) ? existing : [existing];
        }
        puzzles.push(puzzle);
        fs.writeFileSync(outPath, JSON.stringify(puzzles, null, 2), 'utf8');
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok: true, count: puzzles.length}));
      } catch (err) {
        res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({ok: false, error: 'Invalid puzzle JSON'}));
      }
    });
    return;
  }

  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(root, safePath === '/' ? 'index.html' : safePath);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Clear-Site-Data': '"cache"'
    });
    res.end(data);
  });
}

const server = certPath && keyPath
  ? https.createServer({
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    }, handleRequest)
  : http.createServer(handleRequest);

server.listen(port, host, () => {
  const protocol = certPath && keyPath ? 'https' : 'http';
  console.log(`Serving ${root}`);
  console.log(`Open: ${protocol}://${host}:${port}`);
});
