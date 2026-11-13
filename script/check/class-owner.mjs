#!/usr/bin/env node
/**
 * Guard: every `foliplus-*` class token has one owner, and consumers read it
 * from the owner module rather than spelling the literal.
 *
 * Two shapes of drift this catches that `duplicate-class-def` (which only
 * scans owner declarations) and `core-class-literal` (which only scans core)
 * do not:
 *
 *   1. A second owner module declares the same token.
 *   2. A non-owner module in ui / control / platform spells the token as a
 *      bare literal instead of importing it from the owner. core is guarded
 *      by core-class-literal and skipped here; pass --include-core to fold
 *      it in when auditing.
 *
 * Owner files are the shared vocabulary modules
 * (`foliplus/js/ui/*ClassName.ts`, one exported `*_CLASS` object each) and
 * the per-component `const.ts` files (one `CLASSES` object each).
 *
 * Composite values inside an owner file ("a foliplus-x foliplus-y") are
 * legitimate owner declarations of both tokens. Composite literals elsewhere
 * still trip the consumer scan if a token in them is not imported from its
 * owner.
 *
 * Tokens outside the `foliplus-` namespace (`is-dragging`, `leaflet-*`, ...)
 * are not part of this owner system and are skipped.
 *
 * Usage: `node script/check/class-owner.mjs [--check] [--root <dir>]
 *   [--include-core]`. Without --check the script prints an inventory and
 * always exits 0. With --check it exits 1 on any duplicate owner or any
 * non-owner bare literal.
 */
import fs from "node:fs";
import path from "node:path";

/** Production source root, relative to the repo root. */
const JS_ROOT_REL = path.join("foliplus", "js");

/** Directories excluded from the consumer scan. Tests, browser probes, CSS,
 *  docs, locale files and internal notes are readers of the class names (or
 *  not code at all), not consumers via the TS import graph. */
const EXCLUDED_DIR_PARTS = [
  path.join("foliplus", "locale"),
  "test",
  "doc",
  "script",
  ".foliplus",
];

/** File suffixes the consumer scan reads. CSS is a definition side; locale
 *  is data; markdown is documentation. */
const SCAN_SUFFIXES = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

/** A token must start with the foliplus namespace to be in the owner system.
 *  `is-dragging`, `leaflet-control`, ... are not ours to own. */
const TOKEN_PREFIX = "foliplus-";

/** Right-boundary for a token: not followed by another name character, so a
 *  longer class sharing the prefix never absorbs the match. */
const TOKEN_SUFFIX = "(?![A-Za-z0-9_-])";

/** Left-boundary: not preceded by another name character. Keeps
 *  `data-foliplus-*` and `--foliplus-*` out of the hit list. */
const TOKEN_PREFIX_GUARD = "(?<![A-Za-z0-9_-])";

/** Strip block + line comments so a mention in prose does not count as a hit. */
const stripComments = src =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const walk = (dir, acc = []) => {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (SCAN_SUFFIXES.includes(path.extname(entry.name))) acc.push(p);
  }
  return acc;
};

/** All production TS files under JS_ROOT. */
const prodFiles = root => walk(path.join(root, JS_ROOT_REL));

/** Split a string-literal body into individual `foliplus-...` tokens. A
 *  composite value ("a foliplus-x foliplus-y") yields both tokens; a
 *  non-foliplus token ("is-dragging") yields none. */
const tokensIn = literal => {
  const re = new RegExp(
    `${TOKEN_PREFIX_GUARD + TOKEN_PREFIX}[a-z0-9]+(?:-[a-z0-9]+)*${TOKEN_SUFFIX}`,
    "g",
  );
  return literal.match(re) ?? [];
};

/** Is this file one of the owner modules? Owner modules are the shared
 *  vocabulary files (`*ClassName.ts` under ui/) and the per-component
 *  `const.ts` files. */
const isOwnerFile = rel =>
  rel.endsWith("ClassName.ts") || path.basename(rel) === "const.ts";

/** Walk an owner file, collecting { token, owner, line } for every string
 *  literal that names a foliplus-* token. The vocabulary shape is flat (one
 *  key, one string value) by convention and duplicate-class-def already
 *  enforces it, so a regex over the file body is sufficient. */
