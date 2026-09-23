/**
 * Stok Opname — API Google Sheet untuk halaman GitHub Pages.
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
 *   Config      key/value: kode_akses, nama_gudang, master_versi, master_file, master_diimport
 *   Master_DMS  stok terakhir dari DMS (sku, barcode, barcode_karton, nama, isi_karton, stok)
 *   Sesi        daftar sesi opname
 *   Hitung      satu baris per sesi + device + SKU, nilai terakhir (karton, lusin, pcs)
 *   Log         riwayat setiap scan/koreksi per device (audit)
 */

const SH = { CONFIG: 'Config', MASTER: 'Master_DMS', SESI: 'Sesi', HITUNG: 'Hitung', LOG: 'Log' };
const HEAD = {
  Master_DMS: ['sku', 'barcode', 'barcode_karton', 'nama', 'isi_karton', 'stok'],
  Sesi: ['sesi_id', 'nama', 'status', 'dibuat', 'dibuat_oleh'],
  Hitung: ['sesi_id', 'device_id', 'device_nama', 'sku', 'karton', 'lusin', 'pcs', 'updated_at'],
  Log: ['log_id', 'waktu', 'sesi_id', 'device_id', 'device_nama', 'sku', 'karton', 'lusin', 'pcs', 'aksi'],
};

function doGet(e) { return handle_((e && e.parameter) || {}); }

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return jsonOut_({ error: 'bad_json' }); }
  return handle_(body);
}

function handle_(p) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets_(ss);
    const cfg = readConfig_(ss);
    const code = String(p.code || '').trim();
    if (!code) return jsonOut_({ error: 'missing_code' });
    if (!String(cfg.kode_akses || '').trim()) return jsonOut_({ error: 'no_access_code', message: 'Isi kode_akses di tab Config.' });
    if (code !== String(cfg.kode_akses).trim()) return jsonOut_({ error: 'invalid_code' });

    switch (p.action) {
      case 'init':
        return jsonOut_({ ok: true, gudang: cfg.nama_gudang || '', sessions: readSessions_(ss),
          master: masterMeta_(cfg), serverTime: new Date().toISOString() });
      case 'master':
        return jsonOut_({ ok: true, master: masterMeta_(cfg), values: ss.getSheetByName(SH.MASTER).getDataRange().getDisplayValues() });
      case 'rekap':
        return jsonOut_({ ok: true, rows: readHitung_(ss, String(p.sesi || '')), serverTime: new Date().toISOString() });
      case 'push': return locked_(() => push_(ss, p));
      case 'createSession': return locked_(() => createSession_(ss, p));
      case 'setSessionStatus': return locked_(() => setSessionStatus_(ss, p));
      case 'deleteSession': return locked_(() => deleteSession_(ss, p));
      case 'importMaster': return locked_(() => importMaster_(ss, p));
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
    }
  });
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

function masterMeta_(cfg) {
  return { version: String(cfg.master_versi || ''), fileName: String(cfg.master_file || ''),
    importedAt: cfg.master_diimport ? String(cfg.master_diimport) : '' };
}

/* ---------------- sessions ---------------- */

function readSessions_(ss) {
  const v = ss.getSheetByName(SH.SESI).getDataRange().getValues();
  return v.slice(1).filter(r => r[0]).map(r => ({
    id: String(r[0]), name: String(r[1]), status: String(r[2] || 'open'),
    createdAt: r[3] instanceof Date ? r[3].toISOString() : String(r[3] || ''),
  }));
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
  ss.getSheetByName(SH.SESI).appendRow([id, name, 'open', new Date().toISOString(), String(p.device_nama || '')]);
  return jsonOut_({ ok: true, id: id, sessions: readSessions_(ss) });
}

function setSessionStatus_(ss, p) {
  const sh = ss.getSheetByName(SH.SESI);
  const row = findSessionRow_(sh, String(p.sesi || ''));
  if (row < 0) return jsonOut_({ error: 'not_found' });
  sh.getRange(row, 3).setValue(p.status === 'closed' ? 'closed' : 'open');
  return jsonOut_({ ok: true, sessions: readSessions_(ss) });
}

