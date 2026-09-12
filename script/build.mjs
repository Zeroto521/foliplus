#!/usr/bin/env node
/**
 * Build script — minify foliplus JS/CSS assets with esbuild.
 *
 * Pipeline:
 *   1. esbuild-bundle each component with SVG/HTML source transforms (via ``script/compress.mjs``)
 *   2. Merge the shared stylesheet modules -> ``dist/foliplus-common.min.css``
 *
 *   Source transforms run at bundle time via esbuild onLoad — no .build/ mirror needed.
 *
 * Usage:
 *   node script/build.mjs              # build all (minified)
 *   node script/build.mjs --dev        # unminified, keepNames (for PY identifier tests)
 *   node script/build.mjs --check      # build and verify all artifacts exist
 *   node script/build.mjs --sonda      # build + generate one combined sonda report (HTML treemap)
 *   node script/build.mjs --verify     # don't build; assert the dist/ tree is complete
 */
import autoprefixer from "autoprefixer";
import { spawnSync } from "child_process";
import { build } from "esbuild";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { basename, dirname, resolve } from "path";
import postcss from "postcss";
import postcssNesting from "postcss-nesting";
import { fileURLToPath, pathToFileURL } from "url";
import { help, parseArgs } from "./args.mjs";
import { transformSource } from "./compress.mjs";
import { globalNamespacePlugin } from "./global-namespace-plugin.mjs";
import { FAIL, OK } from "./glyphs.mjs";
import { resolveVersion } from "./version.mjs";

// Sonda is only loaded when --sonda is passed (lazy dynamic import).
// Returns the API used to merge per-build metafiles into one combined report.
let sondaApi = null;
const loadSonda = async () => {
  if (sondaApi) return sondaApi;
  const { Config, processEsbuildMetafile } = await import("sonda");
  sondaApi = { Config, processEsbuildMetafile };
  return sondaApi;
};

// ── Config ──────────────────────────────────────────────────────
// Central path/flag config. `dev` toggles minification & identifier
// preservation — Python render-string tests rely on `keepNames` finding
// `foliplus.showHint` etc. in unminified bundles.
const __dirname = dirname(fileURLToPath(import.meta.url));
// The shared-runtime directory is bundled as foliplus-common.min.js and
// must NOT be externalized (it bundles the shared modules).
const SHARED_ENTRY = "runtime";

const BUILD_SPEC = {
  root: { type: "string", default: ".", desc: "Project root directory" },
  dev: { type: "bool", desc: "Unminified, keepNames" },
  check: { type: "bool", desc: "Verify all artifacts exist" },
  verify: { type: "bool", desc: "Don't build; assert the existing dist/ is complete" },
  sonda: { type: "bool", desc: "Generate sonda bundle report (HTML treemap)" },
};
const _raw = parseArgs(process.argv.slice(2), BUILD_SPEC);
if (_raw.help) {
  console.log(help(BUILD_SPEC));
  process.exit(0);
}
if (_raw.errors.length) {
  console.error(_raw.errors.join("\n"));
  console.error(help(BUILD_SPEC));
  process.exit(1);
}
const CFG = _raw;
CFG.root = resolve(CFG.root);

const srcDir = resolve(CFG.root, "foliplus/js");
const cssDir = resolve(CFG.root, "foliplus/css");
const distDir = resolve(CFG.root, "foliplus/dist");
const buildJs = resolve(CFG.root, "foliplus/.build/js");
const buildCss = resolve(CFG.root, "foliplus/.build/css");
const COMMON_CSS_TMP = "common.css";

// ── Version banner ────────────────────────────────────────────────────────────
// `git describe` (tag + distance + commit) — identical in local dev and CI,
// resolved once and cached by script/version.mjs.
const BUILD_VERSION = resolveVersion();

// ── PostCSS pipeline ────────────────────────────────────────────
// CSS sources are authored in nested syntax (CSS Nesting) and compiled to
// flat selectors for maximum browser compatibility, then vendor-prefixed
// via Autoprefixer (driven by the `browserslist` key in package.json).
// `edition: '2021'` emits fully-flattened selectors (no `:is()` wrapper),
// keeping specificity identical to hand-written flat CSS.
const postcssProcessor = postcss([postcssNesting({ edition: "2021" }), autoprefixer()]);

