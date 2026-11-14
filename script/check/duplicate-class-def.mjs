#!/usr/bin/env node
/**
 * Guard: one owner per CSS class name.
 *
 * A `foliplus-*` class name is a contract shared between the TypeScript and
 * the CSS. When the same name is spelled out as a const value in two places --
 * say `ui/panelClassName.ts` and `control/ExportControl/const.ts` -- the two
 * spellings can drift independently and nothing notices: both still compile,
 * both still render, and the CSS only ever sees one of them. The panel
 * vocabulary already drifted once (SearchControl close button, recorded in
 * `ui/panelClassName.ts` own header) and an audit found five more.
 *
 * This guard enumerates every owner site of a `foliplus-*` class name in
 * production TypeScript and reports any name owned more than once.
 *
 * An owner site is a value in a class const map (`HIDDEN: "foliplus-hidden"`
 * inside `const CLASSES = { ... }`, key ALL_CAPS or camelCase --
 * `DEFAULT_CLASSES.active`) or a file-level named const
 * (`const HIDDEN_CLASS = "foliplus-hidden"`).
 *
 * Not an owner site:
 *   - composite values ("foliplus-dot foliplus-dot-solid") -- a spelling that
 *     combines several classes, not an owner of any one of them;
 *   - selector strings (".foliplus-layer-item") -- a reader of a class;
 *   - a bare literal in markup or a `classList.add("...")` call. Those are the
 *     hand-written spellings that later batches remove, not owners.
 *
 * Matching is word-bounded and comment-stripped, so `--foliplus-ctrl-inset-x`
 * (a CSS variable), `foliplus-export-mode` (a longer name sharing a prefix)
 * and `data-foliplus-export` (an attribute) never trip it.
 *
 * Usage: `node script/check/duplicate-class-def.mjs [--check] [--root <dir>]`
 *   Without `--check` the script prints an inventory and always exits 0. With
 *   `--check` it exits 1 when any duplicate sits outside `BASELINE_PENDING`.
 *
 * `BASELINE_PENDING` was the audit's remaining work -- duplicate names whose
 * resolution needs an ownership decision (a new panel shell state vocabulary,
 * or sinking a name from a component into `ui/`) rather than a mechanical
 * delete. Each entry recorded the owning batch and why D0 deferred it, so the list
 * read as a work queue: an entry was dropped the moment its batch landed. A name
 * absent from the list, or a *new* site for a listed name, fails `--check`.
 * The list is now empty; `EXEMPTIONS` below is the only allowed repeat.
 */
import fs from "node:fs";
import path from "node:path";

/** Production source root, relative to the repo root. Tests are out of scope:
 *  a test may spell a class name to assert on the DOM it builds. */
const JS_ROOT_REL = path.join("foliplus", "js");

/**
 * Exempted duplicates -- class names intentionally owned more than once.
 *
 * Each exemption records why the repeated spelling is correct, so removing a
 * name from this list means the reason changed, not that the guard relaxed.
 * The one exemption is `measure-label`: `LABEL.CLASS` and `PANES.LABEL`
 * in MeasureControl/const.ts spell the same string but are different API
 * surfaces -- the pane name is a Leaflet createPane() argument, the class is a
 * style hook. They are never merged on the strength of a shared string.
 */
const EXEMPTIONS = [
  {
    token: "foliplus-measure-label",
    sites: ["foliplus/js/control/MeasureControl/const.ts"],
    reason:
      "LABEL.CLASS and PANES.LABEL are different API surfaces: the pane name" +
      " is a Leaflet createPane() argument, the class is a style hook.",
  },
];

/** The audit's remaining work. Every deferred duplicate has landed its batch,
 *  so the list is empty. A name on this list would be a *known* duplicate
 *  awaiting its batch; a name absent from it fails `--check`. Do not add an
 *  entry here to silence a duplicate; fix the duplicate.
 *
 *  The only allowed repeat is `EXEMPTIONS` below, and that needs a written
 *  reason for two spellings of one name to be correct.
 * @type {{token: string, batch: string, sites: string[], reason: string}[]}
 */
const BASELINE_PENDING = [];

/** A single `foliplus-*` class name. */
const TOKEN_RE = /^foliplus-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Strip comments without eating newlines, so a doc comment naming a class
 *  does not count as an owner and a reported line number still points at the
 *  value. */
const codeOnly = src =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
    .replace(/\/\/[^\r\n]*/g, m => m.replace(/[^\r\n]/g, " "));

/** Parse every class name owner site out of one source file.
 *  @returns [{token, key, owner, line}] with `line` 1-based. */
