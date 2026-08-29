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
import { fileURLToPath, pathToFileURL } from "url";
import { brotliCompressSync } from "zlib";
import { OK, STATUS, WARN } from "./glyphs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_THRESHOLD = 10;
const LOW_MARGIN_PCT = 5;

const distDir = root => resolve(root, "foliplus/dist");
const baselinePath = root => resolve(root, "size-baselines.json");

const parseArgs = argv => {
  const args = {
    check: true,
    save: false,
    audit: false,
    threshold: DEFAULT_THRESHOLD,
    thresholdSet: false,
    unknown: [],
  };
  for (const a of argv) {
    if (a === "--save") args.save = true;
    else if (a === "--audit") args.audit = true;
    else if (a.startsWith("--threshold=")) {
      const v = parseInt(a.split("=")[1], 10);
      args.threshold = Number.isFinite(v) ? v : DEFAULT_THRESHOLD;
      args.thresholdSet = true;
    } else args.unknown.push(a);
  }
  if (args.save) args.check = false;
  return args;
};

/** Resolve the effective threshold: explicit --threshold wins, else the
 *  baseline's stored threshold (so `--save --threshold=15` is honored by a
 *  later plain `check`), else the default. */
const resolveThreshold = (args, baseline) => {
  if (args.thresholdSet) return args.threshold;
  if (baseline && Number.isFinite(baseline.threshold)) return baseline.threshold;
  return DEFAULT_THRESHOLD;
};

const readSizes = (root = ROOT) => {
  const dir = distDir(root);
  const files = readdirSync(dir)
    .filter(f => /\.min\.(js|css)$/.test(f))
    .sort();
  const sizes = {};
  for (const f of files)
    sizes[f] = brotliCompressSync(readFileSync(resolve(dir, f))).length;
  return sizes;
};

const readBaseline = (root = ROOT) => {
  const path = baselinePath(root);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
};

const writeBaseline = (files, threshold, root = ROOT) => {
  const data = {
    version: 1,
    threshold,
    lastUpdated: new Date().toISOString().split("T")[0],
    updatedBy: process.env.GITHUB_ACTOR || "local",
    files,
  };
  const path = baselinePath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
};

const fmtKB = n => (n / 1024).toFixed(2) + " KB";
const fmtDelta = (curr, prev) => {
  if (curr == null || prev == null) return "—";
  const d = curr - prev;
  return (d > 0 ? "+" : "") + (d / 1024).toFixed(2) + " KB";
};
const fmtPct = (curr, prev) => {
  if (curr == null || !prev) return "—";
  const p = ((curr - prev) / prev) * 100;
  return (p > 0 ? "+" : "") + p.toFixed(1) + "%";
};

const buildRows = (current, baseline, threshold) => {
  const allFiles = [
    ...new Set([
      ...Object.keys(current),
      ...(baseline ? Object.keys(baseline.files || {}) : []),
    ]),
  ].sort();
  return allFiles.map(f => {
    const curr = current[f] ?? null;
    const prev = baseline ? (baseline.files[f] ?? null) : null;
    if (curr === null) return { file: f, status: "missing", over: false };
    if (prev === null)
      return {
        file: f,
        curr,
        prev: null,
        delta: null,
        pct: null,
        status: "new",
        over: false,
      };
    const delta = curr - prev;
    const pct = prev > 0 ? (delta / prev) * 100 : null;
    const over = pct > threshold;
    return {
      file: f,
      curr,
      prev,
      delta,
      pct,
      status: over ? "over" : delta > 0 ? "up" : delta < 0 ? "down" : "same",
      over,
    };
  });
};

const renderTable = (rows, threshold) => {
  const lines = [
    "",
    `## 📦 Bundle Size Check (threshold: ${threshold}%)`,
    "",
    "| File | Current | Baseline | Δ | Δ% | Status |",
    "|------|---------|----------|------|-----|--------|",
  ];
  for (const r of rows) {
    const currStr = r.curr != null ? fmtKB(r.curr) : "—";
    const prevStr = r.prev != null ? fmtKB(r.prev) : "—";
    const icon = STATUS[r.status] || "·";
    const label = r.status === "over" ? `OVER ${fmtPct(r.curr, r.prev)}` : r.status;
    lines.push(
      `| ${r.file} | ${currStr} | ${prevStr} | ${fmtDelta(r.curr, r.prev)} | ${fmtPct(r.curr, r.prev)} | ${icon} ${label} |`,
    );
  }
  return lines.join("\n");
};

