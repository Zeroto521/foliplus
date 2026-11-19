#!/usr/bin/env node
/**
 * Local patch-coverage mirror.
 *
 * Codecov's `patch` status only runs on CI: a branch can be green locally and
 * fail on merge when new lines land uncovered (root cause of #1181 / #1193).
 * This script mirrors that check locally — read the PR diff's added lines,
 * cross-reference them against the vitest coverage report, and fail when the
 * covered share of added executable lines is below the CI patch target (95%).
 *
 * Coverage is read from `coverage/coverage-final.json` (istanbul) when present,
 * else `coverage/lcov.info` (lcov) — both are written by
 * `npx vitest run --coverage`. The diff base defaults to `origin/main`,
 * matching how codecov sees the PR's patch.
 *
 * Usage:
 *   node script/check/patch-coverage.mjs [--base=<ref>] [--threshold=<0-1>]
 *       [--coverage=<path>] [--cwd=<root>]
 *
 * Exit 0 when the patch meets the threshold (or has no executable added
 * lines); exit 1 listing the uncovered added lines otherwise; exit 2 on an
 * environment error (missing coverage report, failing git diff).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_THRESHOLD = 0.95;
const DEFAULT_BASE = "origin/main";
const DEFAULT_COVERAGE = "coverage/coverage-final.json";
const DEFAULT_LCOV = "coverage/lcov.info";

/** Normalize a Windows/Posix path to forward slashes. */
const slash = p => p.replace(/\\/g, "/");

/**
 * Normalize a coverage-report path (absolute or repo-relative) to a
 * repo-relative forward-slash path. Absolute paths under `cwd` are stripped of
 * the cwd prefix; other paths pass through unchanged (they are already
 * relative or outside the repo — left as-is for diagnostics).
 */
const toRel = (absPath, cwd) => {
  const p = slash(path.resolve(cwd, absPath));
  const normCwd = slash(path.resolve(cwd)).replace(/\/+$/, "");
  return p.startsWith(`${normCwd}/`) ? p.slice(normCwd.length + 1) : p;
};

/**
 * Parse a unified diff into { <relativePath>: Set<addedLine> }.
 *
 * Handles the hunks produced by `git diff --unified=0`: each `@@ -a,b +c,d @@`
 * opens a hunk whose new-file line cursor starts at `c`; a body line `+` is an
 * added line (record the cursor, advance it), `-` is a removal (no new-file
 * line consumed), ` ` is context (advance the cursor), and everything else
 * (file headers, `\\ No newline`) is ignored. The `+++ b/<path>` header selects
 * the file; a deletion (`+++ /dev/null`) contributes no added lines.
 */
const parseAddedLines = diffText => {
  const perFile = new Map();
  let file = null;
  let cursor = -1;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      if (!perFile.has(file)) {
        perFile.set(file, new Set());
      }
      cursor = -1;
      continue;
    }
    if (line.startsWith("@@")) {
      const m = line.match(/\+(\d+)(?:,\d+)?/);
      cursor = m ? parseInt(m[1], 10) : -1;
      continue;
    }
    if (file === null || cursor < 0) {
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      perFile.get(file).add(cursor);
      cursor++;
    } else if (line.startsWith("-")) {
      // removal — no new-file line consumed
    } else if (line.startsWith(" ")) {
      cursor++;
    }
  }
  for (const [f, s] of perFile) {
    if (s.size === 0) {
      perFile.delete(f);
    }
  }
  return perFile;
};

/**
 * Parse an istanbul coverage report (coverage-final.json) into
 * Map<relPath, { lines: Map<line,"covered"|"uncovered">, partials }>.
 * A line is covered when any statement spanning it ran (`s[id] > 0`); covered
 * wins over uncovered when a line carries both (partial-statement lines).
 */
const parseIstanbul = (coverage, cwd) => {
  const out = new Map();
  for (const [abs, entry] of Object.entries(coverage)) {
    const rel = toRel(abs, cwd);
    const lines = new Map();
    for (const [id, stmt] of Object.entries(entry.statementMap)) {
      const covered = (entry.s[id] ?? 0) > 0;
      for (let l = stmt.start.line; l <= stmt.end.line; l++) {
        if (covered) {
          lines.set(l, "covered");
        } else if (!lines.has(l)) {
          lines.set(l, "uncovered");
        }
      }
    }
    const partials = [];
    for (const [id, br] of Object.entries(entry.branchMap)) {
      const line = br.line ?? br.loc?.start?.line;
      const counts = entry.b[id] ?? [];
      const untaken = counts.filter(c => c === 0).length;
      if (line != null && untaken > 0) {
        partials.push({ line, untaken, total: counts.length });
      }
    }
    out.set(rel, { lines, partials });
  }
  return out;
};

