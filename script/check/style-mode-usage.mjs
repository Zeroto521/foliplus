#!/usr/bin/env node
/**
 * Read-only usage inventory: who still uses FILL_MODE / FillMode to represent
 * the style mode, and where.
 *
 * step 4 survey + migration-completeness gate. The fill and border
 * faces both consume the FILL_MODE vocabulary today (border.ts / strokeValue.ts
 * / persistence.ts's borderStyleMode branch), and the intent store key is
 * asymmetric: INTENT.FILL_MODE = "fillMode" vs INTENT.BORDER_STYLE_MODE =
 * "borderStyleMode". This script answers "who still uses FILL_MODE / FillMode"
 * and (in --check mode) asserts the migration is complete.
 *
 * Scope: production foliplus/js/**\*.ts only (tests and dist are out). Reads
 * only — it never writes and does not touch any occupied file (border.ts /
 * fill.ts / intent.ts are #1017 / the migration's own scope), so it
 * cannot conflict with in-flight work.
 *
 * Output (human, default):
 *   <file>:<line>: <kind> <text>
 * where kind is one of value / type / comment (see classifyLine), grouped by
 * face (border / fill / persistence / definition / other).
 *
 * Flags:
 *   --json        emit a machine-readable array (for before/after diff)
 *   --root <path> repo root to scan (default: process.cwd())
 *   --check       migration-completeness gate: exit 1 when any value or type
 *                 FILL_MODE / FillMode reference remains anywhere in
 *                 production. Comments are reported but not fatal. NOT wired
 *                 into CI yet — it becomes the step-3 PR's gate.
 *
 * ACCEPTANCE CRITERIA (the migration contract, per lead — these three numbers
 * are the step-3 acceptance standard, not just code):
 *   1. border group: value = 0 AND type = 0 after the split (border.ts and
 *      strokeValue.ts must stop consuming the FILL_MODE vocabulary; the
 *      border style mode gets its own BORDER_MODE = { SOLID, VALUE }).
 *   2. definition group: the 18 FILL_MODE / FillMode occurrences in intent.ts
 *      become STYLE_MODE's definition — the COUNT stays 18 (11 value + 6 type
 *      + 1 comment) while the NAME changes from FILL_MODE/FillMode to
 *      STYLE_MODE/StyleMode.
 *   3. persistence borderStyleMode branch: switches from the FILL_MODE
 *      literals to BORDER_MODE literals (and fillMode -> fillStyleMode key
 *      migration reads the old key and re-writes the new key only).
 *
 * Exit code: 0 normally; 1 in --check mode when the assertion fails.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The identifiers this inventory tracks (the vocabulary being migrated away). */
const WORD = /(?<![.\w])FILL_MODE\b|\bFillMode\b/;

/** Files where the border face consumes the fill vocabulary (the overflow). */
const BORDER_FILES = new Set([
  "foliplus/js/control/LayerControl/ui/style/border.ts",
  "foliplus/js/control/LayerControl/ui/style/strokeValue.ts",
]);

/** The fill face (the vocabulary's home) plus its value submodule. */
const FILL_FILES = new Set([
  "foliplus/js/control/LayerControl/ui/style/fill.ts",
  "foliplus/js/control/LayerControl/ui/style/fillValue.ts",
]);

/** The shared definition file (FILL_MODE const + FillMode type + keys). */
const DEFINITION_FILE = "foliplus/js/core/layer/intent.ts";

const PERSISTENCE_FILE = "foliplus/js/control/LayerControl/persistence.ts";

const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  ".venv",
  ".git",
  "coverage",
  ".agents",
]);

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith(".ts")) out.push(p);
  }
  return out;
};

/**
 * Classify a tracked token's occurrence on a line into value / type / comment.
 * Block-comment state is tracked across lines (a multi-line JSDoc is not code).
 * @param line source line
 * @param inBlock whether the line starts inside a block comment (between a slash-star pair)
 * @returns {{kinds: string[], inBlock: boolean}}
 */
