const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const SHEET_ID = '1RDBz-AZaEX9bqDIqEv1tKlZaOuIN9uTjo5e8abrvnyY';
const PUB_ID  = '2PACX-1vSnpzAYqp0gDavs1Vr9NLT6eUgeJhVCd2A9a6ygB0qr6ztmPL_Vz0XwKnb0RvxBNRtjxlGlKHetFLr_';
const BASE_GVIZ = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
const BASE_PUB  = `https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pub?single=true&output=csv`;

const SHEET_URLS = {
  us:       [`${BASE_PUB}&gid=0`,           `${BASE_GVIZ}&sheet=Sales+2024-2026+USA`],
  ca:       [`${BASE_PUB}&gid=1819427614`,  `${BASE_GVIZ}&gid=1819427614`],
  cn:       [`${BASE_PUB}&gid=1442270003`,  `${BASE_GVIZ}&gid=1442270003`],
  stock_us:    [`${BASE_GVIZ}&sheet=Stock_USA`],
  stock_cn:    [`${BASE_GVIZ}&sheet=Stock_China`],
  stock_ca:    [`${BASE_GVIZ}&sheet=Stock-Canada`],
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

// ── CSV parser ───────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { row.push(cell.trim()); cell = ''; }
    else if ((c === '\n' || c === '\r') && !inQ) {
      row.push(cell.trim()); if (row.some(x => x)) rows.push(row);
      row = []; cell = '';
      if (c === '\r' && text[i+1] === '\n') i++;
    } else cell += c;
  }
  row.push(cell.trim()); if (row.some(x => x)) rows.push(row);
  return rows;
}

function si(v) { const n = parseInt(String(v||'').replace(/[^0-9]/g,'')); return isNaN(n) ? 0 : n; }

// ── Sales sheet parser ───────────────────────────────────────────────────
function parseSales(text) {
  const rows = parseCSV(text);
  const RU = ['янв','февр','мар','апр','мая','июн','июл','авг','сент','окт','нояб','дек'];
  let header, headerIdx;
  for (let i = 0; i < Math.min(4, rows.length); i++) {
    if (rows[i].some(h => h && /\d{4}/.test(h))) { header = rows[i]; headerIdx = i; break; }
  }
  if (!header) return {};
  const colMap = {};
  header.forEach((h, i) => {
    if (!h) return;
    const m = h.match(/(\d{4})[^а-яёa-z]*([а-яё]+)/i);
    if (!m) return;
    const mo = RU.findIndex(x => m[2].toLowerCase().startsWith(x));
    if (mo >= 0) colMap[parseInt(m[1]) * 100 + mo + 1] = i;
  });
  const now = new Date();
  const curKey = now.getFullYear() * 100 + now.getMonth() + 1;
  const complete = Object.keys(colMap).map(Number).filter(k => k < curKey).sort((a,b) => b-a).slice(0, 3);
  if (complete.length < 3) return {};
  const [c30, c29, c28] = complete.map(k => colMap[k]);
  const cCur = colMap[curKey] ?? -1;
  const days = now.getDate();
  // Season: same 3 months last year (for season blend)
  const seaKeys = complete.map(k => (Math.floor(k/100)-1)*100 + (k%100));
  const [s0,s1,s2] = seaKeys.map(k => colMap[k] ?? -1);
  // YoY: same 3 months last year avg vs current avg
  const lyKeys = complete.map(k => (Math.floor(k/100)-1)*100 + (k%100));
  const [ly0,ly1,ly2] = lyKeys.map(k => colMap[k] ?? -1);
  const result = {};
  rows.slice(headerIdx + 1).forEach(row => {
    const name = row[1]?.trim(); if (!name) return;
    const v28 = si(row[c28]), v29 = si(row[c29]), v30 = si(row[c30]);
    const cur = cCur >= 0 ? Math.round(si(row[cCur]) * (30 / days) * 10) / 10 : 0;
    const sea = [s0,s1,s2].map(c => c>=0 ? si(row[c]) : 0);
    const curAvg = (v28+v29+v30)/3;
    const lyVals = [ly0,ly1,ly2].map(c => c>=0 ? si(row[c]) : 0);
    const lyAvg = (lyVals[0]+lyVals[1]+lyVals[2])/3;
    const yoy = lyAvg>0 ? Math.round((curAvg-lyAvg)/lyAvg*100) : null;
    result[name] = [v28, v29, v30, cur, sea, yoy];
  });
  return result;
}

