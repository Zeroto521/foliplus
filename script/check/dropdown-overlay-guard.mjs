#!/usr/bin/env node
// script/check/dropdown-overlay-guard — the dropdown overlay stays required and supplied, so no second Escape dispatcher appears
/**
 * Guard: createDropdown overlay must be supplied and typed required.
 *
 * The shared dropdown closes its open list through the per-map overlay
 * registry (the single Escape/outside-press dispatcher). A call site that
 * omits `overlay` would silently bind its own document/window keydown —
 * a second Escape dispatcher competing with the registry (the bug class
 * #1011 and #1030 closed). The type contract must therefore never be
 * optional, and every createDropdown call must supply it.
 *
 * Scope: production `foliplus/js/**\/*.ts` ONLY (tests simulate registries
 * with stub overlays and are excluded). The guard detects:
 *   - a createDropdown call whose object literal has no `overlay:` property
 *     (a spread may supply it, but the property is the common contract);
 *   - an `overlay?:` optional-typed property anywhere in production (a
 *     type position that would let a caller omit the hook);
 *   - the conditional-spread idiom `...(x.overlay ? { overlay: x.overlay } : {})`
 *     (an optional hook re-encoded as a runtime conditional).
 *
 * Declaration sites: `ui/dropdown.ts` (defines DropdownOptions.overlay as
 * required) and `core/label/labelControl.ts` / `core/value/rampForm.ts` (the
 * three interfaces the design makes required). These are skipped; the guard
 * checks every OTHER production file.
 *
 * Usage: `node script/check/dropdown-overlay-guard.mjs [root]`
 *   Prints each violation as `file:line: text` and exits 1 when any are found.
 */
// The one comment stripper in script/check (exported by the locale-key gate);
// do not grow a second copy. It is line-based on purpose: a scanner aid, never
// a substitute for the AST below.
import { stripComments } from "./scan-locale-key.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** Files that declare the overlay contract (required, not violations). */
const DECLARE_FILES = new Set([
  "foliplus/js/ui/dropdown.ts",
  "foliplus/js/core/label/labelControl.ts",
  "foliplus/js/core/value/rampForm.ts",
]);

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
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith(".ts")) out.push(p);
  }
  return out;
};

/** Decode \uXXXX escapes so a callee spelled `create\u0044ropdown` is
 *  prefiltered exactly as the parser will see it (`createDropdown`). */
const normalizeUnicodeEscapes = src =>
  src.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );

/** An `overlay` optional marker that may be separated from the `?` by
 *  whitespace or a comment (`overlay /* gap *\/ ?: unknown`). */
const OVERLAY_OPTIONAL_WITH_COMMENTS =
  /overlay(?:(?:\s+|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)*)\?/;

/** Whether a source can hold one of the three violations.
 *
 *  The prefilter must be a SUPERSET of the AST findings, never a heuristic
 *  that decides them: the reviewer of #1427 showed that a plain
 *  `content.includes(...)` check silently dropped a comment-gapped
 *  `overlay /* gap *\/ ?` and a unicode-escaped `create\u0044ropdown`.
 *  So:
 *  - `createDropdown` / `create\u0044ropdown` is matched on the raw text with
 *    escapes decoded (an identifier can never be split by a comment);
 *  - the `overlay ?` token is matched across comments in the raw text, and
 *    again on the comment-stripped text (the shared stripper is line-based, so
 *    a `//` inside a string can swallow the rest of a line — the raw check
 *    covers that, the stripped one covers the plain comment gap).
 *  A file failing all checks cannot hold a violation. */
const canHoldViolation = src => {
  const text = normalizeUnicodeEscapes(src);
  if (text.includes("createDropdown")) return true;
  if (OVERLAY_OPTIONAL_WITH_COMMENTS.test(text)) return true;
  const stripped = normalizeUnicodeEscapes(stripComments(src));
  return stripped.includes("createDropdown") || /overlay\s*\?/.test(stripped);
};

/** Whether a call expression is `createDropdown(...)`. */
const isCreateDropdownCall = node => {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === "createDropdown";
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text === "createDropdown";
  }
  return false;
};

/** Whether an object literal has an `overlay` property assignment. */
const hasOverlayProperty = obj =>
  // Caller narrows to an object literal before invoking, so properties is
  // always present; the direct .some() keeps the contract without a dead
  // optional-chain fallback branch.
  obj.properties.some(p => {
    if (ts.isPropertyAssignment(p)) {
      const name = p.name;
      return ts.isIdentifier(name) && name.text === "overlay";
    }
    if (ts.isShorthandPropertyAssignment(p)) return p.name.text === "overlay";
    return false;
  });

/**
 * Find overlay-contract violations in the production source tree.
 * @param root repo root; production is scanned under `<root>/foliplus/js`.
 * @returns [{file, line, text, context}]
 */
const findOverlayContractViolations = (root = process.cwd()) => {
  const targets = walk(path.join(root, "foliplus", "js"));
  const hits = [];
  for (const file of targets) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (DECLARE_FILES.has(rel)) continue;
    const content = fs.readFileSync(file, "utf8");
    // Cheap text prefilter before the AST (see canHoldViolation): all three
    // rules need either the `createDropdown` callee or an `overlay ?` token,
    // and a comment can split the latter. Without it the guard parses all 318
    // production modules, which is why it could exceed even its own 60 s budget
    // under coverage on a loaded host (only 10 files pass the filter).
    if (!canHoldViolation(content)) {
      continue;
    }
    const sf = ts.createSourceFile(
      rel,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const visit = node => {
      // 1. createDropdown call without an overlay property.
      if (isCreateDropdownCall(node)) {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
          if (!hasOverlayProperty(firstArg)) {
            hits.push({
              file: rel,
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              text: "createDropdown call without an overlay property",
              context: "call",
            });
          }
        } else if (firstArg) {
          // A non-literal first arg (a variable) cannot be statically proven.
          hits.push({
            file: rel,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            text: "createDropdown called with a non-literal options object",
            context: "call",
          });
        }
      }

      // 2. overlay?: optional property (type position).
      if (
        ts.isPropertySignature(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "overlay" &&
        node.questionToken
      ) {
        hits.push({
          file: rel,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          text: "overlay?: optional property — the overlay hook must be required",
          context: "optional",
        });
      }

      // 3. The conditional-spread idiom ...(x.overlay ? { overlay: ... } : {}).
      //    The spread operand is often parenthesized: ...(x.overlay ? {...} : {}).
      if (ts.isSpreadAssignment(node)) {
        let spreadExpr = node.expression;
        while (ts.isParenthesizedExpression(spreadExpr)) {
          spreadExpr = spreadExpr.expression;
        }
        if (
          ts.isConditionalExpression(spreadExpr) &&
          ts.isPropertyAccessExpression(spreadExpr.condition) &&
          spreadExpr.condition.name.text === "overlay"
        ) {
          hits.push({
            file: rel,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            text: "conditional overlay spread — pass overlay directly",
            context: "spread",
          });
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
  const hits = findOverlayContractViolations(root);
  for (const h of hits) {
    console.log(`${h.file}:${h.line}: ${h.text}`);
  }
  return hits.length === 0 ? 0 : 1;
};

const runCli = (argv, entry, selfUrl = fileURLToPath(import.meta.url)) => {
  if (entry !== undefined && path.resolve(entry) === selfUrl) {
    process.exitCode = main(argv[0] || process.cwd());
  }
};
runCli(process.argv.slice(2), process.argv[1]);

export { findOverlayContractViolations, main, runCli, walk };
