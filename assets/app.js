(() => {
'use strict';

/* ================= helpers ================= */
const $ = s => document.querySelector(s);
const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
// Halaman penghitung (hitung.html) memakai body data-mode="hitung": tanpa rekap dan tanpa angka stok DMS.
const MODE = document.body.dataset.mode === 'hitung' ? 'hitung' : 'admin';
const K = key => MODE === 'hitung' ? key + '-h' : key;
const TABS = MODE === 'hitung' ? ['hitung', 'hasil', 'sesi'] : ['hitung', 'hasil', 'rekap', 'dms', 'sesi'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf = new Intl.NumberFormat('id-ID');
const fmt = n => nf.format(n || 0);
const norm = s => String(s ?? '').trim().toUpperCase();
const rid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const LS = {
  get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
  set(k, v){ try { localStorage.setItem(k, v); return true; } catch(e){ return false; } },
  del(k){ try { localStorage.removeItem(k); } catch(e){} },
  json(k){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch(e){ return null; } },
  put(k, o){
    if (!LS.set(k, JSON.stringify(o))) showBanner('Memori browser penuh. Hitungan terbaru mungkin tidak tersimpan di device ini. Sambungkan ke internet supaya hitungan terkirim ke Sheet.');
  },
  keys(prefix){ const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) out.push(k); } } catch(e){} return out; }
};

function toPcs(it, isi){ return (it.k||0)*(isi||0) + (it.l||0)*12 + (it.p||0); }
function klp(t, isi){
  const a = Math.abs(t); const k = isi > 0 ? Math.floor(a/isi) : 0; const r = a - k*isi;
  return {k, l: Math.floor(r/12), p: r % 12};
}
function normQ(q, isi){ const r = klp(toPcs(q, isi), isi); return {k: r.k, l: r.l, p: r.p}; }
const ST = {
  in:    {c: 'ok',   t: 'Ada di DMS',                       d: '<path d="M5 12.5l4.5 4.5L19 7.5"/>'},
  noisi: {c: 'info', t: 'Ada di DMS, isi karton belum ada', d: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'},
  out:   {c: 'warn', t: 'Tidak ada di DMS',                 d: '<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17h.01"/>'},
};
function stIco(sku){
  const p = productFor(sku); const s = ST[!p ? 'out' : p.k > 0 ? 'in' : 'noisi'];
  return `<span class="si ${s.c}" title="${esc(s.t)}" role="img" aria-label="${esc(s.t)}"><svg viewBox="0 0 24 24">${s.d}</svg></span>`;
}
const TAG = {
  sent: '<span class="tg sent"><svg viewBox="0 0 24 24"><path d="M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.5A3.5 3.5 0 0 1 17 18H7z"/><path d="M9.5 13l2 2 3.5-3.5"/></svg>Terkirim</span>',
  wait: '<span class="tg wait"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Menunggu kirim</span>',
  hold: '<span class="tg hold"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Tertahan</span>',
  cor:  '<span class="tg cor"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>Dikoreksi</span>',
};
const tagsFor = (pending, corrected) => (corrected ? TAG.cor : '') + (pending ? (S.blocked[S.sessionId] ? TAG.hold : TAG.wait) : TAG.sent);
const IB = {
  tog:  (attr, label, closed) => `<button class="ib ib-ghost" type="button" ${attr} aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24">${closed ? '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>' : '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'}</svg></button>`,
  edit: (attr, label) => `<button class="ib ib-edit" type="button" ${attr} aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg></button>`,
  del:  (attr, label) => `<button class="ib ib-del" type="button" ${attr} aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>`,
};
// isi per karton: dari DMS kalau ada, kalau tidak dari isian user yang diingat per barang
// Kondisi stok: Good Stock = kunci SKU polos, Bad Stock = kunci "SKU#B" (server menyimpannya di kolom kondisi)
const BAD = '#B';
const isBad = key => String(key).endsWith(BAD);
const baseSku = key => isBad(key) ? String(key).slice(0, -BAD.length) : String(key);
const keyOf = (sku, bad) => bad ? sku + BAD : sku;
const condBadge = key => isBad(key) ? '<span class="cond-bad">Bad Stock</span>' : '';
const skuHtml = key => esc(baseSku(key)) + condBadge(key);
function isiOf(sku){
  sku = baseSku(sku);
  const p = productFor(sku); if (p && p.k > 0) return p.k;
  const c = S.local && S.local.isi && S.local.isi[sku]; return c > 0 ? c : 0;
}
// bentuk yang dikirim ke server: tanpa isi karton dari DMS, karton diubah ke lusin dan pcs supaya Rekap tetap benar
function wireItem(sku, it, custom){
  const p = productFor(sku);
  if ((p && p.k > 0) || !(it.k > 0) || !(custom > 0)) return {k: it.k || 0, l: it.l || 0, p: it.p || 0};
  const r = klp(toPcs(it, custom), 0); return {k: 0, l: r.l, p: r.p};
}
function fmtFull(o){
  const parts = [];
  if (o.k) parts.push(fmt(o.k) + ' Karton'); if (o.l) parts.push(fmt(o.l) + ' Lusin'); if (o.p) parts.push(fmt(o.p) + ' Pcs');
  return parts.length ? parts.join(' · ') : '0';
}
function fmtKLP(o){
  const parts = [];
  if (o.k) parts.push(fmt(o.k) + ' K'); if (o.l) parts.push(fmt(o.l) + ' L'); if (o.p) parts.push(fmt(o.p) + ' P');
  return parts.length ? parts.join(' · ') : '0';
}
function fmtTime(iso){ if (!iso) return ''; return new Date(iso).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'}); }
function fmtDate(iso){ if (!iso) return '-'; const d = new Date(iso); if (isNaN(d)) return String(iso); return d.toLocaleString('id-ID', {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}); }
function ago(iso){
  if (!iso) return '-'; const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'baru saja'; if (s < 3600) return Math.floor(s/60) + ' mnt lalu';
  if (s < 86400) return Math.floor(s/3600) + ' jam lalu'; return fmtDate(iso);
}
let toastT;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200); }
function showBanner(msg){ const b = $('#banner'); b.textContent = msg || ''; b.hidden = !msg; }
function loadScript(src){
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Gagal memuat ' + src)); document.head.appendChild(s); });
}

/* ================= state ================= */
const S = {
  code: (MODE === 'hitung' && ((window.APP_CONFIG && window.APP_CONFIG.KODE_HITUNG) || new URLSearchParams(location.search).get('k'))) || LS.get(K('so-code')) || '',
  role: null, kodeHitung: '', confirmRotate: false,
  deviceId: LS.get('so-device-id') || ('d-' + rid() + rid()),
  deviceName: (LS.get('so-device-name') || '').toUpperCase(),
  gudang: '',
  sessions: LS.json(K('so-sessions')) || [],
  sessionId: LS.get('so-session') || null,
  master: {meta:null, items:[]}, bySku: new Map(), byCode: new Map(),
  local: null, dirty: {}, plog: [], ready: false,   // data device ini untuk sesi aktif
  remote: [], remoteAt: null, remoteSid: null,        // baris Hitung semua device
  online: navigator.onLine, pushing: false, blocked: {},
  tab: 'hitung', current: null,
  quickOn: LS.get('so-quick') === '1', quickUnit: LS.get('so-quick-unit') || 'p', quickCond: null,
  rkFilter: 'semua', rkSearch: '', rkLimit: 200, dmsSearch: '', dmsLimit: 200,
  editing: null, confirmDel: null, confirmSess: null, parsed: null, confirmImport: false
};
LS.set('so-device-id', S.deviceId);

/* ================= API ================= */
const API = {
  base(){ return (window.APP_CONFIG && window.APP_CONFIG.APPS_SCRIPT_URL) || ''; },
  ready(){ const b = this.base(); return !!b && !b.includes('PASTE_URL'); },
  async get(params){
    const u = new URL(this.base());
    Object.entries(Object.assign({}, params, {code: S.code})).forEach(([k, v]) => u.searchParams.set(k, v));
    return this._json(await fetch(u.toString(), {cache: 'no-store'}));
  },
  async post(body){
    return this._json(await fetch(this.base(), {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify(Object.assign({}, body, {code: S.code}))}));
  },
  async _json(res){
    if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), {code: 'http'});
    const d = await res.json();
    if (d.error) throw Object.assign(new Error(d.message || d.error), {code: d.error});
    S.syncAt = Date.now();
    return d;
  }
};
function netFail(e){ return !e.code || e.code === 'http' || e.code === 'busy'; }

