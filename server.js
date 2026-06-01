const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const SHEET_ID = '1RDBz-AZaEX9bqDIqEv1tKlZaOuIN9uTjo5e8abrvnyY';
const PUB_ID = '2PACX-1vSnpzAYqp0gDavs1Vr9NLT6eUgeJhVCd2A9a6ygB0qr6ztmPL_Vz0XwKnb0RvxBNRtjxlGlKHetFLr_';
const BASE_GVIZ = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
const BASE_PUB  = `https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pub?single=true&output=csv`;

const SHEET_URLS = {
  us: [`${BASE_PUB}&gid=0`, `${BASE_GVIZ}&sheet=Sales+2024-2026+USA`, `${BASE_GVIZ}&sheet=Sales+2024-3026+USA`],
  ca: [`${BASE_PUB}&gid=1819427614`, `${BASE_GVIZ}&sheet=Sales+2024-3026+Canada`, `${BASE_GVIZ}&sheet=Sales+2024-2026+Canada`, `${BASE_GVIZ}&gid=1819427614`],
  cn: [`${BASE_PUB}&gid=1442270003`, `${BASE_GVIZ}&sheet=Sales+2024-3026+China`, `${BASE_GVIZ}&sheet=Sales+2024-2026+China`, `${BASE_GVIZ}&gid=1442270003`]
};

const PORT = process.env.PORT || 3000;

function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/csv,*/*' } };
    https.get(targetUrl, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (!data || data.trim().length < 20) reject(new Error('Empty: ' + targetUrl));
        else resolve(data);
      });
    }).on('error', reject);
  });
}

// Remove the "Итого" column so it never confuses month parsing
function stripTotal(csv) {
  const lines = csv.split('\n');
  let totalCol = -1;

  // Find Итого column index from header rows
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    const fields = parseCSVLine(lines[i]);
    const idx = fields.findIndex(f => f && (f.includes('Итого') || f.includes('Total')));
    if (idx >= 0) { totalCol = idx; break; }
  }

  if (totalCol < 0) return csv; // no Итого found, return as-is

  // Remove column at totalCol from every row
  return lines.map(line => {
    const fields = parseCSVLine(line);
    fields.splice(totalCol, 1);
    return fields.map(f => f.includes(',') || f.includes('"') ? '"' + f.replace(/"/g,'""') + '"' : f).join(',');
  }).join('\n');
}

function parseCSVLine(line) {
  const fields = [];
  let inQ = false, field = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { fields.push(field); field = ''; }
    else field += c;
  }
  fields.push(field);
  return fields;
}

async function fetchSheet(sheet) {
  const urls = SHEET_URLS[sheet];
  for (let i = 0; i < urls.length; i++) {
    try {
      const data = await fetchUrl(urls[i]);
      console.log(`[${sheet}] OK via URL ${i+1}`);
      return stripTotal(data);
    } catch(e) {
      console.log(`[${sheet}] URL ${i+1} failed: ${e.message}`);
    }
  }
  throw new Error(`All URLs failed for ${sheet}`);
}

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (pathname.startsWith('/api/sheets/')) {
    const sheet = pathname.replace('/api/sheets/', '');
    if (!SHEET_URLS[sheet]) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const csv = await fetchSheet(sheet);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Cache-Control', 'max-age=300');
      res.writeHead(200);
      res.end(csv);
    } catch(e) {
      console.error(`[${sheet}] All failed:`, e.message);
      res.writeHead(500);
      res.end('Error: ' + e.message);
    }
    return;
  }

  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`RBM COODY Stock on port ${PORT}`));
