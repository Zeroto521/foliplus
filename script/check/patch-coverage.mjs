#!/usr/bin/env node
// script/check/patch-coverage — mirrors the CI patch-coverage gate locally, so a PR adding uncovered lines cannot look green
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
 *
 * Scope: only JS/TS sources count toward the patch (vitest covers them).
 * Python sources are excluded and reported as skipped — `make test-js`
 * only produces JS coverage, so a Python-only change must not fail this mirror
 * (Python is covered by pytest, not this mirror). A changed file is Python when
 * it ends in .py or lives under test/python/ (foliplus/*.py and below,
 * test/python/* and below, script/*.py). Any other non-JS file (markdown,
 * yaml, config) is skipped too.
 *
 * Why this is not wired into `make gate`: 94e3b1f0 reverted the make gate
 * target because "CI already covers all checks independently" — the CI
 * workflows run lint / format / typecheck / tests as separate jobs, so a
 * local aggregate gate would duplicate work and drift from CI. This script
 * stays a standalone check; run it before push.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_THRESHOLD = 0.95;
const DEFAULT_BASE = "origin/main";
const DEFAULT_COVERAGE = "coverage/coverage-final.json";
const DEFAULT_LCOV = "coverage/lcov.info";
const DEFAULT_PY_COVERAGE = "coverage.xml";

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
 * A changed file counts toward the patch only when vitest can cover it
 * (JS/TS sources). Everything else — Python, markdown, yaml, configs — is
 * outside this mirror's scope.
 */
const isJsFile = rel => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(slash(rel));

/**
 * A Python-scope file is scored against the pytest Cobertura report
 * (`coverage.xml`), not skipped — see parseCobertura. It is no longer
 * excluded from the patch; an uncovered added line in a Python file FAILs
 * the check, mirroring codecov's patch gate for Python.
 * The rule covers foliplus/*.py and below, test/python/* and below, and
 * script/*.py — any .py file, plus any path under test/python/ (defensive
 * for future non-.py files).
 */
const isPythonFile = rel =>
  /\.py$/.test(slash(rel)) || slash(rel).startsWith("test/python/");

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
 * Parse a coverage.py Cobertura XML report (coverage.xml) into the same
 * Map<relPath, { lines, partials }> shape as parseIstanbul/parseLcov.
 *
 * Cobertura <class filename="..."> paths are relative to each <source> root;
 * the report lists one <source> per measured root (foliplus/, script/). A
 * class's repo-relative path is the join of the FIRST source whose file exists
 * on disk — this disambiguates the same relative name under different roots
 * (e.g. check/changelog_check.py exists under script/, not foliplus/).
 * `pathExists` is injectable for tests (defaults to fs.existsSync).
 */
const parseCobertura = (text, cwd, pathExists = p => fs.existsSync(p)) => {
  const out = new Map();
  const sources = [];
  let file = null;
  let lines = null;
  let partials = null;
  const flush = () => {
    if (file !== null) {
      out.set(file, { lines, partials });
    }
    file = null;
    lines = null;
    partials = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const srcMatch = line.match(/^<source>([^<]+)<\/source>$/);
    if (srcMatch) {
      sources.push(srcMatch[1]);
      continue;
    }
    const classMatch = line.match(/^<class\b[^>]*\bfilename="([^"]+)"/);
    if (classMatch) {
      flush();
      const filename = classMatch[1];
      let rel = null;
      for (const source of sources) {
        const candidate = toRel(path.resolve(source, filename), cwd);
        if (pathExists(path.resolve(cwd, candidate))) {
          rel = candidate;
          break;
        }
      }
      if (rel === null) {
        // No source resolves — fall back to the first source join (defensive).
        rel = sources.length
          ? toRel(path.resolve(sources[0], filename), cwd)
          : slash(filename);
      }
      file = rel;
      lines = new Map();
      partials = [];
      continue;
    }
    const lineMatch = line.match(/^<line\b([^>]*)\/?>$/);
    if (lineMatch && file !== null) {
      const attrs = lineMatch[1];
      const num = attrs.match(/\bnumber="(\d+)"/);
      const hits = attrs.match(/\bhits="(\d+)"/);
      const branch = attrs.match(/\bbranch="true"/);
      const cond = attrs.match(/condition-coverage="(\d+)% \((\d+)\/(\d+)\)"/);
      if (num) {
        const ln = parseInt(num[1], 10);
        const covered = hits ? parseInt(hits[1], 10) > 0 : false;
        if (covered) {
          lines.set(ln, "covered");
        } else if (!lines.has(ln)) {
          lines.set(ln, "uncovered");
        }
        if (branch && cond) {
          const taken = parseInt(cond[2], 10);
          const total = parseInt(cond[3], 10);
          if (taken < total) {
            partials.push({ line: ln, untaken: total - taken, total });
          }
        }
      }
      continue;
    }
    if (line.startsWith("</class>")) {
      flush();
    }
  }
  flush();
  return out;
};

