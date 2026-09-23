# Stok Opname Gudang — GitHub Pages + Google Sheet

Web app stok opname untuk beberapa device sekaligus (HP, tablet, laptop dengan
scanner). Setiap device menghitung barang, hitungannya ditandai nama device,
lalu semua device dijumlahkan dan dibandingkan dengan stok terakhir dari DMS.

```
HP-01 ─┐                                       ┌─ tab Hitung   (nilai terakhir per device per SKU)
HP-02 ─┼─(fetch)─> Apps Script (Code.gs) ──────┼─ tab Log      (riwayat setiap scan, untuk audit)
HP-03 ─┘                                       ├─ tab Sesi     (daftar sesi opname)
   GitHub Pages                                └─ tab Master_DMS (stok terakhir dari DMS)
```

## Fitur

1. **Beberapa device sekaligus.** Semua device membuka link yang sama dan
   memilih sesi opname yang sama. Tiap device menyimpan hitungannya sendiri,
   jadi scan dari device berbeda tidak saling menimpa.
2. **Scan SKU atau barcode.** Bisa pakai scanner USB/Bluetooth (bekerja
   seperti keyboard + Enter), kamera HP (tombol **Kamera**), atau ketik SKU
   atau nama barang. Barcode karton otomatis dihitung sebagai karton.
3. **Karton, lusin, pcs.** Isi karton diambil dari data DMS per barang, lusin
   = 12 pcs. Mode **Scan langsung tambah** menambah +1 pcs/lusin/karton tiap
   scan tanpa perlu mengetik jumlah.
4. **Data ditandai per device.** Setiap baris di tab `Hitung` dan `Log`
   menyimpan `device_id` dan `device_nama`.
5. **Dijumlahkan semua device.** Tab **Rekap** menampilkan kolom per device,
   total hitung, stok DMS, selisih (pcs dan karton/lusin/pcs), serta status
   Sesuai / Kurang / Lebih / Belum dihitung / Di luar DMS. Bisa diekspor ke
   Excel.
6. **Pembanding = stok terakhir DMS.** Unggah ekspor DMS (Excel/CSV) dari
   halaman, atau tempel langsung di tab `Master_DMS` di Google Sheet.

Tambahan:
- **Tetap jalan saat sinyal gudang lemah.** Hitungan disimpan dulu di device,
  lalu dikirim otomatis saat online. Indikator di kanan atas menunjukkan
  berapa SKU yang belum terkirim.
- **Hitung buta.** Layar hitung tidak menampilkan stok DMS, supaya penghitung
  tidak terpengaruh angka sistem. Stok DMS hanya terlihat di Rekap.
- **Koreksi dan batal.** Setiap scan bisa dibatalkan, dan setiap SKU bisa
  dikoreksi atau dihapus. Semua perubahan tercatat di tab `Log`.

## Gratis, dan siapa bisa melihat apa

- GitHub Pages gratis untuk repo publik. Apps Script gratis untuk akun Google biasa.
- Kode halaman bisa dilihat siapa saja di GitHub, tetapi **data stok tidak
  ada di kode**. Data hanya keluar setelah memasukkan **kode akses tim** yang
  tersimpan di tab `Config`.
- Kode akses adalah PIN bersama, bukan login per orang. Untuk menggantinya,
  ubah `Config!kode_akses` di Sheet. Semua device akan diminta kode baru.

---

## Langkah 1 — Buat Google Sheet

1. Buat Spreadsheet baru di Google Drive, beri nama mis. `Stok Opname Gudang`.
2. Tab tidak perlu dibuat manual. Skrip akan membuatnya di Langkah 2.

## Langkah 2 — Pasang Apps Script

1. Di Sheet, buka **Extensions > Apps Script**.
2. Hapus isi `Code.gs` bawaan, lalu tempel isi file
   [`google-apps-script/Code.gs`](google-apps-script/Code.gs) dari paket ini.