function deleteSession_(ss, p) {
  const id = String(p.sesi || '');
  const sesi = ss.getSheetByName(SH.SESI);
  const row = findSessionRow_(sesi, id);
  if (row > 0) sesi.deleteRow(row);
  const h = ss.getSheetByName(SH.HITUNG);
  const v = h.getDataRange().getValues();
  const keep = [v[0]].concat(v.slice(1).filter(r => String(r[0]) !== id));
  if (keep.length !== v.length) {
    h.getRange(1, 1, v.length, v[0].length).clearContent();
    h.getRange(1, 1, keep.length, keep[0].length).setValues(keep);
  }
  return jsonOut_({ ok: true, sessions: readSessions_(ss) });
}

/* ---------------- counts ---------------- */

function readHitung_(ss, sesi) {
  const v = ss.getSheetByName(SH.HITUNG).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const r = v[i];
    if (String(r[0]) !== sesi) continue;
    out.push([String(r[1]), String(r[2]), String(r[3]), Number(r[4]) || 0, Number(r[5]) || 0, Number(r[6]) || 0,
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
    if (String(v[i][0]) === sesi && String(v[i][1]) === dev) idx[String(v[i][3])] = i;
  }
  const changed = [], appended = [];
  items.forEach(it => {
    const sku = String(it.sku || '').trim();
    if (!sku) return;
    const row = [sesi, dev, devName, sku, toInt_(it.k), toInt_(it.l), toInt_(it.p), String(it.at || new Date().toISOString())];
    if (idx[sku] != null) { v[idx[sku]] = row; changed.push(idx[sku]); }
    else appended.push(row);
  });
  // Nama device ikut diperbarui di semua baris device ini.
  Object.keys(idx).forEach(sku => {
    const i = idx[sku];
    if (String(v[i][2]) !== devName) { v[i][2] = devName; if (changed.indexOf(i) < 0) changed.push(i); }
  });

  if (changed.length > 25) {
    sh.getRange(1, 1, v.length, 8).setValues(v.map(r => r.slice(0, 8)));
  } else {
    changed.forEach(i => sh.getRange(i + 1, 1, 1, 8).setValues([v[i].slice(0, 8)]));
  }
  if (appended.length) sh.getRange(sh.getLastRow() + 1, 1, appended.length, 8).setValues(appended);

  // Log: lewati id yang sudah pernah diterima (kiriman ulang saat sinyal putus).
  const logs = Array.isArray(p.log) ? p.log.slice(0, 500) : [];
  if (logs.length) {
    const cache = CacheService.getScriptCache();
    const seen = cache.getAll(logs.map(l => 'log_' + l.id));
    const rows = logs.filter(l => l.id && !seen['log_' + l.id]).map(l =>
      [String(l.id), String(l.at || ''), sesi, dev, devName, String(l.sku || ''), toInt_(l.k), toInt_(l.l), toInt_(l.p), String(l.aksi || '')]);
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
  const rows = Array.isArray(p.rows) ? p.rows : [];
  if (!rows.length) return jsonOut_({ error: 'bad_request', message: 'Data master kosong.' });
  const sh = ss.getSheetByName(SH.MASTER);
  sh.clearContents();
  sh.getRange('A:C').setNumberFormat('@');
  const data = [HEAD.Master_DMS].concat(rows.map(r => [
    String(r[0] || ''), String(r[1] || ''), String(r[2] || ''), String(r[3] || ''), toInt_(r[4]), toInt_(r[5])]));
  sh.getRange(1, 1, data.length, 6).setValues(data);
  const nowIso = new Date().toISOString();
  setConfig_(ss, 'master_versi', nowIso);
  setConfig_(ss, 'master_file', String(p.fileName || 'upload web'));
  setConfig_(ss, 'master_diimport', nowIso);
  return jsonOut_({ ok: true, count: rows.length });
}

/**
 * Simple trigger: kalau tab Master_DMS diedit/ditempel langsung di Sheet,
 * tandai versi baru supaya semua device mengambil ulang master.
 */
function onEdit(e) {
  try {
    const sh = e && e.range && e.range.getSheet();
    if (!sh || sh.getName() !== SH.MASTER) return;
    const ss = sh.getParent();
    setConfig_(ss, 'master_versi', new Date().toISOString());
    setConfig_(ss, 'master_file', 'diedit langsung di Sheet');
    setConfig_(ss, 'master_diimport', new Date().toISOString());
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
