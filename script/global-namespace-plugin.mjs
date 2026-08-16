// script/global-namespace-plugin.mjs — esbuild plugin (P5).
// Component bundles externalize #core/*, #common/* and #foliplus/BaseControl.js
// imports to the global namespace exposed by foliplus-common.min.js
// (window.foliplus.core / .common.<mod> / .BaseControl). The runtime entry
// (name === "runtime") must NOT be externalized — it bundles the shared code.
//
// A shim module is generated per import: it reads the matching global
// namespace object and re-exports the module's named exports by name.
// Export names are collected recursively from the original source
// (handles `export * from` barrels and `export {} from` re-exports).
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";

const DECL_RE =
  /export\s+(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/g;
const NAMED_RE = /export\s*\{([^}]+)\}/g;
const STAR_RE = /export\s*\*\s*from\s*["']([^"']+)["']/g;
const RE_EXPORT_RE = /export\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;

/** Parse a comma-separated export list, returning local names (before `as`). */
const exportNames = list =>
  list
    .split(",")
    .map(part =>
      part
        .trim()
        .split(/\s+as\s+/)[0]
        .trim(),
    )
    .filter(n => n && !n.startsWith("type"));

// Memoized per resolved source path — the same module is imported by many
// components, so avoid re-reading/re-parsing it on every bundle.
const exportCache = new Map();

const collectExports = (filePath, seen = new Set(), depth = 0) => {
  // Source modules are TypeScript (.ts) — the import specifier uses .js
  // (ESM convention), so resolve .ts when the .js path does not exist.
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

/** Map an import specifier to its global namespace path on window.foliplus. */
const sharedGlobalNamespace = spec => {
  if (spec === "#foliplus/BaseControl.js") return "foliplus.BaseControl";
  if (spec === "#core/hint.js") return "foliplus.hint";
  if (spec === "#core/component.js") return "foliplus.core.component";
  if (spec === "#core/mode.js") return "foliplus.core.mode";
  if (spec === "#core/keyboard.js") return "foliplus.core.keyboard";
  // core subdomain barrel: #core/<sub>/* → foliplus.core.<sub> (layer today,
  // future events/modes). Core-root single files (hint) are handled above.
  const coreSub = spec.match(/^#core\/([^/]+)\//);
  if (coreSub) return `foliplus.core.${coreSub[1]}`;
  const mod = spec.replace(/^#common\//, "").replace(/\.js$/, "");
  return `foliplus.common.${mod}`;
};

/** Create the plugin for a given source root (resolves #core/#common/#foliplus). */
const globalNamespacePlugin = sourceRoot => ({
  name: "foliplus-global-namespace",
  setup(build) {
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
      const exports = collectExports(sourcePath);
      const ns = sharedGlobalNamespace(spec);
      const lines = exports.map(n => `export const ${n} = globalThis.${ns}["${n}"];`);
      return { contents: lines.join("\n"), loader: "js" };
    });
  },
});

export { collectExports, globalNamespacePlugin, sharedGlobalNamespace };