/* ================= login ================= */
async function login(code, silent){
  if (!API.ready()) { $('#loginErr').textContent = 'APPS_SCRIPT_URL belum diisi di assets/config.js. Lihat README Langkah 4.'; return; }
  S.code = code;
  const btn = $('#loginBtn');
  if (!silent) { btn.disabled = true; btn.textContent = 'Menghubungkan…'; }
  try {
    const d = await API.get({action: 'init'});
    if (MODE === 'admin' && d.role !== 'admin') { $('#loginErr').textContent = 'Kode ini untuk link penghitung. Masukkan kode admin.'; S.code = ''; showLogin(); return; }
    LS.set(K('so-code'), code);
    S.role = d.role; S.kodeHitung = d.kodeHitung || '';
    applyInit(d);
    showApp();
    await syncMaster(d.master);
  } catch(e){
    if (!$('#appScreen').hidden && !e.code) { console.error(e); showBanner('Error: ' + (e && e.stack || e.message || e)); }
    if (e.code === 'invalid_code') {
      $('#loginErr').textContent = MODE === 'hitung' ? 'Link penghitung tidak berlaku atau kodenya sudah diganti. Minta link baru ke admin.' : 'Kode akses salah.';
      LS.del(K('so-code')); showLogin();
    }
    else if (e.code === 'no_access_code') $('#loginErr').textContent = 'Kode akses belum diisi di tab Config Google Sheet.';
    else if (silent && S.code) { S.online = false; showApp(); showBanner('Belum tersambung ke server. Hitungan disimpan di device ini dan dikirim otomatis saat sinyal kembali.'); }
    else $('#loginErr').textContent = 'Tidak bisa terhubung ke Apps Script. Cek internet atau URL di config.js. (' + e.message + ')';
  } finally {
    btn.disabled = false; btn.textContent = 'Masuk';
  }
}
function applyInit(d){
  S.online = true;
  S.gudang = d.gudang || '';
  S.sessions = (d.sessions || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  LS.put(K('so-sessions'), S.sessions);
  let sid = S.sessionId;
  if (!sid || !S.sessions.find(s => s.id === sid)) { const pick = S.sessions.find(s => s.status !== 'closed') || S.sessions[0]; sid = pick ? pick.id : null; }
  if (sid !== S.sessionId || !S.local) selectSession(sid);
}
function showLogin(){ $('#appScreen').hidden = true; $('#loginScreen').hidden = false; $('#codeInput').value = ''; $('#codeInput').focus(); }
let started = false;
function showApp(){
  $('#loginScreen').hidden = true; $('#appScreen').hidden = false;
  if (!S.master.items.length) { const c = LS.json(K('so-master')); if (c) setMaster(c.meta, c.items); }
  if (!S.local) selectSession(S.sessionId);
  setTab(TABS.includes(LS.get(K('so-tab'))) ? LS.get(K('so-tab')) : 'hitung');
  if (!started) { started = true; setInterval(tick, 20000); }
  pushAll();
}

/* ================= master DMS ================= */
function setMaster(meta, items){
  S.master = {meta, items}; S.bySku = new Map(); S.byCode = new Map();
  for (const p of items) {
    S.bySku.set(p.s, p);
    const add = (code, u) => {
      const c = norm(code), arr = S.byCode.get(c);
      if (!arr) S.byCode.set(c, [{p, u}]);
      else { const h = arr.find(x => x.p === p); if (!h) arr.push({p, u}); else if (u === 'k') h.u = 'k'; }
    };
    add(p.s, null);
    if (p.b) add(p.b, 'p');
    if (p.bk) add(p.bk, 'k');
  }
}
async function syncMaster(meta, force){
  const cached = LS.json(K('so-master'));
  if (!force && cached && meta && cached.meta && cached.meta.version === meta.version && meta.version) { setMaster(cached.meta, cached.items); renderAll(); return; }
  try {
    const d = await API.get({action: 'master'});
    const parsed = parseDmsRows(d.values || [], 'Sheet', MODE === 'hitung');
    const items = parsed.items || [];
    setMaster(d.master, items);
    LS.put(K('so-master'), {meta: d.master, items});
    renderAll();
    if (force) toast('Stok DMS diambil ulang: ' + fmt(items.length) + ' SKU');
  } catch(e){ if (cached) setMaster(cached.meta, cached.items); if (force) toast('Gagal mengambil stok DMS'); renderAll(); }
}
function productFor(sku){ return S.bySku.get(baseSku(sku)) || null; }

/* ================= sesi & data device ================= */
function curSession(){ return S.sessions.find(s => s.id === S.sessionId) || null; }
function selectSession(sid){
  S.sessionId = sid; S.editing = null; S.confirmDel = null; closeCard();
  if (sid) LS.set('so-session', sid);
  const local = sid ? LS.json('so-st-' + sid) : null;
  S.local = local || {items: {}, log: []};
  S.dirty = (sid && LS.json('so-dirty-' + sid)) || {};
  S.plog = (sid && LS.json('so-plog-' + sid)) || [];
  S.ready = !!local;
  S.remote = []; S.remoteAt = null; S.remoteSid = sid;
  renderAll();
  if (sid) fetchRekap();
}
function saveLocal(){
  if (!S.sessionId) return;
  LS.put('so-st-' + S.sessionId, S.local);
  LS.put('so-dirty-' + S.sessionId, S.dirty);
  LS.put('so-plog-' + S.sessionId, S.plog);
}
function whyNoCount(){
  const s = curSession();
  if (!S.deviceName) return 'Isi nama device dulu (ketuk nama di header).';
  if (!s) return MODE === 'hitung' ? 'Belum ada sesi berjalan. Ketuk tombol muat ulang di kanan atas.' : 'Belum ada sesi. Buat sesi di tab Sesi.';
  if (s.status === 'closed' || S.blocked[S.sessionId]) return 'Sesi sudah ditutup. ' + (MODE === 'admin' ? 'Buka lagi di tab Sesi.' : 'Minta admin membukanya lagi.');
  if (!S.ready) return 'Hitungan sedang dimuat, coba lagi sebentar.';
  return 'Belum bisa menghitung.';
}
function canCount(){
  const s = curSession();
  return !!(s && s.status !== 'closed' && S.deviceName && S.ready && !S.blocked[S.sessionId]);
}

async function fetchRekap(){
  const sid = S.sessionId; if (!sid) return;
  try {
    const d = await API.get(MODE === 'hitung' ? {action: 'myRows', sesi: sid, device_id: S.deviceId} : {action: 'rekap', sesi: sid});
    if (S.sessionId !== sid) return;
    S.online = true;
    S.remote = d.rows || []; S.remoteAt = d.serverTime || now(); S.remoteSid = sid;
    if (!S.ready) {
      // Device ini belum punya data lokal untuk sesi ini: ambil hitungannya dari Sheet dulu,
      // supaya kiriman berikutnya tidak menimpa angka lama.
      const items = {};
      S.remote.filter(r => r[0] === S.deviceId).forEach(r => { if (r[3] || r[4] || r[5]) items[r[2]] = {k: r[3], l: r[4], p: r[5], at: r[6]}; });
      S.local = {items, log: []}; S.ready = true; saveLocal();
    }
    renderAll();
  } catch(e){
    if (netFail(e)) S.online = false;
    if (e.code === 'invalid_code') return logout(true);
    renderSync(); renderHitung();
  }
}

/* ================= kirim ke Sheet (offline-first) ================= */
let pushTimer = null;
function schedulePush(ms){ clearTimeout(pushTimer); pushTimer = setTimeout(pushAll, ms == null ? 2500 : ms); renderSync(); }
function pendingSids(){
  const set = new Set();
  LS.keys('so-dirty-').forEach(k => { const v = LS.json(k); if (v && Object.keys(v).length) set.add(k.slice(9)); });
  LS.keys('so-plog-').forEach(k => { const v = LS.json(k); if (v && v.length) set.add(k.slice(8)); });
  if (S.sessionId && (Object.keys(S.dirty).length || S.plog.length)) set.add(S.sessionId);
  return [...set].filter(sid => !S.blocked[sid]);
}
async function pushAll(){
  if (S.pushing || !S.code) return;
  const sids = pendingSids(); if (!sids.length) { renderSync(); return; }
  S.pushing = true; renderSync();
  let failed = false;
  for (const sid of sids) { if (!(await pushSession(sid))) { failed = true; break; } }
  S.pushing = false; renderSync();
  if (S.tab === 'hitung' || S.tab === 'hasil') renderHitungLists();
  if (failed) schedulePush(15000);
  else if (pendingSids().length) schedulePush(500);
}
async function pushSession(sid){
  const live = sid === S.sessionId;
  const local = live ? S.local : (LS.json('so-st-' + sid) || {items: {}});
  const dirty = live ? S.dirty : (LS.json('so-dirty-' + sid) || {});
  const plog = live ? S.plog : (LS.json('so-plog-' + sid) || []);
  const sent = Object.assign({}, dirty);
  const logs = plog.slice(0, 300);
  const items = Object.keys(sent).map(sku => { const it = local.items[sku] || {}; const w = wireItem(sku, it, (local.isi || {})[baseSku(sku)]); return {sku, k: w.k, l: w.l, p: w.p, at: it.at || now()}; });
  try {
    await API.post({action: 'push', sesi: sid, device_id: S.deviceId, device_nama: S.deviceName || 'Tanpa nama', items, log: logs});
    S.online = true; S.pushErr = null;
    const ids = new Set(logs.map(l => l.id));
    if (sid === S.sessionId) {
      for (const [k, v] of Object.entries(sent)) if (S.dirty[k] === v) delete S.dirty[k];
      S.plog = S.plog.filter(l => !ids.has(l.id)); saveLocal();
    } else {
      const d2 = LS.json('so-dirty-' + sid) || {}; for (const [k, v] of Object.entries(sent)) if (d2[k] === v) delete d2[k];
      LS.put('so-dirty-' + sid, d2); LS.put('so-plog-' + sid, (LS.json('so-plog-' + sid) || []).filter(l => !ids.has(l.id)));
    }
    return true;
  } catch(e){
    if (e.code === 'session_closed' || e.code === 'session_not_found') {
      S.blocked[sid] = true;
      const s = S.sessions.find(x => x.id === sid);
      showBanner('Sesi "' + (s ? s.name : sid) + '" sudah ditutup atau dihapus. ' + fmt(Object.keys(dirty).length) + ' SKU dari device ini tidak terkirim. Buka lagi sesinya di tab Sesi untuk mengirim.');
      if (sid === S.sessionId) refreshSessions();
      return true;
    }
    if (e.code === 'invalid_code') { logout(true); return false; }
    if (netFail(e)) S.online = false; else S.pushErr = e.message || e.code || 'error';
    return false;
  }
}
function renderSync(){
  const el = $('#sync'); if (!el) return;
  const n = Object.keys(S.dirty).length;
  const other = pendingSids().filter(s => s !== S.sessionId).length;
  let st = 'ok', txt, tip = '';
  if (S.blocked[S.sessionId] && n) { st = 'off'; txt = 'Sesi ditutup · ' + fmt(n) + ' tertahan'; tip = 'Buka lagi sesinya di tab Sesi supaya hitungan terkirim.'; }
  else if (!S.online) { st = 'off'; txt = n ? 'Offline · ' + fmt(n) + ' menunggu' : 'Offline'; }
  else if (S.pushErr && (n || other)) { st = 'off'; txt = 'Gagal kirim · ' + fmt(n || other) + ' menunggu'; tip = 'Server menolak: ' + S.pushErr; }
  else if (n || other || S.pushing) { st = 'wait'; txt = S.pushing ? 'Mengirim…' : n ? fmt(n) + ' belum terkirim' : fmt(other) + ' sesi lain menunggu'; }
  else txt = S.syncAt ? 'Tersinkron ' + fmtTime(new Date(S.syncAt).toISOString()) : 'Tersinkron';
  el.className = 'sync ' + st; el.title = tip;
  el.innerHTML = '<i></i><span>' + esc(txt) + '</span>';
}
function tick(){
  if (document.hidden) return;
  if (pendingSids().length) pushAll();
  if (S.tab === 'rekap' || !S.online) fetchRekap();
}
addEventListener('online', () => { S.online = true; pushAll(); fetchRekap(); });
addEventListener('offline', () => { S.online = false; renderSync(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.code && !$('#appScreen').hidden) { pushAll(); fetchRekap(); } });

/* ================= hitung ================= */
function markDirty(sku){ S.dirty[sku] = rid(); }
function addLog(e){ const entry = Object.assign({id: rid() + rid(), at: now()}, e); S.local.log.unshift(entry); S.local.log = S.local.log.slice(0, 40); S.plog.push(entry); return entry; }
function afterChange(){ saveLocal(); schedulePush(); renderHitungLists(); if (S.tab === 'rekap') renderRekap(); }
S.editingLog = null; S.confirmLog = null;
S.rkSort = 'perhatian'; S.devF = 'semua'; S.devQ = ''; S.devAll = false; S.dmsFilter = 'semua'; S.dmsSort = 'sku';
S.qLog = {q: '', f: 'semua', sort: 'baru'}; S.qMy = {q: '', f: 'semua', sort: 'baru'}; S.logAll = false;

function addCount(prod, code, q, cond){
  if (!canCount()) return false;
  if (cond !== 'g' && cond !== 'b') { toast('Pilih Good Stock atau Bad Stock dulu'); return false; }
  const known = !!(prod && prod.k > 0);
  const bsku = prod ? prod.s : code;
  const sku = keyOf(bsku, cond === 'b');
  const ik = Math.max(0, q.ik|0);
  const oldIsi = isiOf(sku);
  const isi = known ? prod.k : (ik || oldIsi);
  const raw = {k: Math.max(0, q.k|0), l: Math.max(0, q.l|0), p: Math.max(0, q.p|0)};
  if (!raw.k && !raw.l && !raw.p) { toast('Isi jumlah dulu'); return false; }
  if (raw.k && !isi) { toast('Isi per karton wajib diisi kalau mengisi Karton'); return false; }
  if (!known && ik) S.local.isi = Object.assign(S.local.isi || {}, {[bsku]: ik});
  const {k, l, p} = normQ(raw, isi);
  const it = S.local.items[sku] || {k: 0, l: 0, p: 0};
  const base = toPcs(it, known ? isi : oldIsi);
  Object.assign(it, klp(base + toPcs(raw, isi), isi)); it.at = now();
  S.local.items[sku] = it; markDirty(sku);
  addLog({sku, k, l, p, aksi: 'tambah'});
  afterChange();
  toast('+ ' + fmtFull({k, l, p}) + ' → ' + bsku + (cond === 'b' ? ' (Bad Stock)' : ''));
  return true;
}
function undoLog(id){
  const e = S.local.log.find(x => x.id === id); if (!e || e.aksi !== 'tambah') return;
  const it = S.local.items[e.sku]; const isi = isiOf(e.sku);
  if (it) { const left = Math.max(0, toPcs(it, isi) - toPcs(e, isi)); if (!left) delete S.local.items[e.sku]; else { Object.assign(it, klp(left, isi)); it.at = now(); } }
  markDirty(e.sku);
  S.local.log = S.local.log.filter(x => x.id !== id);
  S.plog.push({id: rid() + rid(), at: now(), sku: e.sku, k: e.k, l: e.l, p: e.p, aksi: 'batal'});
  afterChange(); toast('Dibatalkan: ' + e.sku);
}

function editLog(id, q){
  const e = S.local.log.find(x => x.id === id); if (!e || e.aksi !== 'tambah') return;
  const isi = isiOf(e.sku);
  const nq = normQ({k: Math.max(0, q.k|0), l: Math.max(0, q.l|0), p: Math.max(0, q.p|0)}, isi);
  if (!nq.k && !nq.l && !nq.p) { S.editingLog = null; undoLog(id); return; }
  const it = S.local.items[e.sku] || {k: 0, l: 0, p: 0};
  const total = Math.max(0, toPcs(it, isi) - toPcs(e, isi)) + toPcs(nq, isi);
  Object.assign(it, klp(total, isi)); it.at = now(); it.cor = true; S.local.items[e.sku] = it; markDirty(e.sku);
  S.plog.push({id: rid() + rid(), at: now(), sku: e.sku, k: e.k, l: e.l, p: e.p, aksi: 'batal'});
  e.k = nq.k; e.l = nq.l; e.p = nq.p; e.cor = true;
  S.plog.push({id: rid() + rid(), at: now(), sku: e.sku, k: nq.k, l: nq.l, p: nq.p, aksi: 'tambah'});
  S.editingLog = null; afterChange(); toast('Scan dikoreksi: ' + e.sku);
}

/* ================= scan ================= */
function lookup(code){ const c = norm(code); return c ? (S.byCode.get(c) || []) : []; }
function suggestions(q){
  const c = norm(q); if (c.length < 2) return [];
  const out = [];
  for (const p of S.master.items) {
    if (norm(p.s).includes(c) || (p.b && norm(p.b).startsWith(c)) || norm(p.n).includes(c)) { out.push(p); if (out.length >= 6) break; }
  }
  return out;
}
// Penanda stok DMS di daftar pilihan: ikon saja untuk penghitung, ikon + jumlah untuk admin.
function stockIcon(p){
  if (p.a == null) return '';
  return p.a
    ? '<span class="sg-st on" title="Ada stok di DMS" aria-label="Ada stok di DMS"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg></span>'
    : '<span class="sg-st" title="Stok DMS kosong" aria-label="Stok DMS kosong"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg></span>';
}
function stockTag(p){ return MODE === 'admin' && p.a != null ? '<small>Stok DMS: ' + (p.q > 0 ? esc(fmtFull(klp(p.q, p.k))) : 'kosong') + '</small>' : ''; }
function renderSuggest(list, units){
  const box = $('#suggest');
  if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.innerHTML = list.map((p, i) => `<button type="button" data-sku="${esc(p.s)}"${units && units[i] ? ' data-u="' + units[i] + '"' : ''}><span class="mono">${esc(p.s)}</span><span class="sg-n">${esc(p.n)}${stockTag(p)}</span>${stockIcon(p)}</button>`).join('');
  box.hidden = false;
}
function scanMsg(msg){ const m = $('#scanMsg'); m.textContent = msg || ''; m.hidden = !msg; }

// Dipakai input manual/scanner dan kamera. Mengembalikan teks singkat untuk ditampilkan.
function handleCode(code, fromCam){
  code = String(code || '').trim(); if (!code) return '';
  renderSuggest([]); scanMsg('');
  const hits = lookup(code);
  if (hits.length > 1) {
    if (fromCam) closeCam();
    $('#scanInput').value = code;
    renderSuggest(hits.map(h => h.p), hits.map(h => h.u));
    scanMsg('Kode ini dipakai ' + hits.length + ' SKU. Pilih salah satu.' + (hits.some(h => h.p.a != null) ? ' Ikon centang hijau = ada stok di DMS.' : ''));
    return '';
  }
  const hit = hits[0];
  if (hit) {
    if (S.quickOn && canCount() && S.quickCond) {
      const unit = hit.u === 'k' ? 'k' : S.quickUnit;
      if (unit === 'k' && !(hit.p.k > 0)) { if (fromCam) closeCam(); openCard(hit.p, code); scanMsg('Isi karton belum ada di data DMS. Masukkan lusin/pcs.'); return 'Isi karton kosong'; }
      addCount(hit.p, code, {[unit]: 1}, S.quickCond); closeCard();
      const it = S.local.items[keyOf(hit.p.s, S.quickCond === 'b')];
      return '<b>+1 ' + ({k:'karton', l:'lusin', p:'pcs'})[unit] + (S.quickCond === 'b' ? ' Bad Stock' : ' Good Stock') + '</b> ' + esc(hit.p.n) + ' · total device ini ' + esc(fmtFull(it));
    }
    if (fromCam) closeCam();
    openCard(hit.p, code, hit.u); return '';
  }
  if (fromCam) closeCam();
  const sug = suggestions(code);
  if (sug.length === 1) { openCard(sug[0], code); return ''; }
  if (sug.length > 1) { $('#scanInput').value = code; renderSuggest(sug); scanMsg('Beberapa barang cocok. Pilih salah satu.'); return ''; }
  openCard(null, code);
  scanMsg('Kode "' + code + '" tidak ada di stok DMS. Tetap bisa dicatat, akan muncul sebagai "Di luar DMS" di Rekap.');
  return '';
}
function handleScan(){ const inp = $('#scanInput'); const v = inp.value; inp.value = ''; handleCode(v, false); if (S.quickOn) inp.focus(); }

function openCard(prod, code, unitHint){
  S.current = {prod, code: prod ? prod.s : norm(code), cond: null};
  document.querySelectorAll('#condSeg button').forEach(b => b.setAttribute('aria-pressed', 'false'));
  $('#prodCard').hidden = false;
  $('#pcSku').textContent = prod ? prod.s + (prod.b ? '  ·  ' + prod.b : '') : norm(code);
  $('#pcName').innerHTML = prod ? esc(prod.n) : '<span class="unknown-tag">Tidak ada di DMS</span>';
  $('#pcMeta').textContent = prod ? (prod.k > 0 ? '1 karton = ' + fmt(prod.k) + ' pcs' : 'Isi karton belum diisi di DMS') : 'Barang belum terdaftar di DMS';
  const isi = prod && prod.k > 0 ? prod.k : isiOf(S.current.code);
  $('#qK').disabled = false; $('#qKh').textContent = isi > 0 ? fmt(isi) + ' pcs' : 'isi per karton?';
  $('#qIWrap').hidden = !!(prod && prod.k > 0);
  ['#qK', '#qL', '#qP', '#qI'].forEach(s => $(s).value = '');
  if (!(prod && prod.k > 0) && isi > 0) $('#qI').value = isi;
  if (unitHint === 'k') {
    if (prod && prod.k > 0) { $('#qK').value = 1; scanMsg('Barcode karton: 1 Karton terisi otomatis. Ubah kalau jumlahnya lain.'); }
    else scanMsg('Barcode karton, tapi isi per karton belum ada. Isi dulu "Isi per karton".');
  }
  $('#pcMine').textContent = mineText(isi);
  updatePreview();
  const first = '#qK';
  setTimeout(() => { $(first).focus(); $('#prodCard').scrollIntoView({block: 'nearest', behavior: 'smooth'}); }, 0);
}
function mineText(isi){
  const c = S.current.code, parts = [];
  [['g', 'Good Stock'], ['b', 'Bad Stock']].forEach(([cd, lb]) => {
    const it = S.local && S.local.items[keyOf(c, cd === 'b')];
    if (it) parts.push(lb + ': ' + fmtFull(it) + ' (' + fmt(toPcs(it, isi)) + ' pcs)');
  });
  return parts.length ? 'Sudah dihitung device ini · ' + parts.join(' · ') : '';
}
function closeCard(){ S.current = null; const c = $('#prodCard'); if (c) c.hidden = true; }
function readQty(){ return {k: +$('#qK').value || 0, l: +$('#qL').value || 0, p: +$('#qP').value || 0, ik: +$('#qI').value || 0}; }
function updatePreview(){
  const btn = $('#addBtn');
  if (!S.current) { btn.disabled = !canCount(); return; }
  const q = readQty(); const known = !!(S.current.prod && S.current.prod.k > 0);
  const isi = known ? S.current.prod.k : q.ik;
  const need = !!(q.k && !isi);
  const wrap = $('#qIWrap'); wrap.classList.toggle('need', need);
  const t = toPcs({k: q.k, l: q.l, p: q.p}, isi);
  const pv = $('#pcPreview');
  if (need) { pv.innerHTML = '<span class="neg">Isi per karton wajib diisi kalau mengisi Karton</span>'; }
  else if (!t) { pv.textContent = 'Masukkan jumlah'; }
  else { const n = normQ(q, isi); pv.innerHTML = 'Tercatat <b>' + esc(fmtFull(n)) + '</b> (' + fmt(t) + ' pcs)'; }
  btn.disabled = !canCount() || need || !t || !S.current.cond;
  if (!S.current.cond && t && !need) pv.innerHTML += ' · <span class="neg">Pilih kondisi stok dulu</span>';
}
function submitCard(){
  if (!S.current) return;
  if (addCount(S.current.prod, S.current.code, readQty(), S.current.cond)) { closeCard(); scanMsg(''); $('#scanInput').focus(); }
}

/* ================= kamera ================= */
const Cam = {active: false, stream: null, timer: null, h5: null, last: '', lastAt: 0};
const CAM_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
function camMsg(html){ $('#camMsg').innerHTML = html; }
async function openCam(){
  if (!canCount()) { toast(whyNoCount()); return; }
  $('#camModal').hidden = false; Cam.active = true; Cam.last = '';
  camMsg(S.quickOn ? 'Mode scan terus: tiap barcode langsung ditambah. Tekan <b>Tutup</b> kalau selesai.' : 'Arahkan kamera ke barcode.');
  const video = $('#camVideo');
  if ('BarcodeDetector' in window) {
    try {
      let formats = CAM_FORMATS;
      try { const sup = await BarcodeDetector.getSupportedFormats(); formats = CAM_FORMATS.filter(f => sup.includes(f)); } catch(e){}
      const det = new BarcodeDetector({formats});
      Cam.stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment'}, audio: false});
      if (!Cam.active) return stopStream();
      video.hidden = false; video.srcObject = Cam.stream; await video.play();
      const loop = async () => {
        if (!Cam.active) return;
        try { const r = await det.detect(video); if (r.length) onCamCode((r.find(x => lookup(x.rawValue).length) || r[0]).rawValue); } catch(e){}
        Cam.timer = setTimeout(loop, 150);
      };
      loop(); return;
    } catch(e){ stopStream(); if (e && e.name === 'NotAllowedError') { camMsg('Izin kamera ditolak. Izinkan kamera di pengaturan browser.'); return; } }
  }
  try {
    video.hidden = true; $('.cam-wrap').classList.add('h5');
    if (!window.Html5Qrcode) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js');
    if (!Cam.active) return;
    Cam.h5 = new window.Html5Qrcode('camFallback');
    await Cam.h5.start({facingMode: 'environment'}, {fps: 10, qrbox: (w, h) => ({width: Math.floor(w * 0.85), height: Math.floor(Math.min(h, w) * 0.4)}), formatsToSupport: h5Formats()}, txt => onCamCode(txt), () => {});
  } catch(e){ camMsg('Kamera tidak bisa dibuka: ' + esc(e.message || e) + '. Pakai scanner atau ketik SKU.'); }
}
function h5Formats(){
  const F = window.Html5QrcodeSupportedFormats; if (!F) return undefined;
  return ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'ITF'].map(k => F[k]).filter(v => v != null);
}
function onCamCode(code){
  const t = Date.now();
  if (code === Cam.last && t - Cam.lastAt < 2500) return;
  Cam.last = code; Cam.lastAt = t;
  if (navigator.vibrate) navigator.vibrate(60);
  const msg = handleCode(code, true);
  if (Cam.active && msg) camMsg(msg);
}
function stopStream(){
  clearTimeout(Cam.timer);
  if (Cam.stream) { Cam.stream.getTracks().forEach(tr => tr.stop()); Cam.stream = null; }
  const v = $('#camVideo'); if (v) v.srcObject = null;
}
async function closeCam(){
  if (!Cam.active) return;
  Cam.active = false; $('#camModal').hidden = true; stopStream(); $('.cam-wrap').classList.remove('h5');
  if (Cam.h5) { try { await Cam.h5.stop(); Cam.h5.clear(); } catch(e){} Cam.h5 = null; }
}

