#!/usr/bin/env node
/**
 * Guard: no scheme-picker class literal in core production code.
 *
 * The scheme-picker vocabulary lives in ui/schemePickerClassName.js (one owner
 * for every name the shared picker and the shared row builder spell). core
 * cannot import a component const, so the names belong to ui/, and core
 * callers (today: core/value/rampForm.ts) read the list through #ui/index.js.
 *
 * A bare `foliplus-scheme-picker-*` literal reappearing in core is the drift
 * this guard fails on. Left-side negative lookbehind plus right-side word-
 * bound means only an independent class-name token matches; a
 * `data-foliplus-scheme-picker-x` attribute or a `--foliplus-scheme-picker-y`
 * CSS variable never trips it — the name char to their left trips the
 * lookbehind.
 *
 * Usage: `node script/check/core-class-literal.mjs [--check] [--root <dir>]`
 *   Without `--check` the script prints its inventory and always exits 0.
 *   With `--check` it exits 1 when any literal is found.
 */
import fs from "node:fs";
import path from "node:path";

/** Production source root, relative to the repo root. Tests are out of scope:
 *  the parity contract is enforced by the source itself reading the vocabulary,
 *  not by a test-side literal. */
const JS_ROOT_REL = path.join("foliplus", "js", "core");

/** Class prefixes this guard watches. Word-bounded on the right. */
const PREFIXES = ["foliplus-scheme-picker-"];

/** Left-side negative lookbehind + right-side word-bound: the match must be
 *  an independent class-name token. A `data-foliplus-scheme-picker-x`
 *  attribute or a `--foliplus-scheme-picker-x` CSS variable does not count —
 *  the name char immediately to its left (`-`) trips the lookbehind. */
const PREFIX = "(?<![A-Za-z0-9_-])";

/** Right-boundary: one or more name chars (the class tail), then not another.
 *  Word-bounded on the right so a longer class sharing the prefix never
 *  absorbs the match. */
const SUFFIX = "[a-z0-9]+(?:-[a-z0-9]+)*(?![a-zA-Z0-9_-])";

const walk = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
};

const stripComments = src =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const scan = root => {
  const hits = [];
  for (const file of walk(path.join(root, JS_ROOT_REL))) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    for (const prefix of PREFIXES) {
      const re = new RegExp(PREFIX + prefix + SUFFIX, "g");
      let m;
      while ((m = re.exec(src)) !== null) {
        const line = src.slice(0, m.index).split("\n").length;
        hits.push({
          file: path.relative(root, file).split(path.sep).join("/"),
          line,
          token: m[0],
        });
      }
    }
  }
  return hits;
};

const main = (argv = [], root = process.cwd()) => {
  const check = argv.includes("--check");
  const rootIdx = argv.indexOf("--root");
  // When --root is passed, resolve its value; otherwise keep the default
  // (process.cwd()) the caller supplied. Split onto two statements so
  // v8 attributes each arm of the fallback independently.
  if (rootIdx !== -1) {
    const override = argv[rootIdx + 1];
    if (override !== undefined) root = path.resolve(override);
  }
  const hits = scan(root);
  if (hits.length === 0) {
    console.log(`core-class-literal: scheme-picker vocabulary clean in ${JS_ROOT_REL}`);
    return 0;
  }
  console.error(
    `core-class-literal: ${hits.length} bare literal(s) in ${JS_ROOT_REL}:`,
  );
  for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.token}`);
  console.error("Read these from ui/schemePickerClassName.js via #ui/index.js.");
  return check ? 1 : 0;
};

/* v8 ignore next 3 -- CLI entry point; exercised by the shell, not by
 *  vitest. main() is exported and fully covered by
 *  core-class-literal.test.ts; only the "am I the entry module and should I
 *  process.exit" branch is untestable from a test runner. */
if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href
) {
  process.exit(main(process.argv.slice(2)));
}

export { main, scan, walk };
