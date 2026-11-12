#!/usr/bin/env node
/**
 * Generate _shared-registry.ts by scanning component imports.
 *
 * Scans component .ts files for imports from #core/*, #platform/*, and
 * #foliplus/BaseControl.js — both targeted named imports and import * as
 * (resolved via property-access patterns).  Output registers only the
 * exports used by components on window.foliplus.core / .platform / BaseControl,
 * enabling esbuild to tree-shake unused exports from component bundles.
 *
 * The scan is script/build/import-scan.mjs, shared with
 * script/build/global-namespace-plugin.mjs: this file publishes a name on
 * window.foliplus, the plugin reads it back through a shim, so both sides
 * must scan with the same rules. This file only canonicalizes the keys and
 * generates the artifact.
 *
 * NOTE: core/{component,hint,mode} are SKIPPED — registered manually in
 * runtime/index.ts (see SKIPPED_CORE_FILES in the source).
 *
 * Usage:
 *   node script/build/scan-registry.mjs [--root <path>] [--silent]
 *
 * Reads <root>/foliplus/js/ (source), writes <root>/foliplus/.build/js/.
 */
import { help, parseArgs } from "../args.mjs";
import { repoRoot, resolveJsRoot } from "../build-path.mjs";
import { canonicalSpec, scanSharedImports } from "./import-scan.mjs";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { pathToFileURL } from "url";

const SCAN_SPEC = {
  root: {
    type: "string",
    default: repoRoot(import.meta.url),
    desc: "Project root directory",
  },
  silent: { type: "bool", desc: "Suppress output messages" },
};
const raw = parseArgs(process.argv.slice(2), SCAN_SPEC);
if (raw.help) {
  console.log(help(SCAN_SPEC));
  process.exit(0);
}
if (raw.errors.length) {
  console.error(raw.errors.join("\n"));
  console.error(help(SCAN_SPEC));
  process.exit(1);
}
const opts = raw;

const ROOT = resolve(opts.root);
const srcDir = resolveJsRoot(ROOT);
const buildJs = resolve(ROOT, "foliplus/.build/js");
mkdirSync(buildJs, { recursive: true });

/** Walk a component dir and return `{ canonicalSpec: [names...] }` — named and
 *  star-import usage merged, keyed the way this registry is generated from
 *  (`core/geo`, `platform/dom`). Named `registryUsedExports` rather than
 *  `scanImports`: the actual scan is script/build/import-scan.mjs, and this is only
 *  the registry's adapter over it. */
const registryUsedExports = dir => {
  const { named, starUsed } = scanSharedImports(dir);
  const merged = new Map();
  for (const [spec, names] of [...named.entries(), ...starUsed.entries()]) {
    const key = canonicalSpec(spec);
    const set = merged.get(key) || new Set();
    for (const n of names) set.add(n);
    merged.set(key, set);
  }
  const usedExports = {};
  for (const key of [...merged.keys()].sort()) {
    usedExports[key] = [...merged.get(key)].sort();
  }
  return usedExports;
};

/** Bound on `export * from` chains before collectExportedNames stops recursing. */
const MAX_EXPORT_DEPTH = 16;

// `export { A, B as C } from "./mod.js"` — a named re-export clause.
const RE_EXPORT_NAMED_FROM = /export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
// `export * from "./mod.js"` — a star re-export clause.
const RE_EXPORT_STAR_FROM = /export\s*\*\s*from\s*["']([^"']+)["']/g;
// `export { A, B as C }` — a local re-export clause (no `from`).
const RE_EXPORT_NAMED_LOCAL = /export\s*\{([^}]*)\}/g;
// `export const X` / `export function X` / `export class X` — a direct export.
const RE_EXPORT_DECL =
  /export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;

/** Names an `export { ... }` clause makes importable: `A, B as C` → `A, C`
 *  (the `as` alias is the published name). A `default` alias publishes no
 *  named export, so it is dropped. */
const parseExportNames = list =>
  list
    .split(",")
    .map(part => {
      const trimmed = part.trim();
      if (!trimmed) return null;
      const asMatch = trimmed.match(/\s+as\s+([A-Za-z_$][\w$]*)$/);
      const name = asMatch ? asMatch[1] : trimmed;
      return name === "default" ? null : name;
    })
    .filter(Boolean);

