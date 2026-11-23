// Membuat Admin.html dan Hitung.html di google-apps-script/ dari index.html, hitung.html, assets/.
// Jalankan: node build-apps-script.js   (lalu clasp push / salin semua file ke editor Apps Script)
const fs = require('fs');
const css = fs.readFileSync('assets/style.css', 'utf8');
// HtmlService menghapus komentar // secara kasar dan memotong URL di dalam string, jadi // ditulis \/\/ (artinya sama di JS).
const js = fs.readFileSync('assets/app.js', 'utf8').replace(/https:\/\//g, 'https:\\/\\/');
if (js.includes('<?') || css.includes('<?')) throw new Error('app.js/style.css mengandung "<?" yang bentrok dengan template Apps Script');
const dbg = `<script>(function(){function show(m){var d=document.getElementById("errBox");if(!d){d=document.createElement("pre");d.id="errBox";d.style.cssText="position:fixed;left:0;right:0;bottom:0;z-index:99999;margin:0;padding:10px;background:#7a1010;color:#fff;font:12px monospace;white-space:pre-wrap;max-height:40vh;overflow:auto";document.body.appendChild(d);}d.textContent+=m+"\\n";}window.addEventListener("error",function(e){show("JS error: "+e.message+" ("+(e.lineno||"?")+")");});window.addEventListener("unhandledrejection",function(e){show("Promise error: "+(e.reason&&e.reason.message||e.reason));});})();</script>
`;
const cfg = dbg + `<script>window.APP_CONFIG = { EMBEDDED: true, APPS_SCRIPT_URL: <?!= JSON.stringify(url) ?>, KODE_HITUNG: <?!= JSON.stringify(k) ?> };</script>`;
for (const [src, out] of [['index.html', 'Admin.html'], ['hitung.html', 'Hitung.html']]) {
  let h = fs.readFileSync(src, 'utf8');
  const n0 = h.length;
  h = h.replace(/<link rel="stylesheet" href="assets\/style\.css[^"]*">/, () => `<style>\n${css}\n</style>`)
       .replace(/<script src="assets\/config\.js[^"]*"><\/script>/, () => cfg)
       .replace(/<script src="assets\/app\.js[^"]*"><\/script>/, () => `<script>\n${js}\n</script>`);
  if (/(href|src)="assets\//.test(h)) throw new Error(src + ': masih ada referensi assets/');
  fs.writeFileSync('google-apps-script/' + out, h);
  console.log(out, h.length, 'bytes');
}