const renderConsole = rows => {
  const lines = ["", "Bundle Size Check", "─".repeat(70)];
  for (const r of rows) {
    const icon = STATUS[r.status] || "·";
    const currStr = r.curr != null ? fmtKB(r.curr) : "—";
    const prevStr = r.prev != null ? fmtKB(r.prev) : "—";
    const label = r.status === "over" ? `OVER ${fmtPct(r.curr, r.prev)}` : r.status;
    lines.push(
      `  ${icon} ${r.file.padEnd(42)} ${currStr.padStart(10)}  ←  ${prevStr.padStart(10)}  ${fmtDelta(r.curr, r.prev).padStart(9)}  ${fmtPct(r.curr, r.prev).padStart(6)}  ${label}`,
    );
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

const check = (args, root = ROOT) => {
  const current = readSizes(root);
  const baseline = readBaseline(root);
  const threshold = resolveThreshold(args, baseline);
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
    console.error(`\n${STATUS.over} ${failures.length} bundle(s) exceeded threshold:`);
    for (const f of failures)
      console.error(
        `  ${f.file}: ${fmtKB(f.prev)} → ${fmtKB(f.curr)} (${f.pct.toFixed(1)}%)`,
      );
    console.error("\nUpdate baseline: node script/size-check.mjs --save");
    return 1;
  }
  if (lowMargin.length > 0) {
    console.warn(
      `\n${WARN}  ${lowMargin.length} bundle(s) with <${LOW_MARGIN_PCT}% margin:`,
    );
    for (const m of lowMargin) {
      const g = (((m.curr - m.prev) / m.prev) * 100).toFixed(1);
      const remaining = (threshold - parseFloat(g)).toFixed(1);
      console.warn(`  ${m.file}: ${g}% growth (${remaining}% margin left)`);
    }
  }
  if (!baseline) {
    console.warn(`\n${WARN}  No baseline found. Create one:`);
    console.warn("  node script/size-check.mjs --save");
  } else {
    console.log(`\n${OK} All bundles within threshold.`);
  }
  return 0;
};

const save = (args, root = ROOT) => {
  const current = readSizes(root);
  if (!Object.keys(current).length) {
    console.error("No bundles found in foliplus/dist/. Run build first.");
    return 1;
  }
  writeBaseline(current, resolveThreshold(args, readBaseline(root)), root);
  const totalKB = Object.values(current).reduce((a, b) => a + b, 0) / 1024;
  console.log(
    `${OK} Baseline saved: ${Object.keys(current).length} bundles, ${totalKB.toFixed(2)} KB total`,
  );
  for (const [f, s] of Object.entries(current))
    console.log(`  ${fmtKB(s).padStart(10)}  ${f}`);
  return 0;
};

const audit = (root = ROOT) => {
  const current = readSizes(root);
  const baseline = readBaseline(root);
  if (!baseline) {
    console.log("No baseline found. Run: node script/size-check.mjs --save");
    return 0;
  }
  const threshold = baseline.threshold ?? DEFAULT_THRESHOLD;
  console.log(
    `\nBundle Size Audit (baseline: ${baseline.lastUpdated}, threshold: ${threshold}%)`,
  );
  console.log("─".repeat(78));
  console.log(
    "  " +
      "File".padEnd(40) +
      "Current".padStart(10) +
      "Baseline".padStart(10) +
      "Growth".padStart(9) +
      "Margin".padStart(9) +
      "  Status",
  );

  const files = Object.keys(current).sort();
  for (const f of files) {
    const curr = current[f];
    const prev = baseline.files[f];
    if (prev == null) {
      console.log(
        "  " +
          f.padEnd(40) +
          fmtKB(curr).padStart(10) +
          "  NEW".padStart(10) +
          " ".padStart(18) +
          "  " +
          STATUS.new +
          " new",
      );
      continue;
    }
    const growth = (((curr - prev) / prev) * 100).toFixed(1);
    const remaining = threshold - parseFloat(growth);
    const marginStr = (remaining >= 0 ? "" : WARN + " ") + remaining.toFixed(1) + "%";
    const status =
      remaining <= 0
        ? `${STATUS.over} OVER`
        : remaining < LOW_MARGIN_PCT
          ? `${WARN} LOW`
          : `${OK} OK`;
    console.log(
      "  " +
        f.padEnd(40) +
        fmtKB(curr).padStart(10) +
        fmtKB(prev).padStart(10) +
        growth.padStart(8) +
        "%" +
        marginStr.padStart(9) +
        "  " +
        status,
    );
  }
  return 0;
};

export {
  audit,
  buildRows,
  check,
  fmtDelta,
  fmtKB,
  fmtPct,
  parseArgs,
  resolveThreshold,
  save,
};

// CLI entry point: `node script/size-check.mjs [--save|--audit] [--threshold=N]`.
// Guarded so importing this module (for tests) has no side effects.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = parseArgs(process.argv.slice(2));
  if (args.unknown.length)
    console.warn(`${WARN}  Unknown argument(s) ignored: ${args.unknown.join(", ")}`);
  const code = args.save ? save(args) : args.audit ? audit() : check(args);
  process.exit(code ?? 0);
}
