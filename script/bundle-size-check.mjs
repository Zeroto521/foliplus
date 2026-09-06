#!/usr/bin/env node
/**
 * Bundle size checker — compares the built dist bundles' brotli sizes against
 * another build's sizes (typically the base branch), flagging bundles that grow
 * past a threshold (default 10%).
 *
 * There is no committed baseline: CI builds the base branch and captures its
 * sizes with `--emit`, then diffs the PR build against that file.
 *
 * Usage:
 *   node script/bundle-size-check.mjs --emit=base-sizes.json          # capture sizes
 *   node script/bundle-size-check.mjs --baseline=base-sizes.json      # diff vs base
 *   node script/bundle-size-check.mjs --baseline=base-sizes.json --report=out.md
 *   node script/bundle-size-check.mjs --baseline=base-sizes.json --threshold=15
 *   node script/bundle-size-check.mjs --root=<path> ...               # read <path>/foliplus/dist
 *   node script/bundle-size-check.mjs --help                          # all flags
 *
 * When GITHUB_STEP_SUMMARY is set, also writes a Markdown summary.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { brotliCompressSync } from "zlib";
import { help, parseArgs as parseArgsCore } from "./args.mjs";
import { FAIL, OK, STATUS, WARN } from "./glyphs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_THRESHOLD = 10;
const LOW_MARGIN_PCT = 5;

const distDir = root => resolve(root, "foliplus/dist");

// Build tooling that rewrites the emitted bytes. `esbuild` owns the minifier
// and the bundle structure; `svgo` rewrites the inline SVG inside JS sources;
// `postcss`, `postcss-nesting` and `autoprefixer` rewrite the CSS; `browserslist`
// selects the browsers they target. `package-lock.json` is not committed, so a
// PR and the base branch each run their own `npm install` against the live
// registry and can resolve different versions — the diff would then measure tool
// drift instead of code. Observed within the same session: svgo 4.0.2 → 4.1.0,
// postcss 8.5.26 → 8.5.28, browserslist 4.28.8 → 4.28.9, esbuild 0.24.2 (pinned).
const BUILD_TOOLS = [
  "esbuild",
  "svgo",
  "postcss",
  "postcss-nesting",
  "autoprefixer",
  "browserslist",
];

/** Resolve a package's version from a root's node_modules, or null when the
 *  package is absent (e.g. a tool that is no longer needed by the build). */
const toolVersion = (root, pkg) => {
  const path = resolve(root, "node_modules", pkg, "package.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")).version ?? null;
  } catch {
    return null;
  }
};

/** Diff the build tool versions of the current checkout against the baseline
 *  capture. Both were built with the versions named here — a mismatch means the
 *  two size samples were produced by different toolchains.
 *
 *  `emit` records an explicit `null` for a tool the build no longer needs, so
 *  the test is whether the key is *present*, not whether the value is truthy:
 *  a `null → version` change means the tool came back into the build. */
const toolMismatch = (_current, baseline) => {
  const recorded = baseline.tools || {};
  const rows = [];
  for (const pkg of BUILD_TOOLS) {
    if (!Object.prototype.hasOwnProperty.call(recorded, pkg)) continue;
    const prev = recorded[pkg];
    const curr = toolVersion(ROOT, pkg);
    if (prev !== curr) rows.push({ pkg, prev, curr });
  }
  return rows;
};

// Drop the leading block comment — esbuild's `banner`. It is emitted by both
// builds being compared and carries no runtime code, and its byte count drifts
// with the build config, so counting it is pure diff noise. It stays in the
// shipped bundle: it is how a served asset is tied to the version that built it.
const stripLeadingBlockComment = src => {
  const body = src.replace(/^﻿?\/\*[\s\S]*?\*\/\s*/, "");
  return body !== src ? body : src;
};

/** Flag spec — parsed by the shared `args.mjs` parser used by the other build
 *  scripts. It defaults flags it does not see to `false`, so the `?`/`!`
 *  checks below keep their usual meaning. */
const SPEC = {
  emit: { type: "string", desc: "Write the current sizes to this JSON file" },
  baseline: { type: "string", desc: "JSON file to diff against" },
  report: { type: "string", desc: "Also write the Markdown table here" },
  threshold: {
    type: "number",
    default: DEFAULT_THRESHOLD,
    desc: "Max growth before failing, in %",
  },
  root: { type: "string", desc: "Project root (reads <root>/foliplus/dist)" },
};

const parseArgs = argv => parseArgsCore(argv, SPEC);

const readSizes = (root = ROOT) => {
  const dir = distDir(root);

  const files = readdirSync(dir)
    .filter(f => /\.min\.(js|css)$/.test(f))
    .sort();
  const sizes = {};
  for (const f of files) {
    const src = readFileSync(resolve(dir, f), "utf-8");

    sizes[f] = brotliCompressSync(stripLeadingBlockComment(src)).length;
  }
  return sizes;
};

