import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Keyboard-ownership guard: Arrow/Escape key handling is a shared-primitive
// concern. Components must not inspect `event.key` for an Arrow* or "Escape"
// inside an `addEventListener("keydown", ...)` callback; they register with the
// shared primitives instead (ListCursor for list navigation, the overlay
// registry for Escape, InteractionManager for layer shortcuts). A component
// that compares the key itself reintroduces the bug class this guards against
// (a local handler eating a key the shared primitive owns).
//
// Scope: `foliplus/js` production source only. The shared primitives live in
// EXEMPT (file-level) — a file there may inspect Arrow/Escape because it *is*
// the primitive. Everything else that compares the key in a keydown callback
// fails here, at authoring time (CI), not in review.
//
// Matches via the repo's own `typescript` compiler API (no new dependency):
// walk every CallExpression whose callee is `addEventListener`, take the
// "keydown" overload, and search the callback body for a `.key` comparison
// against an Arrow* literal or "Escape".
const REPO_ROOT = resolve(".");
const SOURCE_ROOT = resolve(REPO_ROOT, "foliplus", "js");
const EXEMPT: string[] = [
  "common/dom.ts",
  "common/floating.ts",
  "core/interaction/listCursor.ts",
  "core/overlayRegistry.ts",
  "ui/dismiss.ts",
  "ui/listbox.ts",
  "ui/slider.ts",
  "control/ExportControl/crop.ts",
];
const SOURCE_EXT = new Set([".ts", ".tsx"]);
const SKIP_DIR = new Set(["node_modules", "dist", ".venv", ".git", "coverage"]);

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else {
      const dot = name.lastIndexOf(".");
      if (dot >= 0 && SOURCE_EXT.has(name.slice(dot))) out.push(p);
    }
  }
  return out;
}

/** The Arrow and Escape key literals a keydown callback must not compare. */
const OWNED_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Escape",
]);

/** Whether the keydown callback compares `event.key` against an owned key.
 *  Walks the callback body for a PropertyAccess `.key` (any object name) or a
 *  bare identifier named `key`, compared (=== / !== / case) against an owned
 *  literal. Name-based, so a renamed event param is still caught. */
function callbackChecksOwnedKey(cb: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isBinaryExpression(node) && isKeyComparison(node)) {
      found = true;
      return;
    }
    if (ts.isCaseClause(node) && isOwnedKeyLiteral(node.expression)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(cb);
  return found;
}

function isKeyComparison(node: ts.BinaryExpression): boolean {
  const op = node.operatorToken.kind;
  if (
    op !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    op !== ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    op !== ts.SyntaxKind.EqualsEqualsToken &&
    op !== ts.SyntaxKind.ExclamationEqualsToken
  ) {
    return false;
  }
  const readsKey = (n: ts.Expression): boolean =>
    (ts.isPropertyAccessExpression(n) && n.name.text === "key") ||
    (ts.isIdentifier(n) && n.text === "key");
  return (
    (readsKey(node.left) && isOwnedKeyLiteral(node.right)) ||
    (readsKey(node.right) && isOwnedKeyLiteral(node.left))
  );
}

function isOwnedKeyLiteral(n: ts.Expression): boolean {
  return ts.isStringLiteral(n) && OWNED_KEYS.has(n.text);
}

/** Find the callback (arg index 1) of an `addEventListener("keydown", cb)`. */
function keydownCallback(call: ts.CallExpression): ts.Node | null {
  const callee = call.expression;
  const isAddEventListener =
    ts.isPropertyAccessExpression(callee) && callee.name.text === "addEventListener";
  if (!isAddEventListener) return null;
  const typeArg = call.arguments[0];
  if (!typeArg || !ts.isStringLiteral(typeArg) || typeArg.text !== "keydown") {
    return null;
  }
  const cb = call.arguments[1];
  if (!cb) return null;
  // A function/arrow is inspected directly; an identifier (named handler) is
  // not resolvable across files — the shared primitives pass named handlers
  // and are EXEMPT, so a non-exempt file passing a bare identifier is not
  // flagged here (that is a deliberate scope limit: cross-file flow).
  if (
    ts.isArrowFunction(cb) ||
    ts.isFunctionExpression(cb) ||
    ts.isMethodDeclaration(cb)
  ) {
    return cb;
  }
  return null;
}

describe("keyboard ownership — Arrow/Escape stay in the shared primitives", () => {
  it("finds no component keydown callback comparing an owned key", () => {
    const files = walk(SOURCE_ROOT, []);
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (EXEMPT.some(a => rel.endsWith(a))) continue;
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf-8"),
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
      );
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const cb = keydownCallback(node);
          if (cb && callbackChecksOwnedKey(cb)) {
            const line =
              source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            hits.push(`${rel}:${line}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(hits).toEqual([]);
  });
});
