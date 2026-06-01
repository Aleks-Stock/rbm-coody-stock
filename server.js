const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const SHEET_ID = '1RDBz-AZaEX9bqDIqEv1tKlZaOuIN9uTjo5e8abrvnyY';
const PUB_ID = '2PACX-1vSnpzAYqp0gDavs1Vr9NLT6eUgeJhVCd2A9a6ygB0qr6ztmPL_Vz0XwKnb0RvxBNRtjxlGlKHetFLr_';

const SHEETS = {
  us: `https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pub?gid=0&single=true&output=csv`,
  ca: `https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pub?gid=1819427614&single=true&output=csv`,
  cn: `https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pub?gid=1442270003&single=true&output=csv`
};

const FALLBACK = {
  us: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Sales+2024-2026+USA`,
  ca: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=1819427614`,
  cn: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=1442270003`
};

const PORT = process.env.PORT || 3000;

function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RBMStock/1.0)',
        'Accept': 'text/csv,text/plain,*/*'
      }
    };
    https.get(targetUrl, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (!data || data.trim().length < 10) reject(new Error('Empty response'));
        else resolve(data);
      });
    }).on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (pathname.startsWith('/api/sheets/')) {
    const sheet = pathname.replace('/api/sheets/', '');
    if (!SHEETS[sheet]) { res.writeHead(404); res.end('Not found'); return; }
    try {
      // Try published URL first, fallback to gviz
      let csv;
      try {
        csv = await fetchUrl(SHEETS[sheet]);
      } catch(e1) {
        console.log(`Primary failed for ${sheet}, trying fallback:`, e1.message);
        csv = await fetchUrl(FALLBACK[sheet]);
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Cache-Control', 'max-age=300');
      res.writeHead(200);
      res.end(csv);
    } catch (e) {
      console.error(`Failed to fetch ${sheet}:`, e.message);
      res.writeHead(500);
      res.end('Error: ' + e.message);
    }
    return;
  }

  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`RBM COODY Stock running on port ${PORT}`);
});
