/**
 * Stok Opname: API Google Sheet untuk halaman GitHub Pages.
 *
 * Deploy sebagai Web App: Deploy > New deployment > Web app.
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Semua permintaan wajib membawa `code` = Config!kode_akses.
 * GET  ?action=init|master|rekap&code=...&sesi=...
 * POST body JSON (Content-Type text/plain) {action, code, ...}
 *
 * Tab:
 *   Config      key/value: kode_akses (admin), nama_gudang, master_*
 *   Master_<sesi_id>  stok DMS khusus satu sesi (tiap sesi/distributor punya sendiri; info versinya di tab Sesi).
 *   Master_DMS  master lama (satu untuk semua). Hanya dipakai sesi yang dibuat sebelum master dipisah per sesi.
 *               kolom: stok terakhir dari DMS (sku, barcode, barcode_karton, nama, isi_karton, stok_karton, stok_lusin, stok_pcs)
 *   Sesi        daftar sesi opname; kolom kode = kode link penghitung khusus sesi itu
 *   Hitung      satu baris per sesi + device + SKU + kondisi, nilai terakhir (karton, lusin, pcs).
 *               kondisi kosong = Good Stock, 'rusak' = Bad Stock. Di sisi web, Bad Stock ditulis sebagai kunci "SKU#B".
 *   Log         riwayat setiap scan/koreksi per device (audit)
 */

const SH = { CONFIG: 'Config', MASTER: 'Master_DMS', SESI: 'Sesi', HITUNG: 'Hitung', LOG: 'Log' };
const HEAD = {
  Master_DMS: ['sku', 'barcode', 'barcode_karton', 'nama', 'isi_karton', 'stok_karton', 'stok_lusin', 'stok_pcs'],
  Sesi: ['sesi_id', 'nama', 'status', 'dibuat', 'dibuat_oleh', 'kode', 'master_versi', 'master_file', 'master_diimport'],
  Hitung: ['sesi_id', 'device_id', 'device_nama', 'sku', 'karton', 'lusin', 'pcs', 'updated_at', 'kondisi'],
  Log: ['log_id', 'waktu', 'sesi_id', 'device_id', 'device_nama', 'sku', 'karton', 'lusin', 'pcs', 'aksi', 'kondisi'],
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action) return handle_(p);
  return page_(p);
}

// Menyajikan halaman web (Admin.html atau Hitung.html) dari Apps Script ini. Dibuat oleh build-apps-script.js.
function page_(p) {
  const hitung = p.page === "hitung";
  const t = HtmlService.createTemplateFromFile(hitung ? "Hitung" : "Admin");
  t.url = ScriptApp.getService().getUrl();
  t.k = String(p.k || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return t.evaluate()
    .setTitle(hitung ? "Hitung Stok" : "Stok Opname")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return jsonOut_({ error: 'bad_json' }); }
  return handle_(body);
}

const ADMIN_ONLY = ['rekap', 'createSession', 'setSessionStatus', 'deleteSession', 'importMaster', 'rotateCounterCode'];