3. Simpan (`Ctrl+S`).
4. Di dropdown fungsi (atas, sebelah tombol Run), pilih **`setup`**, lalu klik
   **Run**. Saat pertama kali, Google meminta izin: pilih akun Anda, klik
   **Advanced > Go to (nama proyek) (unsafe)**, lalu **Allow**. Ini normal
   untuk skrip milik sendiri.
5. Kembali ke Sheet. Sekarang ada tab `Config`, `Master_DMS`, `Sesi`,
   `Hitung`, dan `Log`.
6. Di tab `Config`, ganti nilai `kode_akses` (awal: `GUDANG-2026`) dan
   `nama_gudang` sesuai kebutuhan.

| key | value |
|---|---|
| `kode_akses` | kode untuk masuk, mis. `GUDANG-2026` |
| `nama_gudang` | tampil di atas halaman, mis. `Gudang Timika` |
| `master_versi`, `master_file`, `master_diimport` | diisi otomatis, jangan diubah |

## Langkah 3 — Deploy sebagai Web App

1. Klik **Deploy > New deployment**.
2. Klik ikon gerigi di sebelah "Select type", pilih **Web app**.
3. Isi **Execute as**: `Me` dan **Who has access**: `Anyone`.
4. Klik **Deploy**, lalu salin **Web app URL** (diakhiri `/exec`).

Kalau nanti `Code.gs` diubah, pakai **Deploy > Manage deployments > pensil
edit > Version: New version > Deploy**. Jangan `New deployment` lagi, karena
itu membuat URL baru.

## Langkah 4 — Isi URL di `assets/config.js`

Buka `assets/config.js`, ganti `PASTE_URL_WEB_APP_DI_SINI` dengan URL dari
Langkah 3:

```js
window.APP_CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/XXXXXXXXXXXX/exec",
};
```

## Langkah 5 — Upload ke GitHub

1. Buat repo baru di GitHub: **+ > New repository**, beri nama mis.
   `stok-opname`, pilih **Public**, jangan centang "Add a README". Klik
   **Create repository**.
2. **Ekstrak dulu file zip ini** di komputer. GitHub tidak membuka isi zip.
3. Di halaman repo, klik **uploading an existing file** (atau
   **Add file > Upload files**).
4. Drag **semua isi** folder `stok-opname-web` (bukan foldernya) ke halaman
   upload: `index.html`, `README.md`, `.nojekyll`, `.gitignore`, folder
   `assets`, dan folder `google-apps-script`.
   File yang namanya diawali titik (`.nojekyll`) kadang tersembunyi. Di Mac
   tekan `Cmd+Shift+.` di Finder untuk menampilkannya.
5. Klik **Commit changes**.

Lewat command line juga bisa:

```bash
cd stok-opname-web
git init && git add -A && git commit -m "Stok opname: GitHub Pages + Apps Script"
git branch -M main
git remote add origin https://github.com/<akun-anda>/stok-opname.git
git push -u origin main
```

## Langkah 6 — Nyalakan GitHub Pages

1. Di repo, buka **Settings > Pages**.
2. **Source**: `Deploy from a branch`. **Branch**: `main`, folder `/ (root)`. Klik **Save**.
3. Tunggu 1–2 menit. URL muncul di halaman yang sama:
   `https://<akun-anda>.github.io/stok-opname/`.

## Langkah 7 — Cara pakai di gudang

1. **Admin (sekali per opname):**
   - Buka link, masukkan kode akses.
   - Tab **Stok DMS**: klik **Pilih file Excel / CSV**, pilih ekspor stok DMS,
     cek pratinjau, klik **Simpan ke Google Sheet**. Klik **Unduh template**
     untuk melihat format kolom.
   - Tab **Sesi**: buat sesi, mis. `Opname Gudang A — Sep 2026`.
