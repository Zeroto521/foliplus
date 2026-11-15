#!/usr/bin/env node
/**
 * Guard: every popup coordinate write lives in a shared placement adapter.
 *
 * `ui/placement.ts` is the one geometry kernel and `ui/placementAdapter.ts`
 * the one DOM writer: every surface places through the adapter (measure ->
 * kernel -> write, or apply an already-computed placement). No surface file
 * writes top/left/bottom itself; the listbox's in-flow `right` reset is one
 * line exemption, alongside the non-popup sites and the slider's rail layout.
 *
 * This scan flags, in any other file under `foliplus/js`:
 *
 *   1. a popup coordinate write (`.style.top|left|bottom|right =`, the
 *      bracket form, or `.style.setProperty("top" | "left" | "bottom" |
 *      "right", ...)`);
 *   2. a flip marker write (`dataset.side =` / `setAttribute("data-side", ...)`);
 *   3. a viewport metric (`innerWidth` / `innerHeight`) — the raw input of
 *      hand-written flip / clamp math.
 *
 * The adapter files above are exempt as a whole, but they must actually use
 * the kernel: every one except ui/placement.ts has to reference
 * computePlacement in code, so an "adapter" cannot quietly become a second
 * hand-written implementation. (A comment mentioning it does not count.)
 *
 * A line that is not popup placement (a canvas translation, an offscreen
 * measurer, a crop / hint / measure overlay) is exempt when the line, or the
 * line right above it, carries `// placement-adapter: <reason>`. The reason is
 * required: an exemption without one is itself a violation.
 *
 * Known limits, by design: this is a lexical guard. Aliasing the style object
 * (`const s = el.style; s.top = ...`), `Object.assign(el.style, ...)`, WAAPI
 * keyframes and transform-based positioning are not matched; a new surface
 * that uses them must still go through the kernel by review.
 *
 * Split of duties (do not duplicate the other guards):
 *
 *   - `class-owner` / `duplicate-class-def` / `core-class-literal`: class
 *     tokens and their owners;
 *   - `popup-placement` (this file): coordinate writes, the flip marker and
 *     the viewport metrics used for placement.
 *
 * Usage: `node script/check/popup-placement.mjs [--check] [--root <dir>]`.
 * Without `--check` it prints an inventory and always exits 0; with `--check`
 * it exits 1 on any violation.
 */
import fs from "node:fs";
import path from "node:path";

/** Production source root, relative to the repo root. */
const JS_ROOT_REL = path.join("foliplus", "js");

/** Files allowed to write a floating surface's coordinates: the kernel itself
 *  and the shared DOM adapter. Adding a surface means routing it through the
 *  adapter — never a second flip implementation. */
const ADAPTER_FILES = new Set([
  "foliplus/js/ui/placement.ts",
  "foliplus/js/ui/placementAdapter.ts",
]);

/** The line-level exemption marker. The reason after the colon is mandatory. */
const EXEMPT_RE = /\/\/\s*placement-adapter\b(?::\s*(.*))?/;

/** What counts as placement writing. Order is priority: a coordinate write is
 *  reported as such even when the same line also reads a viewport metric. */