function handle_(p) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets_(ss);
    const cfg = readConfig_(ss);
    const code = String(p.code || '').trim();
    if (!code) return jsonOut_({ error: 'missing_code' });
    const admin = String(cfg.kode_akses || '').trim();
    if (!admin) return jsonOut_({ error: 'no_access_code', message: 'Isi kode_akses di tab Config.' });
    // kode_akses = admin (lihat semua). Kode penghitung = satu per sesi (Sesi!kode): hanya bisa
    // membuka sesi itu saja, tanpa angka stok DMS dan tanpa rekap.
    let role = null, scope = '';
    ensureSessionCodes_(ss);
    if (code === admin) role = 'admin';
    else {
      const own = readSessions_(ss, true).find(x => x.kode && x.kode === code);
      if (own) { role = 'hitung'; scope = own.id; }
    }
    if (!role) return jsonOut_({ error: 'invalid_code' });
    if (role !== 'admin' && ADMIN_ONLY.indexOf(p.action) >= 0) return jsonOut_({ error: 'forbidden', message: 'Hanya untuk admin.' });
    // Penghitung tidak boleh menyentuh sesi lain, apa pun yang dikirim.
    if (role === 'hitung' && (p.action === 'myRows' || p.action === 'push') && String(p.sesi || '') !== scope)
      return jsonOut_({ error: 'wrong_session', message: 'Link ini bukan untuk sesi tersebut.' });

    switch (p.action) {
      case 'init': {
        const all = readSessions_(ss, role === 'admin');
        const out = { ok: true, role: role, gudang: cfg.nama_gudang || '', serverTime: new Date().toISOString(),
          sessions: role === 'admin' ? all : all.filter(s => s.id === scope) };
        if (role === 'hitung') { out.scopedSesi = scope; out.master = (out.sessions[0] || {}).master || null; }
        return jsonOut_(out);
      }
      case 'master': {
        const sid = String(p.sesi || '');
        if (role === 'hitung' && sid !== scope) return jsonOut_({ error: 'wrong_session', message: 'Link ini bukan untuk sesi tersebut.' });
        const sess = readSessions_(ss).find(x => x.id === sid);
        if (!sess) return jsonOut_({ error: 'session_not_found' });
        const msh = masterSheetFor_(ss, sess);
        const values = msh ? msh.getDataRange().getDisplayValues() : [];
        return jsonOut_({ ok: true, master: sess.master, values: role === 'admin' ? values : masterForCounter_(values) });
      }
      case 'rekap':
        return jsonOut_({ ok: true, rows: readHitung_(ss, String(p.sesi || '')), serverTime: new Date().toISOString() });
      case 'myRows': {
        const dev = String(p.device_id || '');
        return jsonOut_({ ok: true, rows: readHitung_(ss, String(p.sesi || '')).filter(r => r[0] === dev), serverTime: new Date().toISOString() });
      }
      case 'push': return locked_(() => push_(ss, p));
      case 'createSession': return locked_(() => createSession_(ss, p));
      case 'setSessionStatus': return locked_(() => setSessionStatus_(ss, p));
      case 'deleteSession': return locked_(() => deleteSession_(ss, p));
      case 'importMaster': return locked_(() => importMaster_(ss, p));
      case 'rotateCounterCode': return locked_(() => rotateSessionCode_(ss, p));
      default: return jsonOut_({ error: 'unknown_action' });
    }
  } catch (err) {
    return jsonOut_({ error: 'server_error', message: String(err && err.message || err) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function locked_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return jsonOut_({ error: 'busy', message: 'Server sedang sibuk, coba lagi.' });
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------------- sheets & config ---------------- */

function ensureSheets_(ss) {
  if (!ss.getSheetByName(SH.CONFIG)) {
    const c = ss.insertSheet(SH.CONFIG);
    c.getRange(1, 1, 3, 2).setValues([['key', 'value'], ['kode_akses', 'GUDANG-2026'], ['nama_gudang', 'Gudang Utama']]);
  }
  [SH.MASTER, SH.SESI, SH.HITUNG, SH.LOG].forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      const h = HEAD[name];
      sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
      sh.setFrozenRows(1);
      if (name === SH.MASTER) sh.getRange('A:C').setNumberFormat('@');
      if (name === SH.HITUNG) sh.getRange('A:D').setNumberFormat('@');
      if (name === SH.LOG) sh.getRange('A:F').setNumberFormat('@');
    } else if (name === SH.SESI) {
      HEAD.Sesi.forEach((h, i) => { if (i >= 5 && String(sh.getRange(1, i + 1).getValue() || '') === '') sh.getRange(1, i + 1).setValue(h).setFontWeight('bold'); });
    } else if (name === SH.HITUNG || name === SH.LOG) {
      // Sheet lama: tambahkan kolom kondisi di header kalau belum ada.
      const h = HEAD[name];
      if (String(sh.getRange(1, h.length).getValue() || '') === '') sh.getRange(1, h.length).setValue('kondisi').setFontWeight('bold');
    }
  });
  // Sesi yang dibuat sebelum waktu ini masih memakai Master_DMS lama; sesi baru wajib import master sendiri.
  if (!String(readConfig_(ss).master_per_sesi_sejak || '').trim()) setConfig_(ss, 'master_per_sesi_sejak', new Date().toISOString());
}

function readConfig_(ss) {
  const values = ss.getSheetByName(SH.CONFIG).getDataRange().getValues();
  const obj = {};
  values.forEach(r => { const k = String(r[0] || '').trim(); if (k && k !== 'key') obj[k] = r[1]; });
  return obj;
}

function setConfig_(ss, key, value) {
  const sh = ss.getSheetByName(SH.CONFIG);
  const values = sh.getDataRange().getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
  sh.appendRow([key, value]);
}

function newCounterCode_() {
  return 'H-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
}