/** Resolve a relative specifier in an `export * from` clause to an existing
 *  source file. `./mod.js` may live on disk as `mod.ts`; a bare specifier
 *  (an alias such as `#platform/dom.js`) is left to esbuild and returns null. */
const resolveModuleSpecifier = (dir, spec) => {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dir, spec);
  const candidates = spec.endsWith(".js")
    ? [
        base,
        base.replace(/\.js$/, ".ts"),
        base.replace(/\.js$/, ".tsx"),
        base.replace(/\.js$/, ".mts"),
      ]
    : [base, `${base}.ts`, `${base}.js`, `${base}.tsx`];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const idxBase = spec.endsWith(".js") ? base.replace(/\.js$/, "") : base;
  for (const idx of [resolve(idxBase, "index.ts"), resolve(idxBase, "index.js")]) {
    if (existsSync(idx)) return idx;
  }
  return null;
};

/** Collect the named-export surface of a module file — every name importable
 *  via `import { X } from ...`. Reads the file, walks its `export` clauses
 *  (named-from, star-from, local named, and direct `const`/`function`/`class`),
 *  and resolves `export * from` targets recursively. `seen` guards cycles and
 *  `depth` bounds star chains, so a self-referential or unresolvable barrel
 *  reports the missing names rather than recursing forever. */
const collectExportedNames = (filePath, seen = new Set(), depth = 0) => {
  if (depth > MAX_EXPORT_DEPTH) return new Set();
  const abs = resolve(filePath);
  if (seen.has(abs)) return new Set();
  seen.add(abs);
  let source;
  try {
    source = readFileSync(abs, "utf-8");
  } catch {
    return new Set();
  }
  const names = new Set();
  const dir = dirname(abs);
  for (const m of source.matchAll(RE_EXPORT_NAMED_FROM)) {
    for (const n of parseExportNames(m[1])) names.add(n);
  }
  for (const m of source.matchAll(RE_EXPORT_STAR_FROM)) {
    const target = resolveModuleSpecifier(dir, m[1]);
    if (target) {
      for (const n of collectExportedNames(target, seen, depth + 1)) names.add(n);
    }
  }
  // Local `export { ... }` clauses (no `from`) after the `from` forms are
  // removed, so a clause that ends in `from "..."` is not counted twice.
  const withoutFrom = source.replace(RE_EXPORT_NAMED_FROM, "");
  for (const m of withoutFrom.matchAll(RE_EXPORT_NAMED_LOCAL)) {
    for (const n of parseExportNames(m[1])) names.add(n);
  }
  for (const m of source.matchAll(RE_EXPORT_DECL)) names.add(m[1]);
  return names;
};

/** Fail the build when a component imports a name the ui barrel does not
 *  re-export. The barrel namespace is generated from the same scan, so an
 *  import and its published name normally stay in lockstep; the only way they
 *  drift is editing `ui/index.ts` (deleting a re-export, or emptying the file)
 *  without touching the components. esbuild externalizes the barrel import to
 *  a shim that reads the flat `window.foliplus.ui`, so the drift would
 *  otherwise resolve to `undefined` at runtime while the build stays green. */
const assertBarrelExports = (sourceDir, barrelName, names) => {
  const indexPath = resolve(sourceDir, barrelName, "index.ts");
  if (!existsSync(indexPath)) {
    throw new Error(
      [
        `${barrelName}/index.ts is missing but a component imports from`,
        `"#${barrelName}/index.js" (${names.join(", ")}). The barrel must`,
        "exist and re-export every name the components use.",
      ].join(" "),
    );
  }
  const exported = collectExportedNames(indexPath);
  const missing = names.filter(n => !exported.has(n));
  if (missing.length) {
    throw new Error(
      [
        `"#${barrelName}/index.js" does not re-export: ${missing.join(", ")}.`,
        `Add ${missing.length > 1 ? "these names" : "this name"} to`,
        `${barrelName}/index.ts or remove the import from the component.`,
      ].join(" "),
    );
  }
};

