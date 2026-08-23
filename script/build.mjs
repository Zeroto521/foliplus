#!/usr/bin/env node
/**
 * Build script — minify foliplus JS/CSS assets with esbuild.
 *
 * Pipeline:
 *   1. esbuild-bundle each component with SVG/HTML source transforms (via ``script/compress.mjs``)
 *   2. Merge ``common.css`` + ``panel.css`` → ``dist/foliplus-common.min.css``
 *
 *   Source transforms run at bundle time via esbuild onLoad — no .build/ mirror needed.
 *
 * Usage:
 *   node script/build.mjs              # build all (minified)
 *   node script/build.mjs --dev        # unminified, keepNames (for PY identifier tests)
 *   node script/build.mjs --check      # build and verify all artifacts exist
 *   node script/build.mjs --watch      # watch for changes and rebuild (dev hot-reload)
 */
import autoprefixer from "autoprefixer";
import { spawnSync } from "child_process";
import { build, context } from "esbuild";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { basename, dirname, relative, resolve } from "path";
import postcss from "postcss";
import postcssNesting from "postcss-nesting";
import { fileURLToPath } from "url";
import { help, parseArgs } from "./args.mjs";
import { transformSource } from "./compress.mjs";
import { globalNamespacePlugin } from "./global-namespace-plugin.mjs";

// ── Config ──────────────────────────────────────────────────────
// Central path/flag config. `dev` toggles minification & identifier
// preservation — Python render-string tests rely on `keepNames` finding
// `foliplus.showHint` etc. in unminified bundles.
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
// The shared-runtime directory is bundled as foliplus-common.min.js and
// must NOT be externalized (it bundles the shared modules).
const SHARED_ENTRY = "runtime";