// Sesi lama (dibuat sebelum ada kolom kode) diberi kode sendiri-sendiri.
function ensureSessionCodes_(ss) {
  const sh = ss.getSheetByName(SH.SESI);
  const n = sh.getLastRow();
  if (n < 2) return;
  const rng = sh.getRange(2, 1, n - 1, 6), v = rng.getValues();
  let dirty = false;
  v.forEach(r => { if (r[0] && !String(r[5] || '').trim()) { r[5] = newCounterCode_(); dirty = true; } });
  if (dirty) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) return;
    try { sh.getRange(2, 6, v.length, 1).setValues(v.map(r => [r[5]])); } finally { lock.releaseLock(); }
  }
}

function rotateSessionCode_(ss, p) {
  const sh = ss.getSheetByName(SH.SESI);
  const row = findSessionRow_(sh, String(p.sesi || ''));
  if (row < 0) return jsonOut_({ error: 'not_found' });
  sh.getRange(row, 6).setValue(newCounterCode_());
  return jsonOut_({ ok: true, sessions: readSessions_(ss, true) });
}

// Kolom yang boleh dilihat penghitung. Daftar putih, bukan daftar hitam: kolom stok
// dengan nama apa pun (stok, saldo, qty, karton, ...) tidak pernah ikut terkirim.
const COUNTER_COLS = {
  sku: ['sku','kode','kode_barang','kode_produk','item_code','itemcode','product_code','kd_brg','kode_item','kodebarang'],
  barcode: ['barcode','ean','upc','barcode_pcs','gtin','barcode_satuan'],
  barcode_karton: ['barcode_karton','barcode_ctn','barcode_dus','ean_karton','barcode_box'],
  nama: ['nama','nama_barang','nama_produk','name','product_name','deskripsi','description','item_name','namabarang'],
  isi_karton: ['isi_karton','isi','pcs_per_karton','konversi','isi_ctn','pcs_karton','qty_per_karton','isi_dus','isi_per_karton'],
};

