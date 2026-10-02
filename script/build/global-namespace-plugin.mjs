// script/build/global-namespace-plugin.mjs — esbuild plugin (P5, optimized).
// Component bundles externalize #core/*, #common/* and #foliplus/BaseControl.js
// imports to the global namespace exposed by foliplus-common.min.js
// (window.foliplus.core / .common.<mod> / .BaseControl). The runtime entry
// (name === "runtime") must NOT be externalized — it bundles the shared code.
//
// KEY OPTIMIZATION: Auto-scan component source for shared-module imports,
// then generate shims ONLY for the actually-imported names. Unused exports
// are never declared, so they cannot appear in the bundle. The scan itself
// lives in script/build/import-scan.mjs — the same engine
// script/build/scan-registry.mjs uses, so publishing and reading cannot drift.
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { SHARED_SPEC_PREFIXES } from "../build-path.mjs";
import {
  collectSources,
  scanSharedImports as scanSharedImportsEngine,
} from "./import-scan.mjs";

const DECL_RE =
  /export\s+(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/g;
const NAMED_RE = /export\s*\{([^}]+)\}/g;
const STAR_RE = /export\s*\*\s*from\s*["']([^"']+)["']/g;
const RE_EXPORT_RE = /export\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;

/** Parse a comma-separated export list, returning exported names (respects as).
 *  `type` is a modifier (`type A`), never a prefix — `export { typeFoo }` is
 *  a real identifier and survives. */
const exportNames = list =>
  list
    .split(",")
    .map(part => {
      const trimmed = part.trim();
      const m = trimmed.match(/^(.+?)\s+as\s+(.+)$/);
      return m ? m[2].trim() : trimmed;
    })
    .filter(n => n && !/^type\s/.test(n));

const exportCache = new Map();

const collectExports = (filePath, seen = new Set(), depth = 0) => {
  const srcPath = existsSync(filePath) ? filePath : filePath.replace(/\.js$/, ".ts");
  if (depth > 6 || seen.has(srcPath) || !existsSync(srcPath)) return [];
  if (exportCache.has(srcPath)) return exportCache.get(srcPath);
  seen.add(srcPath);
  const src = readFileSync(srcPath, "utf-8");
  const names = new Set();
  let m;
  while ((m = DECL_RE.exec(src))) names.add(m[1]);
  while ((m = NAMED_RE.exec(src))) exportNames(m[1]).forEach(n => names.add(n));
  while ((m = STAR_RE.exec(src))) {
    const sub = resolve(dirname(srcPath), m[1]);
    for (const n of collectExports(sub, seen, depth + 1)) names.add(n);
  }
  while ((m = RE_EXPORT_RE.exec(src))) {
    const sub = resolve(dirname(srcPath), m[2]);
    exportNames(m[1]).forEach(n => names.add(n));
    for (const n of collectExports(sub, seen, depth + 1)) names.add(n);
  }
  const result = [...names];
  exportCache.set(srcPath, result);
  return result;
};

/** Map a canonical spec (`core/hint`, `common/log`, `BaseControl`) to its
 *  runtime-relative dotted form — the string the shared runtime registers
 *  under on `window.foliplus`. Shared between the shim generator (which
 *  prefixes `foliplus.` for the global lookup) and the build script (which
 *  records declared deps in `manifest.json`) so the two stay in sync.
 *
 *  `core/hint` is the one exception to the "first path segment" rule: the
 *  runtime publishes it at the top level (`foliplus.hint`, not
 *  `foliplus.core.hint`) in the `Object.assign(window.foliplus, …)` block
 *  in runtime/index.ts. Everything else follows `core.<sub>` /
 *  `common.<sub>`; `BaseControl` (i.e. `#foliplus/BaseControl.js`) is a
 *  bare top-level export.
 *
 *  When the canonical form still carries a `#` — which only happens for the
 *  deleted `core/index.ts` barrel — it is returned as-is so
 *  `sharedGlobalNamespace` produces an invalid JS identifier in the shim
 *  name. The build fails loudly rather than shipping a stale artifact. */
const runtimeTarget = spec => {
  if (spec.startsWith("#")) return spec;
  if (spec === "core/hint") return "hint";
  if (spec.startsWith("common/")) return "common." + spec.split("/")[1];
  if (spec.startsWith("core/")) {
    const sub = spec.split("/")[1];
    return sub === "index" ? "#" + spec : "core." + sub;
  }
  if (spec.startsWith("foliplus/")) return spec.slice("foliplus/".length);
  return spec;
};

