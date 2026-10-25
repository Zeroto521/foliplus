#!/usr/bin/env node
/**
 * Inventory + syntax gate for the `test/js/browser` probe corpus.
 *
 * The probe files are not a test suite: each one is a JavaScript snippet that
 * a Python Playwright test injects with `page.evaluate(_js("<dir>/<name>"))`.
 * Playwright accepts either a function expression or a statement body, so this
 * gate mirrors that two-step parse and reports:
 *
 *   - every probe parses (V8 `new Function`, no evaluator needed),
 *   - which probes no Python test references (orphans),
 *   - which `_js()` references have no probe file (dangling).
 *
 * Files whose basename starts with `_` are support files (for example
 * `_parse_probe.js`), not probes: the inventory skips them and a reference to
 * one is not reported as dangling.
 *
 * Exit status is 0 by default; `--strict` fails on parse errors or dangling
 * references. No dependencies, no browser.
 *
 * Usage:
 *   node script/check/browser-probe.mjs
 *   node script/check/browser-probe.mjs --strict --json browser-probe.json
 *   node script/check/browser-probe.mjs --github-summary
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { repoRoot } from "../build-path.mjs";

const ROOT = repoRoot(import.meta.url);
const LIST_LIMIT = 20;

/** A support file is a `_`-prefixed sibling, never counted as a probe. */
const isSupportName = name => name.split("/").pop().startsWith("_");

/** Every regular file below `dir`, recursively (absolute paths). */
const walk = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

const relPosix = (abs, base) => path.relative(base, abs).split(path.sep).join("/");

/**
 * Parse one probe the way Playwright's `page.evaluate(string)` does.
 *
 * Playwright first compiles the source as an expression, then falls back to
 * compiling it as a function body; only a source that fails BOTH is
 * unrunnable. Returns the failure message, or null when it parses.
 */
const parseProbe = source => {
  try {
    new Function(`return (${source})`);
    return null;
  } catch {
    try {
      new Function(source);
      return null;
    } catch (error) {
      return String(error instanceof Error ? error.message : error);
    }
  }
};