function masterForCounter_(values) {
  if (!values.length) return [];
  const head = values[0].map(h => String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  const keys = Object.keys(COUNTER_COLS);
  const idx = keys.map(k => head.findIndex(h => COUNTER_COLS[k].indexOf(h) >= 0));
  // Hanya penanda 1/0 (ada stok atau tidak), tanpa jumlah, untuk ikon di daftar pilihan SKU.
  const sIdx = ['stok_karton', 'stok_lusin', 'stok_pcs'].map(n => head.indexOf(n)).filter(i => i >= 0);
  const num = v => parseInt(String(v == null ? '' : v).replace(/[^\d-]/g, ''), 10) || 0;
  return [keys.concat('ada_stok')].concat(values.slice(1).map(r =>
    idx.map(i => (i >= 0 ? r[i] : '')).concat(sIdx.some(i => num(r[i]) > 0) ? '1' : '0')));
}

function masterSheetName_(sid) { return 'Master_' + sid; }

// Tab master milik sesi. Sesi lama (dibuat sebelum master dipisah) jatuh ke Master_DMS selama belum import sendiri.
function masterSheetFor_(ss, sess) {
  return ss.getSheetByName(masterSheetName_(sess.id)) || (sess.legacy ? ss.getSheetByName(SH.MASTER) : null);
}

/* ---------------- sessions ---------------- */

function readSessions_(ss, withCode) {
  const v = ss.getSheetByName(SH.SESI).getDataRange().getValues();
  const cfg = readConfig_(ss), since = String(cfg.master_per_sesi_sejak || '');
  return v.slice(1).filter(r => r[0]).map(r => {
    const o = {
      id: String(r[0]), name: String(r[1]), status: String(r[2] || 'open'),
      createdAt: r[3] instanceof Date ? r[3].toISOString() : String(r[3] || ''),
    };
    if (withCode) o.kode = String(r[5] || '');
    const own = !!ss.getSheetByName(masterSheetName_(o.id));
    o.legacy = !own && !!since && !!o.createdAt && o.createdAt < since;
    o.master = own
      ? { version: String(r[6] || ''), fileName: String(r[7] || ''), importedAt: String(r[8] || '') }
      : o.legacy
        ? { version: String(cfg.master_versi || ''), fileName: String(cfg.master_file || ''), importedAt: cfg.master_diimport ? String(cfg.master_diimport) : '' }
        : { version: '', fileName: '', importedAt: '' };
    return o;
  });
}

function findSessionRow_(sh, id) {
  const ids = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (let i = 1; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 1;
  return -1;
}

function createSession_(ss, p) {
  const name = String(p.nama || '').trim().slice(0, 80);
  if (!name) return jsonOut_({ error: 'bad_request', message: 'Nama sesi kosong.' });
  const id = 's-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  ss.getSheetByName(SH.SESI).appendRow([id, name, 'open', new Date().toISOString(), String(p.device_nama || ''), newCounterCode_()]);
  return jsonOut_({ ok: true, id: id, sessions: readSessions_(ss, true) });
}

function setSessionStatus_(ss, p) {
  const sh = ss.getSheetByName(SH.SESI);
  const row = findSessionRow_(sh, String(p.sesi || ''));
  if (row < 0) return jsonOut_({ error: 'not_found' });
  sh.getRange(row, 3).setValue(p.status === 'closed' ? 'closed' : 'open');
  return jsonOut_({ ok: true, sessions: readSessions_(ss, true) });
}

function deleteSession_(ss, p) {
  const id = String(p.sesi || '');
  const sesi = ss.getSheetByName(SH.SESI);
  const row = findSessionRow_(sesi, id);
  if (row > 0) sesi.deleteRow(row);
  const ms = ss.getSheetByName(masterSheetName_(id));
  if (ms) ss.deleteSheet(ms);
  const h = ss.getSheetByName(SH.HITUNG);
  const v = h.getDataRange().getValues();
  const keep = [v[0]].concat(v.slice(1).filter(r => String(r[0]) !== id));
  if (keep.length !== v.length) {
    h.getRange(1, 1, v.length, v[0].length).clearContent();
    h.getRange(1, 1, keep.length, keep[0].length).setValues(keep);
  }
  return jsonOut_({ ok: true, sessions: readSessions_(ss, true) });
}

/* ---------------- counts ---------------- */

function readHitung_(ss, sesi) {
  const v = ss.getSheetByName(SH.HITUNG).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const r = v[i];
    if (String(r[0]) !== sesi) continue;
    out.push([String(r[1]), String(r[2]), String(r[3]) + (String(r[8] || '') === 'rusak' ? '#B' : ''), Number(r[4]) || 0, Number(r[5]) || 0, Number(r[6]) || 0,
      r[7] instanceof Date ? r[7].toISOString() : String(r[7] || '')]);
  }
  return out;
}

/**
 * Menyimpan nilai TERAKHIR per SKU dari satu device (bukan penambahan),
 * jadi kiriman ulang yang sama tidak menggandakan angka.
 */
function push_(ss, p) {
  const sesi = String(p.sesi || ''), dev = String(p.device_id || ''), devName = String(p.device_nama || '').slice(0, 40);
  if (!sesi || !dev) return jsonOut_({ error: 'bad_request', message: 'sesi/device kosong.' });
  const sessions = readSessions_(ss);
  const s = sessions.find(x => x.id === sesi);
  if (!s) return jsonOut_({ error: 'session_not_found' });
  if (s.status === 'closed') return jsonOut_({ error: 'session_closed' });

  const items = Array.isArray(p.items) ? p.items : [];
  const sh = ss.getSheetByName(SH.HITUNG);
  const v = sh.getDataRange().getValues();
  const idx = {};
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][0]) === sesi && String(v[i][1]) === dev) idx[String(v[i][3]) + (String(v[i][8] || '') === 'rusak' ? '#B' : '')] = i;
  }
  const changed = [], appended = [];
  items.forEach(it => {
    const key = String(it.sku || '').trim();
    if (!key) return;
    const bad = /#B$/.test(key), sku = bad ? key.slice(0, -2) : key;
    if (!sku) return;
    const row = [sesi, dev, devName, sku, toInt_(it.k), toInt_(it.l), toInt_(it.p), String(it.at || new Date().toISOString()), bad ? 'rusak' : ''];
    if (idx[key] != null) { v[idx[key]] = row; changed.push(idx[key]); }
    else appended.push(row);
  });
  // Nama device ikut diperbarui di semua baris device ini.
  Object.keys(idx).forEach(sku => {
    const i = idx[sku];
    if (String(v[i][2]) !== devName) { v[i][2] = devName; if (changed.indexOf(i) < 0) changed.push(i); }
  });

  if (changed.length > 25) {
    sh.getRange(1, 1, v.length, 9).setValues(v.map(r => r.slice(0, 9)));
  } else {
    changed.forEach(i => sh.getRange(i + 1, 1, 1, 9).setValues([v[i].slice(0, 9)]));
  }
  if (appended.length) sh.getRange(sh.getLastRow() + 1, 1, appended.length, 9).setValues(appended);

  // Log: lewati id yang sudah pernah diterima (kiriman ulang saat sinyal putus).
  const logs = Array.isArray(p.log) ? p.log.slice(0, 500) : [];
  if (logs.length) {
    const cache = CacheService.getScriptCache();
    const seen = cache.getAll(logs.map(l => 'log_' + l.id));
    const rows = logs.filter(l => l.id && !seen['log_' + l.id]).map(l => {
      const key = String(l.sku || ''), bad = /#B$/.test(key);
      return [String(l.id), String(l.at || ''), sesi, dev, devName, bad ? key.slice(0, -2) : key, toInt_(l.k), toInt_(l.l), toInt_(l.p), String(l.aksi || ''), bad ? 'rusak' : ''];
    });
    if (rows.length) {
      const lg = ss.getSheetByName(SH.LOG);
      lg.getRange(lg.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      const put = {};
      rows.forEach(r => { put['log_' + r[0]] = '1'; });
      cache.putAll(put, 21600);
    }
  }
  return jsonOut_({ ok: true, saved: items.length, serverTime: new Date().toISOString() });
}

