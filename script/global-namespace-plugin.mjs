// script/global-namespace-plugin.mjs — esbuild plugin (P5, optimized).
// Component bundles externalize #core/*, #common/* and #foliplus/BaseControl.js
// imports to the global namespace exposed by foliplus-common.min.js
// (window.foliplus.core / .common.<mod> / .BaseControl). The runtime entry
// (name === "runtime") must NOT be externalized — it bundles the shared code.
//
// KEY OPTIMIZATION: Auto-scan component source for shared-module imports,
// then generate shims ONLY for the actually-imported names. Unused exports
// are never declared, so they cannot appear in the bundle.
import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";

const DECL_RE =
  /export\s+(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/g;
const NAMED_RE = /export\s*\{([^}]+)\}/g;
const STAR_RE = /export\s*\*\s*from\s*["']([^"']+)["']/g;
const RE_EXPORT_RE = /export\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;

/** Parse a comma-separated export list, returning exported names (respects as). */
const exportNames = list =>
  list
    .split(",")
    .map(part => {
      const trimmed = part.trim();
      const m = trimmed.match(/^(.+?)\s+as\s+(.+)$/);
      return m ? m[2].trim() : trimmed;
    })
    .filter(n => n && !n.startsWith("type"));

// Matches: import { A, B } from "#core/x.js"  |  import * as X from "#common/y.js"
const SHARED_IMPORT_RE =
  /import\s+(?:\{([^}]+)\}|\*\s+as\s+(\w+))\s+from\s+["']#((?:core|common|foliplus)\/[^"']+)["']/g;

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

const sharedGlobalNamespace = spec => {
  if (spec === "#foliplus/BaseControl.js") return "foliplus.BaseControl";
  if (spec === "#core/hint.js") return "foliplus.hint";
  if (spec === "#core/component.js") return "foliplus.core.component";
  if (spec === "#core/mode.js") return "foliplus.core.mode";
  if (spec === "#core/interaction.js") return "foliplus.core.interaction";
  // core subdomain barrel: #core/<sub>/* → foliplus.core.<sub> (layer today,
  // future events/modes). Core-root single files (hint) are handled above.
  const coreSub = spec.match(/^#core\/([^/]+)\//);
  if (coreSub) return "foliplus.core." + coreSub[1];
  const mod = spec.replace(/^#common\//, "").replace(/\.js$/, "");
  return "foliplus.common." + mod;
};

/** Recursively collect all .ts/.js sources under a directory. */
const collectSources = (dir, out = []) => {
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      if (entry.endsWith(".d.ts")) continue;
      if (entry.endsWith(".ts") || entry.endsWith(".js")) {
        out.push(readFileSync(fullPath, "utf-8"));
      } else if (!entry.startsWith(".")) {
        collectSources(fullPath, out);
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return out;
};

/** Analyze component sources for shared-module imports and their usage.
    Returns { used: Map<spec, Set<names>>, starUsed: Map<spec, Set<names>> }. */
const scanSharedImports = dir => {
  const sources = collectSources(dir);
  const used = new Map();
  const starAliases = new Map(); // local alias -> spec
  for (const src of sources) {
    let m;
    while ((m = SHARED_IMPORT_RE.exec(src))) {
      const spec = "#" + m[3];
      if (m[2]) {
        starAliases.set(m[2], spec);
      } else {
        const names = (m[1] || "")
          .split(",")
          .map(x => x.split(" as ")[0].trim())
          .filter(n => n && !n.startsWith("type"));
        if (!used.has(spec)) used.set(spec, new Set());
        for (const n of names) used.get(spec).add(n);
      }
    }
  }
  // Second pass: find `alias.Prop` usages for star imports.
  const starUsed = new Map();
  for (const [alias, spec] of starAliases) {
    const propRe = new RegExp(
      "\\b" + alias.replace(/[$]/g, "\\$") + "\\.([A-Za-z_$][\\w$]*)",
      "g",
    );
    const names = new Set();
    for (const src of sources) {
      let pm;
      while ((pm = propRe.exec(src))) names.add(pm[1]);
    }
    if (names.size) starUsed.set(spec, names);
  }
  return { used, starUsed };
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
      let namesToShim;
      // Merge named + star imports — a module can be consumed both ways.
      const merged = new Set();
      if (usedExports.has(spec)) usedExports.get(spec).forEach(n => merged.add(n));
      if (starUsed.has(spec)) starUsed.get(spec).forEach(n => merged.add(n));

      namesToShim = merged.size > 0 ? [...merged] : collectExports(sourcePath);

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
  globalNamespacePlugin,
  scanSharedImports,
  sharedGlobalNamespace,
};