/** Emit one import + registration pair with collision-safe aliasing.
 *  The registry imports every shared name once; when two modules export the
 *  SAME name (e.g. a vocab const and a locale-key const both named STYLE_MODE),
 *  a bare `import { STYLE_MODE }` from each would collapse in esbuild to the
 *  LAST import — so the runtime namespace would publish the wrong value.
 *  Collisions are aliased: the second import becomes `X as X__<scopeKey>` and the
 *  registration object keeps the published name (`X: X__<scopeKey>`), so each
 *  namespace resolves to the module's OWN value. scopeKey must be unique per
 *  namespace and distinct from any real name. */
const emitNamespace = (
  lines,
  usedNames,
  scopeKey,
  registrationTarget,
  names,
  specifier,
) => {
  const sorted = [...names].sort();
  /* v8 ignore next -- defensive: every caller guards against an empty name list */
  if (sorted.length === 0) return;
  const importNames = [];
  const entryNames = [];
  for (const name of sorted) {
    if (usedNames.has(name)) {
      const alias = `${name}__${scopeKey}`;
      importNames.push(`${name} as ${alias}`);
      entryNames.push(`${name}: ${alias}`);
    } else {
      usedNames.add(name);
      importNames.push(name);
      entryNames.push(name);
    }
  }
  lines.push(`import { ${importNames.join(", ")} } from "${specifier}";`);
  lines.push(`window.foliplus.${registrationTarget} = { ${entryNames.join(", ")} };`);
};
const generateRegistry = (srcDirParam = srcDir, buildJsParam = buildJs) => {
  const sourceDir = srcDirParam;
  const buildDir = buildJsParam;
  const commonDir = resolve(sourceDir, "platform");
  const uiDir = resolve(sourceDir, "ui");
  const coreDir = resolve(sourceDir, "core");
  // platform/ is flat (the engines moved to ui/), so a plain readdir (like ui/ and
  // the core single-file list) collects the modules. No subdir recursion.
  const commonModules = readdirSync(commonDir)
    .filter(f => f.endsWith(".ts") && f !== "index.ts")
    .map(f => f.replace(/\.ts$/, ""))
    .sort();

  const uiModules = existsSync(uiDir)
    ? readdirSync(uiDir)
        .filter(f => f.endsWith(".ts") && f !== "index.ts")
        .map(f => f.replace(/\.ts$/, ""))
        .sort()
    : [];
  const coreSubs = readdirSync(coreDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();
  const coreSingleFiles = readdirSync(coreDir, { withFileTypes: true })
    .filter(f => f.isFile() && f.name.endsWith(".ts") && f.name !== "index.ts")
    .map(f => f.name.replace(/\.ts$/, ""))
    .sort();

  const controlDir = resolve(sourceDir, "control");
  const componentDirs = existsSync(controlDir)
    ? readdirSync(controlDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => resolve(controlDir, e.name))
    : [];

  const usedExports = {};
  for (const dir of componentDirs) {
    const scanned = registryUsedExports(dir);
    for (const [spec, names] of Object.entries(scanned)) {
      if (!usedExports[spec]) usedExports[spec] = [];
      usedExports[spec].push(...names);
    }
  }
  for (const spec of Object.keys(usedExports)) {
    usedExports[spec] = [...new Set(usedExports[spec])].sort();
  }

  // Track every name already imported so a same-named export from a
  // different module is aliased instead of collapsing (esbuild keeps only
  // the last bare import of a duplicated name).
  const usedNames = new Set();

  const lines = [
    "// AUTO-GENERATED by script/build/scan-registry.mjs — do not edit.",
    "// Scans component imports for targeted named imports (Tree Shaking).",
    "window.foliplus = window.foliplus || {};",
    "window.foliplus.core = {};",
    "window.foliplus.platform = {};",
    "window.foliplus.ui = {};",
  ];

  for (const sub of coreSubs) {
    const names = new Set(usedExports[`core/${sub}`] || []);
    // A component import of `#core/<sub>/<file>.js` shims to the same
    // `foliplus.core.<sub>` namespace in global-namespace-plugin (its rule
    // keys on the first path segment), but canonicalSpec files it under
    // `core/<sub>/<file>` — a key this loop would never read, so the name
    // registered nothing and the shim resolved `undefined` at runtime.
    // Fold the file keys into the namespace; the generated import below
    // pulls from the sub's index.js,
    // so a name the barrel does not re-export fails the build loudly
    // instead of silently shimming to undefined.
    for (const key of Object.keys(usedExports)) {
      if (key.startsWith(`core/${sub}/`)) {
        for (const n of usedExports[key]) names.add(n);
      }
    }
    const sorted = [...names].sort();
    if (sorted.length === 0) continue;
    emitNamespace(
      lines,
      usedNames,
      `core_${sub}`,
      `core["${sub}"]`,
      sorted,
      `#core/${sub}/index.js`,
    );
  }

  // Skip core/{component,hint,mode} — registered in runtime/index.ts.
  const SKIPPED_CORE_FILES = new Set(["component", "hint", "mode"]);
  for (const name of coreSingleFiles) {
    if (SKIPPED_CORE_FILES.has(name)) continue;
    const names = usedExports[`core/${name}`] || [];
    if (names.length === 0) continue;
    emitNamespace(
      lines,
      usedNames,
      `core_${name}`,
      `core["${name}"]`,
      names,
      `#core/${name}.js`,
    );
  }

  for (const name of commonModules) {
    const names = usedExports[`platform/${name}`] || [];
    if (names.length === 0) continue;
    emitNamespace(
      lines,
      usedNames,
      `platform_${name}`,
      `platform["${name}"]`,
      names,
      `#platform/${name}.js`,
    );
  }

  for (const name of uiModules) {
    const names = usedExports[`ui/${name}`] || [];
    if (names.length === 0) continue;
    emitNamespace(
      lines,
      usedNames,
      `ui_${name}`,
      `ui["${name}"]`,
      names,
      `#ui/${name}.js`,
    );
  }

  // The ui barrel (#ui/index.js): a component importing from it is scanned
  // under the canonical key "ui" (canonicalSpec strips /index), so the
  // per-module loop above never sees it. Publish the barrel's re-exports at
  // the flat window.foliplus.ui root — the same object the runtime exposes as
  // foliplus.ui (the index module is the Python __init__ of the ui package,
  // so its names land on the package itself, not on ui.index). The component
  // shim reads the same namespace: sharedGlobalNamespace("#ui/index.js") ===
  // "foliplus.ui".
  // This is separate from the per-module loop, which still handles direct
  // ui/<name>.js imports (a few build-script tests import those directly).
  const barrelNames = usedExports["ui"] || [];
  if (barrelNames.length > 0) {
    assertBarrelExports(sourceDir, "ui", barrelNames);
    // A flat publish cannot host a per-module key with the same name as a
    // barrel export — the deep ui module and the flat export would fight for
    // one key. No such name exists today; the guard makes the collision loud.
    for (const name of barrelNames) {
      if (uiModules.includes(name)) {
        throw new Error(
          [
            `ui barrel export "${name}" collides with the ui module of the`,
            "same name. The flat foliplus.ui root cannot hold both the module",
            "namespace and a barrel export under one key.",
          ].join(" "),
        );
      }
    }
    emitNamespace(lines, usedNames, "ui", `ui`, barrelNames, "#ui/index.js");
  }

  const baseNames = usedExports["foliplus/BaseControl"] || ["BaseControl"];
  if (baseNames.length > 0) {
    // BaseControl publishes the class itself, not a { BaseControl } wrapper:
    // foliplus.BaseControl IS the class, so a consumer can write
    // `class MyControl extends foliplus.BaseControl`. The component shim for
    // #foliplus/BaseControl.js reads it directly (no ["BaseControl"] index).
    const baseName = baseNames.includes("BaseControl") ? "BaseControl" : baseNames[0];
    lines.push(`import { ${baseNames.join(", ")} } from "#foliplus/BaseControl.js";`);
    lines.push(`window.foliplus.BaseControl = ${baseName};`);
  }

  writeFileSync(resolve(buildDir, "_shared-registry.ts"), lines.join("\n"), "utf-8");

  if (!opts.silent) {
    console.log(
      `_shared-registry.ts written (${lines.length} lines, ${Object.keys(usedExports).length} specs)`,
    );
  }
};

/** Run the registry scan for the current working tree. */
const main = () => {
  generateRegistry();
};

export {
  assertBarrelExports,
  collectExportedNames,
  generateRegistry,
  main,
  registryUsedExports,
};

// CLI entry point: `node script/build/scan-registry.mjs [--root <path>] [--silent]`.
// Guarded so importing this module (e.g. for tests) has no side effects.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
