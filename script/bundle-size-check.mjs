#!/usr/bin/env node
/**
 * Bundle size baseline checker — compares each dist bundle's brotli size
 * against a committed baseline (`bundle-size-baseline.json`). Fails when a bundle
 * grows beyond the configured threshold (default 10%).
 *
 * Modes:
 *   (default)    Check current sizes vs baseline, fail on exceedance.
 *   --save       Update baseline from current sizes.
 *
 * Usage:
 *   node script/bundle-size-check.mjs            # check (CI / local)
 *   node script/bundle-size-check.mjs --save     # update baseline
 *   node script/bundle-size-check.mjs --threshold=15  # override threshold
 *   node script/bundle-size-check.mjs --baseline=<path>  # compare against a custom baseline
 *   node script/bundle-size-check.mjs --report=<path>    # also write the Markdown table to a file
 *
 * When GITHUB_STEP_SUMMARY is set, also writes a Markdown summary.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { brotliCompressSync } from "zlib";
import { OK, STATUS, WARN } from "./glyphs.mjs";
import { resolveVersion } from "./version.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_THRESHOLD = 10;
const LOW_MARGIN_PCT = 5;

const distDir = root => resolve(root, "foliplus/dist");
const baselinePath = root => resolve(root, "bundle-size-baseline.json");

const parseArgs = argv => {
  const args = {
    save: false,
    threshold: DEFAULT_THRESHOLD,
    thresholdSet: false,
    baseline: null,
    report: null,
    unknown: [],
  };
  for (const a of argv) {
    if (a === "--save") args.save = true;
    else if (a.startsWith("--threshold=")) {
      const v = parseInt(a.split("=")[1], 10);
      args.threshold = Number.isFinite(v) ? v : DEFAULT_THRESHOLD;
      args.thresholdSet = true;
    } else if (a.startsWith("--baseline=")) args.baseline = a.split("=")[1];
    else if (a.startsWith("--report=")) args.report = a.split("=")[1];
    else args.unknown.push(a);
  }
  return args;
};

/** Resolve the effective threshold: explicit --threshold wins, else the
 *  baseline's stored threshold (so `--save --threshold=15` is honored by a
 *  later plain `check`), else the default. */
