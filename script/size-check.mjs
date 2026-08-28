#!/usr/bin/env node
/**
 * Bundle size baseline checker — compares each dist bundle's brotli size
 * against a committed baseline (`size-baselines.json`). Fails when a bundle
 * grows beyond the configured threshold (default 10%).
 *
 * Modes:
 *   (default)    Check current sizes vs baseline, fail on exceedance.
 *   --save       Update baseline from current sizes.
 *   --audit      Show utilization report (current / baseline / margin).
 *
 * Usage:
 *   node script/size-check.mjs            # check (CI / local)
 *   node script/size-check.mjs --save     # update baseline
 *   node script/size-check.mjs --audit    # utilization report
 *   node script/size-check.mjs --threshold=15  # override threshold
 *
 * When GITHUB_STEP_SUMMARY is set, also writes a Markdown summary.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { brotliCompressSync } from "zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "foliplus/dist");
const BASELINE = resolve(ROOT, "size-baselines.json");
const DEFAULT_THRESHOLD = 10;
const LOW_MARGIN_PCT = 5;

const parseArgs = argv => {
  const args = { check: true, save: false, audit: false, threshold: DEFAULT_THRESHOLD };
  for (const a of argv) {
    if (a === "--save") args.save = true;
    else if (a === "--audit") args.audit = true;
    else if (a.startsWith("--threshold=")) args.threshold = parseInt(a.split("=")[1], 10);
  }
  if (args.save) args.check = false;
  return args;
};

const readSizes = () => {
  const files = readdirSync(DIST).filter(f => /\.min\.(js|css)$/.test(f)).sort();
  const sizes = {};
  for (const f of files) sizes[f] = brotliCompressSync(readFileSync(resolve(DIST, f))).length;
  return sizes;
};

const readBaseline = () => {
  if (!existsSync(BASELINE)) return null;
  return JSON.parse(readFileSync(BASELINE, "utf-8"));
};

const writeBaseline = (files, threshold) => {
  const data = {
    version: 1,
    threshold,
    lastUpdated: new Date().toISOString().split("T")[0],
    updatedBy: process.env.GITHUB_ACTOR || "local",
    files,
  };
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, JSON.stringify(data, null, 2) + "\n");
};

const fmtKB = n => (n / 1024).toFixed(2) + " KB";
const fmtDelta = (curr, prev) => {
  const d = curr - prev;
  return (d > 0 ? "+" : "") + (d / 1024).toFixed(2) + " KB";
};
const fmtPct = (curr, prev) => {
  if (!prev) return "—";
  const p = ((curr - prev) / prev) * 100;
  return (p > 0 ? "+" : "") + p.toFixed(1) + "%";
};

const ICONS = { over: "🔴", up: "🟡", down: "🟢", same: "⚪", new: "🆕", missing: "⚠️" };

const buildRows = (current, baseline, threshold) => {
  const allFiles = [...new Set([...Object.keys(current), ...(baseline ? Object.keys(baseline.files || {}) : [])])].sort();
  return allFiles.map(f => {
    const curr = current[f] ?? null;
    const prev = baseline ? baseline.files[f] ?? null : null;
    if (curr === null) return { file: f, status: "missing", over: false };
    if (prev === null) return { file: f, curr, prev: null, delta: null, pct: null, status: "new", over: false };
    const delta = curr - prev;
    const pct = prev > 0 ? (delta / prev) * 100 : null;
    const over = pct > threshold;
    return { file: f, curr, prev, delta, pct, status: over ? "over" : delta > 0 ? "up" : delta < 0 ? "down" : "same", over };
  });
};

const renderTable = (rows, threshold) => {
  const lines = ["", `## 📦 Bundle Size Check (threshold: ${threshold}%)`, "",
    "| File | Current | Baseline | Δ | Δ% | Status |",
    "|------|---------|----------|------|-----|--------|"];
  for (const r of rows) {
    const currStr = r.curr != null ? fmtKB(r.curr) : "—";
    const prevStr = r.prev != null ? fmtKB(r.prev) : "—";
    const icon = ICONS[r.status] || "⚪";
    const label = r.status === "over" ? `OVER ${fmtPct(r.curr, r.prev)}` : r.status;
    lines.push(`| ${r.file} | ${currStr} | ${prevStr} | ${fmtDelta(r.curr, r.prev)} | ${fmtPct(r.curr, r.prev)} | ${icon} ${label} |`);
  }
  return lines.join("\n");
};

const renderConsole = rows => {
  const lines = ["", "Bundle Size Check", "─".repeat(70)];
  for (const r of rows) {
    const icon = ICONS[r.status] || "⚪";
    const currStr = r.curr != null ? fmtKB(r.curr) : "—";
    const prevStr = r.prev != null ? fmtKB(r.prev) : "—";
    const label = r.status === "over" ? `OVER ${fmtPct(r.curr, r.prev)}` : r.status;
    lines.push(`  ${icon} ${r.file.padEnd(42)} ${currStr.padStart(10)}  ←  ${prevStr.padStart(10)}  ${fmtDelta(r.curr, r.prev).padStart(9)}  ${fmtPct(r.curr, r.prev).padStart(6)}  ${label}`);
  }
  return lines.join("\n");
};

const appendSummary = text => {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try {
    const existing = readFileSync(process.env.GITHUB_STEP_SUMMARY, "utf-8");
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, existing + text);
  } catch {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  }
};

const check = ({ threshold }) => {
  const current = readSizes();
  const baseline = readBaseline();
  const rows = buildRows(current, baseline, threshold);
  const failures = rows.filter(r => r.over);
  const lowMargin = rows.filter(r => {
    if (r.over || r.curr == null || r.prev == null || r.prev <= 0) return false;
    const growth = ((r.curr - r.prev) / r.prev) * 100;
    return growth > threshold - LOW_MARGIN_PCT;
  });

  console.log(renderConsole(rows));
  appendSummary(renderTable(rows, threshold));

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} bundle(s) exceeded threshold:`);
    for (const f of failures) console.error(`  ${f.file}: ${fmtKB(f.prev)} → ${fmtKB(f.curr)} (${f.pct.toFixed(1)}%)`);
    console.error("\nUpdate baseline: node script/size-check.mjs --save");
    process.exit(1);
  }
  if (lowMargin.length > 0) {
    console.warn(`\n⚠️  ${lowMargin.length} bundle(s) with <${LOW_MARGIN_PCT}% margin:`);
    for (const m of lowMargin) {
      const g = ((m.curr - m.prev) / m.prev * 100).toFixed(1);
      const remaining = (threshold - parseFloat(g)).toFixed(1);
      console.warn(`  ${m.file}: ${g}% growth (${remaining}% margin left)`);
    }
  }
  if (!baseline) {
    console.warn("\n⚠️  No baseline found. Create one:");
    console.warn("  node script/size-check.mjs --save");
  } else {
    console.log("\n✓ All bundles within threshold.");
  }
};

const save = ({ threshold }) => {
  const current = readSizes();
  if (!Object.keys(current).length) {
    console.error("No bundles found in foliplus/dist/. Run build first.");
    process.exit(1);
  }
  writeBaseline(current, threshold);
  const totalKB = Object.values(current).reduce((a, b) => a + b, 0) / 1024;
  console.log(`✓ Baseline saved: ${Object.keys(current).length} bundles, ${totalKB.toFixed(2)} KB total`);
  for (const [f, s] of Object.entries(current)) console.log(`  ${fmtKB(s).padStart(10)}  ${f}`);
};

const audit = () => {
  const current = readSizes();
  const baseline = readBaseline();
  if (!baseline) {
    console.log("No baseline found. Run: node script/size-check.mjs --save");
    return;
  }
  const threshold = baseline.threshold;
  console.log(`\nBundle Size Audit (baseline: ${baseline.lastUpdated}, threshold: ${threshold}%)`);
  console.log("─".repeat(78));
  console.log("  " + "File".padEnd(40) + "Current".padStart(10) + "Baseline".padStart(10) + "Growth".padStart(9) + "Margin".padStart(9) + "  Status");

  const files = Object.keys(current).sort();
  for (const f of files) {
    const curr = current[f];
    const prev = baseline.files[f];
    if (prev == null) {
      console.log("  " + f.padEnd(40) + fmtKB(curr).padStart(10) + "  NEW".padStart(10) + " ".padStart(18) + "  🆕 new");
      continue;
    }
    const growth = ((curr - prev) / prev * 100).toFixed(1);
    const remaining = threshold - parseFloat(growth);
    const marginStr = (remaining >= 0 ? "" : "⚠️ ") + remaining.toFixed(1) + "%";
    const status = remaining <= 0 ? "🔴 OVER" : remaining < LOW_MARGIN_PCT ? "🟡 LOW" : "🟢 OK";
    console.log("  " + f.padEnd(40) + fmtKB(curr).padStart(10) + fmtKB(prev).padStart(10) + growth.padStart(8) + "%" + marginStr.padStart(9) + "  " + status);
  }
};

const args = parseArgs(process.argv.slice(2));
if (args.save) save(args);
else if (args.audit) audit();
else check(args);
