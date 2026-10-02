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
import { resolve } from "path";

/** Import specifier → repo-relative directory. One spelling for every table. */
const ALIAS_TO_REL = {
  "#common": "foliplus/js/common",
  "#core": "foliplus/js/core",
  "#foliplus": "foliplus/js",
  "#script": "script",
};

/** The three shared aliases; `#script` is vitest-only. */
const SHARED_ALIASES = ["#common", "#core", "#foliplus"];

/** Resolve `foliplus/js` under a project `root`. */
const resolveJsRoot = root => resolve(root, ALIAS_TO_REL["#foliplus"]);

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
 * Shared-import specifier prefixes — the `#…` namespaces the import scanner
 * and the global-namespace plugin accept. Single spelling for the regex
 * consumers that used to hard-code `(?:core|common|foliplus)`.
 */
const SHARED_SPEC_PREFIXES = SHARED_ALIASES.map(spec => spec.slice(1));

/**
 * package.json `imports` entries for the shared aliases, derived from the
 * same mapping (glob suffix added). Tests assert these stay aligned with the
 * package.json file, which remains the Node runtime source.
 */
const PACKAGE_IMPORTS = Object.fromEntries(
  Object.entries(ALIAS_TO_REL).map(([spec, rel]) => [`${spec}/*`, `./${rel}/*`]),
);

export {
  PACKAGE_IMPORTS,
  SHARED_SPEC_PREFIXES,
  pathAliases,
  resolveJsRoot,
  testPathAliases,
};
