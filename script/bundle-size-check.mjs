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
 *   node script/bundle-size-check.mjs --baseline=base-sizes.json --enforce
 *   node script/bundle-size-check.mjs --root=<path> ...               # read <path>/foliplus/dist
 *   node script/bundle-size-check.mjs --help                          # all flags
 *
 * A bundle is gated only when **both** bars are crossed: its growth exceeds
 * `--threshold` in percent *and* `MIN_GROWTH_BYTES` in absolute bytes. The
 * percentage alone inflates on a tiny bundle — 33 bytes on a 371 B bundle
 * reads "+8.9%" — which parks an immaterial growth in the low-margin advisory
 * band ("8.9% growth (1.1% margin left)") and the reader answers it by
 * shortening identifiers or raising the budget instead of looking at the
 * change. The absolute bar is inert where it matters: above 1,280 B, 10%
 * growth already means more than 128 B, so the verdict there is unchanged.
 *
 * When GITHUB_STEP_SUMMARY is set, also writes a Markdown summary.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { brotliCompressSync } from "zlib";
import { help, parseArgs as parseArgsCore } from "./args.mjs";
import { FAIL, OK, STATUS, WARN } from "./glyph.mjs";

// A threshold breach is a policy decision, not a broken check. The report —
// the table and the tree of who exceeded — is the thing that must reach the
// PR, so `check` never fails because a bundle grew; it returns the verdict and
// lets the caller decide. `--enforce` re-adds the exit code for a hard gate.
const EXIT_THRESHOLD = 2;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_THRESHOLD = 10;
const LOW_MARGIN_PCT = 5;

// Absolute floor on the growth that can gate a bundle, in brotli bytes.
//
// Sized from the repo's own history, not guessed. The twelve adjacent-commit
// pairs on main leading up to this change (53405660..2a58f2bb) produced 20
// non-zero per-bundle deltas and none of them crossed ±10%. On a bundle small
// enough for this bar to reach (a baseline under 1,280 B) the widest swing was
// 33 B — #389's ScaleControl field rename, 371 -> 404 B, +8.9% — and the
// next-largest were 11 B and 10 B. Doubling 33 B for toolchain and minifier
// wobble gives 66, and the next power of two above that is 128, so the widest
// swing ever observed sits almost four times inside the bar.
//
// It is deliberately not larger. At the 2.0-3.9:1 brotli ratio of this repo's
// minified JS, 128 B is about 260-500 bytes of source — a small clause of real
// logic, not an identifier rename. Above the floor a bundle small enough for
// it to bite can still be gated on genuine bloat; below it a percentage
// breach is not evidence of anything. At 256 B the same 404 B bundle could
// absorb 255 B — 63% — before the gate noticed, which is a new module rather
// than a rename.
//
// Where the bar is inert: above 1,280 B, 10% growth already means more than
// 128 B, so those bundles are judged exactly as before. That is 8 of the 18
// bundles and 93% of the total brotli weight.
const MIN_GROWTH_BYTES = 128;

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
    desc: `Max growth before failing, in % — growth must also exceed the ${MIN_GROWTH_BYTES} B floor`,
  },
  enforce: {
    type: "bool",
    desc: "Exit non-zero when a bundle exceeds --threshold",
  },
  root: { type: "string", desc: "Project root (reads <root>/foliplus/dist)" },
  base: {
    type: "string",
    desc: "Base commit — the reference the sizes are diffed against",
  },
  head: { type: "string", desc: "Head commit — the build being measured" },
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
// In bytes: the floor is stated in bytes, so the growth it was held against
// must be too. A 7 B change reads "+0.01 KB" in the table above, which drops
// the number that actually decides the verdict.
const fmtDeltaBytes = (curr, prev) => {
  if (curr == null || prev == null) return "—";
  const d = curr - prev;
  return (d > 0 ? "+" : "") + d + " B";
};
const fmtPct = (curr, prev) => {
  if (curr == null || !prev) return "—";
  const p = ((curr - prev) / prev) * 100;
  return (p > 0 ? "+" : "") + p.toFixed(1) + "%";
};

/** Map the comparison numbers to a display status, most severe first.
 *  Judged by the displayed percent (`pct.toFixed(1)`) so a sub-0.05% byte
 *  drift renders "0.0%" and is classified "same" — except when pct is
 *  incalculable (zero-size baseline), where the raw byte delta decides.
 *
 *  `trivial` sits between `low` and `up`: growth that is positive and visible
 *  but under `MIN_GROWTH_BYTES`, so it can neither gate the build nor draw the
 *  low-margin warning. A shrink is never `trivial` — a decrease is news at any
 *  size, and it cannot gate regardless. It also needs a computable percentage,
 *  so a growth off a zero-size baseline falls through to `up`; that case is
 *  unreachable here, since a zero-size brotli output is not a bundle. */
