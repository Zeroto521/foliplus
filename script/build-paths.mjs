/**
 * script/build-paths.mjs — single source for path-alias resolution.
 *
 * Consumers that each used to spell `foliplus/js` (or a full alias table)
 * by hand:
 *   - script/esbuild-config.mjs  esbuild `alias`
 *   - vitest.config.mjs         vitest `resolve.alias` (plus `#script`)
 *   - script/build.mjs          `srcDir` for plugins / component discovery
 *   - script/scan-registry.mjs  `srcDir` for the import scan
 *   - package.json `imports`    Node resolution — asserted by test
 *
 * #518 was two hand-copied scanners disagreeing; alias tables drift the same
 * way. One module owns the spelling; every consumer imports it.
 *
 * Audit note: no esbuild `target` is set anywhere in this repo today. Do not
 * introduce one here — a target bump would change emitted JS, and the product
 * contract for this single-source work is a zero-byte diff on JS artifacts.
 */
import { resolve } from "path";

/** Repo-relative TypeScript source root. */
const JS_ROOT_REL = "foliplus/js";

/** Resolve `foliplus/js` under a project `root`. */
const resolveJsRoot = root => resolve(root, JS_ROOT_REL);

/**
 * Path aliases shared by esbuild (artifact builds) and vitest (tests).
 * Keys match the `#…` import specifiers every consumer resolves.
 */
const pathAliases = root => {
  const jsRoot = resolveJsRoot(root);
  return {
    "#common": resolve(jsRoot, "common"),
    "#core": resolve(jsRoot, "core"),
    "#foliplus": jsRoot,
  };
};

/**
 * Vitest alias table: the shared paths plus `#script`, which only tests use
 * (`import { … } from "#script/merge-css.mjs"`). esbuild must NOT gain
 * `#script` — no component imports it, and an unused alias is still a second
 * spelling of the truth.
 */
const testPathAliases = root => ({
  ...pathAliases(root),
  "#script": resolve(root, "script"),
});

/**
 * Shared-import specifier prefixes — the `#…/` namespaces the import scanner
 * and the global-namespace plugin accept. Single spelling for the regex
 * consumers that used to hard-code `(?:core|common|foliplus)`.
 */
const SHARED_SPEC_PREFIXES = ["core", "common", "foliplus"];

/**
 * package.json `imports` entries for the shared aliases (relative to the
 * package root). Tests assert these stay aligned with {@link pathAliases};
 * Node cannot import this module for its own resolution, so the JSON file
 * remains the runtime source and this table is the drift check.
 */
const PACKAGE_IMPORTS = {
  "#common/*": "./foliplus/js/common/*",
  "#core/*": "./foliplus/js/core/*",
  "#foliplus/*": "./foliplus/js/*",
  "#script/*": "./script/*",
};

export {
  JS_ROOT_REL,
  PACKAGE_IMPORTS,
  SHARED_SPEC_PREFIXES,
  pathAliases,
  resolveJsRoot,
  testPathAliases,
};