// ── Stock sheet parsers ──────────────────────────────────────────────────
function parseStockUS(text) {
  const rows = parseCSV(text); const result = {}; let cat = '';
  rows.slice(1).forEach(row => {
    if (row[0]?.trim() && !row[1]?.trim()) { cat = row[0].trim(); return; }
    const name = row[1]?.trim(); if (!name) return;
    result[name] = { transit: si(row[2]), stock: si(row[3]), cn: si(row[4]),
                     ordered: Math.max(0, si(row[5]||0)), category: cat };
  });
  return result;
}
function parseStockCA(text) {
  const rows = parseCSV(text); const result = {};
  rows.slice(1).forEach(row => { const n = row[1]?.trim(); if (n) result[n] = { transit: si(row[2]), stock: si(row[3]) }; });
  return result;
}

// ── Forecast ─────────────────────────────────────────────────────────────
function calcForecast(v28, v29, v30, cur = 0, sea = [0,0,0]) {
  const season = Math.round((sea[0]+sea[1]+sea[2])/3*10)/10;
  // Current month projection (mirror calcAvg3WithCurrent)
  if (cur > 0 && cur > v30) {
    const trend = Math.round(([v29,v30,cur].reduce((a,b)=>a+b,0)/3)*10)/10;
    if (season>0 && trend>0) return Math.round((season*0.6+trend*0.4)*10)/10;
    return trend>0 ? trend : season;
  }
  // calcAvg3 logic
  const m = [v28, v29, v30];
  let s = 0; while (s < m.length && m[s] === 0) s++;
  const a = m.slice(s);
  if (!a.length) return 0;
  if (a[a.length-1] === 0) return Math.round(a.reduce((x,y)=>x+y,0)/a.length*10)/10;
  if (a.length === 1) return a[0];
  if (a.length === 2) return a[1];
  if (a[0]>0 && a[1]>a[0] && a[2]>a[1]) {
    const slope = (a[2]-a[0])/2;
    return Math.max(a[2], Math.round((a[2]+slope)*10)/10);
  }
  const trend3 = Math.round(a.reduce((x,y)=>x+y,0)/a.length*10)/10;
  if (season>0 && trend3>0) return Math.round((season*0.6+trend3*0.4)*10)/10;
  if (season>0) return season;
  return trend3;
}

// ── ABC + Order computation ──────────────────────────────────────────────

// Load SOURCE array from index.html (same hardcoded data as website)
function loadSource() {
  try {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const m = html.match(/var SOURCE=(\[[\s\S]*?\]);/);
    if (!m) return {};
    const arr = JSON.parse(m[1]);
    const map = {};
    arr.forEach(it => { map[it.name] = it; });
    return map;
  } catch(e) { console.error('loadSource error:', e.message); return {}; }
}

const WUZHOU = ['Panda','UP-5','UP-2','Hexagon','Cuboid','Caminus','Kamin','Rain Fly','Floor for Hexagon','Floor for UP'];
const isWU = n => WUZHOU.some(p => n.includes(p));