const scanOwnerFile = (absPath, rel) => {
  const text = stripComments(fs.readFileSync(absPath, "utf8"));
  const owners = [];
  const re = /:\s*"([^"\`]*)"/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const literal = match[1];
    // Selector values (".foliplus-x") are not owner declarations — they are
    // readers of the class. Only bare token values declare ownership.
    if (literal.includes("$") || literal.startsWith(".")) continue;
    // Only single-token values declare ownership. Composite values
    // ("foliplus-x foliplus-y") are the DOM builder's full class string -- a
    // consumer of every token in it, not an owner of any.
    if (literal.includes(" ")) continue;
    for (const token of tokensIn(literal)) {
      const line = text.slice(0, match.index).split("\n").length;
      // Same file, same token, same declaration object = one owner site.
      // Multiple keys in one object spelling the same token (e.g. PATH_SOLID
      // and PATH_DASHED both containing "foliplus-measure-path") are one
      // owner, not two.
      if (owners.some(o => o.token === token && o.owner === rel)) continue;
      owners.push({ token, owner: rel, line });
    }
  }
  return owners;
};

/** Build the token -> [owner entries] map across every owner file. */
const buildOwnerMap = root => {
  const entries = [];
  for (const file of prodFiles(root)) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (!isOwnerFile(rel)) continue;
    entries.push(...scanOwnerFile(file, rel));
  }
  const map = new Map();
  for (const entry of entries) {
    if (!map.has(entry.token)) map.set(entry.token, []);
    map.get(entry.token).push(entry);
  }
  return map;
};

/** Find every bare `foliplus-...` literal in a non-owner file. Any string
 *  literal counts -- the rule is "do not spell a vocabulary token outside
 *  its owner". */
const scanConsumers = (root, ownerMap, { includeCore }) => {
  const hits = [];
  for (const file of prodFiles(root)) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (!includeCore && rel.startsWith("foliplus/js/core/")) continue;
    if (isOwnerFile(rel)) continue;
    if (EXCLUDED_DIR_PARTS.some(part => rel.split("/").includes(part))) continue;
    const text = stripComments(fs.readFileSync(file, "utf8"));
    const re = /"([^"\`]*)"|'([^'\`]*)'|`([^`\\]*)`/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      const literal = match[1] ?? match[2] ?? match[3] ?? "";
      if (literal.includes("$")) continue;
      for (const token of tokensIn(literal)) {
        const owners = ownerMap.get(token);
        // Unknown token (no declared owner) is duplicate-class-def's problem,
        // not ours -- we only police tokens that have a declared owner.
        if (!owners || owners.length === 0) continue;
        const isOwnerHere = owners.some(o => o.owner === rel);
        if (isOwnerHere) continue;
        const line = text.slice(0, match.index).split("\n").length;
        hits.push({ file: rel, line, token, owners });
      }
    }
  }
  return hits;
};

const main = (argv = [], root = process.cwd()) => {
  const check = argv.includes("--check");
  const includeCore = argv.includes("--include-core");
  const rootIdx = argv.indexOf("--root");
  if (rootIdx !== -1) root = path.resolve(argv[rootIdx + 1] ?? root);

  const ownerMap = buildOwnerMap(root);
  const duplicates = [...ownerMap.entries()].filter(([, sites]) => sites.length > 1);
  const consumerHits = scanConsumers(root, ownerMap, { includeCore });

  const tier = includeCore
    ? "foliplus/js (all tiers)"
    : "foliplus/js (ui/control/platform; core is guarded by core-class-literal)";
  console.log(
    `class-owner: ${ownerMap.size} tokens, ${duplicates.length} duplicate owner(s), ${consumerHits.length} non-owner literal(s) in ${tier}`,
  );

  let failed = false;
  if (duplicates.length > 0) {
    failed = true;
    console.error("Duplicate token owners:");
    for (const [token, sites] of duplicates) {
      console.error(`  ${token}`);
      for (const site of sites) console.error(`    ${site.owner}:${site.line}`);
    }
  }
  if (consumerHits.length > 0) {
    failed = true;
    console.error("Non-owner bare literals:");
    for (const hit of consumerHits) {
      const ownerList = hit.owners.map(o => o.owner).join(", ");
      console.error(`  ${hit.file}:${hit.line}  ${hit.token}  (owner: ${ownerList})`);
    }
  }
  if (!failed) return 0;
  console.error(
    "Read vocabulary tokens from their owner module (import the *_CLASS object).",
  );
  return check ? 1 : 0;
};

/* v8 ignore next 3 -- CLI entry point; exercised by the shell, not by
 *  vitest. main() is exported and covered by class-owner.test.ts; only the
 *  "am I the entry module and should I process.exit" branch is untestable
 *  from a test runner. */
if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href
) {
  process.exit(main(process.argv.slice(2)));
}

export { buildOwnerMap, main, scanConsumers, scanOwnerFile, tokensIn, walk };
