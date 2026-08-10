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
 *   node script/build.mjs --check      # build then verify all artifacts exist (CI)
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
import { optimize } from "svgo";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "foliplus");
const JS_SRC = resolve(SRC, "js");
const CSS_SRC = resolve(SRC, "css");
const DIST = resolve(SRC, "dist");
const TMP = resolve(SRC, ".build");
const TMP_JS = resolve(TMP, "js");
const TMP_CSS = resolve(TMP, "css");
const MERGED_CSS_NAME = "_common_merged.css";

// ── Shared esbuild options for every bundled artifact ─────────────
const BASE_OPTS = {
  bundle: true,
  minify: true,
  sourcemap: true,
  allowOverwrite: true,
};
const artifact = (entryPoints, outfile) => ({
  entryPoints,
  outfile,
  ...BASE_OPTS,
});

// ── SVGO: compress SVG markup inside JS template literals ──────────
const svgRe =
  /`\s*(?:<div[^>]*>\s*<svg[\s\S]*?<\/svg>\s*<\/div>|<svg[\s\S]*?<\/svg>)\s*`/g;

const compressSvgStrings = (code) => {
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
        } catch {
          return match;
        }
      }
    }
    try {
      const result = optimize(raw, { multipass: true });
      return "`" + result.data + "`";
    } catch {
      return match;
    }
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
    if (existsSync(jsFile))
      components.push({ name, js: jsFile, css: existsSync(cssFile) ? cssFile : null });
  }
  return components;
};

const buildEntries = (components) => {
  const entries = [];
  // runtime.js is now an ES module entry — esbuild bundles it with all
  // runtime/*.js imports, identical to how component JS is bundled.
  const runtimeJs = resolve(TMP_JS, "runtime", "runtime.js");
  if (existsSync(runtimeJs)) {
    entries.push(artifact([runtimeJs], resolve(DIST, "runtime.min.js")));
  }

  const commonCssSrc = resolve(CSS_SRC, "common.css");
  const panelCssSrc = resolve(CSS_SRC, "panel.css");
  if (existsSync(commonCssSrc)) {
    let css = readFileSync(commonCssSrc, "utf-8");
    if (existsSync(panelCssSrc)) css += "\n" + readFileSync(panelCssSrc, "utf-8");
    // Write merged CSS to a temp file so esbuild minifies it as one artifact.
    mkdirSync(TMP_CSS, { recursive: true });
    const tmpCss = resolve(TMP_CSS, MERGED_CSS_NAME);
    writeFileSync(tmpCss, css, "utf-8");
    entries.push(artifact([tmpCss], resolve(DIST, "common.min.css")));
  }
  for (const { name, js, css } of components) {
    entries.push(artifact([js], resolve(DIST, `${name}.min.js`)));
    if (css) entries.push(artifact([css], resolve(DIST, `${name}.min.css`)));
  }
  return entries;
};

async function main() {
  const check = process.argv.includes("--check");

  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP_JS, { recursive: true });
  cpSync(JS_SRC, TMP_JS, { recursive: true });
  processJsFiles(TMP_JS);

  const components = findComponents();
  const entries = buildEntries(components);
  console.log(
    `Building ${entries.length} artifacts for ${components.length} components...`,
  );

  let failed = 0;
  for (const opts of entries) {
    try {
      await build(opts);
      console.log(`  ✓ ${basename(opts.outfile)}`);
    } catch (e) {
      failed += 1;
      console.error(`  ✗ ${basename(opts.outfile)}: ${e.message}`);
    }
  }

  if (check) {
    const missing = entries.map((e) => e.outfile).filter((f) => !existsSync(f));
    if (missing.length) {
      console.error(`Missing artifacts: ${missing.join(", ")}`);
      process.exit(1);
    }
    console.log(`All ${entries.length} artifacts present.`);
  }
  if (failed) process.exit(1);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
