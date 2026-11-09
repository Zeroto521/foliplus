/**
 * script/build-path.mjs — single source for path-alias resolution.
 *
 * Consumers that each used to spell `foliplus/js` (or a full alias table)
 * by hand:
 *   - script/build/esbuild-config.mjs  esbuild `alias`
 *   - vitest.config.mjs         vitest `resolve.alias` (plus `#script`)
 *   - script/build/build.mjs          `srcDir` for plugins / component discovery
 *   - script/build/scan-registry.mjs  `srcDir` for the import scan
 *   - package.json `imports`    Node resolution — asserted by test
 *
 * #518 was two hand-copied scanners disagreeing; alias tables drift the same
 * way. One mapping (`ALIAS_TO_REL`) owns the spelling; every consumer reads
 * through it, including the package.json `imports` table (the only place Node
 * resolves `#…` at runtime — asserted against by test, since Node cannot
 * import this module).
 *
 * Audit note: no esbuild `target` is set anywhere in this repo today. Do not
 * introduce one here — a target bump would change emitted JS, and the product
 * contract for this single-source work is a zero-byte diff on JS artifacts.
 */
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

/** Import specifier → repo-relative directory. One spelling for every table. */
const ALIAS_TO_REL = {
  "#platform": "foliplus/js/platform",
  "#core": "foliplus/js/core",
  "#ui": "foliplus/js/ui",
  "#control": "foliplus/js/control",
  "#foliplus": "foliplus/js",
  "#script": "script",
};

/** The shared aliases; `#script` is vitest-only. */
const SHARED_ALIASES = ["#platform", "#core", "#ui", "#control", "#foliplus"];

/** Resolve `foliplus/js` under a project `root`. */
const resolveJsRoot = root => resolve(root, ALIAS_TO_REL["#foliplus"]);

/**
 * Locate the repo root from any script under it by walking up for the nearest
 * `package.json`. Anchored — immune to the script's own depth (#593 moved
 * `script/` into subdirs and every fixed `..` chain had to change).
 * Throws when no `package.json` is found above the caller.
 * Startup-time fs probe: tests that `vi.mock("fs")` must pass the real
 * `existsSync` through, or the walk yields nothing.
 */