const BUILD_SPEC = {
  root: { type: "string", default: ".", desc: "Project root directory" },
  dev: { type: "bool", desc: "Unminified, keepNames" },
  check: { type: "bool", desc: "Verify all artifacts exist" },
  watch: { type: "bool", desc: "Watch for changes and rebuild" },
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

// --check only makes sense for a single (non-watch) build — verify and
// exit. Running it alongside --watch would fight the persistent process,
// so we drop it in watch mode with a hint.
if (_raw.check && _raw.watch) {
  console.log("Note: --check skipped in --watch mode (use without --watch to verify).");
  _raw.check = false;
}
const CFG = _raw;
CFG.root = resolve(CFG.root);
const ROOT_RESOLVED = CFG.root;

const srcDir = resolve(ROOT_RESOLVED, "foliplus/js");
const cssDir = resolve(ROOT_RESOLVED, "foliplus/css");
const distDir = resolve(ROOT_RESOLVED, "foliplus/dist");
const buildJs = resolve(ROOT_RESOLVED, "foliplus/.build/js");
const buildCss = resolve(ROOT_RESOLVED, "foliplus/.build/css");
const MERGED_CSS_NAME = "_common_merged.css";

// Absolute paths for the merged common-CSS sources. The mergedCssEntryPlugin
// turns the entry file into an @import chain over these two files so they
// become real esbuild dependencies — their changes then trigger a rebuild in
// watch mode (the previous Node-side concat into a temp file was a blind spot
// that only merged once at startup).
const commonCssPath = resolve(cssDir, "common.css");
const panelCssPath = resolve(cssDir, "panel.css");
const panelCssExists = existsSync(panelCssPath);

/** Plugin that rewrites the merged common-CSS entry into an `@import` chain.
 *  It claims the entry via `onResolve` into a dedicated namespace so
 *  `postcssPlugin` (which matches `.css` in the default namespace first)
 *  never minifies the bare entry stub — that would defeat the rewrite. The
 *  imported real CSS files (common.css / panel.css) stay in the default
 *  namespace and flow through `postcssPlugin` normally. This makes both
 *  source files real esbuild dependencies, so their changes trigger a rebuild
 *  in watch mode (the previous Node-side concat was a blind spot that only
 *  merged once at startup). */
const mergedCssEntryPlugin = {
  name: "merged-css-entry",
  setup(build) {
    const entry = resolve(buildCss, MERGED_CSS_NAME);
    build.onResolve({ filter: /\.css$/ }, args => {
      if (resolve(dirname(args.path), basename(args.path)) === entry) {
        return { path: args.path, namespace: "merged-css" };
      }
      return null;
    });
    build.onLoad({ filter: /\.css$/, namespace: "merged-css" }, () => {
      const lines = [`@import "${basename(commonCssPath)}";`];
      if (existsSync(panelCssPath))
        lines.push(`@import "${basename(panelCssPath)}";`);
      // Use bare @import names with resolveDir pointing at the css source dir.
      // esbuild's CSS loader handles bare/./ names correctly but corrupts ".."
      // relative paths, so we resolve from cssDir rather than buildCss.
      return { contents: lines.join("\n"), loader: "css", resolveDir: cssDir };
    });
  },
};

// ── Version banner ────────────────────────────────────────────────────────────
// Prefer the installed package version (foliplus.__version__, generated by
// setuptools-scm into foliplus/_version.py at install time), fall back to
// `git describe` (setuptools-scm derives the same value), then "unknown".
let versionCache = null;
const resolveVersion = () => {
  if (versionCache) return versionCache;
  const py = spawnSync(
    "python",
    ["-c", "import foliplus; print(foliplus.__version__)"],
    { encoding: "utf-8" },
  );
  if (py.status === 0 && py.stdout.trim()) {
    versionCache = py.stdout.trim();
    return versionCache;
  }
  const git = spawnSync("git", ["describe", "--tags", "--always", "--dirty"], {
    encoding: "utf-8",
  });
  if (git.status === 0 && git.stdout.trim()) {
    versionCache = git.stdout.trim();
    return versionCache;
  }
  versionCache = "unknown";
  return versionCache;
};
const BUILD_VERSION = resolveVersion();

// ── PostCSS pipeline ────────────────────────────────────────────
// CSS sources are authored in nested syntax (CSS Nesting) and compiled to
// flat selectors for maximum browser compatibility, then vendor-prefixed
// via Autoprefixer (driven by the `browserslist` key in package.json).
// `edition: '2021'` emits fully-flattened selectors (no `:is()` wrapper),
// keeping specificity identical to hand-written flat CSS.
const postcssProcessor = postcss([postcssNesting({ edition: "2021" }), autoprefixer()]);

/** esbuild onLoad plugin that runs CSS through the PostCSS pipeline.
 *  Scoped to the `file` namespace so the merged-CSS entry (which lives in
 *  the `merged-css` namespace) isn't intercepted and minified before the
 *  mergedCssEntryPlugin can rewrite it to an @import chain. */
const postcssPlugin = {
  name: "postcss",
  setup(build) {
    build.onLoad({ filter: /\.css$/, namespace: "file" }, async args => {
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
  // Tree Shaking: drop unused exports from shared modules.
  // Disabled for shared entry (it produces the shared code); enabled
  // for component bundles (they consume it via externalization).
  treeShaking: true,
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
  plugins: [postcssPlugin, sourceTransformPlugin],
};

/** Build one artifact's esbuild options. `plugins` lets callers (e.g. the
 *  merged-CSS entry or watch mode) inject extra plugins on top of the base set. */
const artifact = (entryPoints, outfile, name, plugins = []) => {
  const base = {
    entryPoints,
    outfile,
    ...esbuildCfg,
    // Tree Shaking: disabled for shared entry (produces shared code),
    // enabled for component bundles (drop unused shared exports).
    treeShaking: name === SHARED_ENTRY ? false : true,
    // P5: shared modules (#core/#common/#foliplus/BaseControl) are externalized
    // in component bundles and read from the global namespace; the shared entry
    // itself bundles them (no externalization).
    plugins: [
      ...(name === SHARED_ENTRY
        ? [...esbuildCfg.plugins, resolveSharedRegistryPlugin]
        : [...esbuildCfg.plugins, globalNamespacePlugin(srcDir)]),
      ...plugins,
    ],
    banner: {
      js: `/*! foliplus@${BUILD_VERSION} · ${name} */\n`,
      css: `/*! foliplus@${BUILD_VERSION} · ${name} */\n`,
    },
  };
  return base;
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
    if (jsFile)
      components.push({ name, js: jsFile, css: existsSync(cssFile) ? cssFile : null });
  }
  return components;
};

/** Shorthand for a path under dist/. */
const out = name => resolve(distDir, name);

/** Build the full list of esbuild artifacts (components + merged common CSS). */
const buildEntries = components => {
  const entries = [];
  for (const { name, js, css } of components) {
    // The shared entry is exposed as "common" so the filename
    // foliplus-common.min.js pairs with the CSS.
    const outName = name === SHARED_ENTRY ? "common" : name;
    entries.push(artifact([js], out(`foliplus-${outName}.min.js`), name));
    if (css) entries.push(artifact([css], out(`foliplus-${outName}.min.css`), name));
  }

  // Merge common.css + panel.css into a single artifact. The mergedCssEntryPlugin
  // turns the entry into a @import chain so both source files are real
  // dependencies — their changes trigger a rebuild in watch mode.
  if (existsSync(commonCssPath)) {
    mkdirSync(buildCss, { recursive: true });
    const entryCss = resolve(buildCss, MERGED_CSS_NAME);
    // The mergedCssEntryPlugin rewrites the entry's contents to an @import
    // chain, but esbuild still needs the entry file to exist to resolve it.
    // Write a harmless stub — the plugin replaces its contents at bundle time.
    writeFileSync(entryCss, "/* merged css entry; rewritten by plugin */", "utf-8");
    entries.push(
      artifact([entryCss], out("foliplus-common.min.css"), "common", [mergedCssEntryPlugin]),
    );
  }
  return entries;
};

/** Generate .build/js/_shared-registry.ts via external script.
 *  Auto-scans component imports for used exports (see scan-registry.mjs). */
const generateSharedRegistry = () => {
  const genResult = spawnSync(
    process.execPath,
    [resolve(__dirname, "scan-registry.mjs"), "--root", ROOT_RESOLVED, "--silent"],
    { stdio: "pipe", encoding: "utf-8" },
  );
  if (genResult.error) throw genResult.error;
  if (genResult.stderr) console.error(genResult.stderr);
  if (genResult.status !== 0) process.exit(genResult.status);
};

// ── Watch mode helpers ──────────────────────────────────────────
// esbuild's `context()` API gives us a long-lived build session that can
// be rebuilt on demand and watched for source changes. This lets us
// support `--watch` (dev hot-reload) without forking another process.

/** esbuild plugin that logs success/failure on each rebuild. esbuild 0.24
 *  has no `onRebuild` option, so `onEnd` (fires after every build, including
 *  watch-triggered rebuilds) is the mechanism. Errors only print a marker —
 *  esbuild's own logLine already prints the full error detail, so printing
 *  e.text here would double-write. Each artifact registers its own plugin
 *  with its outfile, so per-artifact status is reported. */
function rebuildLoggerPlugin(outfile) {
  return {
    name: "rebuild-logger",
    setup(build) {
      build.onEnd(result => {
        if (result.errors.length) console.error(`  ✗ ${basename(outfile)}`);
        else console.log(`  ✓ ${basename(outfile)}`);
      });
    },
  };
}

/** Run all artifact builds via the synchronous build() API (single-run mode).
 *  Returns the count of failed builds. */
async function runOnce(entries) {
  const results = await Promise.allSettled(entries.map(opts => build(opts)));
  let failed = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") console.log(`  ✓ ${basename(entries[i].outfile)}`);
    else {
      failed++;
      console.error(`  ✗ ${basename(entries[i].outfile)}: ${r.reason.message}`);
    }
  }
  return failed;
}

/** Run all artifacts through per-artifact esbuild contexts and watch for changes.
 *  Each context watches its own source tree independently; one `watch()` per
 *  context is reliable in esbuild 0.24. `onRebuild` doesn't exist in 0.24, so
 *  an `onEnd` plugin per artifact reports success/failure on each rebuild.
 *  Watch contexts set logLevel:"error" so esbuild's own output is limited to
 *  error detail; progress/✓ status is handled by the rebuildLoggerPlugin. */
async function runWatch(entries) {
  // esbuild reuses a single internal service; creating contexts in parallel
  // over-runs it and yields "The service is no longer running" errors.
  // We create them one at a time.
  const contexts = [];
  for (let i = 0; i < entries.length; i++) {
    const ctx = await context({
      ...entries[i],
      plugins: [...entries[i].plugins, rebuildLoggerPlugin(entries[i].outfile)],
      logLevel: "error",
    });
    contexts.push(ctx);
  }

  const disposeAll = async () => {
    for (const ctx of contexts) await ctx.dispose().catch(() => {});
  };

  let shuttingDown = false;
  const stop = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nStopping watcher...");
    disposeAll().then(() => process.exit(0)).catch(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  // One explicit rebuild() per artifact so dist/ outputs exist on first run
  // and errors surface immediately rather than being hidden until the first
  // edit. Done sequentially so the shared service isn't over-run. We don't
  // also log per-artifact status here because the rebuildLoggerPlugin's
  // onEnd handles it — a fatal rebuild() error is the only thing not caught
  // there, so we log that.
  for (let i = 0; i < entries.length; i++) {
    try {
      await contexts[i].rebuild();
    } catch (err) {
      console.error(`  ✗ ${basename(entries[i].outfile)}: ${err.message}`);
    }
  }

  console.log(`Watching for changes (${entries.length} artifacts) — press Ctrl+C to stop.`);
  // watch() returns a never-resolving promise; fork each off the stack so SIGINT
  // reaches the handler (an awaited never-resolving promise blocks signal delivery).
  // With logLevel:"error", a fatal watch() failure wouldn't surface, so we catch
  // and log it here with the artifact name.
  for (let i = 0; i < entries.length; i++) {
    contexts[i].watch().catch(err =>
      console.error(`  ✗ ${basename(entries[i].outfile)}: watch failed: ${err.message}`),
    );
  }
}

async function main() {
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
  const entries = buildEntries(components);
  console.log(
    `Building ${entries.length} artifacts for ${components.length} components...`,
  );

  // ── Step 4: esbuild bundle ────────────────────────────────────
  if (CFG.watch) {
    // Watch mode runs persistently, so skip the one-shot timer.
    await runWatch(entries);
    return;
  }

  console.time("build");
  const failed = await runOnce(entries);

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
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