const RULES = [
  {
    id: "coordinate",
    re: /\.style\.(?:top|left|bottom|right)\s*=|\.style\[\s*["'](?:top|left|bottom|right)["']\s*\]\s*=|\.style\.setProperty\(\s*["'](?:top|left|bottom|right)["']/,
    hint: "writes a popup coordinate",
  },
  {
    id: "flip-marker",
    re: /(?:\.dataset(?:\.side|\[\s*["']side["']\s*\])\s*=|setAttribute\(\s*["']data-side["']\s*,)/,
    hint: "writes the flip marker",
  },
  {
    id: "viewport-metric",
    re: /\b(?:innerWidth|innerHeight)\b/,
    hint: "reads a viewport metric for placement",
  },
];

/** Blank out block comments but keep newlines, so line numbers stay stable. */
const blankBlockComments = source =>
  source.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, " "));

/** Strip a trailing `//` comment. The `[^:]` guard keeps `https://` intact. */
const stripLineComment = line => line.replace(/(^|[^:])\/\/.*$/, "$1");

const walkTs = (dir, acc = []) => {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, acc);
    else if (entry.name.endsWith(".ts")) acc.push(full);
  }
  return acc;
};

/** The exemption attached to a hit: same line first, then the line above. */
const exemptionAt = (rawLines, index) => {
  for (const at of [index, index - 1]) {
    const line = rawLines[at];
    if (line === undefined) continue;
    const match = EXEMPT_RE.exec(line);
    if (match) return { reason: (match[1] ?? "").trim() };
  }
  return null;
};

/** Scan one source file. Comments are stripped before matching, so prose that
 *  mentions a write does not count; the raw line is kept for the exemption. */
const scanSource = (rel, source) => {
  const rawLines = source.split(/\r?\n/);
  const codeLines = blankBlockComments(source).split(/\r?\n/);
  const findings = [];
  const exemptions = [];

  for (let index = 0; index < codeLines.length; index++) {
    const code = stripLineComment(codeLines[index]);
    const rule = RULES.find(candidate => candidate.re.test(code));
    if (!rule) continue;

    const exempt = exemptionAt(rawLines, index);
    if (exempt) {
      if (exempt.reason) {
        exemptions.push({
          file: rel,
          line: index + 1,
          rule: rule.id,
          reason: exempt.reason,
        });
      } else {
        findings.push({
          file: rel,
          line: index + 1,
          rule: "exemption-without-reason",
          text: rawLines[index].trim(),
        });
      }
      continue;
    }
    findings.push({
      file: rel,
      line: index + 1,
      rule: rule.id,
      text: rawLines[index].trim(),
    });
  }
  return { findings, exemptions };
};

/** Scan every production TS file under *root*. Adapter files are skipped. */
/** Files in ADAPTER_FILES that define the kernel rather than consume it. */
const KERNEL_FILES = new Set(["foliplus/js/ui/placement.ts"]);

/** An adapter that does not reference computePlacement is a second hand-written
 *  implementation wearing an allow-listed name. Comments are stripped first so
 *  a prose mention cannot satisfy the check. */
const scanAdapters = root => {
  const findings = [];
  for (const rel of ADAPTER_FILES) {
    if (KERNEL_FILES.has(rel)) continue;
    const absolute = path.join(root, ...rel.split("/"));
    if (!fs.existsSync(absolute)) continue;
    const source = blankBlockComments(fs.readFileSync(absolute, "utf8"));
    const code = source.split(/\r?\n/).map(stripLineComment).join("\n");
    if (!/\bcomputePlacement\b/.test(code)) {
      findings.push({
        file: rel,
        line: 1,
        rule: "adapter-without-kernel",
        text: "adapter does not reference computePlacement",
      });
    }
  }
  return findings;
};

const scan = (root = process.cwd()) => {
  const files = walkTs(path.join(root, JS_ROOT_REL));
  const findings = [];
  const exemptions = [];
  for (const absolute of files) {
    const rel = path.relative(root, absolute).split(path.sep).join("/");
    if (ADAPTER_FILES.has(rel)) continue;
    const result = scanSource(rel, fs.readFileSync(absolute, "utf8"));
    findings.push(...result.findings);
    exemptions.push(...result.exemptions);
  }
  findings.push(...scanAdapters(root));
  return { files: files.length, findings, exemptions };
};

const main = (argv = [], root = process.cwd()) => {
  const check = argv.includes("--check");
  const rootIdx = argv.indexOf("--root");
  if (rootIdx !== -1) root = path.resolve(argv[rootIdx + 1] ?? root);

  const { files, findings, exemptions } = scan(root);
  console.log(
    `popup-placement: ${files} file(s) scanned, ${ADAPTER_FILES.size} adapter(s) allowed, ` +
      `${exemptions.length} line exemption(s), ${findings.length} violation(s)`,
  );
  if (findings.length === 0) return 0;

  console.error("Popup placement outside an adapter:");
  for (const hit of findings) {
    console.error(`  ${hit.file}:${hit.line}  ${hit.rule}  ${hit.text}`);
  }
  console.error(
    "Route the coordinate write through ui/placementAdapter.ts (placeSurface / " +
      "applyPlacement), or annotate the line with `// placement-adapter: <reason>` " +
      "when it is not popup placement.",
  );
  return check ? 1 : 0;
};

/* v8 ignore next 3 -- CLI entry point; exercised by the shell, not by vitest.
 * main() is exported and covered by popup-placement.test.ts; only the "am I the
 * entry module and should I process.exit" branch is untestable from a runner. */
if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href
) {
  process.exit(main(process.argv.slice(2)));
}

export {
  ADAPTER_FILES,
  KERNEL_FILES,
  main,
  scan,
  scanAdapters,
  scanSource,
  stripLineComment,
  walkTs,
};