/**
 * Print one file's patch detail (no side prefix — keeps the JS line format
 * stable). `side` labels the report the file was scored against.
 */
const reportFile = (f, side) => {
  const covName = side === "Python" ? "Python coverage" : "coverage";
  const nonLabel = side === "Python" ? "non-Python" : "non-JS";
  if (f.status === "no-coverage") {
    console.log(
      `  ${f.file}: not in the ${covName} report (excluded or ${nonLabel}) — skipped`,
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
  let partial = 0;
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
    let part = 0;
    const missLines = [];
    const partialLines = [];
    for (const l of lines) {
      const st = entry.lines.get(l);
      const isPartial = entry.partials.some(p => p.line === l);
      if (st === "covered" && !isPartial) {
        cov++;
      } else if (st === "covered" && isPartial) {
        part++;
        partialLines.push(l);
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
      partial: part,
      partialLines,
      missing: missLines,
      partials,
    });
    covered += cov;
    uncovered += uncov;
    partial += part;
    if (missLines.length) {
      missing.push({ file: rel, lines: missLines });
    }
  }
  // codecov's patch metric counts a partial (untaken-branch) line as not fully
  // hit: hit / (hit + miss + partial). The mirror previously treated partials
  // as covered, disagreeing with the CI gate (#1402).
  const total = covered + uncovered + partial;
  const pct = total === 0 ? 1 : covered / total;
  return { files, covered, uncovered, partial, total, pct, missing };
};

const parseArgs = argv => {
  const opts = {
    base: DEFAULT_BASE,
    threshold: DEFAULT_THRESHOLD,
    coverage: DEFAULT_COVERAGE,
    pyCoverage: DEFAULT_PY_COVERAGE,
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
    } else if (a.startsWith("--py-coverage=")) {
      opts.pyCoverage = a.slice(14);
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
      "  --coverage=<path>  JS coverage report (default coverage/coverage-final.json;",
      "                     falls back to coverage/lcov.info when absent)",
      "  --py-coverage=<path> Python coverage report (default coverage.xml;",
      "                     Cobertura XML from make test-python-fast)",
      "  --cwd=<root>       repository root (default process.cwd())",
      "  -h, --help         show this help",
      "",
      "The patch is the PR's committed diff against <base>. JS coverage is",
      "produced by `npx vitest run --coverage` (json preferred, lcov fallback);",
      "Python coverage by `make test-python-fast` (coverage.xml). A mixed",
      "JS+Python patch needs both reports. Uncovered added lines are scored",
      "per side and the patch fails when either side is below the threshold.",
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
  // Scope split: JS/TS files are scored against the vitest report; Python
  // files (.py, test/python/) are scored against the pytest Cobertura report.
  // Other files (markdown, yaml, configs) are out of scope and skipped.
  const jsFiles = new Map();
  const pythonFiles = new Map();
  const otherFiles = [];
  for (const [rel, lines] of diffAdded) {
    if (isPythonFile(rel)) {
      pythonFiles.set(rel, lines);
    } else if (isJsFile(rel)) {
      jsFiles.set(rel, lines);
    } else {
      otherFiles.push(rel);
    }
  }
  const target = (threshold * 100).toFixed(1);

  // Report out-of-scope files first so a non-code change is visibly a skip,
  // not a silent pass.
  for (const f of otherFiles) {
    console.log(`  ${f}: skipped: not in a coverage report (excluded or non-code)`);
  }

  // ---- JS side ----
  const jsLoaded = loadCoverage(opts);
  const hasJsPatch = jsFiles.size > 0;
  let jsRes = null;
  if (hasJsPatch) {
    if (!jsLoaded) {
      console.error(
        `[patch-coverage] no JS coverage report at ${path.resolve(opts.cwd, opts.coverage)}` +
          ` or ${path.resolve(opts.cwd, DEFAULT_LCOV)}. Run "npx vitest run --coverage" first.`,
      );
      return 2;
    }
    jsRes = computePatch(jsFiles, jsLoaded.covByRel);
    const got = (jsRes.pct * 100).toFixed(1);
    console.log(
      `[patch-coverage] JS: ${got}% patch (${jsRes.covered}/${jsRes.total} added executable lines covered); target ${target}%`,
    );
    for (const f of jsRes.files) {
      reportFile(f, "JS");
    }
  }

  // ---- Python side ----
  const pyPath = path.resolve(opts.cwd, opts.pyCoverage);
  const hasPyPatch = pythonFiles.size > 0;
  let pyRes = null;
  if (hasPyPatch) {
    if (!fs.existsSync(pyPath)) {
      console.error(
        `[patch-coverage] no Python coverage report at ${pyPath}. Run "make test-python-fast" (or pytest --cov-report=xml) first.`,
      );
      return 2;
    }
    const pyText = fs.readFileSync(pyPath, "utf8");
    const pyCov = parseCobertura(pyText, opts.cwd);
    pyRes = computePatch(pythonFiles, pyCov);
    const got = (pyRes.pct * 100).toFixed(1);
    console.log(
      `[patch-coverage] Python: ${got}% patch (${pyRes.covered}/${pyRes.total} added executable lines covered); target ${target}%`,
    );
    for (const f of pyRes.files) {
      reportFile(f, "Python");
    }
  }

  // ---- verdict ----
  const failed = [];
  if (jsRes && jsRes.pct < threshold) {
    failed.push("JS");
  }
  if (pyRes && pyRes.pct < threshold) {
    failed.push("Python");
  }
  if (failed.length) {
    for (const side of failed) {
      const res = side === "JS" ? jsRes : pyRes;
      console.log(
        `[patch-coverage] ${side} FAIL: ${res.uncovered} added ${res.uncovered === 1 ? "line" : "lines"} not covered${res.partial ? ` plus ${res.partial} partial ${res.partial === 1 ? "line" : "lines"}` : ""}; below ${target}%`,
      );
    }
    console.log(`[patch-coverage] FAIL: ${failed.join(" and ")} below ${target}%`);
    return 1;
  }
  console.log("[patch-coverage] OK");
  return 0;
};

const runCli = (argv, entry, selfUrl = fileURLToPath(import.meta.url)) => {
  if (entry !== undefined && path.resolve(entry) === selfUrl) {
    process.exitCode = main(parseArgs(argv));
  }
};
runCli(process.argv.slice(2), process.argv[1]);

export {
  toRel,
  parseAddedLines,
  parseIstanbul,
  parseLcov,
  parseCobertura,
  computePatch,
  parseArgs,
  loadCoverage,
  isJsFile,
  isPythonFile,
  reportFile,
  main,
  runCli,
};
