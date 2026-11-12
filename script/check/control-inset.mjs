#!/usr/bin/env node
/**
 * Guard: the control horizontal inset has exactly one source.
 *
 * .foliplus-input-skin owns the single horizontal text inset of the input
 * family: `padding: 0 var(--foliplus-ctrl-inset-x)` (form.css). A readout
 * box and the select it replaces start their text at the same x only while
 * every left-aligned control resolves its left inset from THAT token — a
 * second declaration of --foliplus-ctrl-inset-x, or a per-control left padding
 * that names a literal (space-md etc.) instead of the token, re-misaligns the
 * column when the token is edited.
 *
 * Invariants (all on foliplus/css/common/form.css):
 *   1. --foliplus-ctrl-inset-x appears in exactly ONE declaration, and it is
 *      the .foliplus-input-skin padding shorthand.
 *   2. .foliplus-form-select declares no left padding (no padding-left and no
 *      4-value padding shorthand). Its arrow side keeps padding-right; the
 *      left inset falls through to the skin. This is what makes the token the
 *      single source instead of a second copy.
 *
 * The compact number field is intentionally exempt: it is centered, so its
 * text-start is not an alignment point (see the task design). The scheme
 * trigger (bar) and SearchControl input are outside the input family.
 *
 * Usage: `node script/check/control-inset.mjs [root]`
 *   Prints each violation as `file:line: text` and exits 1 when any are found.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FORM_CSS = "foliplus/css/common/form.css";
const TOKEN = "--foliplus-ctrl-inset-x";
const SKIN_SELECTOR = ".foliplus-input-skin";
const SELECT_SELECTOR = ".foliplus-form-select";

/** Split a CSS file into rules: [{ selector, startLine, declLines: [{line,text}] }]. */
const parseRules = src => {
  const lines = src.split(/\r?\n/);
  const rules = [];
  let cur = null;
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Strip /* ... */ comments (track across lines).
    if (inComment) {
      if (trimmed.includes("*/")) inComment = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inComment = true;
      continue;
    }
    if (trimmed.endsWith("{")) {
      cur = { selector: trimmed.slice(0, -1).trim(), startLine: i + 1, decls: [] };
      rules.push(cur);
      continue;
    }
    if (trimmed === "}") {
      cur = null;
      continue;
    }
    if (cur && trimmed && !trimmed.startsWith("//")) {
      cur.decls.push({ line: i + 1, text: trimmed });
    }
  }
  return rules;
};

/** The declaration text that actually sets a left inset (padding shorthand or padding-left). */
const leftInsetDecls = decls => decls.filter(d => /^padding(-left)?\s*:/.test(d.text));

/** Does a padding declaration name the given var? (1-value/2-value shorthands
 *  set both sides; 4-value sets left = 4th.) */
const paddingNamesVar = (text, name) => {
  const values = text
    .replace(/^padding(-left)?\s*:/, "")
    .replace(/;\s*$/, "")
    .trim();
  return values.includes(name);
};

/** Find the single-source violations in form.css. Returns [{file,line,text}]. */
const findControlInsetViolations = (root = process.cwd()) => {
  const file = path.join(root, FORM_CSS);
  if (!fs.existsSync(file)) {
    return [{ file: FORM_CSS, line: 0, text: "form.css not found" }];
  }
  const rules = parseRules(fs.readFileSync(file, "utf8"));
  const hits = [];

  // Invariant 1: exactly ONE declaration names the token, and it is the skin.
  const tokenConsumers = [];
  for (const rule of rules) {
    for (const d of rule.decls) {
      if (d.text.includes(`var(${TOKEN})`)) {
        tokenConsumers.push({ rule, decl: d });
      }
    }
  }
  if (tokenConsumers.length !== 1) {
    for (const c of tokenConsumers) {
      hits.push({
        file: FORM_CSS,
        line: c.decl.line,
        text:
          "control inset token consumed here; expected exactly one consumer " +
          "(the .foliplus-input-skin padding shorthand)",
      });
    }
    if (tokenConsumers.length === 0) {
      hits.push({
        file: FORM_CSS,
        line: 0,
        text: "control inset token has no consumer — .foliplus-input-skin must own it",
      });
    }
  } else {
    const [only] = tokenConsumers;
    if (!only.rule.selector.includes(SKIN_SELECTOR)) {
      hits.push({
        file: FORM_CSS,
        line: only.decl.line,
        text: `control inset token consumed by a rule other than ${
          SKIN_SELECTOR
        } — the skin must be the single source`,
      });
    }
  }

  // Invariant 2: form-select declares no literal left padding.
  const selectRule = rules.find(r => r.selector.includes(SELECT_SELECTOR));
  if (selectRule) {
    for (const d of leftInsetDecls(selectRule.decls)) {
      // A 4-value shorthand with a literal left, or any padding-left naming a
      // literal space, re-introduces a second left-inset source.
      if (d.text.includes("padding-left") || paddingNamesVar(d.text, "space-md")) {
        hits.push({
          file: FORM_CSS,
          line: d.line,
          text:
            `${
              SELECT_SELECTOR
            } declares its own left inset — the left padding must fall through ` +
            `to the skin token (${TOKEN})`,
        });
      }
    }
  }

  return hits;
};

/** CLI entry — only when executed directly, never when a test imports this. */
const main = (root = process.cwd()) => {
  const hits = findControlInsetViolations(root);
  for (const h of hits) {
    console.log(h.line > 0 ? `${h.file}:${h.line}: ${h.text}` : `${h.file}: ${h.text}`);
  }
  return hits.length === 0 ? 0 : 1;
};

const runCli = (argv, entry) => {
  if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(argv[0]);
  }
};
runCli(process.argv.slice(2), process.argv[1]);

const __entryUrl = fileURLToPath(import.meta.url);

export {
  findControlInsetViolations,
  main,
  runCli,
  __entryUrl,
  parseRules,
  leftInsetDecls,
};