/**
 * Parse an lcov report (lcov.info) into the same Map shape as parseIstanbul.
 * `DA` records give line hit counts; `BRDA` records give branch hits — a
 * branch with taken "0" is a partial (untaken target).
 */
const parseLcov = (text, cwd) => {
  const out = new Map();
  let file = null;
  let lines = null;
  let partials = null;
  const byLine = new Map();
  const flush = () => {
    if (file !== null) {
      out.set(toRel(file, cwd), { lines, partials });
    }
    file = null;
    lines = null;
    partials = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      flush();
      file = line.slice(3);
      lines = new Map();
      partials = [];
      byLine.clear();
    } else if (line.startsWith("DA:")) {
      const [ln, cnt] = line.slice(3).split(",").map(Number);
      if (Number.isFinite(ln)) {
        const covered = Number.isFinite(cnt) && cnt > 0;
        if (covered) {
          lines.set(ln, "covered");
        } else if (!lines.has(ln)) {
          lines.set(ln, "uncovered");
        }
      }
    } else if (line.startsWith("BRDA:")) {
      const parts = line.slice(5).split(",");
      const ln = Number(parts[0]);
      const taken = parts[3];
      if (Number.isFinite(ln)) {
        const agg = byLine.get(ln) ?? { untaken: 0, total: 0 };
        agg.total += 1;
        if (taken === "0") {
          agg.untaken += 1;
        }
        byLine.set(ln, agg);
      }
    } else if (line === "end_of_record") {
      for (const [ln, agg] of byLine) {
        if (agg.untaken > 0) {
          partials.push({ line: ln, untaken: agg.untaken, total: agg.total });
        }
      }
      flush();
    }
  }
  if (file !== null) {
    for (const [ln, agg] of byLine) {
      if (agg.untaken > 0) {
        partials.push({ line: ln, untaken: agg.untaken, total: agg.total });
      }
    }
    flush();
  }
  return out;
};

/**
 * Compute patch coverage.
 * @param diffAdded Map<relPath, Set<line>> (repo-relative, forward slashes)
 * @param covByRel Map<relPath, { lines, partials }> (repo-relative keys)
 * @returns { files, covered, uncovered, total, pct, missing }
 */
const computePatch = (diffAdded, covByRel) => {
  let covered = 0;
  let uncovered = 0;
  const files = [];
  const missing = [];
  for (const [rel, lines] of diffAdded) {
    const entry = covByRel.get(slash(rel));
    if (!entry) {
      files.push({ file: rel, status: "no-coverage" });
      continue;
    }
    let cov = 0;
    let uncov = 0;
    const missLines = [];
    for (const l of lines) {
      const st = entry.lines.get(l);
      if (st === "covered") {
        cov++;
      } else if (st === "uncovered") {
        uncov++;
        missLines.push(l);
      }
    }
    const partials = entry.partials.filter(p => lines.has(p.line));
    files.push({
      file: rel,
      covered: cov,
      uncovered: uncov,
      missing: missLines,
      partials,
    });
    covered += cov;
    uncovered += uncov;
    if (missLines.length) {
      missing.push({ file: rel, lines: missLines });
    }
  }
  const total = covered + uncovered;
  const pct = total === 0 ? 1 : covered / total;
  return { files, covered, uncovered, total, pct, missing };
};

const parseArgs = argv => {
  const opts = {
    base: DEFAULT_BASE,
    threshold: DEFAULT_THRESHOLD,
    coverage: DEFAULT_COVERAGE,
    cwd: process.cwd(),
    help: false,
  };
  for (const a of argv) {
    if (a === "--help" || a === "-h") {
      opts.help = true;
    } else if (a.startsWith("--base=")) {
      opts.base = a.slice(7);
    } else if (a.startsWith("--threshold=")) {
      opts.threshold = parseFloat(a.slice(12));
    } else if (a.startsWith("--coverage=")) {
      opts.coverage = a.slice(11);
    } else if (a.startsWith("--cwd=")) {
      opts.cwd = a.slice(6);
    } else {
      console.error(`[patch-coverage] unknown arg: ${a}`);
    }
  }
  return opts;
};