function toInt_(x) { const n = parseInt(x, 10); return isNaN(n) ? 0 : n; }

/* ---------------- master DMS ---------------- */

function importMaster_(ss, p) {
  const sid = String(p.sesi || '');
  const sesi = ss.getSheetByName(SH.SESI);
  const row = sid ? findSessionRow_(sesi, sid) : -1;
  if (row < 0) return jsonOut_({ error: 'session_not_found', message: 'Pilih sesi dulu sebelum import stok DMS.' });
  const rows = Array.isArray(p.rows) ? p.rows : [];
  if (!rows.length) return jsonOut_({ error: 'bad_request', message: 'Data master kosong.' });
  const name = masterSheetName_(sid);
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  sh.getRange('A:C').setNumberFormat('@');
  const data = [HEAD.Master_DMS].concat(rows.map(r => [
    String(r[0] || ''), String(r[1] || ''), String(r[2] || ''), String(r[3] || ''), toInt_(r[4]), toInt_(r[5]), toInt_(r[6]), toInt_(r[7])]));
  sh.getRange(1, 1, data.length, HEAD.Master_DMS.length).setValues(data);
  sh.getRange(1, 1, 1, HEAD.Master_DMS.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  sesi.getRange(row, 7, 1, 3).setValues([[new Date().toISOString(), String(p.fileName || 'upload web'), new Date().toISOString()]]);
  return jsonOut_({ ok: true, count: rows.length, sessions: readSessions_(ss, true) });
}

/**
 * Simple trigger: kalau tab Master_DMS atau Master_<sesi_id> diedit/ditempel langsung di Sheet,
 * tandai versi baru supaya semua device mengambil ulang master.
 */
function onEdit(e) {
  try {
    const sh = e && e.range && e.range.getSheet();
    if (!sh) return;
    const name = sh.getName(), ss = sh.getParent(), nowIso = new Date().toISOString();
    if (name === SH.MASTER) {
      setConfig_(ss, 'master_versi', nowIso);
      setConfig_(ss, 'master_file', 'diedit langsung di Sheet');
      setConfig_(ss, 'master_diimport', nowIso);
    } else if (name.indexOf('Master_') === 0) {
      const sesi = ss.getSheetByName(SH.SESI), row = findSessionRow_(sesi, name.slice(7));
      if (row > 0) sesi.getRange(row, 7, 1, 3).setValues([[nowIso, 'diedit langsung di Sheet', nowIso]]);
    }
  } catch (err) { /* abaikan */ }
}

/* ---------------- utilitas manual ---------------- */

/** Jalankan sekali dari editor: membuat semua tab dan kode akses awal. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets_(ss);
  const cfg = readConfig_(ss);
  if (!String(cfg.kode_akses || '').trim()) setConfig_(ss, 'kode_akses', 'GUDANG-2026');
  if (!String(cfg.nama_gudang || '').trim()) setConfig_(ss, 'nama_gudang', 'Gudang Utama');
  Logger.log('Tab siap. Kode akses: ' + readConfig_(ss).kode_akses);
}

/** Cek cepat isi Sheet tanpa deploy. Lihat hasil di Execution log. */
function testRead() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets_(ss);
  Logger.log(JSON.stringify({ config: readConfig_(ss), sessions: readSessions_(ss),
    masterRows: ss.getSheetByName(SH.MASTER).getLastRow() - 1, hitungRows: ss.getSheetByName(SH.HITUNG).getLastRow() - 1 }, null, 2));
}