/** esbuild onLoad plugin that runs CSS through the PostCSS pipeline. */
const postcssPlugin = {
  name: "postcss",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async args => {
      const source = readFileSync(args.path, "utf-8");
      const result = await postcssProcessor.process(source, { from: args.path });
      return { contents: result.css, loader: "css" };
    });
  },
};

/** esbuild onLoad plugin that applies SVG/HTML source transforms
 *  to foliplus source files — no .build/ mirror needed. */
const sourceTransformPlugin = {
  name: "source-transform",
  setup(build) {
    build.onLoad({ filter: /\.(ts|js)$/ }, async args => {
      if (!args.path.startsWith(srcDir + "/")) return null;
      if (args.path.endsWith(".d.ts")) return null;
      const source = readFileSync(args.path, "utf-8");
      return { contents: transformSource(source), loader: "ts" };
    });
  },
};

/** esbuild onResolve plugin that redirects _shared-registry.js import
 *  (from runtime/index.ts) to the generated file in .build/js/. */
const resolveSharedRegistryPlugin = {
  name: "resolve-shared-registry",
  setup(build) {
    build.onResolve({ filter: /_shared-registry\.js$/ }, args => ({
      path: resolve(buildJs, "_shared-registry.ts"),
    }));
  },
};

// ── Shared esbuild options ──────────────────────────────────────
// `alias` maps `#common/*` to the source tree. Compressed sources are
// delivered at bundle time via sourceTransformPlugin (esbuild onLoad).
const esbuildCfg = {
  bundle: true,
  format: "iife",
  minify: !CFG.dev,
  // Sourcemaps are only useful when debugging the minified bundle in a browser.
  // Since foliplus bundles are embedded in Python-generated HTML and shipped
  // to end users, production sourcemaps have no consumer — skip them.
  sourcemap: false,
  allowOverwrite: true,
  keepNames: CFG.dev,
  alias: {
    "#common": srcDir + "/common",
    "#core": srcDir + "/core",
    "#foliplus": srcDir,
  },
  // Same `git describe` value as the artifact banner, inlined for the
  // runtime console log (`[foliplus] foliplus@…`).
  define: {
    __FOLIPLUS_VERSION__: JSON.stringify(BUILD_VERSION),
  },
  plugins: [postcssPlugin, sourceTransformPlugin],
};

/** esbuild options for one artifact. Two things vary per artifact: tree
 *  shaking and the plugin list, both keyed on whether this is the shared
 *  entry. Component bundles read shared modules from the global namespace
 *  (so they tree-shake unused exports); the shared entry bundles them,
 *  which makes tree shaking meaningless and adds the registry plugin. */
const artifact = (entryPoints, outfile, name) => {
  const shared = name === SHARED_ENTRY;
  // Identical for JS and CSS, but esbuild requires banner to be an object.
  const bannerText = `/*! foliplus@${BUILD_VERSION} · ${name} */\n`;
  return {
    entryPoints,
    outfile,
    ...esbuildCfg,
    treeShaking: !shared,
    plugins: shared
      ? [...esbuildCfg.plugins, resolveSharedRegistryPlugin]
      : [...esbuildCfg.plugins, globalNamespacePlugin(srcDir)],
    banner: { js: bannerText, css: bannerText },
  };
};

/** Return the first path that exists, else null. */
const resolveEntry = candidates => candidates.find(existsSync) ?? null;

/** Discover component entries (dirs with a matching `{Name}.{ts|js}`) under .build/. */
const findComponents = () => {
  const entries = readdirSync(srcDir, { withFileTypes: true });
  const components = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "core") continue; // core is a shared subdomain, not a control component
    const name = entry.name;
    const jsFile = resolveEntry([
      resolve(srcDir, name, "index.ts"),
      resolve(srcDir, name, "index.js"),
    ]);
    const cssFile = resolve(cssDir, `${name}.css`);
    if (jsFile) {
      components.push({ name, js: jsFile, css: existsSync(cssFile) ? cssFile : null });
    }
  }
  return components;
};

