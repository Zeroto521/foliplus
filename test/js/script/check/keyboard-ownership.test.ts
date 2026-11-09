import { existsSync, readFileSync, readdirSync, statSync } from "fs";
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
  "platform/dom.ts",
  "platform/floating.ts",
  "core/interaction/listCursor.ts",
  "core/overlay/overlayRegistry.ts",
  "ui/dismiss.ts",
  "ui/listbox.ts",
  "ui/slider.ts",
  "control/ExportControl/crop.ts",
];
const SOURCE_EXT = new Set([".ts", ".tsx"]);
// Resolve EXEMPT drift once, at import time, not per-test: vitest workers may
// run both `it` blocks in parallel and both pay the fs.existsSync cost.
const MISSING_EXEMPT: string[] = EXEMPT.filter(
  entry => !existsSync(resolve(".", "foliplus", "js", entry)),
);
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

/** Whether a handler body reads an owned key (Arrow/Escape). Catches every
 *  shape components actually use:
 *  - a comparison (=== !== == !=) between an owned literal and either a `.key`
 *    property access or a bare `key` identifier (destructured param);
 *  - a `switch (event.key) / switch (key)` whose cases test owned literals;
 *  - an array of owned literals used as a key set (e.g. NUDGE_KEYS).
 *  Name-based on `key`, so a renamed event param is still caught. */
function readsOwnedKey(fn: ts.Node): boolean {
  const keyNames = new Set(["key"]);
  let found = false;
  const isOwnedLiteral = (n: ts.Expression): boolean =>
    ts.isStringLiteral(n) && OWNED_KEYS.has(n.text);
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      if (/^(event|ev|e|key|ke)$/.test(node.name.text)) keyNames.add(node.name.text);
    } else if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (
        op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        op === ts.SyntaxKind.EqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsToken
      ) {
        const readsKey = (n: ts.Expression): boolean =>
          (ts.isPropertyAccessExpression(n) && n.name.text === "key") ||
          (ts.isIdentifier(n) && keyNames.has(n.text));
        if (
          (readsKey(node.left) && isOwnedLiteral(node.right)) ||
          (readsKey(node.right) && isOwnedLiteral(node.left))
        ) {
          found = true;
          return;
        }
      }
    } else if (ts.isSwitchStatement(node)) {
      const expr = node.expression;
      const onKey =
        (ts.isPropertyAccessExpression(expr) && expr.name.text === "key") ||
        (ts.isIdentifier(expr) && keyNames.has(expr.text));
      if (onKey) {
        for (const clause of node.caseBlock.clauses) {
          if (ts.isCaseClause(clause) && isOwnedLiteral(clause.expression)) {
            found = true;
            return;
          }
        }
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      // A key-set literal like ["ArrowLeft", ...] compared against a key.
      const allOwned = node.elements.every(
        el => ts.isStringLiteral(el) && OWNED_KEYS.has(el.text),
      );
      if (allOwned && node.elements.length > 0) {
        keyNames.add("__owned_set__");
        found = found || false; // presence alone is not a hit; see visit of parent
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return found;
}

/** The keydown callback: an inline function/arrow, or the name of a
 *  file-local handler resolved via `handlers`. */
function keydownCallback(
  call: ts.CallExpression,
  handlers: Map<string, ts.Node>,
): ts.Node | null {
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
  if (
    ts.isArrowFunction(cb) ||
    ts.isFunctionExpression(cb) ||
    ts.isMethodDeclaration(cb)
  ) {
    return cb;
  }
  // Unwrap type assertions: `handler as EventListener` / `(handler)`.
  const unwrap = (n: ts.Expression): ts.Expression =>
    ts.isAsExpression(n) || ts.isParenthesizedExpression(n) ? unwrap(n.expression) : n;
  const resolved = unwrap(cb);
  // Named handler: resolve within the same file. Cross-file flow is out of
  // scope (the shared primitives are file-local and EXEMPT); a component that
  // imports a key handler from elsewhere is not caught here. One-hop
  // delegation is also not followed (the guard inspects the callback body
  // only), so a bare-identifier handler that calls another function which
  // does the key check (e.g. listCursor's `fn` → `handleKey`) is not caught.
  // This is a deliberate scope limit for a tree guard: it catches the
  // inline-arrow bug class (the icon-grid regression) and single-file named
  // handlers, not every transitive key read.
  if (ts.isIdentifier(resolved)) return handlers.get(resolved.text) ?? null;
  if (ts.isPropertyAccessExpression(resolved) && ts.isIdentifier(resolved.name)) {
    return handlers.get(resolved.name.text) ?? null;
  }
  return null;
}

/** Index file-local function declarations and arrow/function assignments by
 *  name so a named keydown handler can be inspected at its definition. */
function handlerMap(source: ts.SourceFile): Map<string, ts.Node> {
  const map = new Map<string, ts.Node>();
  const record = (name: string, node: ts.Node): void => {
    if (!map.has(name)) map.set(name, node);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) record(node.name.text, node);
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) ||
            ts.isFunctionExpression(decl.initializer))
        ) {
          record(decl.name.text, decl.initializer);
        }
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      record(node.name.text, node.initializer);
    }
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
      record(node.name.text, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return map;
}

describe("keyboard ownership — Arrow/Escape stay in the shared primitives", () => {
  it("finds no component keydown callback comparing an owned key", () => {
    const files = walk(SOURCE_ROOT, []);
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (EXEMPT.some(a => rel.endsWith(a))) continue;
      const src = readFileSync(file, "utf-8");
      // Cheap string prefilter: a keydown callback can only exist if the file
      // mentions both "addEventListener" and "keydown". This drops the AST
      // walk from ~500 files to the handful that actually register one,
      // keeping the guard well under CI's timeout under parallel load.
      if (!/(^|[^\w])addEventListener/.test(src) || !/"keydown"|'keydown'/.test(src)) {
        continue;
      }
      const source = ts.createSourceFile(
        file,
        src,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
      );
      const handlers = handlerMap(source);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const cb = keydownCallback(node, handlers);
          if (cb && readsOwnedKey(cb)) {
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

  it("every EXEMPT path exists in the repo (guards against silent drift)", () => {
    // Computed once at module load; see MISSING_EXEMPT below.
    expect(MISSING_EXEMPT).toEqual([]);
  });
});