const printHelp = () => {
  console.log(
    [
      "patch-coverage — local mirror of codecov's patch coverage check.",
      "",
      "Usage: node script/check/patch-coverage.mjs [options]",
      "",
      "Options:",
      "  --base=<ref>       diff base (default origin/main); the patch is",
      "                     `git diff --unified=0 <base>...HEAD`",
      "  --threshold=<0-1>  minimum patch coverage (default 0.95)",
      "  --coverage=<path>  coverage report (default coverage/coverage-final.json;",
      "                     falls back to coverage/lcov.info when absent)",
      "  --cwd=<root>       repository root (default process.cwd())",
      "  -h, --help         show this help",
      "",
      "The patch is the PR's committed diff against <base>. The coverage report is",
      "produced by `npx vitest run --coverage` (json preferred, lcov fallback).",
      "Exit 0 when the patch meets the threshold, 1 when it does not (uncovered",
      "added lines listed), 2 on an environment error.",
    ].join("\n"),
  );
};

/**
 * Read and parse the coverage report. Prefers coverage-final.json (istanbul),
 * falls back to lcov.info. Returns { covByRel, source }.
 */
const loadCoverage = opts => {
  const candidates = [opts.coverage, DEFAULT_LCOV];
  for (const candidate of candidates) {
    const p = path.resolve(opts.cwd, candidate);
    if (!fs.existsSync(p)) {
      continue;
    }
    const text = fs.readFileSync(p, "utf8");
    if (candidate === opts.coverage && p.endsWith(".json")) {
      return { covByRel: parseIstanbul(JSON.parse(text), opts.cwd), source: p };
    }
    return { covByRel: parseLcov(text, opts.cwd), source: p };
  }
  return null;
};

/**
 * CLI entry — orchestrates the diff read, coverage read and the gate.
 * @param opts parsed options; injectable for tests.
 */
const main = (opts = parseArgs(process.argv.slice(2))) => {
  if (opts.help) {
    printHelp();
    return 0;
  }
  const threshold = Number.isFinite(opts.threshold)
    ? opts.threshold
    : DEFAULT_THRESHOLD;
  let diffText;
  try {
    diffText = execFileSync(
      "git",
      ["diff", "--unified=0", `${opts.base}...HEAD`, "--"],
      { cwd: opts.cwd, encoding: "utf8", maxBuffer: 1 << 26 },
    );
  } catch (e) {
    console.error(
      `[patch-coverage] git diff failed for base "${opts.base}" in ${opts.cwd}: ${e.message}`,
    );
    return 2;
  }
  const diffAdded = parseAddedLines(diffText);
  if (diffAdded.size === 0) {
    console.log(`[patch-coverage] no diff against ${opts.base}; patch is empty — pass`);
    return 0;
  }
  const loaded = loadCoverage(opts);
  if (!loaded) {
    console.error(
      `[patch-coverage] no coverage report at ${path.resolve(opts.cwd, opts.coverage)}` +
        ` or ${path.resolve(opts.cwd, DEFAULT_LCOV)}. Run "npx vitest run --coverage" first.`,
    );
    return 2;
  }
  const res = computePatch(diffAdded, loaded.covByRel);
  const target = (threshold * 100).toFixed(1);
  const got = (res.pct * 100).toFixed(1);
  console.log(
    `[patch-coverage] ${got}% patch (${res.covered}/${res.total} added executable lines covered); target ${target}%`,
  );
  for (const f of res.files) {
    if (f.status === "no-coverage") {
      console.log(
        `  ${f.file}: not in the coverage report (excluded or non-JS) — skipped`,
      );
    } else {
      if (f.missing.length) {
        console.log(`  ${f.file}: uncovered added lines ${f.missing.join(", ")}`);
      }
      for (const pr of f.partials) {
        console.log(
          `  ${f.file}:${pr.line}: branch partial — ${pr.total - pr.untaken}/${pr.total} targets taken`,
        );
      }
    }
  }
  if (res.pct < threshold) {
    console.log(
      `[patch-coverage] FAIL: ${res.uncovered} added ${res.uncovered === 1 ? "line" : "lines"} not covered; below ${target}%`,
    );
    return 1;
  }
  console.log("[patch-coverage] OK");
  return 0;
};

const runCli = (argv, entry) => {
  if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(parseArgs(argv));
  }
};
runCli(process.argv.slice(2), process.argv[1]);

const __entryUrl = fileURLToPath(import.meta.url);

export {
  toRel,
  parseAddedLines,
  parseIstanbul,
  parseLcov,
  computePatch,
  parseArgs,
  loadCoverage,
  main,
  runCli,
  __entryUrl,
};