function computeOrder(sales, stock, market, SOURCE={}) {
  const isUS = market === 'US';
  const srcItems = Object.values(SOURCE);
  if (!srcItems.length) return [];

  // Per-category velocity from LIVE sales (like website after Обновить)
  const catVels = {};
  srcItems.forEach(it => {
    const sp = sales[it.name]||[0,0,0,0,[],null];
    // Include current month only if >= 2 actual sales (avoid 1-sale noise early in month)
    const curRaw = sp[6]||0;  // raw current month sales count
    const curNormFiltered = (curRaw >= 2) ? sp[3] : 0;
    const liveVel = calcForecast(sp[0],sp[1],sp[2],curNormFiltered,sp[4]||[0,0,0]);
    const vel = liveVel > 0 ? liveVel : (isUS ? (it.sales_us_avg||0) : Math.max(it.sales_ca_avg||0, it.sales_us_avg||0));
    if (vel <= 0) return;
    it._vel = vel;
    const st = stock[it.name];
    const cat = st?.category || '';
    (catVels[cat] = catVels[cat]||[]).push(vel);
  });

  const items = [];
  srcItems.forEach(it => {
    const vel = it._vel; if (!vel) return;
    const s = stock[it.name]||{transit:0,stock:0,cn:0,ordered:0,category:''};

    // ABC: SOURCE yoy+trend (exact match with website calcABC)
    const yoy = isUS ? it.yoy_us : it.yoy_ca;
    const fallingYoY = yoy != null && yoy < -20;
    const gv = catVels[s.category||'']||[];
    const med = gv.length ? [...gv].sort((a,b)=>a-b)[Math.floor(gv.length/2)] : 1;
    const growing = (isUS ? (it.trend_us||0) : (it.trend_ca||0)) >= 2;
    const aboveAvg = vel >= med * 1.2;
    let abc;
    if (vel <= 2 && !growing) abc = 'C';
    else if (vel > 2 && (growing || aboveAvg) && !fallingYoY) abc = 'A';
    else abc = 'B';

    const thresh = abc==='A'?(isUS?60:75):abc==='C'?(isUS?30:45):(isUS?45:60);
    const tMos   = abc==='A'?(isUS?2:2.5):abc==='C'?(isUS?1:1.5):(isUS?1.5:2);

    // Live stock/transit from sheet, SOURCE ordered
    const stockV   = s.stock   != null ? s.stock   : (isUS ? (it.stock_us||0)   : (it.stock_ca||0));
    const transitV = s.transit != null ? s.transit : (isUS ? (it.in_transit_us||0) : (it.in_transit_ca||0));
    const orderedV = Math.max(0, isUS ? (it.ordered_us||0) : (it.ordered_ca||0));

    const availDays = stockV + transitV;
    const availQty  = stockV + transitV + orderedV;
    const days = availDays > 0 ? Math.floor(availDays / (vel/30)) : 0;
    if (days >= thresh) return;
    const qty = Math.max(0, Math.ceil(vel * tMos) - availQty);
    if (qty <= 0) return;
    items.push({ name: it.name, qty, vel: Math.round(vel*10)/10, days, wu: isWU(it.name), abc });
  });
  return items;
}




function sortItems(items, stockRows) {
  const ord = {}; stockRows.slice(1).forEach((r,i) => { if (r[1]?.trim()) ord[r[1].trim()] = i; });
  return items.sort((a,b) => (a.wu?1:0)-(b.wu?1:0) || (ord[a.name]??999)-(ord[b.name]??999));
}

function fmtMsg(market, items, date) {
  const lines = [`📦 <b>ЗАКАЗ ${market==='US'?'США':'Канада'} — ${date}</b>`, ''];
  let lastWu = null, n = 0;
  items.forEach(it => {
    if (lastWu !== it.wu) { lines.push(`<b>🏭 ${it.wu?'Учжоу':'COODY'} (60 дн):</b>`); lastWu = it.wu; }
    lines.push(`${++n}) ${it.name} [${it.abc}] — <b>${it.qty} pcs</b>`);
  });
  lines.push('', `Всего товаров: ${n}`, '🔗 rbm-coody-stock.onrender.com');
  return lines.join('\n');
}

