#!/usr/bin/env node
/**
 * Bundle size report — generates an overview page + verifies coverage.
 *
 * Reads the built artifacts in `foliplus/dist/` and:
 *   1. `generateIndexReport(root)` — write `bundle-reports/index.html`, a single
 *      overview listing every bundle with raw/gzip/brotli sizes, share bars and
 *      links to each bundle's sonda report.
 *   2. `checkBundleCoverage(root)` — warn if a dist bundle is not listed in
 *      `size-baselines.json` (so it would silently escape threshold checking).
 *
 * Both run from `build.mjs --sonda` after the esbuild build. Run standalone with:
 *   node script/bundle-report.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { brotliCompressSync, gzipSync } from "zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

/** Write `bundle-reports/index.html` — an interactive treemap aggregating all
 *  dist bundles. Borrows sonda's treemap ideas: tile area & color ∝ size,
 *  hover shows exact size, a toolbar switches Raw/Gzip/Brotli, and clicking a
 *  tile opens that bundle's sonda report. */
export const generateIndexReport = (root = projectRoot) => {
  const distDir = resolve(root, "foliplus/dist");
  const reportDir = resolve(root, "bundle-reports");
  const files = readdirSync(distDir)
    .filter(f => /\.min\.(js|css)$/.test(f))
    .sort();

  const bundles = files.map(f => {
    const buf = readFileSync(resolve(distDir, f));
    const base = f.replace(/^foliplus-/, "").replace(/\.min\.(js|css)$/, "");
    const isCss = f.endsWith(".min.css");
    // Sonda report name: JS → `${base}.html`, CSS → `${base}.css.html`
    const report = `${base}${isCss ? ".css" : ""}.html`;
    const href = existsSync(resolve(reportDir, report)) ? report : null;
    return {
      name: f,
      label: base,
      isCss,
      raw: buf.length,
      gz: gzipSync(buf).length,
      bro: brotliCompressSync(buf).length,
      href,
    };
  });

  // Inline data for the client-side treemap (all sizes in bytes).
  const dataJson = JSON.stringify(
    bundles.map(b => ({
      n: b.name,
      l: b.label,
      t: b.isCss ? "css" : "js",
      raw: b.raw,
      gz: b.gz,
      bro: b.bro,
      href: b.href,
    })),
  );
  const totalOf = key => bundles.reduce((a, b) => a + b[key], 0);
  const kb = n => (n / 1024).toFixed(2) + " KB";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>foliplus — Bundle Size Overview</title>
<style>
  :root { --bar:#f4f5f7; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; margin: 1.5rem; color:#1f2937; background:#fafafa; }
  h1 { font-size: 1.25rem; margin:0 0 .2rem; }
  .sub { color:#6b7280; font-size:.88rem; margin:0 0 1rem; }
  .toolbar { display:flex; gap:.5rem; align-items:center; margin-bottom: .8rem; flex-wrap:wrap; }
  .toolbar .label { font-size:.8rem; color:#6b7280; }
  .seg { display:inline-flex; border:1px solid #e5e7eb; border-radius:6px; overflow:hidden; }
  .seg button { border:0; background:#fff; padding:.3rem .7rem; font-size:.8rem; cursor:pointer; }
  .seg button.active { background:#2563eb; color:#fff; }
  #tour { margin-left:auto; font-size: .8rem; color:#6b7280; }
  #map { position:relative; width:100%; height:520px; background:var(--bar); border-radius:6px; overflow:hidden; }
  .tile { position:absolute; display:flex; flex-direction:column; justify-content:space-between;
    padding:.3rem .4rem; overflow:hidden; color:#fff; cursor:pointer; border:1px solid rgba(255,255,255,.35);
    font-size:.72rem; line-height:1.15; transition:filter .1s; }
  .tile:hover { filter:brightness(1.12); z-index:2; }
  .tile .nm { font-weight:600; word-break:break-all; }
  .tile .sz { opacity:.95; font-variant-numeric:tabular-nums; }
  .tile.css { text-shadow:0 1px 1px rgba(0,0,0,.25); }
  #tip { position:relative; display:inline-block; margin-top:.6rem; }
  .hint { color:#94a3b8; font-size:.78rem; }
  table { border-collapse:collapse; width:100%; background:#fff; margin-top:.6rem; box-shadow:0 1px 3px rgba(0,0,0,.06); }
  th,td { text-align:left; padding:.45rem .6rem; border-bottom:1px solid #eee; font-size:.82rem; }
  th { background:#f9fafb; font-weight:600; }
  .num { font-variant-numeric:tabular-nums; }
  .type { font-size:.7rem; padding:.05rem .32rem; border-radius:3px; font-weight:600; }
  .type.js { background:#e0e7ff; color:#3b2fd8; }
  .type.css { background:#dcfce7; color:#15803d; }
  .detail { color:#2563eb; text-decoration:none; }
  .detail.muted { color:#cbd5e1; }
</style>
</head>
<body>
<h1>📦 foliplus Bundle Size Overview</h1>
<div class="sub">${bundles.length} bundles · click a tile to open its sonda module breakdown.</div>
<div class="toolbar">
  <span class="label">Metric:</span>
  <div class="seg" id="seg">
    <button data-k="raw">Raw</button>
    <button data-k="gz" class="active">Gzip</button>
    <button data-k="bro">Brotli</button>
  </div>
</div>
<div id="map"></div>
<div class="hint">Tile size &amp; color ∝ bundle size. Hover for details. Click to drill into a bundle's sonda report.</div>
<table>
  <thead><tr><th>Bundle</th><th>Type</th><th>Raw</th><th>Gzip</th><th>Brotli</th><th>Detail</th></tr></thead>
  <tbody id="tbl"></tbody>
</table>

<script>
const DATA = ${dataJson};
const map = document.getElementById('map');
const seg = document.getElementById('seg');
const tbl = document.getElementById('tbl');
let metric = 'gz';

const kb = n => (n / 1024) >= 1 ? (n/1024).toFixed(2) + ' KB' : n + ' B';
// Color scale green→yellow→red across [min,max] of current metric.
const heat = t => {
  t = Math.max(0, Math.min(1, t));
  const r = Math.round(120 + t * (220 - 120));
  const g = Math.round(220 - t * (220 - 60));
  const b = r < 180 ? 90 : 70;
  return \`rgb(\${r},\${g},\${b})\`;
}

// Squarified treemap (Bruls et al.). Returns [{x,y,w,h}] in the same order as input items.
const squarify = (items, x, y, w, h) => {
  const total = items.reduce((a,b)=>a+b.v,0) || 1;
  const totalArea = w * h;
  const out = [];
  let rx = x, ry = y, rw = w, rh = h;
  let i = 0;
  while (i < items.length) {
    const side = Math.min(rw, rh);
    let row = [];
    let best = Infinity;
    for (let j = i; j < items.length; j++) {
      const area = (items[j].v / total) * totalArea;
      const worst = worstRatio([...row, area], side);
      if (worst <= best) { row.push(area); best = worst; }
      else break;
    }
    const sum = row.reduce((a,b)=>a+b,0);
    const thick = sum / side;
    let off = 0;
    for (const area of row) {
      const len = area / thick;
      if (rw >= rh) {
        out.push({ x: rx, y: ry + off, w: thick, h: len });
        off += len;
      } else {
        out.push({ x: rx + off, y: ry, w: len, h: thick });
        off += len;
      }
    }
    if (rw >= rh) { rx += thick; rw -= thick; }
    else { ry += thick; rh -= thick; }
    i += row.length;
  }
  return out;
}
// Worst aspect ratio of a row laid along a side-long edge (all tiles share row thickness).
const worstRatio = (row, side) => {
  const sum = row.reduce((a,b)=>a+b,0);
  if (sum === 0) return Infinity;
  let worst = 0;
  for (const a of row) {
    if (a === 0) continue;
    const r = (a * side * side) / (sum * sum);
    worst = Math.max(worst, r, 1 / r);
  }
  return worst;
}

const render = metricKey => {
  const items = DATA.map(d => ({ ...d, v: d[metricKey] })).filter(d => d.v > 0);
  const total = items.reduce((a,b)=>a+b.v,0) || 1;
  const rects = squarify(items, 0, 0, map.clientWidth, map.clientHeight);
  // bind each rect to its item by index (squarify preserves item order)
  const minV = Math.min(...items.map(i=>i.v)), maxV = Math.max(...items.map(i=>i.v));
  map.innerHTML = '';
  rects.forEach((r, i) => {
    const it = items[i];
    const t = maxV > minV ? (it.v - minV) / (maxV - minV) : 0.5;
    const el = document.createElement('div');
    el.className = 'tile' + (it.t === 'css' ? ' css' : '');
    el.style.left = r.x + 'px'; el.style.top = r.y + 'px';
    el.style.width = r.w + 'px'; el.style.height = r.h + 'px';
    el.style.background = heat(t);
    el.title = it.n + ' — ' + kb(it.v);
    el.innerHTML = '<span class="nm">' + it.l + '</span>' +
      (r.w > 90 && r.h > 34 ? '<span class="sz">' + kb(it.v) + ' · ' + (it.v/total*100).toFixed(1) + '%</span>' : '');
    if (it.href) el.addEventListener('click', () => window.open(it.href, '_self'));
    map.appendChild(el);
  });
  // refresh table
  tbl.innerHTML = DATA.map(d =>
    '<tr><td>' + d.n + '</td><td><span class="type ' + d.t + '">' + d.t.toUpperCase() + '</span></td>' +
    '<td class="num">' + kb(d.raw) + '</td><td class="num">' + kb(d.gz) + '</td><td class="num">' + kb(d.bro) + '</td>' +
    '<td>' + (d.href ? '<a class="detail" href="' + d.href + '">&#9656; detail</a>' : '<span class="detail muted">&#8212;</span>') + '</td></tr>'
  ).join('');
}

seg.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    seg.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    metric = btn.dataset.k;
    render(metric);
  });
});
// Ensure clientWidth is measured after layout.
requestAnimationFrame(() => render(metric));
</script>
</body>
</html>`;

  mkdirSync(reportDir, { recursive: true });
  writeFileSync(resolve(reportDir, "index.html"), html);
  console.log(
    `  📊 Overview written: ${resolve(reportDir, "index.html")} (${packKw(totalOf("gz"))} gzip, ${packKw(totalOf("raw"))} raw)`,
  );
}

const packKw = bytes => {
  return (bytes / 1024).toFixed(2) + " KB";
}

/** Warn if any dist bundle is not listed in `size-baselines.json` (would skip threshold checks). */
export const checkBundleCoverage = (root = projectRoot) => {
  const distDir = resolve(root, "foliplus/dist");
  const distFiles = readdirSync(distDir).filter(f => /\.min\.(js|css)$/.test(f));
  const configPath = resolve(root, "size-baselines.json");
  if (!existsSync(configPath)) return; // no baseline yet — nothing to cross-check

  const monitored = new Set(Object.keys(JSON.parse(readFileSync(configPath, "utf-8")).files));
  const unmonitored = distFiles.filter(f => !monitored.has(f));
  if (!unmonitored.length) return;

  console.warn(
    `⚠️  ${unmonitored.length} bundle(s) not covered by size-baselines.json: ${unmonitored.join(", ")}`,
  );
  console.warn("   Add them to size-baselines.json or they will not be size-checked.");
}

// CLI entry point: `node script/bundle-report.mjs`
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  generateIndexReport();
  checkBundleCoverage();
}