const statusOf = (over, low, material, pct, delta) => {
  if (over) return "over";
  if (low) return "low";
  const shown = pct == null ? null : parseFloat(pct.toFixed(1));
  if (shown != null) {
    if (shown > 0 && !material) return "trivial";
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
    material: false,
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
    // Both bars must be crossed for the gate to fire. `material` also guards
    // the low-margin advisory, so a sub-floor growth never reads as "1.1%
    // margin left".
    const material = delta > MIN_GROWTH_BYTES;
    const over = material && pct != null && pct > threshold;
    const low = material && !over && pct != null && pct > threshold - LOW_MARGIN_PCT;
    return {
      file: f,
      curr,
      prev,
      delta,
      pct,
      status: statusOf(over, low, material, pct, delta),
      over,
      material,
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

/** The `base … head` commit line for the report, both SHAs shortened to 7
 *  characters — enough to be unique in this repo while staying on one line.
 *  A full SHA makes the pair twice as wide for no gain. Rendered only when
 *  both are given: one side empty is a setup mistake (an unresolved ref, or a
 *  substitution the runner did not make), and a partial range with a `?`
 *  reads worse than no range at all. */
const shortSha = sha => (sha && sha.length > 7 ? sha.slice(0, 7) : sha);

const rangeLine = (base, head) => {
  const b = shortSha(base);
  const h = shortSha(head);
  if (!b || !h) return [];
  return [`Comparing base (${b}) to head (${h}).`];
};

const renderTable = (rows, threshold, base, head) => {
  const { curr, prev, delta, pct } = totalCells(summarize(rows));
  const changed = rows.filter(r => r.status !== "same").length;
  const over = rows.filter(r => r.over).length;
  const lines = [
    "",
    `## Bundle Size Check (threshold: ${threshold}%, floor: ${MIN_GROWTH_BYTES} B)`,
    "",
    ...rangeLine(base, head),
    "",
    `A bundle gates only when its growth crosses **both** bars: more than ${threshold}% and more than ${MIN_GROWTH_BYTES} B. Growth below the floor is shown as "trivial" and does not gate.`,
    "",
    `**Total:** ${curr} · **Δ** ${delta} (${pct}) · ${changed} of ${rows.length} bundles changed`,
    "",
    "<details>",
    `<summary>📦 Per-bundle breakdown${
      over ? ` — ${WARN} <b>${over} over threshold</b>` : ""
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
  const underFloor = rows.filter(r => r.status === "trivial");
  // Toolchain drift is not a code-size signal: flag it instead of failing, and
  // point at the capture step so the base can be re-sampled.
  const drift = toolMismatch(current, baseline);

  const table = renderTable(rows, threshold, args.base, args.head);
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
  // Printed rather than swallowed: the gate is silent on these by design, and
  // the reader of the next run has to be able to tell that from "not checked".
  if (underFloor.length > 0) {
    console.log(
      `\n${OK}  ${underFloor.length} bundle(s) grew by less than the ${MIN_GROWTH_BYTES} B floor — below the absolute bar, so the percentage alone is not evidence and the gate does not fire:`,
    );
    for (const u of underFloor) {
      console.log(
        `  ${u.file}: ${fmtDeltaBytes(u.curr, u.prev)} (${u.pct.toFixed(1)}%)`,
      );
    }
  }
  if (failures.length > 0) {
    console.error(
      `\n${STATUS.over} ${failures.length} bundle(s) exceeded threshold:` +
        "\n" +
        failures
          .map(
            f =>
              `  ${f.file}: ${fmtKB(f.prev)} → ${fmtKB(f.curr)} (${f.pct.toFixed(1)}%)`,
          )
          .join("\n"),
    );
    // The table is already written and the summary already appended above, so a
    // non-zero exit here would only hide the report from the PR comment that
    // follows. Report the verdict; let the caller decide whether it gates.
    console.error(
      args.enforce
        ? "\nBundle growth exceeded the threshold — the build fails here."
        : "\nBundle growth exceeded the threshold — review the change. " +
            "Use --enforce to fail the build.",
    );
    return args.enforce ? EXIT_THRESHOLD : 0;
  }
  console.log(`\n${OK} All bundles within threshold.`);
  return 0;
};

export {
  buildRows,
  check,
  MIN_GROWTH_BYTES,
  emit,
  fmtDelta,
  fmtKB,
  fmtPct,
  parseArgs,
  rangeLine,
  rowCells,
  shortSha,
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