function tgSend(token, chat, text) {
  return new Promise(resolve => {
    const body = JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML' });
    const req = https.request({ hostname:'api.telegram.org', path:`/bot${token}/sendMessage`,
      method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(res.statusCode===200)); });
    req.on('error', ()=>resolve(false)); req.write(body); req.end();
  });
}

async function runNotify(token, chat) {
  const vm = require('vm');
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const mainScript = scripts.map(m => m[1]).join('\n');

  const [csvUS, csvCA, csvSUS, csvSCA] = await Promise.all([
    fetchSheet('us'), fetchSheet('ca'), fetchSheet('stock_us'), fetchSheet('stock_ca')
  ]);

  const sandbox = {
    document: {
      getElementById: (id) => ({ id, textContent:'', innerHTML:'', value:'', disabled:false,
        classList:{ add:()=>{}, remove:()=>{} }, querySelector:()=>null }),
      querySelector: ()=>null, querySelectorAll: ()=>[],
      addEventListener: ()=>{}, createElement: (t)=>({ style:{}, appendChild:()=>{}, click:()=>{}, remove:()=>{}, href:'', download:'' }),
      body: { appendChild:()=>{} }
    },
    window: {}, console, Math, Date, JSON, Array, Object, String, Number,
    parseInt, parseFloat, isNaN, setTimeout:()=>{}, clearTimeout:()=>{},
    localStorage: { getItem:()=>null, setItem:()=>{} },
    fetch: ()=>Promise.resolve({}), alert:()=>{},
    __csvUS: csvUS, __csvCA: csvCA, __csvSUS: csvSUS, __csvSCA: csvSCA,
    __usOrder: null, __caOrder: null
  };
  sandbox.window = sandbox;

  const injection = `
    applyFilter = function(){};
    renderTable = function(){};
    renderKPI = function(){};
    toast = function(){};
    dbar = function(){ return ''; };
    showDetail = function(){};
    showForecast = function(){};
    showOntheway = function(){};

    try {
      // Use website's own parseLastMonths, parseStockUS, parseStockCA
      var usMap = parseLastMonths(__csvUS);
      var caMap = parseLastMonths(__csvCA);
      var stockUS = parseStockUS(__csvSUS);
      var stockCA = parseStockCA(__csvSCA);

      // Merge live data into SOURCE items (mirror doRefresh)
      SOURCE.forEach(function(r) {
        var sus = stockUS[r.name];
        if (sus) { r.stock_us=sus.stock; r.in_transit_us=sus.in_transit; r.stock_cn=sus.cn_stock; r.ordered_us=sus.ordered||0; }
        var sca = stockCA[r.name];
        if (sca) { r.stock_ca=sca.stock; r.in_transit_ca=sca.in_transit; }
        var us = usMap[r.name];
        if (us) {
          var d=new Date().getDate();
          var c=us[31]>0?Math.round(us[31]*(30/d)*10)/10:0;
          r.sales_us_avg=calcAvg3WithCurrent(us,c);
          r.yoy_us=calcYoY(us); r.trend_us=calcTrendFlag(us,c);
          r._v3=[us[30]||0,us[29]||0,us[28]||0]; r._sea=[us[19]||0,us[20]||0,us[21]||0];
          r._months=us._months||[]; r._seaMonths=us._seaMonths||[];
        }
        var ca = caMap[r.name];
        if (ca) {
          var dc=new Date().getDate();
          var cc=ca[31]>0?Math.round(ca[31]*(30/dc)*10)/10:0;
          r.sales_ca_avg=calcAvg3WithCurrent(ca,cc);
          r.yoy_ca=calcYoY(ca); r.trend_ca=calcTrendFlag(ca,cc);
        }
      });

      // Rebuild allData and ABC using website's own functions
      if (typeof uSet==="undefined") uSet={};
      if (typeof ovr==="undefined") ovr={};
      build(SOURCE);
      calcABC(allData);

      // Call website's own openOrder() — it stores result in window._orderItems
      _deletedRows = new Set();
      openOrder(1);
      __usOrder = (_orderItems||[]).map(function(it){ return {name:it.name,qty:it.qty,vel:it.vel,wu:isWuzhou(it.name),abc:it.abc||'B'}; });

      _deletedRows = new Set();
      openOrder(2);
      __caOrder = (_orderItems||[]).map(function(it){ return {name:it.name,qty:it.qty,vel:it.vel,wu:isWuzhou(it.name),abc:it.abc||'B'}; });

    } catch(e) {
      __usOrder = null; __caOrder = null;
      console.error('VM error:', e.message);
      throw e;
    }
  `;

  try {
    vm.runInNewContext(mainScript + injection, sandbox, { timeout: 60000 });
  } catch(e) {
    console.error('[notify] vm:', e.message.slice(0,300));
    throw new Error('VM: ' + e.message);
  }

  const usItems = sandbox.__usOrder || [];
  const caItems = sandbox.__caOrder || [];
  const now = new Date();
  const date = String(now.getDate()).padStart(2,'0')+'.'+String(now.getMonth()+1).padStart(2,'0')+'.'+now.getFullYear();
  let sent = 0;

  for (const [mkt, items] of [['US', usItems], ['CA', caItems]]) {
    if (!items || items.length < 5) { console.log('[notify] '+mkt+': '+(items?.length||0)+' skip'); continue; }
    const lines = ['📦 <b>ЗАКАЗ '+(mkt==='US'?'США':'Канада')+' — '+date+'</b>', ''];
    let lastWu=null, n=0;
    items.forEach(it => {
      if (lastWu !== it.wu) { lines.push('<b>🏭 '+(it.wu?'Учжоу':'COODY')+' (60 дн):</b>'); lastWu=it.wu; }
      lines.push(++n+') '+it.name+' ['+it.abc+'] — <b>'+it.qty+' pcs</b>');
    });
    lines.push('', 'Всего товаров: '+n, '🔗 rbm-coody-stock.onrender.com');
    console.log('[notify] '+mkt+': '+n+' items');
    const ok = await tgSend(token, chat, lines.join('\n'));
    if (ok) sent++;
  }
  return sent;
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

  // ── POST /api/send-telegram ────────────────────────────────────────
  if (pathname === '/api/send-telegram' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { token, chat_id, text } = JSON.parse(body);
        const ok = await tgSend(token||process.env.TELEGRAM_TOKEN, chat_id||process.env.TELEGRAM_CHAT_ID, text);
        res.writeHead(ok?200:500); res.end(ok?'OK':'Failed');
      } catch(e) { res.writeHead(400); res.end(e.message); }
    });
    return;
  }

  // ── /api/notify (GET or POST) ──────────────────────────────────────
  if (pathname === '/api/notify') {
    const getBody = () => new Promise(resolve => {
      if (req.method === 'GET') return resolve({});
      let b = ''; req.on('data', c => b += c); req.on('end', () => { try { resolve(JSON.parse(b||'{}')); } catch { resolve({}); } });
    });
    const body = await getBody();
    const token  = body.token   || process.env.TELEGRAM_TOKEN   || '';
    const chat   = body.chat_id || process.env.TELEGRAM_CHAT_ID || '';
    if (!token || !chat) {
      res.writeHead(400);
      res.end(JSON.stringify({ ok:false, error: "Set TELEGRAM_TOKEN and TELEGRAM_CHAT_ID on Render.com → Environment" }));
      return;
    }
    try {
      const sent = await runNotify(token, chat);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200); res.end(JSON.stringify({ ok: true, sent, message: sent>0?"Sent to Telegram":"No items needed (threshold not reached)" }));
    } catch(e) { console.error('[notify]', e); res.writeHead(500); res.end(JSON.stringify({ ok:false, error:e.message })); }
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