const parseClassDefs = source => {
  const lines = codeOnly(source).split(/\r?\n/);
  const sites = [];
  let mapOwner = null;
  let depth = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const opens = line.match(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*\{\s*$/);
    if (opens) {
      mapOwner = opens[1];
      depth = 1;
      continue;
    }
    if (mapOwner !== null) {
      for (const ch of line) {
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
      }
      if (depth <= 0) {
        mapOwner = null;
        depth = 0;
        continue;
      }
      const entry = line.match(/^\s{2,}([A-Za-z_$][\w$]*)\s*:\s*"([^"]+)"\s*,?\s*$/);
      if (entry && TOKEN_RE.test(entry[2])) {
        sites.push({ token: entry[2], key: entry[1], owner: mapOwner, line: i + 1 });
      }
      continue;
    }
    const named = line.match(
      /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*"([^"]+)"\s*;\s*$/,
    );
    if (named && TOKEN_RE.test(named[2])) {
      sites.push({ token: named[2], key: named[1], owner: named[1], line: i + 1 });
    }
  }
  return sites;
};

/** Group owner sites by class name and keep the groups with more than one
 *  site. @returns [{token, sites}] sorted by token, for stable output. */
const findDuplicateClassDefs = sites => {
  const byToken = new Map();
  for (const site of sites) {
    if (!byToken.has(site.token)) byToken.set(site.token, []);
    byToken.get(site.token).push(site);
  }
  return [...byToken.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([token, group]) => ({ token, sites: group }))
    .sort((a, b) => a.token.localeCompare(b.token));
};

/** True when `dup` is a known, deferred duplicate whose owner files match the
 *  recorded set exactly -- a sixth site for a listed name is a new duplicate. */
const isPending = (dup, pending) => {
  const entry = pending.find(p => p.token === dup.token);
  if (!entry) return false;
  const actual = new Set(dup.sites.map(s => s.rel));
  return actual.size === entry.sites.length && entry.sites.every(f => actual.has(f));
};

/** True when `dup` is an intentionally repeated spelling on the exemption
 *  list with the recorded owner files. An exemption is a documented decision,
 *  not a place to hide a duplicate. */
const isExempt = (dup, exempts = EXEMPTIONS) => {
  const entry = exempts.find(e => e.token === dup.token);
  if (!entry) return false;
  const actual = new Set(dup.sites.map(s => s.rel));
  return actual.size === entry.sites.length && entry.sites.every(f => actual.has(f));
};

/** Walk the production .ts files under a directory. */
const walk = (dir, out) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
};

/** Scan the production tree and report every duplicate. Returns the process
 *  exit code: 1 only when a duplicate lies outside the pending list. */
const main = (argv = [], root = process.cwd()) => {
  const args = argv.slice();
  const check = args.includes("--check");
  const rootIdx = args.indexOf("--root");
  if (rootIdx !== -1) root = path.resolve(args[rootIdx + 1] ?? root);
  const sites = [];
  for (const file of walk(path.join(root, JS_ROOT_REL), [])) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    for (const site of parseClassDefs(fs.readFileSync(file, "utf8"))) {
      sites.push({ ...site, rel });
    }
  }
  const dupes = findDuplicateClassDefs(sites);
  // `--check` is the gate: the pending list applies only there. Without it the
  // script is an inventory and reports what it finds without failing.
  const pendingList = check ? BASELINE_PENDING : [];
  const blocking = check
    ? dupes.filter(d => !isPending(d, pendingList) && !isExempt(d))
    : [];

  console.log(
    `duplicate-class-def: ${sites.length} owner sites scanned, ${dupes.length} ` +
      `class name(s) owned more than once, ${blocking.length} blocking`,
  );
  for (const dup of dupes) {
    const deferred = pendingList.find(p => p.token === dup.token);
    const tag = deferred ? ` [PENDING: ${deferred.batch}]` : " [BLOCKING]";
    console.log(`  ${dup.token} -- ${dup.sites.length} owners${tag}`);
    for (const s of dup.sites) {
      console.log(`    ${s.rel}:${s.line}  ${s.owner}.${s.key}`);
    }
  }
  if (blocking.length > 0) {
    console.log(
      `\nGive each blocking class name one owner and drop its BASELINE_PENDING ` +
        `entry if one exists. Do not extend BASELINE_PENDING to silence a duplicate.`,
    );
    return 1;
  }
  console.log(
    dupes.length === 0
      ? "\nEvery class name has exactly one owner."
      : check
        ? `\n${dupes.length} duplicate(s) deferred to their own batch.`
        : `\nNo gate applied: run with --check to fail on the duplicates above.`,
  );
  return 0;
};

/** Wire `main` to `process.exitCode` only when this file is the entry module,
 *  so importing it from a test cannot exit the collector process. */
const runCli = entry => {
  const isEntry =
    entry !== undefined && path.resolve(entry) === path.resolve(process.argv[1] ?? "");
  if (!isEntry) return;
  process.exitCode = main(process.argv.slice(2));
};

export {
  BASELINE_PENDING,
  EXEMPTIONS,
  TOKEN_RE,
  codeOnly,
  findDuplicateClassDefs,
  isExempt,
  isPending,
  main,
  parseClassDefs,
  runCli,
};

runCli(process.argv[1]);