const repoRoot = importMetaUrl => {
  for (let dir = dirname(fileURLToPath(importMetaUrl)); ;) {
    if (existsSync(resolve(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`repoRoot: no package.json found above ${importMetaUrl}`);
    }
    dir = parent;
  }
};

/**
 * Path aliases shared by esbuild (artifact builds) and vitest (tests).
 * esbuild must NOT gain `#script` — no component imports it, and an unused
 * alias is still a second spelling of the truth.
 */
const pathAliases = root =>
  Object.fromEntries(
    SHARED_ALIASES.map(spec => [spec, resolve(root, ALIAS_TO_REL[spec])]),
  );

/**
 * Vitest alias table: the shared paths plus `#script`, which only tests use
 * (`import { … } from "#script/build/merge-css.mjs"`).
 */
const testPathAliases = root => ({
  ...pathAliases(root),
  "#script": resolve(root, ALIAS_TO_REL["#script"]),
});

/**
 * Shared-module prefixes — the `#…` namespaces where ANY import routes to
 * the shared global namespace (`window.foliplus.platform` / `window.foliplus.core` / `window.foliplus.ui`).
 *
 * Deliberately narrower than `SHARED_ALIASES`: `#foliplus` is an alias but
 * NOT a shared prefix. Only `#foliplus/BaseControl.js` is shared (see
 * `SHARED_MODULE_EXACTS`); every other `#foliplus/*` — a component's own
 * `const.js`, `icon.js`, or `config-schema.js` — resolves through esbuild's
 * alias table and bundles into the component.
 */
/**
 * The namespace-rewrite table the shared-module plugin applies: a shared
 * `#<prefix>/…` specifier becomes `<dir>/…` under `window.foliplus.<prefix>`.
 * Derived from ALIAS_TO_REL so the plugin cannot drift from the alias table —
 * the onResolve filter already matches via SHARED_SPEC_REGEX_SOURCE; these
 * rules are the onLoad rewrite that must stay in lockstep with it.
 */
// DERIVED, not hand-written. A shared prefix is an alias that is ALSO
// published on the shared runtime namespace (window.foliplus.<dir>). Two
// aliases are deliberately NOT shared prefixes:
//   - #control — each component bundles its own namespace; no non-control
//     layer may reach it, so it must never route to the shared bundle.
//   - #foliplus — resolves to foliplus/js (basename "js"), a root alias,
//     not a directory under the shared namespace.
// Renaming a tier is therefore a one-line change to ALIAS_TO_REL: the
// shared-import regex, the plugin rewrite rules and the package.json imports
// all derive from it.
const SHARED_MODULE_PREFIXES = SHARED_ALIASES.filter(
  spec => spec !== "#control" && ALIAS_TO_REL[spec].split("/").pop() !== "js",
).map(spec => ALIAS_TO_REL[spec].split("/").pop());

/**
 * namespacePrefixRules — the shared `#<prefix>/` rewrite table: prefix ->
 * `<dir>/`. Derived from ALIAS_TO_REL; the shared-module plugin reads this
 * instead of hand-rolled .replace() lines, so a tier rename cannot leave the
 * onResolve filter (SHARED_SPEC_REGEX_SOURCE) and the onLoad rewrite out of
 * sync.
 */
const namespacePrefixRules = () =>
  Object.fromEntries(
    SHARED_MODULE_PREFIXES.map(prefix => [
      prefix,
      `${ALIAS_TO_REL[`#${prefix}`].slice(ALIAS_TO_REL[`#${prefix}`].lastIndexOf("/") + 1)}/`,
    ]),
  );

/**
 * Exact `#…` specs that are shared but don't fall under a shared prefix.
 * `#foliplus/BaseControl.js` is the only entry today; the shared runtime
 * publishes it on `window.foliplus.BaseControl`. Adding new entries is a
 * two-line change here — no scanner or plugin update needed, because both
 * read through `SHARED_SPEC_REGEX_SOURCE`.
 */
const SHARED_MODULE_EXACTS = ["#foliplus/BaseControl.js"];

/**
 * Regex source for a shared-module specifier, with the `#` prefix. Not
 * anchored at either end so consumers wrap it as needed:
 *   - scanner (script/build/import-scan.mjs): capture inside `["']…["']`
 *   - plugin (script/build/global-namespace-plugin.mjs): wrap as `^…$`
 *     for the `onResolve` filter
 *
 * Matches:
 *   - `#platform/…` and `#core/…` (prefix branch consumes the path)
 *   - `#foliplus/BaseControl.js` (exact branch, no path)
 *
 * Rejects:
 *   - `#foliplus/<anything-else>` — bundled into the component, not shared
 *   - `#script/…` — vitest-only, never shared
 */
const SHARED_SPEC_REGEX_SOURCE = `#(?:${SHARED_MODULE_PREFIXES.join("|")})/[^"']+|${SHARED_MODULE_EXACTS.map(spec => spec.replace(/\./g, "\\.")).join("|")}`;

/**
 * package.json `imports` entries for the shared aliases, derived from the
 * same mapping (glob suffix added). Tests assert these stay aligned with the
 * package.json file, which remains the Node runtime source.
 */
const PACKAGE_IMPORTS = Object.fromEntries(
  Object.entries(ALIAS_TO_REL).map(([spec, rel]) => [`${spec}/*`, `./${rel}/*`]),
);

export {
  ALIAS_TO_REL,
  PACKAGE_IMPORTS,
  SHARED_ALIASES,
  SHARED_MODULE_EXACTS,
  SHARED_MODULE_PREFIXES,
  namespacePrefixRules,
  SHARED_SPEC_REGEX_SOURCE,
  pathAliases,
  repoRoot,
  resolveJsRoot,
  testPathAliases,
};
