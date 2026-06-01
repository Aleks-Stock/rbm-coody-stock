const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const SHEET_ID = '1RDBz-AZaEX9bqDIqEv1tKlZaOuIN9uTjo5e8abrvnyY';
const SHEETS = {
  us: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Sales+2024-2026+USA`,
  ca: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=1819427614`,
  cn: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=1442270003`
};

const PORT = process.env.PORT || 3000;

function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // API proxy endpoints
  if (pathname.startsWith('/api/sheets/')) {
    const sheet = pathname.replace('/api/sheets/', '');
    if (!SHEETS[sheet]) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    try {
      const csv = await fetchUrl(SHEETS[sheet]);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Cache-Control', 'max-age=300'); // 5 min cache
      res.writeHead(200);
      res.end(csv);
    } catch (e) {
      res.writeHead(500);
      res.end('Error: ' + e.message);
    }
    return;
  }

  // Serve static files
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, 'public', filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'};
    res.setHeader('Content-Type', mime[ext] || 'text/plain');
    res.writeHead(200);
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`RBM COODY Stock server running on port ${PORT}`);
});
