#!/usr/bin/env node
/**
 * Build script — minify foliplus JS/CSS assets with esbuild.
 *
 * Pipeline:
 *   1. Mirror ``foliplus/js/`` → ``foliplus/.build/``
 *   2. SVGO-compress SVG strings + minify HTML template literals (via ``script/compress.mjs``)
 *   3. esbuild-bundle each component → ``dist/{Name}.min.js`` + ``.min.css``
 *   4. Merge ``common.css`` + ``panel.css`` → ``dist/common.min.css``
 *
 * Usage:
 *   node script/build.mjs              # build all (minified)
 *   node script/build.mjs --dev        # unminified, keepNames (for PY identifier tests)
 *   node script/build.mjs --check      # build and verify all artifacts exist
 */
import { build } from "esbuild";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { basename, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { transformSource } from "./compress.mjs";

// ── Config ──────────────────────────────────────────────────────
// Central path/flag config. `dev` toggles minification & identifier
// preservation — Python render-string tests rely on `keepNames` finding
// `foliplus.showHint` etc. in unminified bundles.
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CFG = {
  src: {
    js: resolve(ROOT, "foliplus/js"),
    css: resolve(ROOT, "foliplus/css"),
  },
  out: {
    dist: resolve(ROOT, "foliplus/dist"),
  },
  tmp: {
    js: resolve(ROOT, "foliplus/.build/js"),
    css: resolve(ROOT, "foliplus/.build/css"),
  },
  mergedCssName: "_common_merged.css",
  dev: process.argv.includes("--dev"),
  check: process.argv.includes("--check"),
};

// ── Shared esbuild options ──────────────────────────────────────
// `alias` maps `#common/*` to the processed `.build/` copy so compressed
// sources are bundled (not the raw `foliplus/js` originals).
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
  alias: { "#common": CFG.tmp.js + "/common" },
};

const artifact = (entryPoints, outfile) => ({ entryPoints, outfile, ...esbuildCfg });

/** Recursively apply source transforms (SVGO + HTML minify) to every JS/TS file. */
const processJsFiles = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) processJsFiles(full);
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".ts"))
      writeFileSync(full, transformSource(readFileSync(full, "utf-8")), "utf-8");
  }
};

/** Return the first path that exists, else null. */
const resolveEntry = candidates => candidates.find(existsSync) ?? null;

/** Discover component entries (dirs with a matching `{Name}.{ts|js}`) under .build/. */
const findComponents = () => {
  const entries = readdirSync(CFG.tmp.js, { withFileTypes: true });
  const components = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "shared") continue; // not a control component
    const name = entry.name;
    const jsFile = resolveEntry([
      resolve(CFG.tmp.js, name, `${name}.ts`),
      resolve(CFG.tmp.js, name, `${name}.js`),
    ]);
    const cssFile = resolve(CFG.src.css, `${name}.css`);
    if (jsFile)
      components.push({ name, js: jsFile, css: existsSync(cssFile) ? cssFile : null });
  }
  return components;
};

/** Shorthand for a path under dist/. */
const out = name => resolve(CFG.out.dist, name);

/** Build the full list of esbuild artifacts (components + merged common CSS). */
const buildEntries = components => {
  const entries = [];
  for (const { name, js, css } of components) {
    entries.push(artifact([js], out(`${name}.min.js`)));
    if (css) entries.push(artifact([css], out(`${name}.min.css`)));
  }

  // Merge common.css + panel.css into a single artifact
  const commonCss = resolve(CFG.src.css, "common.css");
  const panelCss = resolve(CFG.src.css, "panel.css");
  if (existsSync(commonCss)) {
    let css = readFileSync(commonCss, "utf-8");
    if (existsSync(panelCss)) css += "\n" + readFileSync(panelCss, "utf-8");
    mkdirSync(CFG.tmp.css, { recursive: true });
    const tmpCss = resolve(CFG.tmp.css, CFG.mergedCssName);
    writeFileSync(tmpCss, css, "utf-8");
    entries.push(artifact([tmpCss], out("common.min.css")));
  }
  return entries;
};

async function main() {
  // ── Step 1: Mirror source to .build/ ──────────────────────────
  // Process in a temp directory so the original source is untouched.
  rmSync(resolve(CFG.tmp.js, ".."), { recursive: true, force: true });
  mkdirSync(CFG.tmp.js, { recursive: true });
  cpSync(CFG.src.js, CFG.tmp.js, { recursive: true });

  // ── Step 2: Source transforms ─────────────────────────────────
  // SVG compression + HTML template minification (in-place on .build/ copy).
  processJsFiles(CFG.tmp.js);

  // ── Step 3: Discover components & build entries ───────────────
  const components = findComponents();
  const entries = buildEntries(components);
  console.log(
    `Building ${entries.length} artifacts for ${components.length} components...`,
  );

  // ── Step 4: esbuild bundle (parallel) ─────────────────────────
  const results = await Promise.allSettled(entries.map(opts => build(opts)));
  const failed = results.filter(r => r.status === "rejected").length;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") console.log(`  ✓ ${basename(entries[i].outfile)}`);
    else console.error(`  ✗ ${basename(entries[i].outfile)}: ${r.reason.message}`);
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
  console.log("Done.");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