const classifyLine = (line, inBlock) => {
  let codePart = line;
  let commentPart = "";
  let inBlockNow = inBlock;
  const kinds = [];
  let i = 0;
  while (i < codePart.length) {
    if (inBlockNow) {
      const end = codePart.indexOf("*/", i);
      if (end === -1) {
        commentPart += codePart.slice(i);
        codePart = codePart.slice(0, i);
        break;
      }
      commentPart += codePart.slice(i, end + 2);
      codePart = codePart.slice(0, i) + codePart.slice(end + 2);
      inBlockNow = false;
      continue;
    }
    const block = codePart.indexOf("/*", i);
    const lineC = codePart.indexOf("//", i);
    if (block === -1 && lineC === -1) break;
    if (lineC !== -1 && (block === -1 || lineC < block)) {
      commentPart += codePart.slice(lineC);
      codePart = codePart.slice(0, lineC);
      break;
    }
    const end = codePart.indexOf("*/", block);
    if (end === -1) {
      commentPart += codePart.slice(block);
      codePart = codePart.slice(0, block);
      inBlockNow = true;
      break;
    }
    commentPart += codePart.slice(block, end + 2);
    codePart = codePart.slice(0, block) + codePart.slice(end + 2);
    i = block;
  }
  if (new RegExp(WORD.source).test(codePart.replace(/\bFILL_MODE\s*:/g, ""))) {
    if (/\bFILL_MODE\s*\./.test(codePart) || /\bFILL_MODE\b/.test(codePart)) {
      if (/type\s+FillMode\b/.test(codePart)) kinds.push("type");
      else if (
        /:\s*FillMode|\|\s*FillMode|as\s*FillMode|<\s*FillMode\s*>|\bFillMode\s*[)\],]|\bFillMode\s*$/.test(
          codePart,
        )
      ) {
        kinds.push("type");
      } else {
        kinds.push("value");
      }
    } else if (/\bFillMode\b/.test(codePart)) {
      kinds.push("type");
    }
  }
  if (new RegExp(WORD.source).test(commentPart)) kinds.push("comment");
  return { kinds, inBlock: inBlockNow };
};

/** Resolve which face a file belongs to for grouping. */
const faceOf = rel => {
  if (BORDER_FILES.has(rel)) return "border";
  if (FILL_FILES.has(rel)) return "fill";
  if (rel === DEFINITION_FILE) return "definition";
  if (rel === PERSISTENCE_FILE) return "persistence";
  return "other";
};

/**
 * Inventory FILL_MODE / FillMode uses in the production source tree.
 * @param root repo root; production is scanned under <root>/foliplus/js.
 * @returns [{file, line, kind, face, text}]
 */
const inventory = (root = process.cwd()) => {
  const targets = walk(path.join(root, "foliplus", "js"));
  const hits = [];
  for (const file of targets) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    const face = faceOf(rel);
    let inBlock = false;
    lines.forEach((line, idx) => {
      const res = classifyLine(line, inBlock);
      inBlock = res.inBlock;
      if (!new RegExp(WORD.source).test(line)) return;
      for (const kind of res.kinds) {
        hits.push({
          file: rel,
          line: idx + 1,
          kind,
          face,
          text: line.trim().slice(0, 90),
        });
      }
    });
  }
  hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return hits;
};

/** Human-readable print grouped by face. */
const printHuman = hits => {
  const byFace = {};
  for (const h of hits) (byFace[h.face] ??= []).push(h);
  const order = ["border", "fill", "persistence", "definition", "other"];
  for (const face of order) {
    const group = byFace[face];
    if (!group) continue;
    console.log(`── ${face} ──`);
    for (const h of group) {
      console.log(`${h.file}:${h.line}: ${h.kind.padEnd(7)} ${h.text}`);
    }
  }
};

/**
 * Migration-completeness assertion. After the FILL_MODE -> STYLE_MODE /
 * BORDER_MODE split there must be no value or type FILL_MODE / FillMode
 * reference anywhere in production (the border group: 0 value + 0 type; the
 * persistence borderStyleMode branch: BORDER_MODE literals). Comments may
 * remain but are reported.
 * @returns {failing: boolean, perFace: Record<string, {value, type}>}
 */
const check = (root = process.cwd()) => {
  const hits = inventory(root);
  const perFace = {};
  for (const h of hits) {
    if (h.kind === "comment") continue;
    perFace[h.face] ??= { value: 0, type: 0 };
    perFace[h.face][h.kind] += 1;
  }
  const failing = Object.values(perFace).some(f => f.value > 0 || f.type > 0);
  return { failing, perFace };
};

/**
 * Strip comments from a line, tracking block-comment state across lines.
 * @param {string} line source line
 * @param {boolean} inBlock whether the line starts inside a block comment
 * @returns {{code: string, comment: string, inBlock: boolean}}
 */
