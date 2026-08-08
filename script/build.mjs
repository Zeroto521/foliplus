#!/usr/bin/env node
/**
 * Build script — minify foliplus JS/CSS assets with esbuild.
 *
 * Pipeline:
 *   1. Mirror `foliplus/js/` → `foliplus/.build/`
 *   2. SVGO-compress SVG strings in every `.js` file under `.build/`
 *   3. esbuild-bundle runtime.js (resolves ES imports from runtime/*.js) to `dist/runtime.min.js`
 *   4. esbuild-bundle all components (resolving ES imports) to `foliplus/dist/`
 *
 * Usage:
 *   node script/build.mjs              # build all
 *   node script/build.mjs --watch      # watch mode
 *   node script/build.mjs --check      # verify artifacts exist (CI)
 */

import { build } from "esbuild";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  rmSync,
} from "fs";
import { basename, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { optimize } from "svgo";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "foliplus");
const JS_SRC = resolve(SRC, "js");
const CSS_SRC = resolve(SRC, "css");
const DIST = resolve(SRC, "dist");
const TMP = resolve(SRC, ".build");
const TMP_JS = resolve(TMP, "js");

// ── SVGO: compress SVG markup inside JS template literals ──────────
const compressSvgStrings = (code) => {
  // Match SVG template literals, with or without a <div> wrapper
  const svgRe = new RegExp("`\\s*(?:<div[\\s\\S]*?<\\/div>|<svg[\\s\\S]*?<\\/svg>)\\s*`", "g");
  return code.replace(svgRe, (match) => {
    const raw = match.replace(/^`\s*/, "").replace(/\s*`$/, "");
    // If wrapped in a <div>, extract the <svg> part, optimize it, then rewrap
    const divMatch = raw.match(/^(<div[^>]*>)\s*([\s\S]*?)\s*(<\/div>)$/);
    if (divMatch) {
      const [, openTag, inner, closeTag] = divMatch;
      const svgMatch = inner.match(/<svg[\s\S]*?<\/svg>/);
      if (svgMatch) {
        try {
          const result = optimize(svgMatch[0], { multipass: true });
          return "`" + openTag + result.data + closeTag + "`";
        } catch { return match; }
      }
    }
    try {
      const result = optimize(raw, { multipass: true });
      return "`" + result.data + "`";
    } catch { return match; }
  });
};

const processJsFiles = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) processJsFiles(full);
    else if (entry.name.endsWith(".js")) {
      const code = readFileSync(full, "utf-8");
      writeFileSync(full, compressSvgStrings(code), "utf-8");
    }
  }
};

const findComponents = () => {
  const entries = readdirSync(TMP_JS, { withFileTypes: true });
  const components = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "runtime" || entry.name === "shared") continue;
    const name = entry.name;
    const jsFile = resolve(TMP_JS, name, `${name}.js`);
    const cssFile = resolve(CSS_SRC, `${name}.css`);
    if (existsSync(jsFile)) {
      components.push({ name, js: jsFile, css: existsSync(cssFile) ? cssFile : null });
    }
  }
  return components;
};

const buildEntries = (components) => {
  const entries = [];
  // runtime.js is now an ES module entry — esbuild bundles it with all
  // runtime/*.js imports, identical to how component JS is bundled.
  if (existsSync(resolve(TMP_JS, "runtime", "runtime.js"))) {
    entries.push({
      entryPoints: [resolve(TMP_JS, "runtime", "runtime.js")],
      outfile: resolve(DIST, "runtime.min.js"),
      bundle: true,
      minify: true,
      sourcemap: true,
      allowOverwrite: true,
    });
  }
  const sharedCss = [
    { dir: CSS_SRC, in: "common.css", out: "common.min" },
    { dir: CSS_SRC, in: "panel.css", out: "panel.min" },
  ];
  for (const { dir, in: input, out } of sharedCss) {
    const src = resolve(dir, input);
    if (!existsSync(src)) continue;
    entries.push({
      entryPoints: [src],
      outfile: resolve(DIST, out + ".css"),
      minify: true,
      sourcemap: true,
      allowOverwrite: true,
    });
  }
  for (const { name, js, css } of components) {
    entries.push({
      entryPoints: [js],
      outfile: resolve(DIST, `${name}.min.js`),
      bundle: true,
      minify: true,
      sourcemap: true,
      allowOverwrite: true,
    });
    if (css) {
      entries.push({
        entryPoints: [css],
        outfile: resolve(DIST, `${name}.min.css`),
        minify: true,
        sourcemap: true,
        allowOverwrite: true,
      });
    }
  }
  return entries;
};

async function main() {
  const isWatch = process.argv.includes("--watch");

  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP_JS, { recursive: true });
  cpSync(JS_SRC, TMP_JS, { recursive: true });
  processJsFiles(TMP_JS);

  const components = findComponents();
  const entries = buildEntries(components);
  console.log(`Building ${entries.length} artifacts for ${components.length} components...`);

  for (const opts of entries) {
    try {
      await build(opts);
      console.log(`  ✓ ${basename(opts.outfile)}`);
    } catch (e) {
      console.error(`  ✗ ${basename(opts.outfile)}: ${e.message}`);
    }
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