/** Shorthand for a path under dist/. */
const out = name => resolve(distDir, name);

/** Shared stylesheet modules, in merge order - never alphabetical.

`token.css` defines the custom properties the rest read, so it must come
first. Sorting would put `button.css` first and silently break every
`var(--...)`: no build error, no console error, just a map with all its
shared colors and sizes gone. Bare names; every module lives in `css/common/`.
*/
const COMMON_CSS_ORDER = [
  "token.css",
  "reset.css",
  "button.css",
  "menu.css",
  "input.css",
  "hint.css",
  "icon.css",
  "ctrl-fold.css",
  "panel.css",
];
/** Concatenate the shared stylesheet modules, asserting the manifest matches
 *  the folder. Both drift directions would be silent otherwise: an unlisted
 *  file is dropped from the bundle, an entry with no file is simply omitted. */
const mergeCommonCss = () => {
  const dir = resolve(cssDir, "common");
  if (!existsSync(dir)) return null;

  const present = readdirSync(dir).filter(f => f.endsWith(".css"));
  const inManifest = new Set(COMMON_CSS_ORDER);
  const inFolder = new Set(present);
  const unlisted = present.filter(f => !inManifest.has(f));
  const missing = COMMON_CSS_ORDER.filter(f => !inFolder.has(f));
  if (unlisted.length || missing.length) {
    throw new Error(
      `build: css/common/ has ${present.length} files, manifest lists ` +
        `${COMMON_CSS_ORDER.length} - unlisted: ${unlisted.join(", ") || "-"}; ` +
        `missing: ${missing.join(", ") || "-"}`,
    );
  }
  return COMMON_CSS_ORDER.map(f => readFileSync(resolve(dir, f), "utf-8")).join("\n");
};

/** Assert the dist/ tree holds every artifact a complete build would emit.
 *
 * Same source of truth as the build itself (`findComponents`) plus the shared
 * entry and the merged stylesheet — a package that ships fewer files than this
 * is unusable, so the check runs in CI without re-running esbuild.
 */
const verifyDist = () => {
  const expected = ["foliplus-common.min.js", "foliplus-common.min.css"];
  for (const { name, css } of findComponents()) {
    // The shared entry is written out as "common", so skip its source name
    // (runtime/) — it has no runtime-prefixed artifact.
    if (name === SHARED_ENTRY) continue;
    expected.push(`foliplus-${name}.min.js`);
    if (css) expected.push(`foliplus-${name}.min.css`);
  }
  const missing = expected.filter(f => !existsSync(resolve(distDir, f)));
  if (missing.length) {
    console.error(
      `Missing artifacts: ${missing.join(", ")} — run \`npm run build\` first`,
    );
    process.exit(1);
  }
  console.log(`${OK} ${expected.length} artifacts present in dist/`);
};

/** Build the full list of esbuild artifacts (components + merged common CSS).
 *  `withSonda` only enables metafile output per build — the metafiles are
 *  merged into a single sonda report after all builds complete. */
const buildEntries = (components, withSonda) => {
  // `metafile: true` is what feeds the sonda treemap; it is per-artifact,
  // so set it once here rather than after every artifact() call.
  const enable = entry => (withSonda ? { ...entry, metafile: true } : entry);

  const entries = [];
  for (const { name, js, css } of components) {
    // The shared entry is exposed as "common" so the filename
    // foliplus-common.min.js pairs with the CSS.
    const outName = name === SHARED_ENTRY ? "common" : name;
    entries.push(enable(artifact([js], out(`foliplus-${outName}.min.js`), name)));
    if (css) {
      entries.push(enable(artifact([css], out(`foliplus-${outName}.min.css`), name)));
    }
  }

  // Merge the shared stylesheet modules into a single artifact
  const css = mergeCommonCss();
  if (css) {
    mkdirSync(buildCss, { recursive: true });
    const tmpCss = resolve(buildCss, COMMON_CSS_TMP);
    writeFileSync(tmpCss, css, "utf-8");
    entries.push(enable(artifact([tmpCss], out("foliplus-common.min.css"), "common")));
  }
  return entries;
};