const stripComments = (line, inBlock) => {
  let code = line;
  let comment = "";
  let inBlockNow = inBlock;
  let i = 0;
  while (i < code.length) {
    if (inBlockNow) {
      const end = code.indexOf("*/", i);
      if (end === -1) {
        comment += code.slice(i);
        code = code.slice(0, i);
        break;
      }
      comment += code.slice(i, end + 2);
      code = code.slice(0, i) + code.slice(end + 2);
      inBlockNow = false;
      continue;
    }
    const block = code.indexOf("/*", i);
    const lineC = code.indexOf("//", i);
    if (block === -1 && lineC === -1) break;
    if (lineC !== -1 && (block === -1 || lineC < block)) {
      comment += code.slice(lineC);
      code = code.slice(0, lineC);
      break;
    }
    const end = code.indexOf("*/", block);
    if (end === -1) {
      comment += code.slice(block);
      code = code.slice(0, block);
      inBlockNow = true;
      break;
    }
    comment += code.slice(block, end + 2);
    code = code.slice(0, block) + code.slice(end + 2);
    i = block;
  }
  return { code, comment, inBlock: inBlockNow };
};

/**
 * Legacy-alias assertion. The pre-rename key "fillMode" is a persistence
 * literal that must survive exactly once — the LEGACY_FILL_MODE_KEY
 * definition in persistence.ts (the single compat read point, consumed by
 * readLegacyFillMode and the provenance-normalization map). A second copy
 * or a dropped mapping means the migration is no longer single-sourced and
 * the one-way read can drift from the write. Comments are reported but not
 * fatal.
 * @returns {{failing: boolean, sites: {file: string, line: number, text: string, fatal: boolean}[]}}
 */
const legacyAliasCheck = (root = process.cwd()) => {
  const targets = walk(path.join(root, "foliplus", "js"));
  const allowedDef = /LEGACY_FILL_MODE_KEY\s*=\s*["']fillMode["']/;
  const sites = [];
  for (const file of targets) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    let inBlock = false;
    lines.forEach((line, idx) => {
      // Track block-comment state on EVERY line so a multi-line JSDoc is not
      // mistaken for code. This must run before the fillMode filter.
      const stripped = stripComments(line, inBlock);
      inBlock = stripped.inBlock;
      if (!/\bfillMode\b/.test(line)) return;
      if (/\bfillMode\b/.test(stripped.comment)) {
        sites.push({
          file: rel,
          line: idx + 1,
          text: line.trim().slice(0, 90),
          fatal: false,
        });
        return;
      }
      if (allowedDef.test(stripped.code)) {
        sites.push({
          file: rel,
          line: idx + 1,
          text: line.trim().slice(0, 90),
          fatal: false,
        });
        return;
      }
      sites.push({
        file: rel,
        line: idx + 1,
        text: line.trim().slice(0, 90),
        fatal: true,
      });
    });
  }
  const failing = sites.some(s => s.fatal);
  return { failing, sites };
};

const parseArgs = argv => {
  let json = false;
  let checkMode = false;
  let legacyAlias = false;
  let root = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") json = true;
    else if (argv[i] === "--check") checkMode = true;
    else if (argv[i] === "--check-legacy-alias") legacyAlias = true;
    else if (argv[i] === "--root" && argv[i + 1]) root = argv[++i];
  }
  return { json, checkMode, legacyAlias, root };
};

const main = (argv = process.argv.slice(2)) => {
  const { json, checkMode, legacyAlias, root } = parseArgs(argv);
  if (legacyAlias) {
    const { failing, sites } = legacyAliasCheck(root);
    console.log(JSON.stringify({ failing, sites }, null, 2));
    return failing ? 1 : 0;
  }
  if (checkMode) {
    const { failing, perFace } = check(root);
    console.log(JSON.stringify({ failing, perFace }, null, 2));
    return failing ? 1 : 0;
  }
  const hits = inventory(root);
  if (json) {
    console.log(JSON.stringify(hits, null, 2));
  } else {
    printHuman(hits);
  }
  return 0;
};

const runCli = entry => {
  if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(process.argv.slice(2));
  }
};
runCli(process.argv[1]);

const __entryUrl = fileURLToPath(import.meta.url);

export {
  check,
  classifyLine,
  inventory,
  legacyAliasCheck,
  main,
  runCli,
  walk,
  __entryUrl,
};
