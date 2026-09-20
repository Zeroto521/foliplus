// script/shared-import-scan.mjs — the one import scanner for shared modules.
//
// Two consumers read the same thing and used to each keep a private copy of
// this code:
//   - script/scan-registry.mjs → `_shared-registry.ts`, which decides what the
//     runtime bundle publishes on `window.foliplus`.
//   - script/global-namespace-plugin.mjs → esbuild shims, which decide what a
//     component bundle reads back from that namespace.
//
// Publishing and reading are two halves of one contract. If they disagree, a
// component gets a shim that resolves to `undefined` at runtime while the
// build still prints a tick — so the scanner must not have two spellings.
//
// This module owns the walk, the import regex, the name parsing, and the
// star-alias property pass. It returns RAW specifiers (`"#core/geo/index.js"`)
// because the plugin keys shims by the exact path esbuild passes to `onLoad`.
// Each consumer adapts the keys to its own needs:
//   - the registry canonicalizes with `canonicalSpec()`;
//   - the plugin uses them verbatim.
//
// The regex is deliberately the superset of both predecessors, so no source
// form the old code accepted is lost. Where they disagreed, the engine takes
// whichever side still produced a working bundle:
//   - both `'` and `"` — the registry only matched `"`, so a single-quoted
//     import was shimmed by the component but never published, and resolved to
//     `undefined` at runtime;
//   - `\s*` around the braces and `from` — the plugin only matched `\s+`, so
//     `import{x}from"#core/a.js"` missed the spec entirely and fell back to
//     shimming every export of the module instead of the one name imported;
//   - `as` split on `\s+`, not the literal `" as "` — a tab in
//     `import { a as\tb }` leaked the whole `a as\tb` into the shim name.
// The star pass is likewise the superset: `\b`-anchored alias + any
// identifier, which subsumes the registry's uppercase-only match plus its
// `Storage.load|save` special case.
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

/** `#core/geo/index.js` → `core/geo`, `#common/dom.js` → `common/dom`.
 *  Keys `_shared-registry.ts` is generated against. */
const canonicalSpec = spec =>
  spec
    .replace(/^#/, "")
    .replace(/\.js$/, "")
    .replace(/\/index$/, "");

/** Parse a named-import list: `foo, bar, baz as b, type A` → `["foo","bar","baz"]`.
 *  Keeps the module-side name (the `as` alias is the local binding). */
const parseImportNames = list =>
  list
    .split(",")
    .map(part => {
      const trimmed = part.trim();
      return trimmed.replace(/\s+as\s+.*/g, "").trim();
    })
    .filter(n => n && !n.startsWith("type"));

// `import { A, B } from "#core/x.js"`  |  `import * as X from "#common/y.js"`
const SHARED_IMPORT_RE =
  /import\s*(?:\{([^}]+)\}|\*\s*as\s*(\w+))\s*from\s*["']#((?:core|common|foliplus)\/[^"']+)["']/g;

/** Recursively collect `.ts`/`.js` sources under a directory, dropping `.d.ts`
 *  and skipping dot-dirs. Unreadable dirs are skipped, not thrown on. */
const collectSources = (dir, out = []) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.name.endsWith(".d.ts")) continue;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".")) collectSources(full, out);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
      out.push(readFileSync(full, "utf-8"));
    }
  }
  return out;
};

/** Scan a directory for shared-module imports.
 *  Returns `{ named, starUsed }`, both `Map<rawSpec, Set<name>>`:
 *    named    — `import { A } from "#…"` and `import type` members
 *    starUsed — `import * as X from "#…"` props seen as `X.prop`
 *  `starUsed` only gets an entry when at least one prop was found, so an
 *  unused star alias stays invisible here and lets the plugin fall back to
 *  the full export set. */
const scanSharedImports = dir => {
  const sources = collectSources(dir);
  const named = new Map();
  const aliases = new Map(); // rawSpec -> Set<local alias>
  SHARED_IMPORT_RE.lastIndex = 0;
  for (const src of sources) {
    let m;
    while ((m = SHARED_IMPORT_RE.exec(src))) {
      const spec = "#" + m[3];
      if (m[2]) {
        const set = aliases.get(spec) || new Set();
        set.add(m[2]);
        aliases.set(spec, set);
      } else {
        const set = named.get(spec) || new Set();
        for (const n of parseImportNames(m[1] || "")) set.add(n);
        named.set(spec, set);
      }
    }
  }
  const starUsed = new Map();
  for (const [spec, aliasSet] of aliases) {
    const names = new Set();
    for (const alias of aliasSet) {
      const propRe = new RegExp(
        "\\b" + alias.replace(/[$]/g, "\\$") + "\\.([A-Za-z_$][\\w$]*)",
        "g",
      );
      for (const src of sources) {
        let pm;
        while ((pm = propRe.exec(src))) names.add(pm[1]);
      }
    }
    if (names.size) starUsed.set(spec, names);
  }
  return { named, starUsed };
};

export {
  SHARED_IMPORT_RE,
  canonicalSpec,
  collectSources,
  parseImportNames,
  scanSharedImports,
};
