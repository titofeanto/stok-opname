(() => {
'use strict';

/* ================= helpers ================= */
const $ = s => document.querySelector(s);
const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
// Halaman penghitung (hitung.html) memakai body data-mode="hitung": tanpa rekap dan tanpa angka stok DMS.
const MODE = document.body.dataset.mode === 'hitung' ? 'hitung' : 'admin';
const K = key => MODE === 'hitung' ? key + '-h' : key;
const TABS = MODE === 'hitung' ? ['hitung', 'sesi'] : ['hitung', 'rekap', 'dms', 'sesi'];
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
    if (!LS.set(k, JSON.stringify(o))) showBanner('Memori browser penuh. Hitungan terbaru mungkin tidak tersimpan di device ini — pastikan online supaya terkirim.');
  },
  keys(prefix){ const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) out.push(k); } } catch(e){} return out; }
};

function toPcs(it, isi){ return (it.k||0)*(isi||0) + (it.l||0)*12 + (it.p||0); }
function klp(t, isi){
  const a = Math.abs(t); const k = isi > 0 ? Math.floor(a/isi) : 0; const r = a - k*isi;
  return {k, l: Math.floor(r/12), p: r % 12};
}
function fmtKLP(o){
  const parts = [];
  if (o.k) parts.push(fmt(o.k) + ' K'); if (o.l) parts.push(fmt(o.l) + ' L'); if (o.p) parts.push(fmt(o.p) + ' P');
  return parts.length ? parts.join(' · ') : '0';
}
function fmtTime(iso){ if (!iso) return ''; return new Date(iso).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'}); }
function fmtDate(iso){ if (!iso) return '—'; const d = new Date(iso); if (isNaN(d)) return String(iso); return d.toLocaleString('id-ID', {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}); }
function ago(iso){
  if (!iso) return '—'; const s = (Date.now() - new Date(iso).getTime()) / 1000;
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
  code: (MODE === 'hitung' && new URLSearchParams(location.search).get('k')) || LS.get(K('so-code')) || '',
  role: null, kodeHitung: '', confirmRotate: false,
  deviceId: LS.get('so-device-id') || ('d-' + rid() + rid()),
  deviceName: LS.get('so-device-name') || '',
  gudang: '',
  sessions: LS.json(K('so-sessions')) || [],
  sessionId: LS.get('so-session') || null,
  master: {meta:null, items:[]}, bySku: new Map(), byCode: new Map(),
  local: null, dirty: {}, plog: [], ready: false,   // data device ini untuk sesi aktif
  remote: [], remoteAt: null, remoteSid: null,        // baris Hitung semua device
  online: navigator.onLine, pushing: false, blocked: {},
  tab: 'hitung', current: null,
  quickOn: LS.get('so-quick') === '1', quickUnit: LS.get('so-quick-unit') || 'p',
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
    if (e.code === 'invalid_code') {
      $('#loginErr').textContent = MODE === 'hitung' ? 'Link penghitung tidak berlaku atau kodenya sudah diganti. Minta link baru ke admin.' : 'Kode akses salah.';
      LS.del(K('so-code')); showLogin();
    }
    else if (e.code === 'no_access_code') $('#loginErr').textContent = 'Kode akses belum diisi di tab Config Google Sheet.';
    else if (silent && S.code && LS.json(K('so-master'))) { S.online = false; showApp(); showBanner('Offline. Hitungan disimpan di device ini dan dikirim otomatis saat sinyal kembali.'); }
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
  if (!S.local && S.sessionId) selectSession(S.sessionId);
  setTab(TABS.includes(LS.get(K('so-tab'))) ? LS.get(K('so-tab')) : 'hitung');
  if (!started) { started = true; setInterval(tick, 20000); }
  pushAll();
}

/* ================= master DMS ================= */
function setMaster(meta, items){
  S.master = {meta, items}; S.bySku = new Map(); S.byCode = new Map();
  for (const p of items) {
    S.bySku.set(p.s, p); S.byCode.set(norm(p.s), {p, u: null});
    if (p.b) S.byCode.set(norm(p.b), {p, u: 'p'});
    if (p.bk) S.byCode.set(norm(p.bk), {p, u: 'k'});
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
function productFor(sku){ return S.bySku.get(sku) || null; }

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
  const items = Object.keys(sent).map(sku => { const it = local.items[sku] || {}; return {sku, k: it.k || 0, l: it.l || 0, p: it.p || 0, at: it.at || now()}; });
  try {
    await API.post({action: 'push', sesi: sid, device_id: S.deviceId, device_nama: S.deviceName || 'Tanpa nama', items, log: logs});
    S.online = true;
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
    if (netFail(e)) S.online = false;
    return false;
  }
}
function renderSync(){
  const el = $('#sync'); if (!el) return;
  const n = Object.keys(S.dirty).length;
  const other = pendingSids().filter(s => s !== S.sessionId).length;
  el.className = 'sync';
  if (!S.online) { el.classList.add('offline'); el.textContent = n ? 'Offline · ' + fmt(n) + ' menunggu' : 'Offline'; }
  else if (n || other || S.pushing) { el.classList.add('pending'); el.textContent = S.pushing ? 'Mengirim…' : fmt(n) + ' belum terkirim'; }
  else el.textContent = 'Terkirim';
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

function addCount(prod, code, q){
  if (!canCount()) return false;
  const k = Math.max(0, q.k|0), l = Math.max(0, q.l|0), p = Math.max(0, q.p|0);
  if (!k && !l && !p) { toast('Isi jumlah dulu'); return false; }
  const sku = prod ? prod.s : code;
  const it = S.local.items[sku] || {k: 0, l: 0, p: 0};
  it.k += k; it.l += l; it.p += p; it.at = now();
  S.local.items[sku] = it; markDirty(sku);
  addLog({sku, k, l, p, aksi: 'tambah'});
  afterChange();
  toast('+ ' + fmtKLP({k, l, p}) + ' → ' + sku);
  return true;
}
function undoLog(id){
  const e = S.local.log.find(x => x.id === id); if (!e || e.aksi !== 'tambah') return;
  const it = S.local.items[e.sku];
  if (it) { it.k = Math.max(0, it.k - e.k); it.l = Math.max(0, it.l - e.l); it.p = Math.max(0, it.p - e.p); it.at = now(); if (!it.k && !it.l && !it.p) delete S.local.items[e.sku]; }
  markDirty(e.sku);
  S.local.log = S.local.log.filter(x => x.id !== id);
  S.plog.push({id: rid() + rid(), at: now(), sku: e.sku, k: e.k, l: e.l, p: e.p, aksi: 'batal'});
  afterChange(); toast('Dibatalkan: ' + e.sku);
}

/* ================= scan ================= */
function lookup(code){ const c = norm(code); return c ? (S.byCode.get(c) || null) : null; }
function suggestions(q){
  const c = norm(q); if (c.length < 2) return [];
  const out = [];
  for (const p of S.master.items) {
    if (norm(p.s).includes(c) || (p.b && norm(p.b).startsWith(c)) || norm(p.n).includes(c)) { out.push(p); if (out.length >= 6) break; }
  }
  return out;
}
function renderSuggest(list){
  const box = $('#suggest');
  if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.innerHTML = list.map(p => `<button type="button" data-sku="${esc(p.s)}"><span class="mono">${esc(p.s)}</span><span>${esc(p.n)}</span></button>`).join('');
  box.hidden = false;
}
function scanMsg(msg){ const m = $('#scanMsg'); m.textContent = msg || ''; m.hidden = !msg; }

// Dipakai input manual/scanner dan kamera. Mengembalikan teks singkat untuk ditampilkan.
function handleCode(code, fromCam){
  code = String(code || '').trim(); if (!code) return '';
  renderSuggest([]); scanMsg('');
  const hit = lookup(code);
  if (hit) {
    if (S.quickOn && canCount()) {
      const unit = hit.u === 'k' ? 'k' : S.quickUnit;
      if (unit === 'k' && !(hit.p.k > 0)) { if (fromCam) closeCam(); openCard(hit.p, code); scanMsg('Isi karton belum ada di data DMS. Masukkan lusin/pcs.'); return 'Isi karton kosong'; }
      addCount(hit.p, code, {[unit]: 1}); closeCard();
      const it = S.local.items[hit.p.s];
      return '<b>+1 ' + ({k:'karton', l:'lusin', p:'pcs'})[unit] + '</b> ' + esc(hit.p.n) + ' · total device ini ' + esc(fmtKLP(it));
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
  S.current = {prod, code: prod ? prod.s : norm(code)};
  $('#prodCard').hidden = false;
  $('#pcSku').textContent = prod ? prod.s + (prod.b ? '  ·  ' + prod.b : '') : norm(code);
  $('#pcName').innerHTML = prod ? esc(prod.n) : '<span class="unknown-tag">Tidak ada di DMS</span>';
  $('#pcMeta').textContent = prod ? (prod.k > 0 ? '1 karton = ' + fmt(prod.k) + ' pcs' : 'Isi karton belum diisi di DMS') : 'Karton tidak bisa dihitung tanpa isi karton';
  const isi = prod ? prod.k : 0;
  $('#qK').disabled = !(isi > 0); $('#qKh').textContent = isi > 0 ? fmt(isi) + ' pcs' : '—';
  ['#qK', '#qL', '#qP'].forEach(s => $(s).value = '');
  const it = S.local && S.local.items[S.current.code];
  $('#pcMine').textContent = it ? 'Sudah dihitung device ini: ' + fmtKLP(it) + ' (' + fmt(toPcs(it, isi)) + ' pcs)' : '';
  updatePreview();
  const first = isi > 0 ? '#qK' : '#qL';
  setTimeout(() => { $(first).focus(); $('#prodCard').scrollIntoView({block: 'nearest', behavior: 'smooth'}); }, 0);
}
function closeCard(){ S.current = null; const c = $('#prodCard'); if (c) c.hidden = true; }
function readQty(){ return {k: +$('#qK').value || 0, l: +$('#qL').value || 0, p: +$('#qP').value || 0}; }
function updatePreview(){
  $('#addBtn').disabled = !canCount();
  if (!S.current) return;
  const t = toPcs(readQty(), S.current.prod ? S.current.prod.k : 0);
  $('#pcPreview').innerHTML = t ? 'Tambah <b>' + fmt(t) + ' pcs</b>' : 'Masukkan jumlah';
}
function submitCard(){
  if (!S.current) return;
  if (addCount(S.current.prod, S.current.code, readQty())) { closeCard(); scanMsg(''); $('#scanInput').focus(); }
}

/* ================= kamera ================= */
const Cam = {active: false, stream: null, timer: null, h5: null, last: '', lastAt: 0};
const CAM_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
function camMsg(html){ $('#camMsg').innerHTML = html; }
async function openCam(){
  if (!canCount()) return;
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
        try { const r = await det.detect(video); if (r.length) onCamCode(r[0].rawValue); } catch(e){}
        Cam.timer = setTimeout(loop, 150);
      };
      loop(); return;
    } catch(e){ stopStream(); if (e && e.name === 'NotAllowedError') { camMsg('Izin kamera ditolak. Izinkan kamera di pengaturan browser.'); return; } }
  }
  try {
    video.hidden = true;
    if (!window.Html5Qrcode) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js');
    if (!Cam.active) return;
    Cam.h5 = new window.Html5Qrcode('camFallback');
    await Cam.h5.start({facingMode: 'environment'}, {fps: 10, qrbox: {width: 260, height: 120}}, txt => onCamCode(txt), () => {});
  } catch(e){ camMsg('Kamera tidak bisa dibuka: ' + esc(e.message || e) + '. Pakai scanner atau ketik SKU.'); }
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
  Cam.active = false; $('#camModal').hidden = true; stopStream();
  if (Cam.h5) { try { await Cam.h5.stop(); Cam.h5.clear(); } catch(e){} Cam.h5 = null; }
}

/* ================= render: header & hitung ================= */
function renderHeader(){
  const s = curSession();
  const label = MODE === 'hitung' ? 'Hitung' : 'Opname';
  $('#brandT').textContent = S.gudang ? label + ' · ' + S.gudang : (MODE === 'hitung' ? 'Hitung Stok' : 'Stok Opname');
  $('#hdrSession').textContent = s ? s.name + (s.status === 'closed' ? ' · ditutup' : '') : 'Belum ada sesi';
  const chip = $('#devChip'); chip.textContent = S.deviceName || 'Atur nama device'; chip.classList.toggle('missing', !S.deviceName);
  renderSync();
}
function renderHitung(){
  const s = curSession(); let html = '';
  if (!S.deviceName) html = `<div class="callout"><span>Beri nama device ini dulu, supaya hitungannya bisa ditandai.</span><button class="btn primary" type="button" data-go="sesi">Atur nama device</button></div>`;
  else if (!s && MODE === 'hitung') html = `<div class="callout"><span>Belum ada sesi opname yang berjalan. Minta admin membuat sesi, lalu buka ulang halaman ini.</span></div>`;
  else if (!s) html = `<div class="callout"><span>Belum ada sesi opname. Buat sesi dulu, lalu semua device pilih sesi yang sama.</span><button class="btn primary" type="button" data-go="sesi">Buat sesi</button></div>`;
  else if (s.status === 'closed') html = `<div class="callout"><span>Sesi <b>${esc(s.name)}</b> sudah ditutup. Buka lagi di tab Sesi untuk menambah hitungan.</span></div>`;
  else if (!S.ready) html = `<div class="callout"><span>Memuat hitungan device ini dari Google Sheet… Perlu online sekali untuk sesi ini.</span></div>`;
  else if (!S.master.items.length) html = `<div class="callout"><span>Data barang belum ada. Scan tetap tercatat, tapi nama barang dan isi karton belum dikenali.</span>${MODE === 'admin' ? '<button class="btn" type="button" data-go="dms">Import stok DMS</button>' : ''}</div>`;
  $('#hitungNotice').innerHTML = html;
  const ok = canCount();
  ['#scanInput', '#scanBtn', '#camBtn'].forEach(x => $(x).disabled = !ok);
  $('#scanInput').placeholder = ok ? 'Scan / ketik SKU…' : 'Belum bisa scan';
  $('#quickOn').checked = S.quickOn;
  $('#quickUnit').classList.toggle('off', !S.quickOn);
  document.querySelectorAll('#quickUnit button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.u === S.quickUnit)));
  updatePreview();
  renderHitungLists();
}
function renderHitungLists(){
  const local = S.local || {items: {}, log: []};
  const log = local.log.filter(e => e.aksi === 'tambah');
  $('#logList').innerHTML = log.length ? log.slice(0, 12).map((e, i) => {
    const p = productFor(e.sku);
    return `<li><span class="t">${esc(fmtTime(e.at))}</span><span class="d"><div class="mono">${esc(e.sku)}</div><div>${esc(p ? p.n : '(tidak ada di DMS)')}</div></span><span class="qv">+${esc(fmtKLP(e))}</span>${i < 5 && canCount() ? `<button class="btn sm" type="button" data-undo="${esc(e.id)}">Batal</button>` : ''}</li>`;
  }).join('') : '<li class="empty">Belum ada scan di sesi ini.</li>';

  const entries = Object.entries(local.items).sort((a, b) => String(b[1].at || '').localeCompare(String(a[1].at || '')));
  let totalPcs = 0;
  const can = canCount();
  const rows = entries.map(([sku, it]) => {
    const p = productFor(sku); const isi = p ? p.k : 0; const t = toPcs(it, isi); totalPcs += t;
    const pend = S.dirty[sku] ? '<span class="dot" title="Belum terkirim"></span>' : '';
    let extra = '';
    if (S.editing === sku) extra = `<div class="edit">
        <div><label for="e-k">Karton</label><input type="number" id="e-k" inputmode="numeric" min="0" value="${it.k || 0}" ${isi > 0 ? '' : 'disabled'}></div>
        <div><label for="e-l">Lusin</label><input type="number" id="e-l" inputmode="numeric" min="0" value="${it.l || 0}"></div>
        <div><label for="e-p">Pcs</label><input type="number" id="e-p" inputmode="numeric" min="0" value="${it.p || 0}"></div>
        <button class="btn sm primary" type="button" data-save="${esc(sku)}">Simpan</button>
        <button class="btn sm" type="button" data-cancel="1">Batal</button></div>`;
    else if (S.confirmDel === sku) extra = `<div class="confirm"><span>Hapus semua hitungan ${esc(sku)} dari device ini?</span><button class="btn sm danger" type="button" data-delyes="${esc(sku)}">Ya, hapus</button><button class="btn sm" type="button" data-cancel="1">Batal</button></div>`;
    else if (can) extra = `<div class="acts"><button class="btn sm" type="button" data-edit="${esc(sku)}">Koreksi</button><button class="btn sm danger" type="button" data-del="${esc(sku)}">Hapus</button></div>`;
    return `<div class="mi">
      <div><div class="nm">${esc(p ? p.n : '(tidak ada di DMS)')}${pend}</div><div class="sk mono">${esc(sku)}</div></div>
      <div class="qv num">${esc(fmtKLP(it))}<small>${fmt(t)} pcs</small></div>${extra}</div>`;
  });
  $('#myList').innerHTML = rows.length ? rows.join('') : '<div class="empty">Belum ada barang yang dihitung device ini.</div>';
  $('#myCount').textContent = entries.length ? entries.length + ' SKU · ' + fmt(totalPcs) + ' pcs' : '';
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
    list.push({id: S.deviceId, name: S.deviceName || 'Tanpa nama', items: S.local.items, updatedAt: last, mine: true});
  }
  return list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
function computeRecap(){
  const devs = recapDevices(); const rows = new Map();
  for (const p of S.master.items) rows.set(p.s, {sku: p.s, b: p.b || '', name: p.n, isi: p.k || 0, dms: p.q || 0, inDms: true, per: {}, counted: 0, has: false});
  for (const d of devs) for (const [sku, it] of Object.entries(d.items)) {
    let r = rows.get(sku);
    if (!r) { r = {sku, b: '', name: '(tidak ada di DMS)', isi: 0, dms: 0, inDms: false, per: {}, counted: 0, has: false}; rows.set(sku, r); }
    const t = toPcs(it, r.isi); r.per[d.id] = (r.per[d.id] || 0) + t; r.counted += t; r.has = true;
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

function renderRekap(){
  const {devs, rows} = computeRecap();
  const c = {sesuai: 0, kurang: 0, lebih: 0, belum: 0, luar: 0}; let minus = 0, plus = 0;
  rows.forEach(r => { c[r.status]++; if (r.status === 'kurang') minus += r.diff; if (r.status === 'lebih') plus += r.diff; });
  const dmsN = S.master.items.length; const counted = rows.filter(r => r.has && r.inDms).length;
  const pct = dmsN ? Math.round(counted / dmsN * 100) : 0;
  $('#rkUpdated').textContent = S.remoteAt ? 'Data semua device per ' + fmtTime(S.remoteAt) + (S.online ? '' : ' · offline') : (S.online ? 'Memuat…' : 'Offline — hanya data device ini');
  $('#tiles').innerHTML = `
    <div class="tile"><div class="k">Progres</div><div class="v">${pct}%</div><div class="s">${fmt(counted)} dari ${fmt(dmsN)} SKU DMS</div></div>
    <div class="tile good"><div class="k">Sesuai</div><div class="v">${fmt(c.sesuai)}</div><div class="s">SKU cocok dengan DMS</div></div>
    <div class="tile bad"><div class="k">Selisih</div><div class="v">${fmt(c.kurang + c.lebih)}</div><div class="s">${fmt(c.kurang)} kurang (${fmt(minus)} pcs) · ${fmt(c.lebih)} lebih (+${fmt(plus)} pcs)</div></div>
    <div class="tile"><div class="k">Belum dihitung</div><div class="v">${fmt(c.belum)}</div><div class="s">${fmt(c.luar)} SKU di luar DMS</div></div>`;

  $('#devCnt').textContent = devs.length ? devs.length + ' device' : '';
  $('#devList').innerHTML = devs.length ? devs.map(d => {
    const items = Object.entries(d.items); let t = 0;
    items.forEach(([sku, it]) => { const p = productFor(sku); t += toPcs(it, p ? p.k : 0); });
    const active = d.updatedAt && (Date.now() - new Date(d.updatedAt).getTime() < 10 * 60 * 1000);
    return `<div class="dev"><div class="n"><i class="${active ? '' : 'idle'}"></i>${esc(d.name || 'Tanpa nama')} ${d.mine ? '<span class="you">device ini</span>' : ''}</div>
      <div class="m">${fmt(items.length)} SKU · ${fmt(t)} pcs</div><div class="m">Update ${esc(ago(d.updatedAt))}</div></div>`;
  }).join('') : '<div class="empty">Belum ada device yang menghitung di sesi ini.</div>';

  const f = S.rkFilter; const q = norm(S.rkSearch);
  let list = rows.filter(r => f === 'semua' ? true : f === 'selisih' ? (r.status === 'kurang' || r.status === 'lebih') : r.status === f);
  if (q) list = list.filter(r => norm(r.sku).includes(q) || norm(r.name).includes(q) || norm(r.b).includes(q));
  list.sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (Math.abs(b.diff) - Math.abs(a.diff)) || a.sku.localeCompare(b.sku));
  const cnt = {semua: rows.length, selisih: c.kurang + c.lebih, sesuai: c.sesuai, belum: c.belum, luar: c.luar};
  $('#rkFilter').innerHTML = FILTERS.map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${f === k}">${l} (${fmt(cnt[k])})</button>`).join('');

  const shown = list.slice(0, S.rkLimit);
  $('#rkTable').innerHTML = `<thead><tr><th>SKU</th><th>Nama barang</th>${devs.map(d => `<th class="r">${esc(d.name)}</th>`).join('')}<th class="r">Total hitung</th><th class="r">Stok DMS</th><th class="r">Selisih</th><th>Status</th></tr></thead>
    <tbody>${shown.length ? shown.map(r => `<tr>
      <td class="mono">${esc(r.sku)}</td>
      <td class="nm">${esc(r.name)}<span class="sub">${r.isi ? 'Isi ' + fmt(r.isi) + ' pcs/karton' : 'Isi karton —'}</span></td>
      ${devs.map(d => `<td class="r">${r.per[d.id] != null ? fmt(r.per[d.id]) : '<span class="sub">—</span>'}</td>`).join('')}
      <td class="r"><b>${fmt(r.counted)}</b><span class="sub">${esc(fmtKLP(klp(r.counted, r.isi)))}</span></td>
      <td class="r">${r.inDms ? fmt(r.dms) + `<span class="sub">${esc(fmtKLP(klp(r.dms, r.isi)))}</span>` : '<span class="sub">—</span>'}</td>
      <td class="r ${r.diff < 0 ? 'neg' : r.diff > 0 ? 'pos' : ''}">${r.diff > 0 ? '+' : ''}${fmt(r.diff)}${r.diff ? `<span class="sub">${r.diff < 0 ? '−' : '+'}${esc(fmtKLP(klp(r.diff, r.isi)))}</span>` : ''}</td>
      <td><span class="pill ${r.status}">${STATUS_LABEL[r.status]}</span></td></tr>`).join('')
      : `<tr><td colspan="${6 + devs.length}" class="empty">Tidak ada barang untuk filter ini.</td></tr>`}</tbody>`;
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
  const head = ['SKU', 'Barcode', 'Nama', 'Isi Karton', ...devs.map(d => d.name + ' (pcs)'), 'Hitung Karton', 'Hitung Lusin', 'Hitung Pcs', 'Total Hitung (pcs)', 'Stok DMS (pcs)', 'Selisih (pcs)', 'Status'];
  const aoa = [head];
  for (const r of rows) {
    const o = klp(r.counted, r.isi);
    aoa.push([r.sku, r.b, r.name, r.isi, ...devs.map(d => r.per[d.id] ?? ''), o.k, o.l, o.p, r.counted, r.inDms ? r.dms : '', r.diff, STATUS_LABEL[r.status]]);
  }
  const dev = [['Device', 'SKU', 'Karton', 'Lusin', 'Pcs', 'Total (pcs)']];
  devs.forEach(d => Object.entries(d.items).forEach(([sku, it]) => { const p = productFor(sku); dev.push([d.name, sku, it.k || 0, it.l || 0, it.p || 0, toPcs(it, p ? p.k : 0)]); }));
  const name = 'stok-opname-' + (s ? s.name : 'sesi').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.xlsx';
  await saveXlsx(name, [['Rekap', aoa, [16, 16, 36, 10]], ['Per Device', dev, [18, 16, 8, 8, 8, 12]]]);
}

/* ================= import DMS ================= */
const ALIAS = {
  s: ['sku','kode','kode_barang','kode_produk','item_code','itemcode','product_code','kd_brg','kode_item','kodebarang'],
  b: ['barcode','ean','upc','barcode_pcs','gtin','barcode_satuan'],
  bk: ['barcode_karton','barcode_ctn','barcode_dus','ean_karton','barcode_box'],
  n: ['nama','nama_barang','nama_produk','name','product_name','deskripsi','description','item_name','namabarang'],
  k: ['isi_karton','isi','pcs_per_karton','konversi','isi_ctn','pcs_karton','qty_per_karton','isi_dus','isi_per_karton'],
  q: ['stok','stock','qty','stok_dms','saldo','stok_akhir','on_hand','qty_pcs','stok_pcs','total_pcs'],
  qk: ['karton','ctn','stok_karton','dus'], ql: ['lusin','lsn','stok_lusin','dzn'], qp: ['pcs','stok_pcs_sisa','eceran']
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
  if (!noStock && col.q == null && col.qk == null && col.ql == null && col.qp == null) return {items: [], error: 'Kolom stok tidak ditemukan. Tambah kolom "stok" (dalam pcs).'};
  const map = new Map(); let skipped = 0, dup = 0;
  const cell = (r, k) => col[k] != null ? String(r[col[k]] ?? '').trim() : '';
  for (const r of rows.slice(1)) {
    const s = norm(cell(r, 's')); if (!s) { skipped++; continue; }
    const k = int(cell(r, 'k'));
    const q = col.q != null ? int(cell(r, 'q')) : (int(cell(r, 'qk')) * k + int(cell(r, 'ql')) * 12 + int(cell(r, 'qp')));
    const item = {s, n: cell(r, 'n') || s, k, q};
    if (cell(r, 'b')) item.b = cell(r, 'b');
    if (cell(r, 'bk')) item.bk = cell(r, 'bk');
    if (map.has(s)) { map.get(s).q += q; dup++; } else map.set(s, item);
  }
  return {items: [...map.values()], skipped, dup, fileName, found: Object.keys(col).map(k => head[col[k]])};
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
function renderDmsPreview(){
  const box = $('#dmsPreview'); const p = S.parsed;
  if (!p) { box.innerHTML = ''; return; }
  if (p.error) { box.innerHTML = `<div class="prevbox"><div class="neg">${esc(p.error)}</div></div>`; return; }
  const tot = p.items.reduce((a, i) => a + i.q, 0);
  box.innerHTML = `<div class="prevbox">
    <div><b>${fmt(p.items.length)} SKU</b> terbaca dari ${esc(p.fileName)} · total ${fmt(tot)} pcs</div>
    <div class="hint" style="margin:0">Kolom dipakai: <span class="mono">${esc(p.found.join(', '))}</span>${p.skipped ? ' · ' + fmt(p.skipped) + ' baris tanpa SKU dilewati' : ''}${p.dup ? ' · ' + fmt(p.dup) + ' SKU dobel dijumlahkan' : ''}</div>
    ${S.confirmImport
      ? `<div class="confirm"><span>Ganti ${fmt(S.master.items.length)} SKU lama di Google Sheet dengan ${fmt(p.items.length)} SKU baru? Hitungan device tidak terhapus.</span><button class="btn sm danger" type="button" id="impYes">Ya, ganti</button><button class="btn sm" type="button" id="impNo">Batal</button></div>`
      : `<div class="row"><button class="btn primary" type="button" id="impBtn">Simpan ke Google Sheet</button><button class="btn" type="button" id="impNo">Batal</button></div>`}
  </div>`;
}
async function importMaster(){
  const p = S.parsed; if (!p || !p.items.length) return;
  const btn = $('#impYes') || $('#impBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan…'; }
  try {
    await API.post({action: 'importMaster', fileName: p.fileName, rows: p.items.map(i => [i.s, i.b || '', i.bk || '', i.n, i.k, i.q])});
    S.parsed = null; S.confirmImport = false; renderDmsPreview();
    await syncMaster(null, true);
  } catch(e){
    S.confirmImport = false; renderDmsPreview();
    toast(netFail(e) ? 'Gagal menyimpan: tidak ada koneksi' : 'Gagal menyimpan: ' + e.message);
  }
}
function renderDms(){
  const m = S.master.meta;
  $('#dmsMeta').innerHTML = S.master.items.length
    ? `<b>${fmt(S.master.items.length)} SKU</b>${m && m.importedAt ? ' · diperbarui ' + esc(fmtDate(m.importedAt)) : ''}${m && m.fileName ? ' · <span class="mono">' + esc(m.fileName) + '</span>' : ''}`
    : 'Belum ada data stok DMS.';
  const q = norm(S.dmsSearch);
  let list = S.master.items;
  if (q) list = list.filter(p => norm(p.s).includes(q) || norm(p.n).includes(q) || norm(p.b).includes(q) || norm(p.bk).includes(q));
  $('#dmsCnt').textContent = fmt(S.master.items.length) + ' SKU';
  const shown = list.slice(0, S.dmsLimit);
  $('#dmsTable').innerHTML = `<thead><tr><th>SKU</th><th>Barcode</th><th>Nama barang</th><th class="r">Isi karton</th><th class="r">Stok (pcs)</th><th class="r">Karton · Lusin · Pcs</th></tr></thead><tbody>${
    shown.length ? shown.map(p => `<tr><td class="mono">${esc(p.s)}</td><td class="mono">${esc(p.b || '—')}${p.bk ? `<span class="sub">ctn ${esc(p.bk)}</span>` : ''}</td><td class="nm">${esc(p.n)}</td><td class="r">${p.k ? fmt(p.k) : '—'}</td><td class="r">${fmt(p.q)}</td><td class="r">${esc(fmtKLP(klp(p.q, p.k)))}</td></tr>`).join('')
    : `<tr><td colspan="6" class="empty">${S.master.items.length ? 'Tidak ada yang cocok.' : 'Import file dari DMS untuk mulai.'}</td></tr>`}</tbody>`;
  $('#dmsMore').hidden = list.length <= S.dmsLimit;
}

/* ================= sesi ================= */
function renderSesi(){
  if (document.activeElement !== $('#devName')) $('#devName').value = S.deviceName;
  const box = $('#sessList');
  box.innerHTML = S.sessions.length ? S.sessions.map(s => {
    const cur = s.id === S.sessionId;
    return `<div class="sess ${cur ? 'cur' : ''}">
      <div><div class="nm">${esc(s.name)}</div><div class="m">Dibuat ${esc(fmtDate(s.createdAt))} · <span class="pill ${s.status === 'closed' ? 'closed' : 'open'}">${s.status === 'closed' ? 'Ditutup' : 'Berjalan'}</span></div></div>
      <div class="acts">
        ${cur ? '<span class="you">dipakai</span>' : `<button class="btn sm primary" type="button" data-use="${esc(s.id)}">Pakai</button>`}
        ${MODE === 'admin' ? `<button class="btn sm" type="button" data-toggle="${esc(s.id)}">${s.status === 'closed' ? 'Buka lagi' : 'Tutup sesi'}</button>
        <button class="btn sm danger" type="button" data-sdel="${esc(s.id)}">Hapus</button>` : ''}
      </div>
      ${S.confirmSess === s.id ? `<div class="confirm"><span>Hapus sesi "${esc(s.name)}" beserta hitungan semua device di Google Sheet? Tidak bisa dibatalkan.</span><button class="btn sm danger" type="button" data-sdelyes="${esc(s.id)}">Ya, hapus</button><button class="btn sm" type="button" data-scancel="1">Batal</button></div>` : ''}
    </div>`;
  }).join('') : `<div class="empty">${MODE === 'hitung' ? 'Belum ada sesi yang berjalan. Minta admin membuat sesi.' : 'Belum ada sesi.'}</div>`;
  renderCounterLink();
}
function counterUrl(){ return new URL('hitung.html?k=' + encodeURIComponent(S.kodeHitung), location.href).toString(); }
function renderCounterLink(){
  const box = $('#counterLink'); if (!box) return;
  if (!S.kodeHitung) { box.innerHTML = '<div class="empty">Memuat…</div>'; return; }
  box.innerHTML = `<div class="linkbox mono" id="counterUrl">${esc(counterUrl())}</div>
    <div class="row" style="margin-top:10px">
      <button class="btn primary" type="button" id="copyCounter">Salin link</button>
      <button class="btn danger" type="button" id="rotateCounter">Ganti link</button>
    </div>
    ${S.confirmRotate ? `<div class="confirm" style="margin-top:10px"><span>Link lama langsung tidak berlaku. Semua penghitung harus membuka link baru. Hitungan yang sudah ada tetap aman.</span><button class="btn sm danger" type="button" id="rotateYes">Ya, ganti</button><button class="btn sm" type="button" id="rotateNo">Batal</button></div>` : ''}`;
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
  S.sessions.forEach(s => { if (s.status !== 'closed') delete S.blocked[s.id]; });
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
  btn.disabled = false;
  if (d) { $('#newSess').value = ''; selectSession(d.id); }
}

/* ================= tabs / render ================= */
function setTab(t){
  if (!TABS.includes(t)) t = 'hitung';
  S.tab = t; LS.set(K('so-tab'), t);
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
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
  if (S.tab === 'rekap') renderRekap();
  if (S.tab === 'dms') renderDms();
  if (S.tab === 'sesi') renderSesi();
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
on('#devChip', 'click', () => { setTab('sesi'); setTimeout(() => $('#devName').focus(), 0); });

on('#scanInput', 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleScan(); } });
on('#scanInput', 'input', e => { if (!S.quickOn) renderSuggest(suggestions(e.target.value)); });
on('#scanBtn', 'click', handleScan);
on('#camBtn', 'click', openCam);
on('#camClose', 'click', closeCam);
on('#suggest', 'click', e => { const b = e.target.closest('[data-sku]'); if (!b) return; const p = productFor(b.dataset.sku); $('#scanInput').value = ''; renderSuggest([]); scanMsg(''); if (p) openCard(p, p.s); });
on('#quickOn', 'change', e => { S.quickOn = e.target.checked; LS.set('so-quick', S.quickOn ? '1' : '0'); renderSuggest([]); renderHitung(); });
on('#quickUnit', 'click', e => { const b = e.target.closest('[data-u]'); if (!b) return; S.quickUnit = b.dataset.u; LS.set('so-quick-unit', S.quickUnit); renderHitung(); });
['#qK', '#qL', '#qP'].forEach(s => {
  $(s).addEventListener('input', updatePreview);
  $(s).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitCard(); } });
});
on('#addBtn', 'click', submitCard);
on('#pcClose', 'click', () => { closeCard(); scanMsg(''); });

on('#logList', 'click', e => { const b = e.target.closest('[data-undo]'); if (b) undoLog(b.dataset.undo); });
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
    const it = {k: v('#e-k'), l: v('#e-l'), p: v('#e-p'), at: now()};
    if (!it.k && !it.l && !it.p) delete S.local.items[sku]; else S.local.items[sku] = it;
    markDirty(sku); S.editing = null;
    addLog({sku, k: it.k, l: it.l, p: it.p, aksi: 'koreksi'}); afterChange(); toast('Koreksi disimpan: ' + sku);
  }
});