/** Map a shared-module specifier to the global namespace holding its exports:
 *  foliplus.BaseControl / foliplus.hint / foliplus.core.<mod> /
 *  foliplus.common.<mod>. The shim generated below reads exactly this string,
 *  so a wrong value makes the import resolve to `undefined` at runtime while
 *  the build still prints a tick for it.
 *
 *  The mapping itself lives in `runtimeTarget` above — this wrapper just
 *  strips the `#` prefix and `.js` extension, then prefixes `foliplus.`.
 *  Keeping the two in one file (and one helper) means a new shared module
 *  can only be misrouted in one place. `test/js/script/build/
 *  global-namespace-plugin.test.ts` walks the directory and fails on any
 *  entry that does not parse.
 *
 *  The `core/index` fall-through (see `runtimeTarget`) returns the leading
 *  `#` intact, which is what keeps `var foliplus_common_#core/index_shim = …`
 *  from ever being a valid declaration — the barrel is dead code, and this
 *  failure mode is intentional.
 *
 *  `component` and `mode` are NOT exceptions. runtime publishes them under
 *  `foliplus.core` (the `foliplus.core.component = …` lines) and the general
 *  rule returns byte-for-byte what their former manual entries did, which is
 *  why those entries were deleted. Appearing in SKIPPED_CORE_FILES
 *  (script/build/scan-registry.mjs) only means the generated registry does not
 *  publish them; that is a registration decision and says nothing about the
 *  namespace a shim must read.
 */
const sharedGlobalNamespace = spec => {
  // `core/index` is handled inside `runtimeTarget` (it returns a `#`-prefixed
  // form so the shim declaration is invalid JS and the build fails loudly).
  const canonical = spec.replace(/^#/, "").replace(/\.js$/, "");
  return "foliplus." + runtimeTarget(canonical);
};

/** Engine-backed scan, in the shape this plugin has always consumed:
 *  `{ used, starUsed }` keyed by the RAW specifier, because `onLoad` receives
 *  exactly what esbuild resolved. `collectSources` is re-exported verbatim
 *  from script/build/import-scan.mjs. */
const scanSharedImports = dir => {
  const { named, starUsed } = scanSharedImportsEngine(dir);
  return { used: named, starUsed };
};

/** Create the plugin for a given source root. */
const globalNamespacePlugin = sourceRoot => ({
  name: "foliplus-global-namespace",
  setup(build) {
    // Pre-scan: discover which shared-module exports are actually imported.
    const entry = build.initialOptions.entryPoints
      ? Array.isArray(build.initialOptions.entryPoints)
        ? build.initialOptions.entryPoints[0]
        : build.initialOptions.entryPoints
      : null;
    const scanDir = entry ? dirname(entry) : null;
    let usedExports = new Map();
    let starUsed = new Map();
    if (scanDir) {
      const result = scanSharedImports(scanDir);
      usedExports = result.used;
      starUsed = result.starUsed;
    }

    build.onResolve(
      { filter: new RegExp(`^#(${SHARED_SPEC_PREFIXES.join("|")})/`) },
      args => ({
        path: args.path,
        namespace: "foliplus-shared",
      }),
    );
    build.onLoad({ filter: /.*/, namespace: "foliplus-shared" }, args => {
      const spec = args.path;
      const rel = spec
        .replace(/^#core\//, "core/")
        .replace(/^#common\//, "common/")
        .replace(/^#foliplus\//, "");
      const sourcePath = resolve(sourceRoot, rel);
      const ns = sharedGlobalNamespace(spec);

      // Which exports to shim:
      // - Star-imported with known usage: include only used props (auto-analysis)
      // - Named-imported: include only those names (auto-analysis)
      // - Unknown (e.g. dynamic import): fall back to all exports
      // Merge named + star imports — a module can be consumed both ways.
      const merged = new Set();
      if (usedExports.has(spec)) usedExports.get(spec).forEach(n => merged.add(n));
      if (starUsed.has(spec)) starUsed.get(spec).forEach(n => merged.add(n));
      const namesToShim = merged.size > 0 ? [...merged] : collectExports(sourcePath);

      if (namesToShim.length === 0) return { contents: "", loader: "js" };

      const shimName = ns.replace(/\./g, "_") + "_shim";
      const shimDecl = "var " + shimName + " = globalThis." + ns + ";";
      const lines = namesToShim.map(
        n => "export const " + n + " = " + shimName + '["' + n + '"];',
      );
      lines.unshift(shimDecl);
      return { contents: lines.join("\n"), loader: "js" };
    });
  },
});

export {
  collectExports,
  collectSources,
  exportNames,
  globalNamespacePlugin,
  runtimeTarget,
  scanSharedImports,
  sharedGlobalNamespace,
};