// ── Static `_js()` reference scan ────────────────────────────────────────
// Only literal calls on one line are mapped. Lines that are comments or
// docstrings are skipped (conftest documents the helper with a literal example
// in its docstring); the helper definition itself is not a call. Calls whose
// argument is not a string literal are reported as indirect — they cannot be
// resolved without importing Python.
const LITERAL_RE = /_js\(\s*(["\'])([^"\']+)\1/g;
const CALL_RE = /(?<![\w$])_js\(/g;
const DEF_RE = /^\s*def\s+_js\b/;

const collectReferences = root => {
  const pythonRoot = path.join(root, "test", "python");
  const references = new Map();
  const indirect = [];
  if (!fs.existsSync(pythonRoot)) return { references, indirect };
  for (const file of walk(pythonRoot).filter(entry => entry.endsWith(".py"))) {
    const rel = relPosix(file, root);
    const fileLines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (const [index, line] of fileLines.entries()) {
      const callCount = (line.match(CALL_RE) || []).length;
      if (!callCount) continue;
      const trimmed = line.trim();
      if (DEF_RE.test(line)) continue;
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
  return { references, indirect };
};

/** Build the full inventory report for one checkout root. Pure: no printing. */
const buildReport = root => {
  const probeRoot = path.join(root, "test", "js", "browser");
  const files = walk(probeRoot)
    .filter(file => file.endsWith(".js"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const names = files.map(file => relPosix(file, probeRoot).replace(/\.js$/, ""));
  const supportFiles = names.filter(isSupportName);
  const probes = names
    .filter(name => !isSupportName(name))
    .map(name => ({ name, file: `test/js/browser/${name}.js` }));

  const parseErrors = [];
  for (const probe of probes) {
    const source = fs.readFileSync(path.join(root, probe.file), "utf8");
    const error = parseProbe(source);
    if (error) parseErrors.push({ probe: probe.name, error });
  }

  const { references, indirect } = collectReferences(root);
  const known = new Set(probes.map(probe => probe.name));
  const support = new Set(supportFiles);
  const orphanProbes = probes.filter(probe => !references.has(probe.name));
  const dangling = [...references.keys()]
    .filter(name => !known.has(name) && !support.has(name))
    .sort()
    .map(name => ({ reference: name, files: references.get(name) }));
  const referencedProbes = [...references.keys()].filter(name => known.has(name));

  const byDir = {};
  for (const probe of probes) {
    const dir = probe.name.includes("/") ? probe.name.split("/")[0] : "(root)";
    byDir[dir] = (byDir[dir] || 0) + 1;
  }

  return {
    totals: {
      probes: probes.length,
      parsed: probes.length - parseErrors.length,
      parseErrors: parseErrors.length,
      references: referencedProbes.length,
      orphanProbes: orphanProbes.length,
      danglingReferences: dangling.length,
      indirectCalls: indirect.length,
      supportFiles: supportFiles.length,
    },
    probes,
    parseErrors,
    orphans: orphanProbes,
    dangling,
    indirect,
    byDir,
  };
};

/** The human-readable report body, one line per array entry. */
const renderText = report => {
  const { totals, byDir, parseErrors, orphans, dangling, indirect } = report;
  const output = [
    `browser probes: ${totals.probes} files under test/js/browser`,
    `  parsed:              ${totals.parsed}/${totals.probes}`,
    `  referenced:          ${totals.probes - orphans.length}`,
    `  orphan probes:       ${totals.orphanProbes}`,
    `  dangling references: ${totals.danglingReferences}`,
    `  indirect _js() calls: ${totals.indirectCalls}`,
    `  support files:       ${totals.supportFiles}`,
    "  by directory:",
  ];
  for (const dir of Object.keys(byDir).sort()) {
    output.push(`    ${dir.padEnd(18)} ${byDir[dir]}`);
  }
  const section = (title, items) => {
    if (!items.length) return;
    output.push("", `${title}:`);
    for (const item of items.slice(0, LIST_LIMIT)) output.push(`  - ${item}`);
    if (items.length > LIST_LIMIT) {
      output.push(`  ... and ${items.length - LIST_LIMIT} more`);
    }
  };
  section(
    "parse errors",
    parseErrors.map(entry => `${entry.probe}: ${entry.error}`),
  );
  section(
    "orphan probes (no _js() reference)",
    orphans.map(probe => probe.name),
  );
  section(
    "dangling references (no probe file)",
    dangling.map(entry => `${entry.reference}  <- ${entry.files.join(", ")}`),
  );
  section("indirect _js() calls (not statically mappable)", indirect);
  return output;
};

/** Job-summary markdown (GitHub Actions fallback UI for the artifact). */
const renderSummary = report => {
  const { totals, parseErrors, orphans, dangling } = report;
  const output = [
    "## Browser probes (informational)",
    "",
    "| metric | value |",
    "| --- | ---: |",
    `| probes | ${totals.probes} |`,
    `| parsed | ${totals.parsed} |`,
    `| parse errors | ${totals.parseErrors} |`,
    `| orphan probes | ${totals.orphanProbes} |`,
    `| dangling references | ${totals.danglingReferences} |`,
    `| indirect _js() calls | ${totals.indirectCalls} |`,
    `| support files | ${totals.supportFiles} |`,
    "",
  ];
  const section = (title, items) => {
    if (!items.length) return;
    output.push(`<details><summary>${title} (${items.length})</summary>`, "");
    for (const item of items.slice(0, LIST_LIMIT)) output.push(`- ${item}`);
    if (items.length > LIST_LIMIT) {
      output.push(`- ... and ${items.length - LIST_LIMIT} more`);
    }
    output.push("", "</details>", "");
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
  output.push(
    "_Informational job: failures are reported here and in the artifact, and do not block required checks._",
  );
  return output;
};

const parseArgs = argv => {
  const jsonIndex = argv.indexOf("--json");
  return {
    strict: argv.includes("--strict"),
    githubSummary: argv.includes("--github-summary"),
    jsonPath:
      jsonIndex >= 0 && jsonIndex + 1 < argv.length ? argv[jsonIndex + 1] : undefined,
  };
};

/**
 * Run the gate. Returns the process exit code instead of exiting so tests can
 * call it with a fixture root; the CLI wrapper below sets `process.exitCode`.
 */
const main = (argv, env = process.env, root = ROOT) => {
  const args = parseArgs(argv);
  const report = buildReport(root);
  console.log(renderText(report).join("\n"));

  if (args.jsonPath) {
    const out = path.resolve(root, args.jsonPath);
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nwrote ${args.jsonPath}`);
  }
  if (args.githubSummary && env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${renderSummary(report).join("\n")}\n`);
  }

  const failed = report.parseErrors.length > 0 || report.dangling.length > 0;
  if (args.strict && failed) {
    console.error(
      "\nbrowser-probe: strict mode — parse errors or dangling references present",
    );
    return 1;
  }
  if (!args.strict) {
    console.log("\nbrowser-probe: informational (use --strict to fail on errors)");
  }
  return 0;
};

// CLI entry: only when executed directly (`node script/check/browser-probe.mjs`),
// never when a test imports the helpers.
const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  process.exitCode = main(process.argv.slice(2));
}

export {
  buildReport,
  collectReferences,
  isSupportName,
  main,
  parseArgs,
  parseProbe,
  renderSummary,
  renderText,
};
