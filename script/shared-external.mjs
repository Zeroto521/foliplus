// script/shared-external.mjs — esbuild plugin (P5).
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

const collectExports = (filePath, seen = new Set(), depth = 0) => {
  // Source modules are TypeScript (.ts) — the import specifier uses .js
  // (ESM convention), so resolve .ts when the .js path does not exist.
  const srcPath = existsSync(filePath) ? filePath : filePath.replace(/\.js$/, ".ts");
  if (depth > 6 || seen.has(srcPath) || !existsSync(srcPath)) return [];
  seen.add(srcPath);
  const src = readFileSync(srcPath, "utf-8");
  const names = new Set();
  const declRe = /export\s+(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = declRe.exec(src))) names.add(m[1]);
  const namedRe = /export\s*\{([^}]+)\}/g;
  while ((m = namedRe.exec(src))) {
    for (const part of m[1].split(",")) {
      const n = part.trim().split(/\s+as\s+/)[0].trim();
      if (n && !n.startsWith("type")) names.add(n);
    }
  }
  const starRe = /export\s*\*\s*from\s*["']([^"']+)["']/g;
  while ((m = starRe.exec(src))) {
    const sub = resolve(dirname(srcPath), m[1]);
    for (const n of collectExports(sub, seen, depth + 1)) names.add(n);
  }
  const reExportRe = /export\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  while ((m = reExportRe.exec(src))) {
    const sub = resolve(dirname(srcPath), m[2]);
    for (const part of m[1].split(",")) {
      const n = part.trim().split(/\s+as\s+/)[0].trim();
      if (n && !n.startsWith("type")) names.add(n);
    }
    for (const n of collectExports(sub, seen, depth + 1)) names.add(n);
  }
  return [...names];
};

/** Map an import specifier to its global namespace path on window.foliplus. */
const sharedGlobalNs = spec => {
  if (spec === "#foliplus/BaseControl.js") return "foliplus.BaseControl";
  if (spec === "#core/hint.js") return "foliplus.hint";
  // core subdomain barrel: #core/<sub>/* → foliplus.core.<sub> (layer today,
  // future events/modes). Core-root single files (hint) are handled above.
  const coreSub = spec.match(/^#core\/([^/]+)\//);
  if (coreSub) return `foliplus.core.${coreSub[1]}`;
  const mod = spec.replace(/^#common\//, "").replace(/\.js$/, "");
  return `foliplus.common.${mod}`;
};

/** Create the plugin for a given source root (resolves #core/#common/#foliplus). */
const sharedExternalPlugin = (sourceRoot, { skip = [] } = {}) => ({
  name: "foliplus-shared-external",
  setup(build) {
    build.onResolve({ filter: /^#(core|common|foliplus)\// }, args => ({
      path: args.path,
      namespace: "foliplus-shared",
    }));
    build.onLoad({ filter: /.*/, namespace: "foliplus-shared" }, async args => {
      const spec = args.path;
      const rel = spec
        .replace(/^#core\//, "core/")
        .replace(/^#common\//, "common/")
        .replace(/^#foliplus\//, "");
      const sourcePath = resolve(sourceRoot, rel);
      const exports = collectExports(sourcePath);
      const ns = sharedGlobalNs(spec);
      const lines = exports.map(n => `export const ${n} = globalThis.${ns}["${n}"];`);
      return { contents: lines.join("\n"), loader: "js" };
    });
  },
});

export { sharedExternalPlugin };
