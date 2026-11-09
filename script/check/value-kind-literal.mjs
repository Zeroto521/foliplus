#!/usr/bin/env node
/**
 * Guard: bare VALUE_KIND literal drift over the by-value style surface.
 *
 * The by-value config kind is a persisted vocabulary: `kind: "numeric"` /
 * `kind: "category"` select the ramp arms and are stored in the record, so
 * they must never be spelled at a call site in a way that can drift from
 * VALUE_KIND (core/valueKind.ts). A typo at a call site would silently
 * misread or miswrite a persisted record.
 *
 * Scope: production `foliplus/js/**\*.ts` ONLY (tests simulate persisted
 * records with literals and are excluded). The guard detects the kind
 * literals only where they are a RUNTIME value:
 *   - object property assignment `{ kind: "numeric" }`
 *   - comparison `x.kind === "category"` / `x.kind !== "numeric"`
 *   - nullish fallback `x.kind ?? "numeric"`
 *   - switch case `case "numeric"` on a `.kind` discriminator
 * Type positions (`kind: "category"` in a `type` union — the ValueConfig
 * discriminated-union contract) are NOT runtime values and are ignored.
 *
 * Exclusions (separate vocabularies, not VALUE_KIND):
 *   - `filterFeature.ts` FieldKind (`"numeric" | "string" | "boolean"`) —
 *     a FILTER field vocabulary, not the by-value ramp kind.
 *   - FILL_MODE / ICON_KIND values — style-mode / icon-kind vocabularies.
 *     These are NOT excluded by a code path: the guard's literal set is only
 *     { 'numeric', 'category' } (VALUE_KIND), so FILL_MODE values
 *     ('solid' / 'value' / 'original') are a DIFFERENT literal set the guard
 *     never scans. When task-41 renames FILL_MODE to STYLE_MODE, decide
 *     separately whether the style-mode vocabulary also needs a drift guard;
 *     if it does, that is a new literal set to scan (or a second guard), not
 *     the removal of an existing exclusion. Do not claim a FILL_MODE
 *     exclusion exists here that the code does not implement.
 *
 * Whitelist: `core/valueKind.ts` itself (it DEFINES the constant).
 *
 * Usage: `node script/check/value-kind-literal.mjs [root]`
 *   Prints each violation as `file:line: text` and exits 1 when any are found.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** The two ramp-arm kind literals that belong to VALUE_KIND. */
const KIND_LITERALS = new Set(["numeric", "category"]);

/** Files with a DIFFERENT kind vocabulary (never VALUE_KIND drift). */
const EXCLUDE_FILES = new Set(["foliplus/js/core/layer/filterFeature.ts"]);

/** Files that may legitimately hold the literals (they define the constant). */
const WHITELIST_FILES = new Set(["foliplus/js/core/valueKind.ts"]);

const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  ".venv",
  ".git",
  "coverage",
  ".agents",
]);

/** Walk a directory and return source files (`.ts`), skipping build dirs. */
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

/** Is `node` a property/element access on a `.kind` member? */
const isKindAccess = node => {
  if (ts.isPropertyAccessExpression(node)) return node.name.text === "kind";
  if (ts.isElementAccessExpression(node)) {
    const a = node.argumentExpression;
    return !!a && ts.isStringLiteral(a) && a.text === "kind";
  }
  return false;
};

/**
 * Find bare VALUE_KIND literals in the production source tree.
 * @param root repo root; production is scanned under `<root>/foliplus/js`.
 * @returns [{file, line, text, context}] — `file` is repo-relative.
 */
const findBareValueKindLiterals = (root = process.cwd()) => {
  const targets = walk(path.join(root, "foliplus", "js"));
  const hits = [];
  for (const file of targets) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (EXCLUDE_FILES.has(rel) || WHITELIST_FILES.has(rel)) continue;
    const content = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(
      rel,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const visit = node => {
      if (ts.isStringLiteral(node) && KIND_LITERALS.has(node.text)) {
        const p = node.parent;
        // Type positions (the ValueConfig discriminated-union contract) are
        // not runtime values.
        if (p && p.kind === ts.SyntaxKind.LiteralType) return;
        // Object property: { kind: "numeric" }
        if (
          p &&
          ts.isPropertyAssignment(p) &&
          ts.isIdentifier(p.name) &&
          p.name.text === "kind"
        ) {
          hits.push({
            file: rel,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            text: node.text,
            context: "property",
          });
          return;
        }
        // Comparison / nullish: x.kind === "category" | x.kind ?? "numeric"
        const OP_KINDS = new Set([
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ]);
        if (p && ts.isBinaryExpression(p) && OP_KINDS.has(p.operatorToken.kind)) {
          const other = p.left === node ? p.right : p.left;
          if (isKindAccess(other)) {
            hits.push({
              file: rel,
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              text: node.text,
              context: "binary",
            });
            return;
          }
        }
        // Switch case: switch (x.kind) { case "numeric": ... }
        if (p && ts.isCaseClause(p) && p.expression === node) {
          hits.push({
            file: rel,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            text: node.text,
            context: "case",
          });
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return hits;
};

/** CLI entry — only when executed directly, never when a test imports this. */
const main = (root = process.cwd()) => {
  const hits = findBareValueKindLiterals(root);
  for (const h of hits) {
    console.log(
      `${h.file}:${h.line}: bare "${h.text}" kind literal — use VALUE_KIND.${h.text.toUpperCase()}`,
    );
  }
  return hits.length === 0 ? 0 : 1;
};

const runCli = (argv, entry) => {
  if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(argv[0]);
  }
};
runCli(process.argv.slice(2), process.argv[1]);

export { findBareValueKindLiterals, main, walk };