const readBaseline = path => {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
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

/** Map the comparison numbers to a display status, most severe first.
 *  Judged by the displayed percent (`pct.toFixed(1)`) so a sub-0.05% byte
 *  drift renders "0.0%" and is classified "same" — except when pct is
 *  incalculable (zero-size baseline), where the raw byte delta decides. */
const statusOf = (over, low, pct, delta) => {
  if (over) return "over";
  if (low) return "low";
  if (pct != null) {
    const shown = parseFloat(pct.toFixed(1));
    if (shown > 0) return "up";
    if (shown < 0) return "down";
    return "same";
  }
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
    // A non-numeric entry renders "NaN%" in the table; treat it as absent.
    if (!Number.isFinite(prev)) return absent(f, curr, null, "new");
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
      status: statusOf(over, low, pct, delta),
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
    `Sizes exclude the build banner.`,
    "",
    `**Total:** ${curr} · **Δ** ${delta} (${pct}) · ${changed} of ${rows.length} bundles changed`,
    "",
    "<details>",
    `<summary>📦 Per-bundle breakdown${
      over ? ` — ${WARN} **${over} over threshold**` : ""
    }</summary>`,
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

/** Console listing of just the current sizes — used when there is no baseline
 *  to diff against (a bare local `bundle-size:check`). */
const renderSizes = sizes => {
  const files = Object.keys(sizes).sort();
  const lines = ["", "Bundle Sizes", "─".repeat(70)];
  for (const f of files) lines.push(`  ${fmtKB(sizes[f]).padStart(10)}  ${f}`);
  const total = files.reduce((a, f) => a + sizes[f], 0);

  lines.push(`  ${fmtKB(total).padStart(10)}  ${files.length} bundles`);
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

/** Write the current dist sizes to a JSON file (CI captures the base branch's
 *  sizes this way, so a PR can diff against them). */
const emit = (args, root = ROOT) => {
  const sizes = readSizes(root);
  if (!Object.keys(sizes).length) {
    console.error("No bundles found in foliplus/dist/. Run build first.");
    return 1;
  }
  const path = resolve(args.emit);

  mkdirSync(dirname(path), { recursive: true });

  // Recorded from ROOT, the tree that is diffed against this capture — the
  // capture root (`--root=/tmp/base`) is a bare checkout with no node_modules.
  const tools = Object.fromEntries(
    BUILD_TOOLS.map(pkg => [pkg, toolVersion(ROOT, pkg)]),
  );
  try {
    writeFileSync(path, JSON.stringify({ files: sizes, tools }, null, 2) + "\n");
  } catch (err) {
    console.error(`${FAIL} Cannot write ${path}: ${err.message}`);
    return 1;
  }
  const totalKB = Object.values(sizes).reduce((a, b) => a + b, 0) / 1024;

  console.log(
    `${OK} Sizes written: ${Object.keys(sizes).length} bundles, ${totalKB.toFixed(2)} KB → ${path}`,
  );
  return 0;
};

const check = (args, root = ROOT) => {
  const current = readSizes(root);
  const baseline = readBaseline(args.baseline);
  // No baseline: nothing to diff against — list sizes instead of a
  // misleading all-"new" table.
  if (!baseline) {
    console.log(renderSizes(current));

    console.warn(
      `\n${WARN}  No baseline provided — pass --baseline=<sizes-file> to diff.`,
    );
    return 0;
  }
  const threshold = args.threshold;
  const rows = buildRows(current, baseline, threshold);
  const failures = rows.filter(r => r.over);
  const lowMargin = rows.filter(r => r.status === "low");
  // Toolchain drift is not a code-size signal: flag it instead of failing, and
  // point at the capture step so the base can be re-sampled.
  const drift = toolMismatch(current, baseline);

  const table = renderTable(rows, threshold);

  console.log(renderConsole(rows));

  appendSummary(table);
  if (args.report) {
    const reportPath = resolve(args.report);
    try {
      mkdirSync(dirname(reportPath), { recursive: true });

      writeFileSync(reportPath, table + "\n");
    } catch (err) {
      console.error(`${FAIL} Cannot write ${reportPath}: ${err.message}`);
    }
  }

  if (drift.length) {
    const parts = drift.map(d => {
      const next = d.curr == null ? "absent" : `→ ${d.curr}`;
      return `${d.pkg} ${d.prev} ${next}`;
    });

    console.warn(
      `\n${WARN}  Build tools differ from the baseline capture — this diff mixes tool drift with code:` +
        "\n  " +
        parts.join(", ") +
        "\n  The base branch and this PR resolve devDependencies separately, so they can pick up different versions between runs.",
    );

    console.warn(
      `${WARN}  re-run the capture step against this toolchain to get a clean comparison.`,
    );
  }

  if (failures.length > 0) {
    console.error(`\n${STATUS.over} ${failures.length} bundle(s) exceeded threshold:`);
    for (const f of failures)
      console.error(
        `  ${f.file}: ${fmtKB(f.prev)} → ${fmtKB(f.curr)} (${f.pct.toFixed(1)}%)`,
      );

    console.error("\nBundle growth exceeded the threshold — review the change.");
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

  console.log(`\n${OK} All bundles within threshold.`);
  return 0;
};

export {
  buildRows,
  check,
  emit,
  fmtDelta,
  fmtKB,
  fmtPct,
  parseArgs,
  rowCells,
  stripLeadingBlockComment,
  summarize,
  toolMismatch,
  toolVersion,
};

// CLI entry point: `node script/bundle-size-check.mjs [--emit=<path>] [--baseline=<path>]`.
// Guarded so importing this module (for tests) has no side effects.
/* v8 ignore start -- CLI-only entry point, not exercised by unit tests */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(help(SPEC));

    process.exit(0);
  }
  // Malformed input (an unknown flag, a non-numeric threshold) is an error —
  // running anyway would compare against the wrong threshold and report
  // success.
  if (args.errors.length) {
    console.error(args.errors.join("\n"));

    console.error(help(SPEC));

    process.exit(1);
  }
  const root = args.root ? resolve(args.root) : ROOT;
  const code = args.emit ? emit(args, root) : check(args, root);

  process.exit(code ?? 0);
}
/* v8 ignore stop */
