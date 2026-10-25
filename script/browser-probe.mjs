#!/usr/bin/env node
// script/browser-probe.mjs — T59: inventory + syntax gate for test/js/browser.
//
// The probe corpus is not a test suite: every file is a JavaScript snippet that
// a Python Playwright test injects with page.evaluate(_js("<dir>/<name>")).
// Playwright accepts either a function expression or a statement body, so this
// runner mirrors that two-step parse and reports three things:
//
//   * every probe parses (V8 `new Function`, no evaluator needed),
//   * which probes no Python test references (orphans),
//   * which _js() references have no probe file (dangling).
//
// Exit status is 0 by default (the CI job is informational); --strict makes
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

/** Default checkout root: the parent of script/. Tests pass their own root. */
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIST_LIMIT = 20;

/** Every regular file below dir, recursively (absolute paths). */
const walk = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

const relPosix = (abs, base) => path.relative(base, abs).split(path.sep).join("/");

/** Parse one probe the way Playwright's page.evaluate(string) does.
 *
 *  Playwright first compiles the source as an expression, then falls back to
 *  compiling it as a function body; only a source that fails BOTH is
 *  unrunnable. Returns the failure message, or null when it parses.
 */
const parseProbe = source => {
  try {
    new Function("return (" + source + ")");
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

// ── Static _js() reference scan ─────────────────────────────────────────
// Only literal calls on one line are mapped. Lines that are comments or
// docstrings are skipped (conftest documents the helper with a literal example
// in its docstring); the helper definition itself is not a call. Calls whose
// argument is not a string literal are reported as indirect — they cannot be
// resolved without importing Python, so they never count as dangling.
const LITERAL_RE = /_js\(\s*(["\'])([^"\']+)\1/g;
const CALL_RE = /(?<![\w$])_js\(/g;
const DEF_RE = /^\s*def\s+_js\b/;

const collectReferences = root => {
  const pythonRoot = path.join(root, "test", "python");
  const references = new Map(); // probe name -> [file:line, ...]
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
        references.get(name).push(rel + ":" + (index + 1));
      }
      if (matched < callCount) indirect.push(rel + ":" + (index + 1));
    }
  }
  return { references, indirect };
};

/** Build the full inventory report for one checkout root. Pure: no printing. */
const buildReport = root => {
  const probeRoot = path.join(root, "test", "js", "browser");
  const probeFiles = walk(probeRoot)
    .filter(file => file.endsWith(".js"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const probes = probeFiles.map(file => ({
    name: relPosix(file, probeRoot).replace(/\.js$/, ""),
    file: relPosix(file, root),
  }));

  const parseErrors = [];
  for (const probe of probes) {
    const source = fs.readFileSync(path.join(root, probe.file), "utf8");
    const error = parseProbe(source);
    if (error) parseErrors.push({ probe: probe.name, error });
  }

  const { references, indirect } = collectReferences(root);
  const known = new Set(probes.map(probe => probe.name));
  const orphans = probes.filter(probe => !references.has(probe.name));
  const dangling = [...references.keys()]
    .filter(name => !known.has(name))
    .sort()
    .map(name => ({ reference: name, files: references.get(name) }));

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
      references: references.size,
      orphanProbes: orphans.length,
      danglingReferences: dangling.length,
      indirectCalls: indirect.length,
    },
    probes,
    parseErrors,
    orphans,
    dangling,
    indirect,
    byDir,
  };
};

/** The human-readable report body, one line per array entry. */
const renderText = report => {
  const { totals, byDir, parseErrors, orphans, dangling, indirect } = report;
  const lines = [
    "browser probes: " + totals.probes + " files under test/js/browser",
    "  parsed:              " + totals.parsed + "/" + totals.probes,
    "  referenced:          " + (totals.probes - orphans.length),
    "  orphan probes:       " + totals.orphanProbes,
    "  dangling references: " + totals.danglingReferences,
    "  indirect _js() calls: " + totals.indirectCalls,
    "  by directory:",
  ];
  for (const dir of Object.keys(byDir).sort()) {
    lines.push("    " + dir.padEnd(18) + " " + byDir[dir]);
  }
  const section = (title, items) => {
    if (!items.length) return;
    lines.push("", title + ":");
    for (const item of items.slice(0, LIST_LIMIT)) lines.push("  - " + item);
    if (items.length > LIST_LIMIT) {
      lines.push("  ... and " + (items.length - LIST_LIMIT) + " more");
    }
  };
  section(
    "parse errors",
    parseErrors.map(entry => entry.probe + ": " + entry.error),
  );
  section(
    "orphan probes (no _js() reference)",
    orphans.map(probe => probe.name),
  );
  section(
    "dangling references (no probe file)",
    dangling.map(entry => entry.reference + "  <- " + entry.files.join(", ")),
  );
  section("indirect _js() calls (not statically mappable)", indirect);
  return lines;
};

/** Job-summary markdown (GitHub Actions fallback UI for the artifact). */
const renderSummary = report => {
  const { totals, parseErrors, orphans, dangling } = report;
  const lines = [
    "## Browser probes (informational)",
    "",
    "| metric | value |",
    "| --- | ---: |",
    "| probes | " + totals.probes + " |",
    "| parsed | " + totals.parsed + " |",
    "| parse errors | " + totals.parseErrors + " |",
    "| orphan probes | " + totals.orphanProbes + " |",
    "| dangling references | " + totals.danglingReferences + " |",
    "| indirect _js() calls | " + totals.indirectCalls + " |",
    "",
  ];
  const section = (title, items) => {
    if (!items.length) return;
    lines.push("<details><summary>" + title + " (" + items.length + ")</summary>", "");
    for (const item of items.slice(0, LIST_LIMIT)) lines.push("- " + item);
    if (items.length > LIST_LIMIT) {
      lines.push("- ... and " + (items.length - LIST_LIMIT) + " more");
    }
    lines.push("", "</details>", "");
  };
  section(
    "parse errors",
    parseErrors.map(entry => entry.probe + ": " + entry.error),
  );
  section(
    "orphan probes",
    orphans.map(probe => probe.name),
  );
  section(
    "dangling references",
    dangling.map(entry => entry.reference + " <- " + entry.files.join(", ")),
  );
  lines.push(
    "_Informational job: failures are reported here and in the artifact, and do not block required checks._",
  );
  return lines;
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

/** Run the gate. Returns the process exit code instead of exiting so tests can
 *  call it with a fixture root; the CLI wrapper at the bottom sets exitCode. */
const main = (argv, env = process.env, root = DEFAULT_ROOT) => {
  const args = parseArgs(argv);
  const report = buildReport(root);
  console.log(renderText(report).join("\n"));

  if (args.jsonPath) {
    const out = path.resolve(root, args.jsonPath);
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    console.log("\nwrote " + args.jsonPath);
  }
  if (args.githubSummary && env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, renderSummary(report).join("\n") + "\n");
  }

  const failed = report.parseErrors.length > 0 || report.dangling.length > 0;
  if (args.strict && failed) {
    console.error(
      "\nbrowser-probes: strict mode — parse errors or dangling references present",
    );
    return 1;
  }
  if (!args.strict) {
    console.log("\nbrowser-probes: informational (use --strict to fail on errors)");
  }
  return 0;
};

// CLI entry: only when executed directly (node script/browser-probe.mjs),
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
  DEFAULT_ROOT,
  main,
  parseArgs,
  parseProbe,
  renderSummary,
  renderText,
};
