#!/usr/bin/env node
// script/check/form-class-literal — form class tokens appear only in their vocabulary file, so a rename cannot leave a site un-styled
/**
 * Guard: bare FORM_CLASS literal drift over the shared form-input vocabulary.
 *
 * The two class names foliplus-input-skin and foliplus-form-select are a
 * persisted DOM contract (the shared input/select chrome across the
 * HeatmapControl template, LayerControl style rows, core/label, and the ui
 * primitives). A caller that spells either literal by hand can drift from
 * FORM_CLASS (ui/formClassName.ts) — a rename in the vocabulary would leave
 * a hand-spelled site silently un-styled. This guard asserts the two tokens
 * appear ONLY in the vocabulary file that defines them.
 *
 * Scope: production foliplus/js/** / *.ts ONLY (tests simulate DOM with
 * literals and are excluded; CSS files under foliplus/css are a different
 * tree and out of scope). Exclusions:
 *   - the vocabulary file itself (it DEFINES the constants);
 *   - comments (stripped before matching);
 *   - data-* attribute values (data-heatmap-* etc. may carry a class
 *     value through the HTML template);
 *   - CSS custom-property references (--foliplus-*), which are variable
 *     names, not class selectors.
 *
 * The match carries a trailing word boundary, so foliplus-input-skinX or a
 * longer foliplus-input-skin-extra class does not count as the token.
 *
 * Whitelist: foliplus/js/ui/formClassName.ts.
 *
 * Usage: node script/check/form-class-literal.mjs [root]
 *   Prints each violation as file:line: text and exits 1 when any are found.
 *
 * The tree walk and comment stripping are the shared primitives from
 * script/check/lib/source-scan.mjs, so this guard and its siblings read the
 * source identically.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectSources, stripComments } from "./lib/source-scan.mjs";

/** The two shared form-input tokens that belong to FORM_CLASS. */
const FORM_CLASS_TOKENS = new Set(["foliplus-input-skin", "foliplus-form-select"]);

/** The vocabulary file that owns the tokens (never a drift site). */
const WHITELIST_FILE = "foliplus/js/ui/formClassName.ts";

const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  ".venv",
  ".git",
  "coverage",
  ".agents",
]);

/** Strip data-*="..." attribute values (they may carry a class value). */
const stripDataAttrs = line => line.replace(/\sdata-[a-z0-9-]+="[^"]*"/gi, "");

/** Strip CSS custom-property references (--foliplus-*) — variable names. */
const stripCssVars = line => line.replace(/--[a-z0-9-]+/gi, "");

/** Does line carry the token as a bare whole-word literal? */
const hasBareToken = (line, token) => {
  const cleaned = stripCssVars(stripDataAttrs(line));
  // Leading boundary: not preceded by a word char (so xfoliplus-input-skin
  // does not count). Trailing boundary: not followed by a word char or a
  // hyphen (so foliplus-input-skin-extra does not count as the token).
  const re = new RegExp(`(?<![A-Za-z0-9_])${token}(?![A-Za-z0-9_-])`);
  return re.test(cleaned);
};

/**
 * Find bare FORM_CLASS literals in the production source tree.
 * @param root repo root; production is scanned under <root>/foliplus/js.
 * @returns [{file, line, text}] — file is repo-relative.
 */
const findBareFormClassLiterals = (root = process.cwd()) => {
  const targets = collectSources(path.join(root, "foliplus", "js"), { skipDirs: SKIP_DIR });
  const hits = [];
  for (const file of targets) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (rel === WHITELIST_FILE) continue;
    const src = stripComments(fs.readFileSync(file, "utf8"));
    const lines = src.split(/\r?\n/);
    for (const [i, line] of lines.entries()) {
      for (const token of FORM_CLASS_TOKENS) {
        if (hasBareToken(line, token)) {
          hits.push({ file: rel, line: i + 1, text: line.trim().slice(0, 90) });
        }
      }
    }
  }
  return hits;
};

/** CLI entry — only when executed directly, never when a test imports this. */
const main = (root = process.cwd()) => {
  const hits = findBareFormClassLiterals(root);
  for (const h of hits) {
    console.log(
      `${h.file}:${h.line}: bare class literal "\${h.text}\" \u2014 use FORM_CLASS`
    );
  }
  return hits.length === 0 ? 0 : 1;
};

const runCli = (argv, entry, selfUrl = fileURLToPath(import.meta.url)) => {
  if (entry !== undefined && path.resolve(entry) === selfUrl) {
    process.exitCode = main(argv[0] || process.cwd());
  }
};

export { findBareFormClassLiterals, hasBareToken, main, runCli };