/** Merge per-build esbuild metafiles into one. Input/output paths are disjoint
 *  across builds (each build emits one artifact), so a shallow merge suffices. */
const mergeMetafiles = metafiles => {
  const merged = { inputs: {}, outputs: {} };
  for (const mf of metafiles) {
    if (!mf) continue;
    Object.assign(merged.inputs, mf.inputs);
    Object.assign(merged.outputs, mf.outputs);
  }
  return merged;
};

/** Generate .build/js/_shared-registry.ts via external script.
 *  Auto-scans component imports for used exports (see scan-registry.mjs). */
const generateSharedRegistry = () => {
  const genResult = spawnSync(
    process.execPath,
    [resolve(__dirname, "scan-registry.mjs"), "--root", CFG.root, "--silent"],
    { stdio: "pipe", encoding: "utf-8" },
  );
  if (genResult.error) throw genResult.error;
  if (genResult.stderr) console.error(genResult.stderr);
  if (genResult.status !== 0) process.exit(genResult.status);
};
const main = async () => {
  if (CFG.verify) {
    verifyDist();
    return;
  }
  console.time("build");
  // ── Step 1: Create output dirs (no source mirror needed)
  // SVG/HTML transforms run at esbuild bundle time via sourceTransformPlugin.
  mkdirSync(buildJs, { recursive: true });
  rmSync(buildCss, { recursive: true, force: true });
  mkdirSync(buildCss, { recursive: true });

  // ── Step 2.5: Generate shared registry ────────────────────────
  // Auto-registers every common/core module on window.foliplus (P5).
  generateSharedRegistry();

  // ── Step 3: Discover components & build entries ───────────────
  const components = findComponents();
  const sonda = CFG.sonda ? await loadSonda() : null;
  if (sonda) {
    console.log("  Sonda analysis enabled (combined report → bundle-treemap.html)");
  }
  const entries = buildEntries(components, CFG.sonda);
  console.log(
    `Building ${entries.length} artifacts for ${components.length} components...`,
  );

  // ── Step 4: esbuild bundle (parallel) ─────────────────────────
  const results = await Promise.allSettled(entries.map(opts => build(opts)));
  const failed = results.filter(r => r.status === "rejected").length;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      console.log(`  ${OK} ${basename(entries[i].outfile)}`);
    } else {
      console.error(`  ${FAIL} ${basename(entries[i].outfile)}: ${r.reason.message}`);
    }
  }

  // ── Step 4.5: Combined sonda report (--sonda) ──
  // Merge per-build metafiles into one sonda treemap (bundle-treemap.html).
  if (sonda) {
    const metafiles = results
      .filter(r => r.status === "fulfilled")
      .map(r => r.value?.metafile)
      .filter(Boolean);
    const reportFile = resolve(CFG.root, "bundle-treemap.html");
    rmSync(reportFile, { force: true });
    const config = new sonda.Config(
      {
        format: "html",
        outputDir: CFG.root,
        filename: "bundle-treemap.html",
        open: false,
        include: [/\.(js|css)$/],
      },
      { integration: "esbuild" },
    );
    await sonda.processEsbuildMetafile(mergeMetafiles(metafiles), config);
  }

  // ── Step 5: Verification (--check) ────────────────────────────
  if (CFG.check) {
    const missing = entries.map(e => e.outfile).filter(f => !existsSync(f));
    if (missing.length) {
      console.error(`Missing artifacts: ${missing.join(", ")}`);
      process.exit(1);
    }
    console.log(`All ${entries.length} artifacts present.`);
  }
  if (failed) process.exit(1);
  console.timeEnd("build");
};

// CLI entry point: `node script/build.mjs [--dev|--check|--verify|--sonda]`.
// Guarded so importing this module has no side effects.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