on('#rkFilter', 'click', e => { const b = e.target.closest('[data-f]'); if (!b) return; S.rkFilter = b.dataset.f; S.rkLimit = 200; renderRekap(); });
on('#rkSearch', 'input', e => { S.rkSearch = e.target.value; S.rkLimit = 200; renderRekap(); });
on('#rkMore', 'click', () => { S.rkLimit += 300; renderRekap(); });
on('#rkRefresh', 'click', () => { pushAll(); fetchRekap(); });
on('#exportBtn', 'click', exportRekap);

on('#dmsFile', 'change', e => { const f = e.target.files[0]; if (f) readDmsFile(f); e.target.value = ''; });
on('#dmsParseBtn', 'click', () => { const t = $('#dmsPaste').value; if (!t.trim()) return; S.parsed = parseDmsRows(parseDelimited(t), 'data tempel'); S.confirmImport = false; renderDmsPreview(); });
on('#dmsPreview', 'click', e => {
  if (e.target.id === 'impBtn') { if (S.master.items.length) { S.confirmImport = true; renderDmsPreview(); } else importMaster(); }
  else if (e.target.id === 'impYes') importMaster();
  else if (e.target.id === 'impNo') { if (S.confirmImport) S.confirmImport = false; else S.parsed = null; renderDmsPreview(); }
});
on('#dmsReload', 'click', () => syncMaster(null, true));
on('#tplBtn', 'click', () => saveXlsx('template-stok-dms.xlsx', [['Master_DMS', [
  ['sku', 'barcode', 'barcode_karton', 'nama', 'isi_karton', 'stok'],
  ['BRG-001', '8991234567001', '18991234567001', 'Contoh Barang A 250ml', 48, 1200],
  ['BRG-002', '8991234567002', '', 'Contoh Barang B 1kg', 12, 300]], [12, 16, 16, 30, 10, 10]]]));
on('#dmsSearch', 'input', e => { S.dmsSearch = e.target.value; S.dmsLimit = 200; renderDms(); });
on('#dmsMore', 'click', () => { S.dmsLimit += 300; renderDms(); });

function saveDeviceName(){
  const v = $('#devName').value.trim().slice(0, 40); if (!v) { $('#devName').focus(); return; }
  S.deviceName = v; LS.set('so-device-name', v); toast('Nama device: ' + v);
  if (S.local && Object.keys(S.local.items).length) { const first = Object.keys(S.local.items)[0]; markDirty(first); saveLocal(); schedulePush(500); }
  renderAll();
}
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
on('#logoutBtn', 'click', () => logout(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && Cam.active) closeCam(); });

/* ================= start ================= */
if (S.code) { $('#codeInput').value = S.code; login(S.code, true); }
else $('#codeInput').focus();
})();
