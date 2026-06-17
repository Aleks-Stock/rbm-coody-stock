const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const SHEET_ID = '1RDBz-AZaEX9bqDIqEv1tKlZaOuIN9uTjo5e8abrvnyY';
const PUB_ID  = '2PACX-1vSnpzAYqp0gDavs1Vr9NLT6eUgeJhVCd2A9a6ygB0qr6ztmPL_Vz0XwKnb0RvxBNRtjxlGlKHetFLr_';
const BASE_GVIZ = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
const BASE_PUB  = `https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pub?single=true&output=csv`;

const SHEET_URLS = {
  us:          [`${BASE_PUB}&gid=0`,          `${BASE_GVIZ}&sheet=Sales+2024-2026+USA`],
  ca:          [`${BASE_PUB}&gid=1819427614`, `${BASE_GVIZ}&gid=1819427614`],
  cn:          [`${BASE_PUB}&gid=1442270003`, `${BASE_GVIZ}&gid=1442270003`],
  stock_us:    [`${BASE_GVIZ}&sheet=Stock_USA`],
  stock_cn:    [`${BASE_GVIZ}&sheet=Stock_China`],
  stock_ca:    [`${BASE_GVIZ}&sheet=Stock_Canada`],
  ontheway:    [`${BASE_GVIZ}&sheet=Ontheway_USA`],
  ontheway_ca: [`${BASE_GVIZ}&sheet=Ontheway_CANADA`]
};

const PORT = process.env.PORT || 3000;

// ── HTTP fetch helper ────────────────────────────────────────────────────
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => data.trim().length > 10 ? resolve(data) : reject(new Error('Empty')));
    }).on('error', reject);
  });
}

async function fetchSheet(sheet) {
  for (let i = 0; i < SHEET_URLS[sheet].length; i++) {
    try { const d = await fetchUrl(SHEET_URLS[sheet][i]); console.log(`[${sheet}] OK`); return d; }
    catch(e) { console.log(`[${sheet}] URL${i+1} failed: ${e.message}`); }
  }
  throw new Error(`All URLs failed for ${sheet}`);
}

// ── HTTP Server ──────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── /api/sheets/:sheet ─────────────────────────────────────────────
  if (pathname.startsWith('/api/sheets/')) {
    const sheet = pathname.replace('/api/sheets/', '');
    if (!SHEET_URLS[sheet]) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const csv = await fetchSheet(sheet);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.writeHead(200); res.end(csv);
    } catch(e) { res.writeHead(500); res.end(e.message); }
    return;
  }

  // ── index.html ─────────────────────────────────────────────────────
  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200); res.end(data);
  });
});

server.listen(PORT, () => console.log(`RBM COODY Stock on port ${PORT}`));

// Keep-alive: ping self every 10 minutes to prevent Render.com sleep
const SELF_URL = process.env.RENDER_EXTERNAL_URL || 'https://rbm-coody-stock.onrender.com';
setInterval(() => {
  https.get(SELF_URL + '/api/sheets/stock_us', res => {
    console.log('[keep-alive] ping', res.statusCode);
    res.resume();
  }).on('error', () => {});
}, 10 * 60 * 1000);