/* ================= render: header & hitung ================= */
function renderHeader(){
  const s = curSession();
  const label = MODE === 'hitung' ? 'Hitung' : 'Opname';
  $('#brandT').textContent = MODE === 'hitung' ? 'Hitung Stok' : 'Stok Opname';
  $('#hdrGudang').textContent = S.gudang || 'Gudang';
  $('#hdrSession').textContent = s ? s.name + (s.status === 'closed' ? ' · ditutup' : '') : 'Belum ada sesi';
  const chip = $('#devChip'); chip.classList.toggle('missing', !S.deviceName);
  chip.innerHTML = '<b>' + esc(S.deviceName || 'Atur nama device') + '</b>' + (S.deviceName ? '<span class="dv-pen" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg></span>' : '');
  chip.dataset.len = S.deviceName.length > 26 ? 'xl' : S.deviceName.length > 15 ? 'l' : '';
  chip.setAttribute('aria-label', S.deviceName ? 'Ganti nama device ' + S.deviceName : 'Atur nama device'); chip.title = S.deviceName ? 'Ketuk untuk ganti nama device' : 'Atur nama device';
  renderSync();
}
function renderHitung(){
  const s = curSession(); let html = '';
  if (!S.deviceName) html = `<div class="callout"><span>Beri nama device ini dulu, supaya hitungannya bisa ditandai.</span><button class="btn primary" type="button" data-go="sesi">Atur nama device</button></div>`;
  else if (!s && MODE === 'hitung') html = `<div class="callout"><span>Belum ada sesi yang berjalan. Minta admin membuat sesi, lalu ketuk tombol muat ulang di kanan atas.</span></div>`;
  else if (!s) html = `<div class="callout"><span>Belum ada sesi opname. Buat sesi dulu, lalu semua device pilih sesi yang sama.</span><button class="btn primary" type="button" data-go="sesi">Buat sesi</button></div>`;
  else if (s.status === 'closed') html = `<div class="callout"><span><b>${esc(s.name)}</b> sudah ditutup. Buka lagi di tab Sesi untuk menambah hitungan.</span></div>`;
  else if (!S.ready) html = `<div class="callout"><span>Memuat hitungan device ini dari Google Sheet… Perlu online sekali untuk sesi ini.</span></div>`;
  else if (!S.master.items.length) html = `<div class="callout"><span>Data barang belum ada. Scan tetap tercatat, tapi nama barang dan isi karton belum dikenali.</span>${MODE === 'admin' ? '<button class="btn" type="button" data-go="dms">Import stok DMS</button>' : ''}</div>`;
  $('#hitungNotice').innerHTML = html;
  const ok = canCount();
  ['#scanInput', '#scanBtn'].forEach(x => { $(x).disabled = !ok; });
  ['#camBtn', '#fabCam'].forEach(x => { const b = $(x); b.classList.toggle('off', !ok); b.setAttribute('aria-disabled', String(!ok)); });
  $('#scanInput').placeholder = ok ? 'Barcode, SKU, nama' : 'Belum bisa scan';
  $('#quickOn').checked = S.quickOn;
  $('#quickUnit').classList.toggle('off', !S.quickOn);
  document.querySelectorAll('#quickUnit button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.u === S.quickUnit)));
  $('#quickCond').classList.toggle('off', !S.quickOn); $('#quickCondHint').classList.toggle('off', !S.quickOn || !!S.quickCond);
  document.querySelectorAll('#quickCond button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c === S.quickCond)));
  updatePreview();
  renderHitungLists();
}
// pencarian, filter, dan urutan untuk Riwayat scan dan Hitungan device ini
function matchQ(q, sku, p){
  if (!q) return true;
  const hay = (sku + ' ' + (p ? p.n + ' ' + (p.b || '') + ' ' + (p.bk || '') : '')).toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}
const inFlt = (x, f) => f === 'semua' || (f === 'luar' && x.out) || (f === 'wait' && x.pend) || (f === 'cor' && x.cor);
function viewRows(rows, st, keep){
  const base = rows.filter(x => matchQ(st.q, x.sku, x.p));
  if (st.q && st.f !== 'semua' && !base.some(x => inFlt(x, st.f))) st.f = 'semua';
  let r = rows.filter(x => keep(x) || (inFlt(x, st.f) && matchQ(st.q, x.sku, x.p)));
  const by = fn => r.slice().sort((x, y) => fn(x, y));
  if (st.sort === 'lama') r = r.slice().reverse();
  else if (st.sort === 'nama') r = by((x, y) => String(x.name).localeCompare(String(y.name), 'id'));
  else if (st.sort === 'sku') r = by((x, y) => String(x.sku).localeCompare(String(y.sku), 'id', {numeric: true}));
  else if (st.sort === 'jumlah') r = by((x, y) => (y.t || 0) - (x.t || 0));
  return r;
}
function renderTb(pfx, st, all, shown, unit){
  const cs = all.filter(x => matchQ(st.q, x.sku, x.p));
  const tb = $('#' + pfx + 'Tb'); tb.hidden = !all.length; if (!all.length) return;
  const defs = [['semua', 'Semua', cs.length], ['luar', 'Di luar DMS', cs.filter(x => x.out).length], ['wait', 'Menunggu kirim', cs.filter(x => x.pend).length], ['cor', 'Dikoreksi', cs.filter(x => x.cor).length]];
  $('#' + pfx + 'Chips').innerHTML = defs.map(([k, l, n]) => '<button type="button" data-f="' + k + '" aria-pressed="' + (st.f === k) + '"' + (n || k === 'semua' ? '' : ' class="z"') + '>' + l + ' <b>' + fmt(n) + '</b></button>').join('');
  $('#' + pfx + 'Clr').hidden = !st.q;
  $('#' + pfx + 'Rst').hidden = !(st.q || st.f !== 'semua' || st.sort !== 'baru');
  $('#' + pfx + 'Sort').value = st.sort;
  $('#' + pfx + 'Meta').textContent = shown === all.length ? fmt(all.length) + ' ' + unit : fmt(shown) + ' dari ' + fmt(all.length);
}
const noHit = (pfx, st) => 'Tidak ada hasil' + (st.q ? ' untuk "' + esc(st.q) + '"' : ' dengan filter ini') + '. <button type="button" class="lnk" data-reset="' + pfx + '">Hapus pencarian dan filter</button>';

function renderHitungLists(){
  const local = S.local || {items: {}, log: []};
  const logAll = local.log.filter(e => e.aksi === 'tambah');
  const recent = new Set(logAll.slice(0, 5).map(e => e.id));
  const lrows = logAll.map(e => { const p = productFor(e.sku); return {e, p, sku: e.sku, name: p ? p.n : e.sku, out: !p, pend: S.plog.some(x => x.id === e.id) || !!S.dirty[e.sku], cor: !!e.cor, t: 0}; });
  let lview = viewRows(lrows, S.qLog, x => x.e.id === S.editingLog || x.e.id === S.confirmLog);
  const lfree = !S.qLog.q && S.qLog.f === 'semua' && S.qLog.sort === 'baru';
  const lhidden = lfree && !S.logAll && lview.length > 12 ? lview.length - 12 : 0;
  if (lhidden) lview = lview.slice(0, 12);
  renderTb('log', S.qLog, lrows, lview.length + lhidden, 'scan');
  const more = $('#logMore'); more.hidden = !lhidden; more.textContent = 'Tampilkan semua (' + fmt(lrows.length) + ')';
  $('#logList').innerHTML = !lrows.length ? '<li class="empty">Belum ada scan. Scan barcode atau ketik kode SKU atau nama barang di kolom atas untuk mulai.</li>'
    : !lview.length ? '<li class="empty">' + noHit('log', S.qLog) + '</li>'
    : lview.map(r => {
    const e = r.e, p = r.p, isi = isiOf(e.sku);
    const nm = esc(p ? p.n : '(tidak ada di DMS)');
    if (S.editingLog === e.id) return `<li class="log-edit">${stIco(e.sku)}<div class="it-i"><div class="sk">${skuHtml(e.sku)}</div><div class="nm">${nm}</div></div><span></span>
        <div class="le-in">
          <div><label for="le-k">Karton</label><input type="text" id="le-k" inputmode="numeric" maxlength="6" autocomplete="off" value="${e.k || 0}" ${isi > 0 ? '' : 'disabled'}></div>
          <div><label for="le-l">Lusin</label><input type="text" id="le-l" inputmode="numeric" maxlength="6" autocomplete="off" value="${e.l || 0}"></div>
          <div><label for="le-p">Pcs</label><input type="text" id="le-p" inputmode="numeric" maxlength="6" autocomplete="off" value="${e.p || 0}"></div></div>
        <div class="le-act"><button class="btn sm primary" type="button" data-lsave="${esc(e.id)}">Simpan</button><button class="btn sm" type="button" data-lcancel="1">Tutup</button></div></li>`;
    if (S.confirmLog === e.id) return `<li class="log-edit">${stIco(e.sku)}<div class="it-i"><div class="sk">${skuHtml(e.sku)}</div><div class="nm">${nm}</div></div><span></span>
        <div class="confirm"><span>Batalkan scan +${esc(fmtFull(e))}?</span><button class="btn sm danger" type="button" data-undoyes="${esc(e.id)}">Ya, batalkan</button><button class="btn sm" type="button" data-lcancel="1">Tidak</button></div></li>`;
    const acts = recent.has(e.id) && canCount() ? `<div class="it-a">${IB.edit('data-ledit="' + esc(e.id) + '"', 'Koreksi scan')}${IB.del('data-undo="' + esc(e.id) + '"', 'Batalkan scan')}</div>` : '<span></span>';
    return `<li>${stIco(e.sku)}<div class="it-i"><div class="sk">${skuHtml(e.sku)}</div><div class="nm">${nm}</div><div class="it-q"><span>+${esc(fmtFull(e))}</span>${tagsFor(r.pend, e.cor)}</div></div>${acts}</li>`;
  }).join('');

  const entries = Object.entries(local.items).sort((a, b) => String(b[1].at || '').localeCompare(String(a[1].at || '')));
  let totalPcs = 0, badPcs = 0, sumK = 0, sumL = 0, sumP = 0;
  const can = canCount();
  const mrows = entries.map(([sku, it]) => {
    const p = productFor(sku); const isi = isiOf(sku); const t = toPcs(it, isi); const n = normQ(it, isi);
    if (isBad(sku)) badPcs += t; else { totalPcs += t; sumK += n.k; sumL += n.l; sumP += n.p; }
    return {sku, it, p, isi, t, n, name: p ? p.n : sku, out: !p, pend: !!S.dirty[sku], cor: !!it.cor};
  });
  const mview = viewRows(mrows, S.qMy, x => x.sku === S.editing || x.sku === S.confirmDel);
  renderTb('my', S.qMy, mrows, mview.length, 'SKU');
  const rows = mview.map(({sku, it, p, isi, t, n}) => {
    let extra = '';
    if (S.editing === sku) extra = `<div class="edit">
        <div><label for="e-k">Karton</label><input type="text" id="e-k" inputmode="numeric" maxlength="6" autocomplete="off" value="${n.k}" ${isi > 0 ? '' : 'disabled'}></div>
        <div><label for="e-l">Lusin</label><input type="text" id="e-l" inputmode="numeric" maxlength="6" autocomplete="off" value="${n.l}"></div>
        <div><label for="e-p">Pcs</label><input type="text" id="e-p" inputmode="numeric" maxlength="6" autocomplete="off" value="${n.p}"></div>
        <button class="btn sm primary" type="button" data-save="${esc(sku)}">Simpan</button>
        <button class="btn sm" type="button" data-cancel="1">Batal</button></div>`;
    else if (S.confirmDel === sku) extra = `<div class="confirm"><span>Hapus semua hitungan ${esc(sku)} dari device ini?</span><button class="btn sm danger" type="button" data-delyes="${esc(sku)}">Ya, hapus</button><button class="btn sm" type="button" data-cancel="1">Batal</button></div>`;
    const busy = S.editing === sku || S.confirmDel === sku;
    const acts = can && !busy ? `<div class="it-a">${IB.edit('data-edit="' + esc(sku) + '"', 'Koreksi')}${IB.del('data-del="' + esc(sku) + '"', 'Hapus')}</div>` : '<span></span>';
    return `<div class="mi">${stIco(sku)}<div class="it-i"><div class="nm">${esc(p ? p.n : '(tidak ada di DMS)')}</div><div class="sk">${skuHtml(sku)} · ${fmt(t)} pcs</div><div class="it-q"><span>${esc(fmtFull(n))}</span>${tagsFor(!!S.dirty[sku], it.cor)}</div></div>${acts}${extra}</div>`;
  });
  $('#myList').innerHTML = !mrows.length ? '<div class="empty">Belum ada barang yang dihitung dari device ini. Setiap barang yang Anda tambahkan muncul di sini dan bisa dikoreksi.</div>'
    : !rows.length ? '<div class="empty">' + noHit('my', S.qMy) + '</div>' : rows.join('');
  const nSku = new Set(entries.map(([k]) => baseSku(k))).size;
  $('#heroDone').textContent = fmt(nSku);
  const nOut = new Set(mrows.filter(x => x.out).map(x => baseSku(x.sku))).size;
  $('#heroIn').textContent = fmt(nSku - nOut); $('#heroOut').textContent = fmt(nOut);
  $('#heroK').textContent = fmt(sumK); $('#heroL').textContent = fmt(sumL); $('#heroP').textContent = fmt(sumP);
  const nMaster = S.master.items.length;
  const pct = nMaster ? Math.min(100, Math.round(nSku / nMaster * 100)) : 0;
  $('#statCard').hidden = !nMaster;
  $('#statLeft').textContent = fmt(Math.max(0, nMaster - nSku));
  $('#statPct').textContent = pct + '%';
  $('#statBar').style.width = pct + '%';
  $('#heroOf').textContent = nMaster ? 'dari ' + fmt(nMaster) + ' SKU dihitung' : 'SKU dihitung';
  $('#myCount').textContent = entries.length ? nSku + ' SKU · ' + fmt(totalPcs) + ' pcs' + (badPcs ? ' · Bad ' + fmt(badPcs) + ' pcs' : '') : '';
}

/* ================= rekap ================= */
function recapDevices(){
  const map = new Map();
  if (S.remoteSid === S.sessionId) {
    for (const r of S.remote) {
      const [dev, name, sku, k, l, p, at] = r;
      if (dev === S.deviceId) continue;
      if (!map.has(dev)) map.set(dev, {id: dev, name, items: {}, updatedAt: ''});
      const d = map.get(dev); d.name = name || d.name;
      if (k || l || p) d.items[sku] = {k, l, p};
      if (String(at) > d.updatedAt) d.updatedAt = String(at);
    }
  }
  const list = [...map.values()];
  if (S.local && Object.keys(S.local.items).length) {
    const last = Object.values(S.local.items).reduce((a, it) => String(it.at || '') > a ? String(it.at) : a, '');
    const mine = {}; Object.entries(S.local.items).forEach(([sku, it]) => { mine[sku] = Object.assign({}, it, wireItem(sku, it, (S.local.isi || {})[baseSku(sku)])); });
    list.push({id: S.deviceId, name: S.deviceName || 'Tanpa nama', items: mine, updatedAt: last, mine: true});
  }
  return list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
function computeRecap(){
  const devs = recapDevices(); const rows = new Map();
  for (const p of S.master.items) rows.set(p.s, {sku: p.s, b: p.b || '', name: p.n, isi: p.k || 0, dms: p.q || 0, inDms: true, per: {}, counted: 0, has: false, bad: 0});
  for (const d of devs) for (const [key, it] of Object.entries(d.items)) {
    const sku = baseSku(key);
    let r = rows.get(sku);
    if (!r) { r = {sku, b: '', name: '(tidak ada di DMS)', isi: 0, dms: 0, inDms: false, per: {}, counted: 0, has: false, bad: 0}; rows.set(sku, r); }
    const t = toPcs(it, r.isi);
    if (isBad(key)) { r.bad += t; continue; }
    r.per[d.id] = (r.per[d.id] || 0) + t; r.counted += t; r.has = true;
  }
  const out = [];
  for (const r of rows.values()) {
    r.diff = r.counted - r.dms;
    r.status = !r.inDms ? 'luar' : !r.has ? 'belum' : r.diff === 0 ? 'sesuai' : r.diff < 0 ? 'kurang' : 'lebih';
    out.push(r);
  }
  return {devs, rows: out};
}
const STATUS_LABEL = {sesuai: 'Sesuai', kurang: 'Kurang', lebih: 'Lebih', belum: 'Belum dihitung', luar: 'Di luar DMS'};
const FILTERS = [['semua', 'Semua'], ['selisih', 'Selisih'], ['sesuai', 'Sesuai'], ['belum', 'Belum dihitung'], ['luar', 'Di luar DMS']];
const ORDER = {kurang: 0, lebih: 0, luar: 1, belum: 2, sesuai: 3};

// satu kartu per barang: angka utama dalam pcs, konversi karton/lusin/pcs di bawahnya, rincian per device dilipat
const RK_ICON = {
  sesuai: ['ok', '<path d="M5 12.5l4.5 4.5L19 7.5"/>'],
  kurang: ['neg', '<path d="M12 5v14M6 13l6 6 6-6"/>'],
  lebih: ['plus', '<path d="M12 19V5M6 11l6-6 6 6"/>'],
  belum: ['off', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
  luar: ['warn', '<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17h.01"/>'],
};
function rekapCard(r, devs){
  const [ic, path] = RK_ICON[r.status];
  const conv = n => esc(fmtFull(klp(n, r.isi)));
  const sign = r.diff > 0 ? '+' : r.diff < 0 ? '−' : '';
  const cell = (label, val, sub, cls) => '<div' + (cls ? ' class="' + cls + '"' : '') + '><small>' + label + '</small><b>' + val + '</b><em>' + sub + '</em></div>';
  const dmsC = r.inDms ? cell('Stok DMS', fmt(r.dms), conv(r.dms)) : cell('Stok DMS', '-', 'tidak ada di DMS');
  const cntC = r.has ? cell('Total hitung', fmt(r.counted), conv(r.counted)) : cell('Total hitung', '-', 'belum dihitung');
  const difC = r.inDms && r.has ? cell('Selisih', (r.diff > 0 ? '+' : '') + fmt(r.diff), r.diff ? sign + conv(r.diff) : 'sesuai', r.diff < 0 ? 'neg' : r.diff > 0 ? 'pos' : 'okc') : cell('Selisih', '-', '');
  const per = devs.filter(d => r.per[d.id] != null);
  const sub = esc(r.sku) + ' · ' + (r.isi ? 'isi ' + fmt(r.isi) + ' pcs/karton' : 'isi karton belum ada') + (per.length === 1 ? ' · ' + esc(per[0].name) : '');
  const badC = r.bad ? '<div class="rk-bad"><b>Bad Stock</b> ' + fmt(r.bad) + ' pcs · ' + conv(r.bad) + ' <em>(tidak masuk selisih)</em></div>' : '';
  const dv = per.length > 1 ? '<details class="devd"><summary>Per device <span>' + per.length + '</span></summary>' + per.map(d => '<div class="dvr"><span class="n">' + esc(d.name) + '</span><span><b>' + fmt(r.per[d.id]) + '</b> pcs · ' + conv(r.per[d.id]) + '</span></div>').join('') + '</details>' : '';
  return '<div class="rk"><div class="rk-h"><span class="si ' + ic + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg></span><div class="it-i"><div class="nm">' + esc(r.name) + '</div><div class="sk">' + sub + '</div></div><span class="pill ' + r.status + '">' + STATUS_LABEL[r.status] + '</span></div><div class="rk-s">' + dmsC + cntC + difC + '</div>' + badC + dv + '</div>';
}
function renderRekap(){
  const {devs, rows} = computeRecap();
  const c = {sesuai: 0, kurang: 0, lebih: 0, belum: 0, luar: 0}; let minus = 0, plus = 0;
  rows.forEach(r => { c[r.status]++; if (r.status === 'kurang') minus += r.diff; if (r.status === 'lebih') plus += r.diff; });
  const dmsN = S.master.items.length; const counted = rows.filter(r => r.has && r.inDms).length;
  const pct = dmsN ? Math.round(counted / dmsN * 100) : 0;
  const rkn = $('#rkNote'); if (rkn) { rkn.hidden = S.online; $('#rkUpdated').textContent = S.remoteAt ? 'Offline. Data semua device per ' + fmtTime(S.remoteAt) + ', perubahan terbaru belum masuk.' : 'Offline. Hanya data device ini yang tampil.'; }
  // ringkasan cepat: empat kotak dengan susunan sama (label + persen, jumlah SKU, bar, stok dalam pcs)
  const sm = {dms: 0, cnt: 0, sesuai: 0, belum: 0, luar: 0};
  rows.forEach(r => {
    if (r.inDms) { sm.dms += r.dms; sm.cnt += r.counted; }
    if (r.status === 'sesuai') sm.sesuai += r.dms;
    if (r.status === 'belum') sm.belum += r.dms;
    if (r.status === 'luar') sm.luar += r.counted;
  });
  const pc = n => dmsN ? n / dmsN * 100 : 0;
  const rp = n => Math.round(pc(n)) + '%';
  const tile = (cls, label, pill, big, unit, bar, foot) => '<div class="tile ' + cls + '"><div class="t-h"><span class="t-k">' + label + '</span><span class="t-p">' + pill + '</span></div><div class="t-v"><b>' + big + '</b><small>' + unit + '</small></div><div class="t-bar">' + bar + '</div><div class="t-f">' + foot + '</div></div>';
  const seg = (n, k) => '<i class="' + (k || '') + '" style="width:' + pc(n).toFixed(1) + '%"></i>';
  const sel = c.kurang + c.lebih;
  $('#tiles').innerHTML =
    tile('t-prog', 'Dihitung', rp(counted), fmt(counted), 'dari ' + fmt(dmsN) + ' SKU', seg(counted), 'Hitung <b>' + fmt(sm.cnt) + '</b> dari <b>' + fmt(sm.dms) + '</b> pcs stok DMS')
    + tile('t-ok', 'Sesuai', rp(c.sesuai), fmt(c.sesuai), 'SKU', seg(c.sesuai), '<b>' + fmt(sm.sesuai) + '</b> pcs cocok dengan DMS')
    + tile('t-sel', 'Selisih', rp(sel), fmt(sel), 'SKU', seg(c.kurang, 'neg') + seg(c.lebih, 'pos'), '<span class="neg">' + fmt(c.kurang) + ' kurang · ' + fmt(minus) + ' pcs</span><br><span class="pos">' + fmt(c.lebih) + ' lebih · +' + fmt(plus) + ' pcs</span>')
    + tile('t-wait', 'Belum dihitung', rp(c.belum), fmt(c.belum), 'SKU', seg(c.belum), '<b>' + fmt(sm.belum) + '</b> pcs stok belum dihitung' + (c.luar ? '<br><span class="warnt">' + fmt(c.luar) + ' SKU di luar DMS · ' + fmt(sm.luar) + ' pcs</span>' : ''));

  // daftar device: terbaru dulu, ringkasan status berfungsi sebagai filter, hanya 4 teratas kecuali dibuka
  $('#devCnt').textContent = devs.length ? devs.length + ' device' : '';
  const dsAll = devs.map(d => {
    const items = Object.entries(d.items); let t = 0;
    items.forEach(([sku, it]) => { if (isBad(sku)) return; const p = productFor(sku); t += toPcs(it, p ? p.k : 0); });
    const age = d.updatedAt ? Date.now() - new Date(d.updatedAt).getTime() : Infinity;
    // status dari waktu update terakhir yang diterima server (bukan dari sinyal langsung HP)
    const st = d.mine ? (S.online ? 'on' : 'off') : age < 5 * 60000 ? 'on' : age < 15 * 60000 ? 'wait' : 'off';
    return {d, n: items.length, t, st, at: d.mine ? Date.now() : (d.updatedAt ? new Date(d.updatedAt).getTime() : 0)};
  }).sort((x, y) => y.at - x.at);
  const dq = S.devQ.trim().toLowerCase();
  const dBase = dq ? dsAll.filter(x => String(x.d.name || '').toLowerCase().includes(dq)) : dsAll;
  const dCnt = {semua: dBase.length, on: 0, wait: 0, off: 0}; dBase.forEach(x => dCnt[x.st]++);
  if (dq && S.devF !== 'semua' && !dCnt[S.devF]) S.devF = 'semua';
  const dView = dBase.filter(x => S.devF === 'semua' || x.st === S.devF);
  const LIM = 4; const dShown = (!S.devAll && dView.length > LIM) ? dView.slice(0, LIM) : dView;
  $('#devQWrap').hidden = dsAll.length <= 6; $('#devQClr').hidden = !dq;
  $('#devChips').hidden = $('#devHint').hidden = !dsAll.length;
  $('#devChips').innerHTML = [['semua', 'Semua', ''], ['on', 'Aktif', 'on'], ['wait', 'Menunggu', 'wait'], ['off', 'Tidak aktif', 'off']].map(([k, l, c]) => '<button type="button" data-f="' + k + '" aria-pressed="' + (S.devF === k) + '"' + (dCnt[k] || k === 'semua' ? '' : ' class="z"') + '>' + (c ? '<i class="dot ' + c + '"></i>' : '') + l + ' <b>' + fmt(dCnt[k]) + '</b></button>').join('');
  $('#devMore').hidden = dView.length <= LIM;
  $('#devMore').textContent = S.devAll ? 'Tampilkan lebih sedikit' : 'Tampilkan semua (' + fmt(dView.length) + ')';
  const devCard = x => {
    const d = x.d, st = x.st, stTxt = {on: 'Aktif', wait: 'Menunggu', off: 'Tidak aktif'}[st];
    return `<div class="dev ${st}"><svg class="phone" viewBox="0 0 24 36" aria-hidden="true"><rect class="pb" x="2" y="1" width="20" height="34" rx="4"/><rect class="ps" x="5" y="6" width="14" height="21" rx="1.5"/><circle class="pd" cx="12" cy="31" r="1.4"/></svg>
      <div class="dv-i"><div class="n">${esc(d.name || 'Tanpa nama')} ${d.mine ? '<span class="you">device ini</span>' : ''}</div>
      <div class="m">${fmt(new Set(Object.keys(d.items).map(baseSku)).size)} SKU · ${fmt(x.t)} pcs</div></div>
      <div class="dv-s"><span class="stp"><i></i>${stTxt}</span><span class="m">${esc(ago(d.updatedAt))}${d.updatedAt ? ' · ' + esc(fmtTime(d.updatedAt)) : ''}</span></div></div>`;
  };
  $('#devList').innerHTML = !dsAll.length ? '<div class="empty">Belum ada device yang menghitung di sesi ini. Salin link penghitung di tab Sesi dan bagikan ke tim gudang.</div>'
    : !dShown.length ? '<div class="empty">Tidak ada device yang cocok. <button type="button" class="lnk" id="devReset">Hapus pencarian dan filter</button></div>'
    : dShown.map(devCard).join('');

  const q = norm(S.rkSearch);
  const bySearch = q ? rows.filter(r => norm(r.sku).includes(q) || norm(r.name).includes(q) || norm(r.b).includes(q)) : rows;
  const inF = (r, k) => k === 'semua' ? true : k === 'selisih' ? (r.status === 'kurang' || r.status === 'lebih') : r.status === k;
  const cnt = {}; FILTERS.forEach(([k]) => { cnt[k] = bySearch.filter(r => inF(r, k)).length; });
  if (q && S.rkFilter !== 'semua' && !cnt[S.rkFilter]) S.rkFilter = 'semua';
  const f = S.rkFilter;
  const list = bySearch.filter(r => inF(r, f));
  const absDiff = r => r.inDms && r.has ? Math.abs(r.diff) : -1;
  const SORT_RK = {
    perhatian: (x, y) => (ORDER[x.status] - ORDER[y.status]) || (Math.abs(y.diff) - Math.abs(x.diff)) || x.sku.localeCompare(y.sku),
    selisih: (x, y) => (absDiff(y) - absDiff(x)) || x.sku.localeCompare(y.sku),
    hitung: (x, y) => (y.counted - x.counted) || x.sku.localeCompare(y.sku),
    nama: (x, y) => String(x.inDms ? x.name : x.sku).localeCompare(String(y.inDms ? y.name : y.sku), 'id'),
    sku: (x, y) => x.sku.localeCompare(y.sku, 'id', {numeric: true}),
  };
  list.sort(SORT_RK[S.rkSort] || SORT_RK.perhatian);
  $('#rkSort').value = S.rkSort;
  $('#rkRst').hidden = !(S.rkSearch.trim() || f !== 'semua' || S.rkSort !== 'perhatian');
  $('#rkFilter').innerHTML = FILTERS.map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${f === k}"${cnt[k] || k === 'semua' ? '' : ' class="z"'}>${l} <b>${fmt(cnt[k])}</b></button>`).join('');

  const shown = list.slice(0, S.rkLimit);
  $('#rkMeta').textContent = list.length === rows.length ? fmt(rows.length) + ' SKU' : fmt(list.length) + ' dari ' + fmt(rows.length) + ' SKU';
  $('#rkList').innerHTML = shown.length ? shown.map(r => rekapCard(r, devs)).join('') : '<div class="empty">Tidak ada barang dengan status ini. Pilih filter lain atau kosongkan pencarian.</div>';
  $('#rkMore').hidden = list.length <= S.rkLimit;
  $('#rkMore').textContent = 'Tampilkan lebih banyak (' + fmt(list.length - S.rkLimit) + ' lagi)';
}

/* ================= excel ================= */
async function xlsxLib(){ if (!window.XLSX) await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'); return window.XLSX; }
function downloadBlob(filename, blob){
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function saveXlsx(filename, sheets){
  try {
    const X = await xlsxLib(); const wb = X.utils.book_new();
    sheets.forEach(([name, aoa, widths]) => { const ws = X.utils.aoa_to_sheet(aoa); if (widths) ws['!cols'] = widths.map(w => ({wch: w})); X.utils.book_append_sheet(wb, ws, name); });
    X.writeFile(wb, filename);
  } catch(e){
    const csv = sheets[0][1].map(r => r.map(v => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\n');
    downloadBlob(filename.replace(/\.xlsx$/, '.csv'), new Blob(['﻿' + csv], {type: 'text/csv'}));
  }
}
async function exportRekap(){
  const {devs, rows} = computeRecap(); const s = curSession();
  rows.sort((a, b) => a.sku.localeCompare(b.sku));
  const head = ['SKU', 'Barcode', 'Nama', 'Isi Karton', ...devs.map(d => d.name + ' (pcs)'), 'Hitung Karton', 'Hitung Lusin', 'Hitung Pcs', 'Total Hitung Good (pcs)', 'Bad Stock (pcs)', 'Stok DMS (pcs)', 'Selisih Good (pcs)', 'Status'];
  const aoa = [head];
  for (const r of rows) {
    const o = klp(r.counted, r.isi);
    aoa.push([r.sku, r.b, r.name, r.isi, ...devs.map(d => r.per[d.id] ?? ''), o.k, o.l, o.p, r.counted, r.bad || '', r.inDms ? r.dms : '', r.diff, STATUS_LABEL[r.status]]);
  }
  const dev = [['Device', 'SKU', 'Kondisi', 'Karton', 'Lusin', 'Pcs', 'Total (pcs)']];
  devs.forEach(d => Object.entries(d.items).forEach(([sku, it]) => { const p = productFor(sku); dev.push([d.name, baseSku(sku), isBad(sku) ? 'Bad Stock' : 'Good Stock', it.k || 0, it.l || 0, it.p || 0, toPcs(it, p ? p.k : 0)]); }));
  const name = 'stok-opname-' + (s ? s.name : 'sesi').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.xlsx';
  await saveXlsx(name, [['Rekap', aoa, [16, 16, 36, 10]], ['Per Device', dev, [18, 16, 12, 8, 8, 8, 12]]]);
}

/* ================= import DMS ================= */
const ALIAS = {
  s: ['sku','kode','kode_barang','kode_produk','item_code','itemcode','product_code','kd_brg','kode_item','kodebarang'],
  b: ['barcode','ean','upc','barcode_pcs','gtin','barcode_satuan'],
  bk: ['barcode_karton','barcode_ctn','barcode_dus','ean_karton','barcode_box'],
  n: ['nama','nama_barang','nama_produk','name','product_name','deskripsi','description','item_name','namabarang'],
  k: ['isi_karton','isi','pcs_per_karton','konversi','isi_ctn','pcs_karton','qty_per_karton','isi_dus','isi_per_karton'],
  q: ['stok','stock','qty','stok_dms','saldo','stok_akhir','on_hand','qty_pcs','total_pcs'],
  a: ['ada_stok'],
  qk: ['stok_karton','karton','ctn','dus'], ql:['stok_lusin','lusin','lsn','dzn'], qp: ['stok_pcs','pcs','stok_pcs_sisa','eceran']
};
function parseDelimited(text){
  const first = text.split(/\r?\n/)[0] || '';
  const delim = [['\t', (first.match(/\t/g) || []).length], [';', (first.match(/;/g) || []).length], [',', (first.match(/,/g) || []).length]].sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const int = v => { const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10); return isNaN(n) ? 0 : n; };
function parseDmsRows(rows, fileName, noStock){
  rows = rows.filter(r => r && r.some(c => String(c ?? '').trim() !== ''));
  if (rows.length < 2) return {items: [], error: 'Data kosong atau hanya berisi header.'};
  const head = rows[0].map(h => String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  const col = {};
  for (const [key, names] of Object.entries(ALIAS)) { const i = head.findIndex(h => names.includes(h)); if (i >= 0) col[key] = i; }
  if (col.s == null) return {items: [], error: 'Kolom SKU tidak ditemukan. Header yang terbaca: ' + rows[0].join(', ')};
  const split = col.qk != null || col.ql != null || col.qp != null;
  if (!noStock && !split && col.q == null) return {items: [], error: 'Kolom stok tidak ditemukan. Tambah kolom stok_karton, stok_lusin, stok_pcs.'};
  const map = new Map(); let skipped = 0, dup = 0, noIsi = 0;
  const cell = (r, k) => col[k] != null ? String(r[col[k]] ?? '').trim() : '';
  for (const r of rows.slice(1)) {
    const s = norm(cell(r, 's')); if (!s) { skipped++; continue; }
    const k = int(cell(r, 'k'));
    const qk = int(cell(r, 'qk')), ql = int(cell(r, 'ql')), qp = int(cell(r, 'qp'));
    const q = split ? qk * k + ql * 12 + qp : int(cell(r, 'q'));
    if (qk > 0 && !(k > 0)) noIsi++;
    const item = {s, n: cell(r, 'n') || s, k, q, qk, ql, qp};
    if (noStock) { if (col.a != null) item.a = cell(r, 'a') === '1' ? 1 : 0; } else item.a = q > 0 ? 1 : 0;
    if (cell(r, 'b')) item.b = cell(r, 'b');
    if (cell(r, 'bk')) item.bk = cell(r, 'bk');
    if (map.has(s)) { const m = map.get(s); m.q += q; m.qk += qk; m.ql += ql; m.qp += qp; if (item.a != null) m.a = (m.a || 0) | item.a; dup++; } else map.set(s, item);
  }
  return {items: [...map.values()], skipped, dup, noIsi, split, fileName, found: Object.keys(col).map(k => head[col[k]])};
}
async function readDmsFile(f){
  try {
    if (/\.xlsx?$/i.test(f.name)) {
      const X = await xlsxLib();
      const wb = X.read(await f.arrayBuffer(), {type: 'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      S.parsed = parseDmsRows(X.utils.sheet_to_json(ws, {header: 1, raw: false, defval: ''}), f.name);
    } else {
      S.parsed = parseDmsRows(parseDelimited((await f.text()).replace(/^﻿/, '')), f.name);
    }
  } catch(e){ S.parsed = {items: [], error: 'File tidak bisa dibaca: ' + e.message}; }
  S.confirmImport = false; renderDmsPreview();
}
function importImpact(p){
  const cur = new Set(S.master.items.map(i => i.s)); const nxt = new Map(p.items.map(i => [i.s, i.k || 0]));
  const counted = new Set([...(S.local ? Object.keys(S.local.items) : []), ...S.remote.map(r => r[2])].map(baseSku));
  const lost = [], changed = [];
  counted.forEach(sku => {
    if (!cur.has(sku)) return;
    const old = productFor(sku);
    if (!nxt.has(sku)) lost.push(sku);
    else if (old && old.k > 0 && nxt.get(sku) !== old.k) changed.push(sku + ' (' + fmt(old.k) + ' → ' + fmt(nxt.get(sku)) + ')');
  });
  return {lost, changed};
}
function renderDmsPreview(){
  const box = $('#dmsPreview'); const p = S.parsed;
  if (!p) { box.innerHTML = ''; return; }
  if (p.error) { box.innerHTML = `<div class="prevbox"><div class="neg">${esc(p.error)}</div></div>`; return; }
  const tot = p.items.reduce((a, i) => a + i.q, 0);
  const imp = importImpact(p); const nImp = imp.lost.length + imp.changed.length;
  const key = p.fileName + '|' + p.items.length; if (S.impKey !== key) { S.impKey = key; S.impAck = false; }
  const lst = x => esc(x.slice(0, 5).join(', ')) + (x.length > 5 ? ' dan ' + (x.length - 5) + ' lainnya' : '');
  const impHtml = nImp ? '<div class="ng-impact"><p>' + (imp.lost.length ? '<b>' + fmt(imp.lost.length) + ' SKU yang sudah dihitung tidak ada di file baru</b> (' + lst(imp.lost) + '). Hitungannya akan terbaca 0 pcs.' : '') + (imp.lost.length && imp.changed.length ? '<br>' : '') + (imp.changed.length ? '<b>' + fmt(imp.changed.length) + ' SKU berubah isi per karton</b> (' + lst(imp.changed) + '). Total pcs hitungan dalam karton ikut berubah.' : '') + '</p></div><label class="ng-ck"><input type="checkbox" id="impAck"' + (S.impAck ? ' checked' : '') + '><span>Saya mengerti</span></label>' : '';
  const warn = [p.skipped ? '<span class="pill luar">' + fmt(p.skipped) + ' baris tanpa SKU dilewati</span>' : '', p.dup ? '<span class="pill luar">' + fmt(p.dup) + ' SKU dobel dijumlahkan</span>' : ''].join('');
  box.innerHTML = `<div class="prevbox">
    <div><b>${fmt(p.items.length)} SKU</b> terbaca dari ${esc(p.fileName)} · total ${fmt(tot)} pcs</div>
    ${warn ? '<div class="prevwarn">' + warn + '</div>' : ''}
    ${impHtml}
    ${p.noIsi ? `<div class="neg">${fmt(p.noIsi)} SKU tanpa isi_karton, kartonnya terhitung 0 pcs.</div>` : ''}
    ${S.confirmImport
      ? `<div class="confirm"><span>Ganti ${fmt(S.master.items.length)} SKU lama dengan ${fmt(p.items.length)} SKU baru? Hitungan device tetap aman.</span><button class="btn sm danger" type="button" id="impYes">Ya, ganti</button><button class="btn sm" type="button" id="impNo">Batal</button></div>`
      : `<div class="row"><button class="btn primary" type="button" id="impBtn"${nImp && !S.impAck ? ' disabled' : ''}>Simpan ke Google Sheet</button><button class="btn" type="button" id="impNo">Batal</button></div>`}
  </div>`;
}
async function importMaster(){
  const p = S.parsed; if (!p || !p.items.length) return;
  const btn = $('#impYes') || $('#impBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan…'; }
  try {
    await API.post({action: 'importMaster', fileName: p.fileName, rows: p.items.map(i => [i.s, i.b || '', i.bk || '', i.n, i.k, i.qk, i.ql, i.qp])});
    S.parsed = null; S.confirmImport = false; renderDmsPreview();
    await syncMaster(null, true);
  } catch(e){
    S.confirmImport = false; renderDmsPreview();
    toast(netFail(e) ? 'Gagal menyimpan: tidak ada koneksi' : 'Gagal menyimpan: ' + e.message);
  }
}
// kartu master barang: isi karton, stok pcs, dan konversinya
function dmsCard(p){
  const noIsi = !(p.k > 0);
  const ic = noIsi ? ['info', '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'] : ['ok', '<path d="M5 12.5l4.5 4.5L19 7.5"/>'];
  const tag = noIsi ? '<span class="pill luar">Isi kosong</span>' : !(p.q > 0) ? '<span class="pill belum">Stok 0</span>' : '<span></span>';
  const sub = esc(p.s) + (p.b ? ' · ' + esc(p.b) : '') + (p.bk ? ' · ctn ' + esc(p.bk) : '');
  const cell = (label, val, s) => '<div><small>' + label + '</small><b>' + val + '</b><em>' + s + '</em></div>';
  return '<div class="rk"><div class="rk-h"><span class="si ' + ic[0] + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + ic[1] + '</svg></span><div class="it-i"><div class="nm">' + esc(p.n) + '</div><div class="sk">' + sub + '</div></div>' + tag + '</div><div class="rk-s two">'
    + cell('Isi karton', noIsi ? '-' : fmt(p.k), noIsi ? 'belum ada' : 'pcs/karton')
    + cell('Stok DMS', fmt(p.q || 0), (p.q > 0 ? esc(fmtFull(klp(p.q, p.k))) : 'pcs')) + '</div></div>';
}
function renderDms(){
  const m = S.master.meta;
  const mi = (ic, label, val, cls) => '<div class="mi3' + (cls ? ' ' + cls : '') + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + ic + '</svg><span><small>' + label + '</small><b>' + val + '</b></span></div>';
  $('#dmsMeta').innerHTML = S.master.items.length
    ? mi('<path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/>', 'Data', fmt(S.master.items.length) + ' SKU') + mi('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 'Diperbarui', m && m.importedAt ? esc(fmtDate(m.importedAt)) : '-') + (m && m.fileName ? mi('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5"/>', 'File', esc(m.fileName), 'wide') : '')
    : '<div class="empty">Belum ada data stok DMS. Unggah file untuk mulai.</div>';
  const q = norm(S.dmsSearch);
  const all = S.master.items;
  const bySearch = q ? all.filter(p => norm(p.s).includes(q) || norm(p.n).includes(q) || norm(p.b).includes(q) || norm(p.bk).includes(q)) : all;
  const inD = (p, k) => k === 'semua' || (k === 'isi' && !(p.k > 0)) || (k === 'nol' && !(p.q > 0));
  const DF = [['semua', 'Semua'], ['isi', 'Isi karton kosong'], ['nol', 'Stok kosong']];
  const cnt = {}; DF.forEach(([k]) => { cnt[k] = bySearch.filter(p => inD(p, k)).length; });
  if (q && S.dmsFilter !== 'semua' && !cnt[S.dmsFilter]) S.dmsFilter = 'semua';
  const f = S.dmsFilter;
  const list = bySearch.filter(p => inD(p, f));
  const numSku = (x, y) => String(x.s).localeCompare(String(y.s), 'id', {numeric: true});
  const SORT = {sku: numSku, nama: (x, y) => String(x.n).localeCompare(String(y.n), 'id'), stok: (x, y) => ((y.q || 0) - (x.q || 0)) || numSku(x, y)};
  list.sort(SORT[S.dmsSort] || numSku);
  $('#dmsCnt').textContent = fmt(all.length) + ' SKU';
  $('#dmsChips').innerHTML = DF.map(([k, l]) => '<button type="button" data-f="' + k + '" aria-pressed="' + (f === k) + '"' + (cnt[k] || k === 'semua' ? '' : ' class="z"') + '>' + l + ' <b>' + fmt(cnt[k]) + '</b></button>').join('');
  $('#dmsSort').value = S.dmsSort;
  $('#dmsRst').hidden = !(S.dmsSearch.trim() || f !== 'semua' || S.dmsSort !== 'sku');
  $('#dmsCntMeta').textContent = list.length === all.length ? fmt(all.length) + ' SKU' : fmt(list.length) + ' dari ' + fmt(all.length) + ' SKU';
  const shown = list.slice(0, S.dmsLimit);
  $('#dmsList').innerHTML = shown.length ? shown.map(dmsCard).join('') : '<div class="empty">' + (all.length ? 'Tidak ada barang yang cocok. Hapus pencarian atau filter.' : 'Unggah file dari DMS untuk mulai.') + '</div>';
  $('#dmsMore').textContent = 'Tampilkan lebih banyak (' + fmt(Math.max(0, list.length - S.dmsLimit)) + ' lagi)';
  $('#dmsMore').hidden = list.length <= S.dmsLimit;
}

/* ================= sesi ================= */
function renderSesi(){
  const has = !!S.deviceName, editing = !has || !!S.nameEditing;
  $('#devCard').hidden = editing; $('#devForm').hidden = !editing; $('#devCancel').hidden = !has;
  $('#devNameShow').textContent = S.deviceName;
  if (document.activeElement !== $('#devName')) $('#devName').value = S.deviceName;
  $('#sessCnt').textContent = S.sessions.length ? S.sessions.length + ' sesi' : '';
  const box = $('#sessList');
  box.innerHTML = S.sessions.length ? S.sessions.map(s => {
    const cur = s.id === S.sessionId, closed = s.status === 'closed';
    const lbl = closed ? 'Ditutup' : 'Berjalan';
    const ico = `<span class="si ${closed ? 'off' : 'ok'}" title="${lbl}" role="img" aria-label="${lbl}"><svg viewBox="0 0 24 24">${closed ? '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>' : '<path d="M8 5l11 7-11 7z"/>'}</svg></span>`;
    const use = cur ? '<span class="you">Dipakai</span>' : `<button class="btn sm primary" type="button" data-use="${esc(s.id)}">Pakai</button>`;
    const adm = MODE === 'admin' ? IB.tog('data-toggle="' + esc(s.id) + '"', closed ? 'Buka lagi sesi' : 'Tutup sesi', closed) + IB.del('data-sdel="' + esc(s.id) + '"', 'Hapus sesi') : '';
    return `<div class="sess ${cur ? 'cur' : ''}">${ico}<div class="it-i"><div class="nm">${esc(s.name)}</div><div class="sk">Dibuat ${esc(fmtDate(s.createdAt))} · <span class="pill ${closed ? 'closed' : 'open'}">${lbl}</span></div></div><div class="it-a">${use}${adm}</div>${S.confirmSess === s.id ? `<div class="confirm"><span>Hapus sesi "${esc(s.name)}" beserta hitungan semua device di Google Sheet? Tidak bisa dibatalkan.</span><button class="btn sm danger" type="button" data-sdelyes="${esc(s.id)}">Ya, hapus</button><button class="btn sm" type="button" data-scancel="1">Batal</button></div>` : ''}</div>`;
  }).join('') : `<div class="empty">${MODE === 'hitung' ? 'Belum ada sesi yang berjalan. Minta admin membuat sesi.' : 'Belum ada sesi. Buat sesi di bawah, lalu bagikan link penghitung.'}</div>`;
  renderCounterLink();
}
function counterUrl(){
  if (window.APP_CONFIG && window.APP_CONFIG.COUNTER_URL) return window.APP_CONFIG.COUNTER_URL;
  const k = encodeURIComponent(S.kodeHitung);
  if (window.APP_CONFIG && window.APP_CONFIG.EMBEDDED) return window.APP_CONFIG.APPS_SCRIPT_URL + '?page=hitung&k=' + k;
  return new URL('hitung.html?k=' + k, location.href).toString();
}
function renderCounterLink(){
  const box = $('#counterLink'); if (!box) return;
  if (!S.kodeHitung) { box.innerHTML = '<div class="empty">Memuat…</div>'; return; }
  box.innerHTML = `<div class="linkbox mono" id="counterUrl">${esc(counterUrl())}</div>
    <div class="row" style="margin-top:10px">
      <button class="btn primary" type="button" id="copyCounter">Salin link</button>
      <button class="btn danger" type="button" id="rotateCounter">Ganti link</button>
    </div>
    ${S.confirmRotate ? `<div class="confirm" style="margin-top:10px"><span>Link lama langsung mati. Penghitung perlu link baru. Hitungan tetap aman.</span><button class="btn sm danger" type="button" id="rotateYes">Ya, ganti</button><button class="btn sm" type="button" id="rotateNo">Batal</button></div>` : ''}`;
}
async function copyCounter(){
  const url = counterUrl();
  try { await navigator.clipboard.writeText(url); toast('Link penghitung disalin'); }
  catch(e){ const r = document.createRange(); r.selectNodeContents($('#counterUrl')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('Tekan Salin untuk menyalin link'); }
}
async function rotateCounter(){
  try { const d = await API.post({action: 'rotateCounterCode'}); S.kodeHitung = d.kodeHitung; S.confirmRotate = false; renderCounterLink(); toast('Link penghitung baru dibuat'); }
  catch(e){ S.confirmRotate = false; renderCounterLink(); toast(netFail(e) ? 'Perlu koneksi internet untuk ini' : 'Gagal: ' + e.message); }
}
function setSessions(list){
  S.sessions = (list || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  LS.put(K('so-sessions'), S.sessions);
  let unblocked = false;
  S.sessions.forEach(s => { if (s.status !== 'closed' && S.blocked[s.id]) { delete S.blocked[s.id]; unblocked = true; } });
  if (unblocked) schedulePush(500);
  if (S.sessionId && !S.sessions.find(s => s.id === S.sessionId)) { const pick = S.sessions.find(s => s.status !== 'closed') || S.sessions[0]; selectSession(pick ? pick.id : null); }
  renderAll();
}
async function refreshSessions(){
  try { const d = await API.get({action: 'init'}); S.online = true; S.gudang = d.gudang || ''; S.kodeHitung = d.kodeHitung || S.kodeHitung; setSessions(d.sessions); if (d.master && (!S.master.meta || d.master.version !== S.master.meta.version)) syncMaster(d.master); }
  catch(e){ if (netFail(e)) { S.online = false; renderSync(); } }
}
async function sessAction(body, okMsg){
  try { const d = await API.post(body); setSessions(d.sessions); if (okMsg) toast(okMsg); return d; }
  catch(e){ toast(netFail(e) ? 'Perlu koneksi internet untuk ini' : 'Gagal: ' + e.message); return null; }
}
async function createSession(){
  const name = $('#newSess').value.trim(); if (!name) { $('#newSess').focus(); return; }
  const btn = $('#newSessBtn'); btn.disabled = true;
  const d = await sessAction({action: 'createSession', nama: name, device_nama: S.deviceName}, 'Sesi dibuat');
  btn.disabled = false; syncRequired();
  if (d) { $('#newSess').value = ''; selectSession(d.id); }
}

/* ================= tabs / render ================= */
function setTab(t){
  if (!TABS.includes(t)) t = 'hitung';
  S.tab = t; LS.set(K('so-tab'), t);
  S.confirmLog = null; S.editingLog = null; S.confirmDel = null; S.editing = null;
  if (t !== 'sesi') S.nameEditing = false;
  document.body.dataset.tab = t; $('#heroCard').hidden = t !== 'hasil';
  document.querySelectorAll('#tabs button[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  TABS.forEach(k => $('#tab-' + k).hidden = k !== t);
  renderAll();
  if (t === 'rekap') fetchRekap();
  if (t === 'sesi') refreshSessions();
  if (t === 'hitung' && canCount() && matchMedia('(pointer:fine)').matches) setTimeout(() => $('#scanInput').focus(), 0);
}
function renderAll(){
  if ($('#appScreen').hidden) return;
  renderHeader();
  if (S.tab === 'hitung') renderHitung();
  if (S.tab === 'hasil') renderHitungLists();
  if (S.tab === 'rekap') renderRekap();
  if (S.tab === 'dms') renderDms();
  if (S.tab === 'sesi') renderSesi();
  if (typeof syncRequired === 'function') syncRequired();
}
function logout(expired){
  closeCam(); LS.del(K('so-code')); S.code = '';
  $('#loginErr').textContent = !expired ? '' : MODE === 'hitung' ? 'Link penghitung sudah diganti. Minta link baru ke admin.' : 'Kode akses sudah diganti. Masukkan kode yang baru.';
  showLogin();
}

/* ================= events ================= */
on('#loginForm', 'submit', e => { e.preventDefault(); const c = $('#codeInput').value.trim(); if (!c) { $('#loginErr').textContent = 'Isi kode akses dulu.'; return; } $('#loginErr').textContent = ''; login(c, false); });
on('#tabs', 'click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) { setTab(g.dataset.go); if (g.dataset.go === 'sesi') setTimeout(() => { const el = S.deviceName ? $('#newSess') : $('#devName'); if (el) el.focus(); }, 0); } });
on('#counterLink', 'click', e => {
  const id = e.target.id;
  if (id === 'copyCounter') copyCounter();
  else if (id === 'rotateCounter') { S.confirmRotate = true; renderCounterLink(); }
  else if (id === 'rotateNo') { S.confirmRotate = false; renderCounterLink(); }
  else if (id === 'rotateYes') rotateCounter();
});
on('#refreshBtn', 'click', () => {
  const b = $('#refreshBtn'); b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin');
  toast('Menyegarkan data…');
  Promise.allSettled([pushAll(), refreshSessions(), S.tab === 'rekap' ? fetchRekap() : null]).then(renderSync);
});
on('#syncInfo', 'click', e => { e.stopPropagation(); const p = $('#syncPop'); p.hidden = !p.hidden; });
document.addEventListener('click', () => { const p = $('#syncPop'); if (p) p.hidden = true; });
function openNameGate(){
  if (!S.deviceName) { S.nameEditing = true; setTab('sesi'); setTimeout(() => $('#devName').focus(), 0); return; }
  const n = S.local ? Object.keys(S.local.items).length : 0;
  const phone = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>';
  const t = '<div class="ng-rule">' + phone + '<span>Satu device = <b>satu penghitung</b></span></div>'
    + (n ? '<div class="ng-impact"><div class="ng-n"><b>' + fmt(n) + '</b><span>SKU</span></div><p>yang sudah dihitung atas nama <b>' + esc(S.deviceName) + '</b> ikut memakai nama baru, di Sheet dan Rekap.</p></div>' : '')
    + '<p class="ng-note">Gunakan hanya untuk <b>memperbaiki salah ketik</b>.' + (n ? ' Penghitung lain? <b>Pakai HP lain.</b>' : '') + '</p>';
  $('#ngText').innerHTML = t;
  $('#ngCkWrap').hidden = !n; $('#ngCk').checked = false; $('#ngYes').disabled = !!n;
  $('#nameGate').hidden = false; setTimeout(() => $('#ngNo').focus(), 0);
}
function closeNameGate(){ $('#nameGate').hidden = true; }
on('#devChip', 'click', openNameGate);
on('#sessLink', 'click', () => setTab('sesi'));
on('#devEditBtn', 'click', openNameGate);
on('#ngNo', 'click', closeNameGate);
on('#ngCk', 'change', e => { $('#ngYes').disabled = !e.target.checked; });
on('#nameGate', 'click', e => { if (e.target.id === 'nameGate') closeNameGate(); });
on('#ngYes', 'click', () => { closeNameGate(); S.nameEditing = true; setTab('sesi'); setTimeout(() => { const i = $('#devName'); i.focus(); i.select(); }, 0); });
on('#devCancel', 'click', () => { S.nameEditing = false; renderSesi(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#nameGate').hidden) closeNameGate(); });

on('#scanInput', 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleScan(); } });
on('#scanInput', 'input', e => { if (!S.quickOn) renderSuggest(suggestions(e.target.value)); });
on('#scanBtn', 'click', handleScan);
on('#camBtn', 'click', openCam);
on('#fabCam', 'click', () => { if (S.tab !== 'hitung') setTab('hitung'); openCam(); });
on('#camClose', 'click', closeCam);
on('#suggest', 'click', e => { const b = e.target.closest('[data-sku]'); if (!b) return; const p = productFor(b.dataset.sku); const u = b.dataset.u || null; $('#scanInput').value = ''; renderSuggest([]); scanMsg(''); if (p) openCard(p, p.s, u); });
on('#quickOn', 'change', e => { S.quickOn = e.target.checked; S.quickCond = null; LS.set('so-quick', S.quickOn ? '1' : '0'); renderSuggest([]); renderHitung(); });
on('#quickCond', 'click', e => { const b = e.target.closest('[data-c]'); if (!b) return; S.quickCond = b.dataset.c; renderHitung(); });
on('#condSeg', 'click', e => { const b = e.target.closest('[data-c]'); if (!b || !S.current) return; S.current.cond = b.dataset.c; document.querySelectorAll('#condSeg button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.c === S.current.cond))); updatePreview(); });
on('#quickUnit', 'click', e => { const b = e.target.closest('[data-u]'); if (!b) return; S.quickUnit = b.dataset.u; LS.set('so-quick-unit', S.quickUnit); renderHitung(); });
['#qK', '#qL', '#qP', '#qI'].forEach(s => {
  $(s).addEventListener('input', updatePreview);
  $(s).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitCard(); } });
});
on('#addBtn', 'click', submitCard);
on('#pcClose', 'click', () => { closeCard(); scanMsg(''); });

on('#logList', 'click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.undo) { S.editingLog = null; S.confirmLog = b.dataset.undo; renderHitungLists(); }
  else if (b.dataset.undoyes) { S.confirmLog = null; undoLog(b.dataset.undoyes); }
  else if (b.dataset.ledit) { S.confirmLog = null; S.editingLog = b.dataset.ledit; renderHitungLists(); setTimeout(() => $('#le-p') && $('#le-p').focus(), 0); }
  else if (b.dataset.lcancel) { S.editingLog = null; S.confirmLog = null; renderHitungLists(); }
  else if (b.dataset.lsave) { const v = id => Math.max(0, +$(id).value || 0); editLog(b.dataset.lsave, {k: v('#le-k'), l: v('#le-l'), p: v('#le-p')}); }
});
on('#myList', 'click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.edit) { S.editing = b.dataset.edit; S.confirmDel = null; renderHitungLists(); setTimeout(() => $('#e-l') && $('#e-l').focus(), 0); }
  else if (b.dataset.del) { S.confirmDel = b.dataset.del; S.editing = null; renderHitungLists(); }
  else if (b.dataset.cancel) { S.editing = null; S.confirmDel = null; renderHitungLists(); }
  else if (b.dataset.delyes) {
    const sku = b.dataset.delyes; delete S.local.items[sku]; markDirty(sku); S.confirmDel = null;
    addLog({sku, k: 0, l: 0, p: 0, aksi: 'hapus'}); afterChange(); toast('Dihapus: ' + sku);
  } else if (b.dataset.save) {
    const sku = b.dataset.save; const v = id => Math.max(0, +$(id).value || 0);
    const it = Object.assign(normQ({k: v('#e-k'), l: v('#e-l'), p: v('#e-p')}, isiOf(sku)), {at: now(), cor: true});
    if (!it.k && !it.l && !it.p) delete S.local.items[sku]; else S.local.items[sku] = it;
    markDirty(sku); S.editing = null;
    addLog({sku, k: it.k, l: it.l, p: it.p, aksi: 'koreksi'}); afterChange(); toast('Koreksi disimpan: ' + sku);
  }
});

on('#rkFilter', 'click', e => { const b = e.target.closest('[data-f]'); if (!b) return; S.rkFilter = b.dataset.f; S.rkLimit = 200; renderRekap(); });
on('#rkSearch', 'input', e => { S.rkSearch = e.target.value; S.rkLimit = 200; renderRekap(); });
on('#rkMore', 'click', () => { S.rkLimit += 300; renderRekap(); });
on('#exportBtn', 'click', exportRekap);

on('#dmsFile', 'change', e => { const f = e.target.files[0]; if (f) readDmsFile(f); e.target.value = ''; });
on('#dmsParseBtn', 'click', () => { const t = $('#dmsPaste').value; if (!t.trim()) return; S.parsed = parseDmsRows(parseDelimited(t), 'data tempel'); S.confirmImport = false; renderDmsPreview(); });
on('#dmsPreview', 'click', e => {
  if (e.target.id === 'impBtn') { if (S.master.items.length) { S.confirmImport = true; renderDmsPreview(); } else importMaster(); }
  else if (e.target.id === 'impYes') importMaster();
  else if (e.target.id === 'impNo') { if (S.confirmImport) S.confirmImport = false; else S.parsed = null; renderDmsPreview(); }
});
on('#dmsPreview', 'change', e => { if (e.target.id === 'impAck') { S.impAck = e.target.checked; renderDmsPreview(); } });
on('#dmsReload', 'click', () => syncMaster(null, true));
on('#tplBtn', 'click', () => saveXlsx('template-stok-dms.xlsx', [['Master_DMS', [
  ['sku', 'barcode', 'barcode_karton', 'nama', 'isi_karton', 'stok_karton', 'stok_lusin', 'stok_pcs'],
  ['BRG-001', '8991234567001', '18991234567001', 'Contoh Barang A 250ml', 48, 25, 0, 0],
  ['BRG-002', '8991234567002', '', 'Contoh Barang B 1kg', 12, 25, 1, 0]], [12, 16, 16, 30, 10, 12, 12, 10]]]));
on('#dmsSearch', 'input', e => { S.dmsSearch = e.target.value; S.dmsLimit = 200; renderDms(); });
on('#dmsChips', 'click', e => { const b = e.target.closest('button[data-f]'); if (!b) return; S.dmsFilter = b.dataset.f; S.dmsLimit = 200; renderDms(); });
on('#dmsSort', 'change', e => { S.dmsSort = e.target.value; S.dmsLimit = 200; renderDms(); });
on('#dmsRst', 'click', () => { S.dmsFilter = 'semua'; S.dmsSearch = ''; S.dmsSort = 'sku'; S.dmsLimit = 200; $('#dmsSearch').value = ''; renderDms(); });
on('#dmsMore', 'click', () => { S.dmsLimit += 300; renderDms(); });

function saveDeviceName(){
  const v = $('#devName').value.trim().toUpperCase().slice(0, 40); if (!v) { $('#devName').focus(); return; }
  S.deviceName = v; S.nameEditing = false; LS.set('so-device-name', v); toast('Nama device: ' + v);
  if (S.local && Object.keys(S.local.items).length) { const first = Object.keys(S.local.items)[0]; markDirty(first); saveLocal(); schedulePush(500); }
  renderAll();
}
function syncRequired(){
  const d = $('#devName'), s = $('#newSess');
  if (d) $('#devSave').disabled = !d.value.trim();
  if (s) { const b = $('#newSessBtn'); b.disabled = !s.value.trim(); }
}
['#devName', '#newSess'].forEach(sel => on(sel, 'input', syncRequired));
// nama device selalu KAPITAL: huruf kecil langsung diubah dan user diberi tahu
let capT;
on('#devName', 'input', e => {
  const el = e.target, v = el.value, u = v.toUpperCase();
  if (v === u) return;
  const s = el.selectionStart, n = el.selectionEnd;
  el.value = u; try { el.setSelectionRange(s, n); } catch (err) {}
  const note = $('#capNote'); note.hidden = false; clearTimeout(capT); capT = setTimeout(() => { note.hidden = true; }, 3500);
  syncRequired();
});
on('#devSave', 'click', saveDeviceName);
on('#devName', 'keydown', e => { if (e.key === 'Enter') saveDeviceName(); });
on('#newSessBtn', 'click', createSession);
on('#newSess', 'keydown', e => { if (e.key === 'Enter') createSession(); });
on('#sessReload', 'click', () => refreshSessions().then(() => toast('Daftar sesi diperbarui')));
on('#sessList', 'click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.use) { selectSession(b.dataset.use); toast('Sesi dipakai'); }
  else if (b.dataset.toggle) { const s = S.sessions.find(x => x.id === b.dataset.toggle); if (s) sessAction({action: 'setSessionStatus', sesi: s.id, status: s.status === 'closed' ? 'open' : 'closed'}, s.status === 'closed' ? 'Sesi dibuka lagi' : 'Sesi ditutup').then(() => pushAll()); }
  else if (b.dataset.sdel) { S.confirmSess = b.dataset.sdel; renderSesi(); }
  else if (b.dataset.scancel) { S.confirmSess = null; renderSesi(); }
  else if (b.dataset.sdelyes) {
    const sid = b.dataset.sdelyes; S.confirmSess = null;
    sessAction({action: 'deleteSession', sesi: sid}, 'Sesi dihapus').then(d => { if (d) ['so-st-', 'so-dirty-', 'so-plog-'].forEach(p => LS.del(p + sid)); });
  }
});
function wireTb(pfx, st){
  on('#' + pfx + 'Q', 'input', e => { st.q = e.target.value.trim(); renderHitungLists(); });
  on('#' + pfx + 'Clr', 'click', () => { $('#' + pfx + 'Q').value = ''; st.q = ''; renderHitungLists(); $('#' + pfx + 'Q').focus(); });
  on('#' + pfx + 'Chips', 'click', e => { const b = e.target.closest('button[data-f]'); if (!b) return; st.f = b.dataset.f; renderHitungLists(); });
  on('#' + pfx + 'Sort', 'change', e => { st.sort = e.target.value; renderHitungLists(); });
}
wireTb('log', S.qLog); wireTb('my', S.qMy);
on('#rkRst', 'click', () => { S.rkFilter = 'semua'; S.rkSearch = ''; S.rkSort = 'perhatian'; S.rkLimit = 200; $('#rkSearch').value = ''; renderRekap(); });
on('#rkSort', 'change', e => { S.rkSort = e.target.value; S.rkLimit = 200; renderRekap(); });
on('#devChips', 'click', e => { const b = e.target.closest('button[data-f]'); if (!b) return; S.devF = b.dataset.f; S.devAll = false; renderRekap(); });
on('#devQ', 'input', e => { S.devQ = e.target.value; S.devAll = false; renderRekap(); });
on('#devQClr', 'click', () => { S.devQ = ''; $('#devQ').value = ''; renderRekap(); $('#devQ').focus(); });
on('#devMore', 'click', () => { S.devAll = !S.devAll; renderRekap(); });
on('#devList', 'click', e => { if (e.target.id === 'devReset') { S.devQ = ''; S.devF = 'semua'; $('#devQ').value = ''; renderRekap(); } });
on('#logMore', 'click', () => { S.logAll = true; renderHitungLists(); });
document.addEventListener('click', e => {
  const r = e.target.closest('[data-reset]'); if (!r) return;
  const pfx = r.dataset.reset, st = pfx === 'log' ? S.qLog : S.qMy;
  st.q = ''; st.f = 'semua'; st.sort = 'baru'; $('#' + pfx + 'Q').value = ''; if (pfx === 'log') S.logAll = false; renderHitungLists();
});
// isian jumlah: hanya angka bulat, tanpa minus, maksimal 6 digit
let numTs = 0;
function numToast(msg){ if (Date.now() - numTs > 1500) { numTs = Date.now(); toast(msg); } }
document.addEventListener('input', e => {
  const t = e.target; if (!t.matches || !t.matches('#qK,#qL,#qP,#qI,#le-k,#le-l,#le-p,#e-k,#e-l,#e-p')) return;
  const v = t.value; let c = v, msg = '';
  if (c.includes('-')) { c = ''; msg = 'Jumlah tidak boleh minus'; }
  else {
    c = c.replace(/[^\d.,]/g, '');
    const m = c.match(/^(\d*)([.,]?)(\d*)/); let whole = (m[1] || '');
    if (m[3]) { c = whole; msg = 'Isi dengan angka bulat saja'; }       // desimal dibuang, bukan digabung
    else c = whole + m[2];                                           // titik di ujung dibiarkan dulu, dibuang saat selesai
    if (whole.length > 6) { c = whole.slice(0, 6); msg = 'Maksimal 999.999'; }
    if (c !== v && !msg && /[^\d.,]/.test(v)) msg = 'Isi dengan angka bulat saja';
  }
  if (c !== v) { t.value = c; if (msg) numToast(msg); }
}, true);
document.addEventListener('change', e => { const t = e.target; if (t.matches && t.matches('#qK,#qL,#qP,#qI,#le-k,#le-l,#le-p,#e-k,#e-l,#e-p')) t.value = t.value.replace(/[.,]/g, ''); }, true);
on('#logoutBtn', 'click', () => logout(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && Cam.active) closeCam(); });

/* ================= start ================= */
// Sudah punya kode (link penghitung atau login sebelumnya): langsung buka aplikasi dari data
// tersimpan, tanpa layar login. Login ke server jalan di belakang; layar login baru muncul
// kalau server menolak kodenya.
if (S.code) { $('#codeInput').value = S.code; showApp(); login(S.code, true); }
else $('#codeInput').focus();

/* ================= tombol kembali ================= */
// Tombol kembali tidak langsung keluar: modal yang sedang terbuka ditutup dulu, kalau tidak ada
// muncul dialog konfirmasi. Entri riwayat penjaga dipasang lagi di tiap sentuhan, karena Chrome
// melewati entri yang ditambahkan tanpa interaksi pengguna.
let leaving = false;
function ensureBackGuard(){ if (!(history.state && history.state.so)) history.pushState({so: 1}, ''); }
ensureBackGuard();
document.addEventListener('pointerdown', ensureBackGuard, {passive: true});

// ada isian yang belum disimpan? (jumlah di form produk, koreksi, atau nama device yang sedang diubah)
function unsavedForm(){
  const qty = S.current && (+$('#qK').value || +$('#qL').value || +$('#qP').value);
  const name = S.nameEditing && S.deviceName && $('#devName').value.trim().toUpperCase() !== S.deviceName;
  return !!(qty || S.editing || S.editingLog || name);
}
function openLeaveGate(){
  const ok = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  $('#lgText').innerHTML = '<div class="ng-rule">' + ok + '<span>Hitungan yang sudah ditambahkan <b>tetap aman</b> di HP dan terkirim saat online.</span></div>'
    + (unsavedForm() ? '<div class="ng-impact"><p>Isian di form yang <b>belum disimpan</b> akan hilang.</p></div>' : '');
  $('#leaveGate').hidden = false; setTimeout(() => $('#lgNo').focus(), 0);
}
function closeLeaveGate(){ $('#leaveGate').hidden = true; }
on('#lgNo', 'click', closeLeaveGate);
on('#leaveGate', 'click', e => { if (e.target.id === 'leaveGate') closeLeaveGate(); });
on('#lgYes', 'click', () => { closeLeaveGate(); leaving = true; history.go(-2); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#leaveGate').hidden) closeLeaveGate(); });
window.addEventListener('popstate', () => {
  if (leaving) return;
  ensureBackGuard(); // tetap di halaman ini sampai user memilih keluar
  if (!$('#leaveGate').hidden) return;
  if (!$('#camModal').hidden) { closeCam(); return; }
  if (!$('#nameGate').hidden) { closeNameGate(); return; }
  openLeaveGate();
});
// refresh atau tutup tab: peringatkan kalau ada hitungan belum terkirim atau isian belum disimpan
window.addEventListener('beforeunload', e => {
  if (leaving) return;
  if (Object.keys(S.dirty).length || unsavedForm()) { e.preventDefault(); e.returnValue = ''; }
});
})();