2. **Setiap penghitung (per device):**
   - Buka link yang sama, masukkan kode akses.
   - Tab **Sesi**: isi **Nama device**, mis. `HP-01 Rak A`, klik **Simpan**.
     Sesi yang sedang berjalan otomatis dipakai.
   - Tab **Hitung**: scan barcode atau ketik SKU, isi Karton/Lusin/Pcs, tekan
     **Enter** atau **Tambah hitungan**.
   - Barang yang sama boleh di-scan berkali-kali (mis. di rak berbeda). Hitungan
     ditambahkan.
3. **Supervisor:** tab **Rekap** menampilkan jumlah semua device dan
   selisihnya terhadap DMS. Rekap dimuat ulang tiap 20 detik. Klik
   **Export Excel** untuk laporan.
4. Setelah selesai, **Tutup sesi** di tab Sesi supaya tidak ada tambahan hitungan.

### Format data DMS

| Kolom | Wajib | Keterangan | Nama kolom lain yang dikenali |
|---|---|---|---|
| `sku` | ya | kode barang | kode, kode_barang, item_code, kd_brg |
| `barcode` | tidak | barcode pcs | ean, upc, gtin |
| `barcode_karton` | tidak | barcode di karton; scan = +1 karton | barcode_ctn, barcode_dus |
| `nama` | tidak | nama barang | nama_barang, deskripsi, item_name |
| `isi_karton` | tidak | pcs per karton | isi, konversi, pcs_per_karton |
| `stok` | ya* | stok DMS dalam **pcs** | stock, qty, saldo, stok_akhir |

*Kalau DMS mengekspor stok terpisah per satuan, pakai kolom `karton`, `lusin`,
`pcs` sebagai pengganti `stok`. Total pcs dihitung otomatis.

Kalau `isi_karton` kosong, barang itu tidak bisa dihitung per karton (hanya
lusin/pcs).

## Masalah yang mungkin muncul

- **"APPS_SCRIPT_URL belum diisi"** — Langkah 4 belum dilakukan atau file
  `config.js` di GitHub belum diperbarui.
- **"Kode akses salah"** — cek `Config!kode_akses`. Huruf besar/kecil dan spasi berpengaruh.
- **"Tidak bisa terhubung ke Apps Script"** — cek URL diakhiri `/exec` dan
  deployment masih aktif.
- **Indikator merah "Offline · N menunggu"** — normal saat tidak ada sinyal.
  Hitungan aman di device dan terkirim otomatis saat online. Jangan hapus data
  browser atau pakai mode incognito selama masih ada yang menunggu.
- **Kamera tidak mau terbuka** — izinkan akses kamera untuk situs ini di
  pengaturan browser. Kamera hanya bekerja di alamat `https://` (GitHub Pages
  sudah https).
- **Nama barang tidak muncul saat scan** — barcode belum ada di data DMS.
  Scan tetap tercatat dan muncul sebagai "Di luar DMS" di Rekap.
- **Data DMS diubah langsung di Sheet** — halaman mengambil ulang otomatis
  saat dibuka. Bisa juga klik **Ambil ulang dari Sheet** di tab Stok DMS.

## Batas yang perlu diketahui

- Apps Script gratis nyaman untuk sekitar 10 device bersamaan. Hitungan
  dikirim berkelompok tiap beberapa detik, bukan per scan.
- Hitungan per device per sesi disimpan di browser device itu. Kalau data
  browser dihapus, device mengambil ulang hitungannya dari Sheet saat online.

## Struktur file

```
index.html                          halaman utama (login + 4 tab)
assets/style.css                    tampilan
assets/app.js                       logika scan, sinkron, rekap, import DMS, kamera
assets/config.js                    URL Apps Script Anda (Langkah 4)
google-apps-script/Code.gs          kode API, tempel ke Apps Script
google-apps-script/appsscript.json  manifes Apps Script (referensi)
.nojekyll                           GitHub Pages memuat langsung tanpa build Jekyll
```
