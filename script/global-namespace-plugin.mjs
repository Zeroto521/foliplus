// script/global-namespace-plugin.mjs — esbuild plugin (P5, optimized).
// Component bundles externalize #core/*, #common/* and #foliplus/BaseControl.js
// imports to the global namespace exposed by foliplus-common.min.js
// (window.foliplus.core / .common.<mod> / .BaseControl). The runtime entry
// (name === "runtime") must NOT be externalized — it bundles the shared code.
//
// KEY OPTIMIZATION: Auto-scan component source for shared-module imports,
// then generate shims ONLY for the actually-imported names. Unused exports
// are never declared, so they cannot appear in the bundle. The scan itself
// lives in script/import-scan.mjs — the same engine
// script/scan-registry.mjs uses, so publishing and reading cannot drift.
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
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

/** Map a shared-module specifier to the global namespace holding its exports:
 *  foliplus.BaseControl / foliplus.hint / foliplus.core.<mod> /
 *  foliplus.common.<mod>. The shim generated below reads exactly this string,
 *  so a wrong value makes the import resolve to `undefined` at runtime while
 *  the build still prints a tick for it.
 *
 *  Two specifiers are exceptions, and they are the two things
 *  runtime/index.ts publishes directly on `window.foliplus` rather than under
 *  `.core` — `BaseControl` and `hint`, in the `Object.assign(window.foliplus,
 *  …)` block. `hint` is the only core-root file this affects: nothing in the
 *  tree publishes or reads `foliplus.core.hint`, so letting it fall through to
 *  the general rule would ship a shim that reads an empty namespace.
 *
 *  `component` and `mode` are NOT exceptions. runtime publishes them under
 *  `foliplus.core` (the `foliplus.core.component = …` lines) and the general
 *  rule returns byte-for-byte what their former manual entries did, which is
 *  why those entries were deleted. Appearing in SKIPPED_CORE_FILES
 *  (script/scan-registry.mjs) only means the generated registry does not
 *  publish them; that is a registration decision and says nothing about the
 *  namespace a shim must read.
 */
const sharedGlobalNamespace = spec => {
  if (spec === "#foliplus/BaseControl.js") return "foliplus.BaseControl";
  if (spec === "#core/hint.js") return "foliplus.hint";
  // core subdomain barrel: #core/<sub>/* → foliplus.core.<sub> (layer today,
  // future events/modes). Core-root single files are handled below.
  const coreSub = spec.match(/^#core\/([^/]+)\//);
  if (coreSub) return "foliplus.core." + coreSub[1];
  // Every core-root single file needs its own entry: the #common fallback below
  // would build "foliplus.common.#core/<name>", whose shim declaration is not
  // valid JS. A missing entry therefore breaks whichever component imports the
  // file, and build.mjs still prints a tick for it — the artifact just stays
  // stale. test/js/script/global-namespace-plugin.test.ts walks the directory
  // and fails on any entry that does not parse. `index` is carved out:
  // #core/index.js is a barrel nothing imports, and mapping it to
  // foliplus.core.index would resurrect dead code from the deleted
  // core/index.ts barrel.
  const coreSingle = spec.match(/^#core\/([^/]+?)(?:\.js)?$/);
  if (coreSingle && coreSingle[1] !== "index") {
    return "foliplus.core." + coreSingle[1];
  }
  const mod = spec.replace(/^#common\//, "").replace(/\.js$/, "");
  return "foliplus.common." + mod;
};

/** Engine-backed scan, in the shape this plugin has always consumed:
 *  `{ used, starUsed }` keyed by the RAW specifier, because `onLoad` receives
 *  exactly what esbuild resolved. `collectSources` is re-exported verbatim
 *  from script/import-scan.mjs. */
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

    build.onResolve({ filter: /^#(core|common|foliplus)\// }, args => ({
      path: args.path,
      namespace: "foliplus-shared",
    }));
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
  scanSharedImports,
  sharedGlobalNamespace,
};