const resolveThreshold = (args, baseline) => {
  if (args.thresholdSet) return args.threshold;
  const stored = Number(baseline?.threshold);
  if (Number.isFinite(stored)) return stored;
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

const readBaseline = path => {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
};

const writeBaseline = (files, threshold, root = ROOT) => {
  const data = {
    version: resolveVersion(),
    threshold,
    // `files` values are brotli-compressed sizes in bytes (see readSizes).
    unit: "brotli bytes",
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

/** Map the comparison numbers to a display status, most severe first. */
const statusOf = (over, low, delta) => {
  if (over) return "over";
  if (low) return "low";
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "same";
};

const buildRows = (current, baseline, threshold) => {
  const allFiles = [
    ...new Set([
      ...Object.keys(current),
      ...(baseline ? Object.keys(baseline.files || {}) : []),
    ]),
  ].sort();
  // Rows with no comparison counterpart (bundle added/removed) carry no delta.
  const absent = (file, curr, prev, status) => ({
    file,
    curr,
    prev,
    delta: null,
    pct: null,
    status,
    over: false,
  });
  return allFiles.map(f => {
    const curr = current[f] ?? null;
    const prev = baseline ? (baseline.files?.[f] ?? null) : null;
    if (curr === null) return absent(f, null, prev, "missing");
    if (prev === null) return absent(f, curr, null, "new");
    const delta = curr - prev;
    const pct = prev > 0 ? (delta / prev) * 100 : null;
    const over = pct > threshold;
    const low = !over && pct > threshold - LOW_MARGIN_PCT;
    return {
      file: f,
      curr,
      prev,
      delta,
      pct,
      status: statusOf(over, low, delta),
      over,
    };
  });
};

/** Shared per-row formatting for both the console and Markdown renderers. */
const rowCells = r => ({
  icon: STATUS[r.status] || "·",
  currStr: r.curr != null ? fmtKB(r.curr) : "—",
  prevStr: r.prev != null ? fmtKB(r.prev) : "—",
  label: r.status === "over" ? `OVER ${fmtPct(r.curr, r.prev)}` : r.status,
});

/** Aggregate totals across all rows (current vs baseline, in bytes). With no
 *  prior sizes there is nothing to diff against, so delta/pct stay null. */
const summarize = rows => {
  let curr = 0;
  let prev = 0;
  let prevSeen = false;
  for (const r of rows) {
    if (r.curr != null) curr += r.curr;
    if (r.prev != null) {
      prev += r.prev;
      prevSeen = true;
    }
  }
  return {
    curr,
    prev,
    hasPrev: prevSeen,
    delta: prevSeen ? curr - prev : null,
    pct: prevSeen && prev > 0 ? ((curr - prev) / prev) * 100 : null,
  };
};

/** Total-row formatting, mirroring rowCells: with no baseline sizes there is
 *  nothing to diff against, so the baseline and difference cells read "—"
 *  rather than 0.00 KB. */
const totalCells = t => ({
  curr: fmtKB(t.curr),
  prev: t.hasPrev ? fmtKB(t.prev) : "—",
  delta: t.delta == null ? "—" : fmtDelta(t.curr, t.prev),
  pct: t.pct == null ? "—" : fmtPct(t.curr, t.prev),
});

const renderTable = (rows, threshold) => {
  const { curr, prev, delta, pct } = totalCells(summarize(rows));
  const changed = rows.filter(r => r.status !== "same").length;
  const over = rows.filter(r => r.over).length;
  const lines = [
    "",
    `## Bundle Size Check (threshold: ${threshold}%)`,
    "",
    `**Total:** ${curr} · **Δ** ${delta} (${pct}) · ${changed} of ${rows.length} bundles changed`,
    "",
    "<details>",
    `<summary>📦 Per-bundle breakdown${over ? ` — ${WARN} ${over} over threshold` : ""}</summary>`,
    "",
    "| File | Current | Baseline | Δ | Δ% | Status |",
    "|:-----|--------:|---------:|-----:|----:|--------|",
  ];
  for (const r of rows) {
    const { icon, currStr, prevStr, label } = rowCells(r);
    lines.push(
      `| ${r.file} | ${currStr} | ${prevStr} | ${fmtDelta(r.curr, r.prev)} | ${fmtPct(r.curr, r.prev)} | ${icon} ${label} |`,
    );
  }
  lines.push(`| **Total** | **${curr}** | **${prev}** | **${delta}** | **${pct}** | |`);
  lines.push("", "</details>");
  return lines.join("\n");
};

const renderConsole = rows => {
  const lines = ["", "Bundle Size Check", "─".repeat(70)];
  for (const r of rows) {
    const { icon, currStr, prevStr, label } = rowCells(r);
    lines.push(
      `  ${icon} ${r.file.padEnd(42)} ${currStr.padStart(10)}  ←  ${prevStr.padStart(10)}  ${fmtDelta(r.curr, r.prev).padStart(9)}  ${fmtPct(r.curr, r.prev).padStart(6)}  ${label}`,
    );
  }
  const { curr, prev, delta, pct } = totalCells(summarize(rows));
  lines.push(
    `  ${"Total".padEnd(44)} ${curr.padStart(10)}  ←  ${prev.padStart(10)}  ${delta.padStart(9)}  ${pct.padStart(6)}`,
  );
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
  const baseline = readBaseline(args.baseline || baselinePath(root));
  const threshold = resolveThreshold(args, baseline);
  const rows = buildRows(current, baseline, threshold);
  const failures = rows.filter(r => r.over);
  const lowMargin = rows.filter(r => r.status === "low");

  const table = renderTable(rows, threshold);
  console.log(renderConsole(rows));
  appendSummary(table);
  if (args.report) {
    const reportPath = resolve(args.report);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, table + "\n");
  }

  if (failures.length > 0) {
    console.error(`\n${STATUS.over} ${failures.length} bundle(s) exceeded threshold:`);
    for (const f of failures)
      console.error(
        `  ${f.file}: ${fmtKB(f.prev)} → ${fmtKB(f.curr)} (${f.pct.toFixed(1)}%)`,
      );
    console.error("\nUpdate baseline: node script/bundle-size-check.mjs --save");
    return 1;
  }
  if (lowMargin.length > 0) {
    console.warn(
      `\n${WARN}  ${lowMargin.length} bundle(s) with <${LOW_MARGIN_PCT}% margin:`,
    );
    for (const m of lowMargin) {
      const g = m.pct.toFixed(1);
      const remaining = (threshold - m.pct).toFixed(1);
      console.warn(`  ${m.file}: ${g}% growth (${remaining}% margin left)`);
    }
  }
  if (!baseline) {
    console.warn(`\n${WARN}  No baseline found. Create one:`);
    console.warn("  node script/bundle-size-check.mjs --save");
  } else console.log(`\n${OK} All bundles within threshold.`);
  return 0;
};

const save = (args, root = ROOT) => {
  const current = readSizes(root);
  if (!Object.keys(current).length) {
    console.error("No bundles found in foliplus/dist/. Run build first.");
    return 1;
  }
  writeBaseline(
    current,
    resolveThreshold(args, readBaseline(baselinePath(root))),
    root,
  );
  const totalKB = Object.values(current).reduce((a, b) => a + b, 0) / 1024;
  console.log(
    `${OK} Baseline saved: ${Object.keys(current).length} bundles, ${totalKB.toFixed(2)} KB total`,
  );
  for (const [f, s] of Object.entries(current))
    console.log(`  ${fmtKB(s).padStart(10)}  ${f}`);
  return 0;
};

export {
  buildRows,
  check,
  fmtDelta,
  fmtKB,
  fmtPct,
  parseArgs,
  resolveThreshold,
  rowCells,
  save,
  summarize,
};

// CLI entry point: `node script/bundle-size-check.mjs [--save] [--threshold=N]`.
// Guarded so importing this module (for tests) has no side effects.
/* v8 ignore start -- CLI-only entry point, not exercised by unit tests */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = parseArgs(process.argv.slice(2));
  if (args.unknown.length)
    console.warn(`${WARN}  Unknown argument(s) ignored: ${args.unknown.join(", ")}`);
  const code = args.save ? save(args) : check(args);
  process.exit(code ?? 0);
}
/* v8 ignore stop */
