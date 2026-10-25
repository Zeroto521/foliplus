#!/usr/bin/env node
// script/browser-probe.mjs — T59: inventory + syntax gate for test/js/browser.
//
// The probe corpus is not a test suite: every file is a JavaScript snippet that
// a Python Playwright test injects with `page.evaluate(_js("<dir>/<name>"))`.
// Playwright accepts either a function expression or a statement body, so this
// runner mirrors that two-step parse and reports three things:
//
//   * every probe parses (V8 `new Function`, no evaluator needed),
//   * which probes no Python test references (orphans),
//   * which `_js()` references have no probe file (dangling).
//
// Exit status is 0 by default (the CI job is informational); `--strict` makes
// parse errors and dangling references fail. No dependencies, no browser.
//
// Usage:
//   node script/browser-probe.mjs
//   node script/browser-probe.mjs --strict --json browser-probes.json
//   node script/browser-probe.mjs --github-summary
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROBE_ROOT = path.join(ROOT, "test", "js", "browser");
const PY_ROOT = path.join(ROOT, "test", "python");
const LIST_LIMIT = 20;

const argv = process.argv.slice(2);
const has = flag => argv.includes(flag);
const valueOf = flag => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const strict = has("--strict");
const jsonPath = valueOf("--json");
const githubSummary = has("--github-summary");

/** Every regular file below `dir`, recursively (absolute paths). */
const walk = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

const relPosix = (abs, base) => path.relative(base, abs).split(path.sep).join("/");

const probeFiles = walk(PROBE_ROOT)
  .filter(file => file.endsWith(".js"))
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const probes = probeFiles.map(file => ({
  name: relPosix(file, PROBE_ROOT).replace(/\.js$/, ""),
  file: relPosix(file, ROOT),
}));

// ── Parse check ──────────────────────────────────────────────────────────
// Playwright's page.evaluate(string) first tries to compile the source as an
// expression, then falls back to compiling it as a function body. Only a
// source that fails BOTH is unrunnable.
const parseProbe = source => {
  try {
    new Function(`return (${source})`);
    return null;
  } catch {
    try {
      new Function(source);
      return null;
    } catch (bodyError) {
      return String(bodyError && bodyError.message ? bodyError.message : bodyError);
    }
  }
};

const parseErrors = [];
for (const probe of probes) {
  const source = fs.readFileSync(path.join(ROOT, probe.file), "utf8");
  const error = parseProbe(source);
  if (error) parseErrors.push({ probe: probe.name, error });
}

