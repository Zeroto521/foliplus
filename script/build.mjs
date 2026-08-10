#!/usr/bin/env node
/**
 * Build script — minify foliplus JS/CSS assets with esbuild.
 *
 * Pipeline:
 *   1. Mirror `foliplus/js/` → `foliplus/.build/`
 *   2. SVGO-compress SVG strings in every `.js`/`.ts` file under `.build/`
 *   3. html-minifier-terser: compress HTML template literals (innerHTML)
 *   4. esbuild-bundle runtime.js (resolves ES imports from runtime/*.js) to `dist/runtime.min.js`
 *   5. esbuild-bundle all components (resolving ES imports) to `foliplus/dist/`
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
// --dev skips minification so Python render-string tests can find
// JS identifiers like `foliplus.showHint` (minify renames locals).
const DEV = process.argv.includes("--dev");
const BASE_OPTS = {
  bundle: true,
  minify: !DEV,
  sourcemap: !DEV,
  allowOverwrite: true,
  keepNames: DEV,
  // Resolve #common/* aliases (used in JS source via package.json imports)
  // to the mirrored .build/ directory so SVGO-compressed files are used.
  alias: { "#common": resolve(TMP_JS, "common") },
};
const artifact = (entryPoints, outfile) => ({ entryPoints, outfile, ...BASE_OPTS });

// ── SVGO: compress SVG markup inside JS template literals ──────────
const svgRe =
  /`\s*(?:<div[^>]*>\s*<svg[\s\S]*?<\/svg>\s*<\/div>|<svg[\s\S]*?<\/svg>)\s*`/g;

const compressSvgStrings = code => {
  return code.replace(svgRe, match => {
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

// ── HTML minifier: compress innerHTML template literals ──────────
// Uses a character-level scanner to correctly handle nested backtick
// template literals (e.g. `${CONF.name}` inside the HTML template).
// Only processes templates that look like HTML (contain `<tag`).

const HTML_RE = /<[a-z][a-z0-9]*[\s>]/i;

/** Find the end of a template literal starting at `start` (the opening backtick).
 *  Returns the index of the closing backtick, or -1 if unterminated. */
const findTemplateEnd = (code, start) => {
  let i = start + 1;
  let depth = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === "`" && depth === 0) return i;
    if (ch === "$" && code[i + 1] === "{" && depth === 0) {
      depth = 1;
      i += 2;
    } else if (depth > 0) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    } else {
      i++;
    }
  }
  return -1;
};

/** Synchronous HTML whitespace compression.
 *  Collapses multi-line whitespace: newlines → single space, > < → ><. */
const collapseHtml = html =>
  html
    .replace(/\n\s*/g, " ")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim();

/** Compress HTML-looking template literals in source code. */
const compressHtmlStrings = code => {
  const result = [];
  let i = 0;
  while (i < code.length) {
    if (code[i] === "`") {
      const end = findTemplateEnd(code, i);
      if (end === -1) {
        result.push(code.slice(i));
        break;
      }
      const raw = code.slice(i + 1, end);
      if (HTML_RE.test(raw)) {
        result.push("`" + collapseHtml(raw) + "`");
      } else {
        result.push(code.slice(i, end + 1));
      }
      i = end + 1;
    } else {
      result.push(code[i]);
      i++;
    }
  }
  return result.join("");
};

const processJsFiles = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) processJsFiles(full);
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".ts")) {
      let code = readFileSync(full, "utf-8");
      code = compressSvgStrings(code);
      code = compressHtmlStrings(code);
      writeFileSync(full, code, "utf-8");
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
    // Entry may be `.js` (legacy) or `.ts` (migrated) — prefer `.ts`.
    const jsFile =
      [resolve(TMP_JS, name, `${name}.ts`), resolve(TMP_JS, name, `${name}.js`)].find(
        existsSync,
      ) ?? null;
    const cssFile = resolve(CSS_SRC, `${name}.css`);
    if (jsFile)
      components.push({ name, js: jsFile, css: existsSync(cssFile) ? cssFile : null });
  }
  return components;
};

const buildEntries = components => {
  const entries = [];
  // runtime.js is now an ES module entry — esbuild bundles it with all
  // runtime/*.js imports, identical to how component JS is bundled.
  const runtimeJs =
    [
      resolve(TMP_JS, "runtime", "runtime.ts"),
      resolve(TMP_JS, "runtime", "runtime.js"),
    ].find(existsSync) ?? null;
  if (runtimeJs) entries.push(artifact([runtimeJs], resolve(DIST, "runtime.min.js")));

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