// ── Reference scan (test/python) ────────────────────────────────────────
// Static references only: `_js("Dir/name")` / `_js('Dir/name')`. Lines that
// are comments or docstrings are skipped (conftest documents the helper with a
// literal example in its docstring). Calls that are not a literal on the same
// line are counted as "indirect" and cannot be mapped without importing Python.
const LITERAL_RE = /_js\(\s*(["'])([^"']+)\1/g;
const references = new Map(); // probe name -> [python file]
const indirect = [];
const pythonFiles = walk(PY_ROOT).filter(file => file.endsWith(".py"));
for (const file of pythonFiles) {
  const rel = relPosix(file, ROOT);
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    const callCount = (line.match(/(?<![\w$])_js\(/g) || []).length;
    if (!callCount) continue;
    // The helper definition itself is not a call (`def _js(...)`).
    if (/^\s*def\s+_js\b/.test(line)) continue;
    // Docstring / comment heuristic: skip documentation-only mentions.
    if (
      trimmed.startsWith("#") ||
      trimmed.startsWith('"""') ||
      trimmed.startsWith("'''")
    ) {
      continue;
    }
    if (trimmed.includes("``")) continue;
    let matched = 0;
    for (const match of line.matchAll(LITERAL_RE)) {
      matched += 1;
      const name = match[2];
      if (!references.has(name)) references.set(name, []);
      references.get(name).push(`${rel}:${index + 1}`);
    }
    if (matched < callCount) indirect.push(`${rel}:${index + 1}`);
  }
}

const orphans = probes.filter(probe => !references.has(probe.name));
const known = new Set(probes.map(probe => probe.name));
const dangling = [...references.keys()]
  .filter(name => !known.has(name))
  .sort()
  .map(name => ({ reference: name, files: references.get(name) }));

// ── Directory breakdown ─────────────────────────────────────────────────
const byDir = {};
for (const probe of probes) {
  const dir = probe.name.includes("/") ? probe.name.split("/")[0] : "(root)";
  byDir[dir] = (byDir[dir] || 0) + 1;
}
const byDirSorted = Object.fromEntries(Object.entries(byDir).sort());

// ── Report ──────────────────────────────────────────────────────────────
const totals = {
  probes: probes.length,
  parsed: probes.length - parseErrors.length,
  parseErrors: parseErrors.length,
  references: references.size,
  orphanProbes: orphans.length,
  danglingReferences: dangling.length,
  indirectCalls: indirect.length,
};

console.log(`browser probes: ${totals.probes} files under test/js/browser`);
console.log(`  parsed:              ${totals.parsed}/${totals.probes}`);
console.log(`  referenced:          ${totals.probes - orphans.length}`);
console.log(`  orphan probes:       ${totals.orphanProbes}`);
console.log(`  dangling references: ${totals.danglingReferences}`);
console.log(`  indirect _js() calls: ${totals.indirectCalls}`);
console.log(`  by directory:`);
for (const [dir, count] of Object.entries(byDirSorted)) {
  console.log(`    ${dir.padEnd(18)} ${count}`);
}

const printList = (title, items) => {
  if (!items.length) return;
  console.log(`\n${title}:`);
  for (const item of items.slice(0, LIST_LIMIT)) console.log(`  - ${item}`);
  if (items.length > LIST_LIMIT) {
    console.log(`  ... and ${items.length - LIST_LIMIT} more`);
  }
};

printList(
  "parse errors",
  parseErrors.map(entry => `${entry.probe}: ${entry.error}`),
);
printList(
  "orphan probes (no _js() reference)",
  orphans.map(probe => probe.name),
);
printList(
  "dangling references (no probe file)",
  dangling.map(entry => `${entry.reference}  <- ${entry.files.join(", ")}`),
);
printList("indirect _js() calls (not statically mappable)", indirect);

const payload = {
  totals,
  parseErrors,
  orphans: orphans.map(probe => probe.name),
  dangling,
  indirect,
  byDir: byDirSorted,
};
if (jsonPath) {
  fs.writeFileSync(
    path.resolve(ROOT, jsonPath),
    JSON.stringify(payload, null, 2) + "\n",
  );
  console.log(`\nwrote ${jsonPath}`);
}

if (githubSummary) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    const lines = [];
    lines.push("## Browser probes (informational)");
    lines.push("");
    lines.push("| metric | value |");
    lines.push("| --- | ---: |");
    lines.push(`| probes | ${totals.probes} |`);
    lines.push(`| parsed | ${totals.parsed} |`);
    lines.push(`| parse errors | ${totals.parseErrors} |`);
    lines.push(`| orphan probes | ${totals.orphanProbes} |`);
    lines.push(`| dangling references | ${totals.danglingReferences} |`);
    lines.push("| indirect `_js()` calls | " + totals.indirectCalls + " |");
    lines.push("");
    const section = (title, items) => {
      if (!items.length) return;
      lines.push(`<details><summary>${title} (${items.length})</summary>`, "");
      for (const item of items.slice(0, LIST_LIMIT)) lines.push(`- ${item}`);
      if (items.length > LIST_LIMIT) {
        lines.push(`- ... and ${items.length - LIST_LIMIT} more`);
      }
      lines.push("", "</details>", "");
    };
    section(
      "parse errors",
      parseErrors.map(entry => `${entry.probe}: ${entry.error}`),
    );
    section(
      "orphan probes",
      orphans.map(probe => probe.name),
    );
    section(
      "dangling references",
      dangling.map(entry => `${entry.reference} <- ${entry.files.join(", ")}`),
    );
    lines.push(
      "_Informational job: failures are reported here and in the artifact, and do not block required checks._",
    );
    fs.appendFileSync(summaryFile, lines.join("\n") + "\n");
  }
}

const failed = parseErrors.length > 0 || dangling.length > 0;
if (strict && failed) {
  console.error(
    "\nbrowser-probes: strict mode — parse errors or dangling references present",
  );
  process.exit(1);
}
if (!strict) {
  console.log("\nbrowser-probes: informational (use --strict to fail on errors)");
}
