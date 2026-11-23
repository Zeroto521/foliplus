#!/usr/bin/env node
/**
 * Guard: every semantic event publish carries an origin.
 *
 * The event bus is the cross-component contract; `origin` (who initiated a
 * change) is the metadata a subscriber uses to decide whether to echo a
 * change back or treat it as a fresh user action. A publish that omits it
 * silently downgrades that decision to "unknown" for every subscriber, so
 * the guard requires each publish/emit call site in production code to pass
 * an origin — or to declare the omission with an adjacent
 * `// origin-exempt: <reason>` comment (same pattern as listener-exempt).
 *
 * Scope: `foliplus/js/**\/*.ts` (production only — tests may drive events
 * without an origin). Recognises the event-bus calls:
 *   publish(bus, EVENTS.X, payload, origin)
 *   bus.publish(EVENTS.X, payload, origin)
 *   bus.emit(EVENTS.X, payload, origin)
 *   operation.emit(EVENTS.X, payload, origin)
 *   operation.emitSuperseding(EVENTS.X, key, payload, origin)
 *   bus.emitSettled / bus.emitSupersedingSettled
 *
 * Usage: `node script/check/event-origin.mjs [root]`
 *   Prints each violation as `file:line: message` and exits 1 on any.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const JS_ROOT = path.join("foliplus", "js");
const EXEMPT_RE = /\/\/\s*origin-exempt:\s*\S+/;

/** Names that publish or emit on the event bus. The guard matches a call
 *  expression whose callee (or callee's property) is one of these. */
const BUS_CALLS = new Set([
  "publish",
  "emit",
  "emitSettled",
  "emitSuperseding",
  "emitSupersedingSettled",
]);

/** Walk the call arguments for an EventOrigin literal: an object literal with
 *  a `kind` property (our discriminated union) — `{ kind: "user", via: ... }`.
 *  The origin is the LAST argument that is such an object (or a reference to
 *  an origin-shaped constant), after the payload. */
const isOriginArg = node => {
  if (!node) return false;
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some(
      p => ts.isPropertyAssignment(p) && p.name.getText() === "kind",
    );
  }
  // A reference to an origin-shaped binding (const ORIGIN = { kind: ... }).
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) return true;
  return false;
};

/** Recognise `EVENTS.X` as the event name. Semantic events are spelled
 *  as the dictionary constant, never a bare string — a bare string is a DOM
 *  or module-local event (e.g. slider's own `emit("input")`), not a bus call. */
const eventNameOf = arg => {
  if (!arg) return null;
  if (ts.isPropertyAccessExpression(arg)) {
    const text = arg.getText();
    if (/^EVENTS\.[A-Z_]+$/.test(text)) return text;
  }
  return null;
};

/** Collect every origin violation in one file's source. */
const findOriginDrift = (source, fileRel) => {
  const violations = [];
  const sf = ts.createSourceFile(
    fileRel,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const lines = source.split(/\r?\n/);
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const calleeText = ts.isPropertyAccessExpression(callee)
        ? callee.name.getText()
        : ts.isIdentifier(callee)
          ? callee.text
          : "";
      if (BUS_CALLS.has(calleeText)) {
        const args = node.arguments;
        // Find the event name. Method form (bus.emit(EVENTS.X, ...),
        // operation.emit(EVENTS.X, ...)) puts EVENTS.X at args[0]; the
        // free-function facade publish(bus, EVENTS.X, ...) puts it at
        // args[1] (args[0] is the bus). Check both, preferring the method
        // form first.
        const evName = eventNameOf(args[0]) ?? eventNameOf(args[1]);
        if (evName !== null) {
          // Which arg holds the event name? Method form: args[0].
          // Free-function publish(bus, EVENTS.X, ...): args[1].
          const eventIndex = eventNameOf(args[0]) !== null ? 0 : 1;
          // Origin is the last arg after the event name that looks like an
          // origin literal (or an origin-shaped reference). Start after the
          // event arg so EVENTS.X itself is never mistaken for an origin.
          let originArg = undefined;
          for (let i = args.length - 1; i > eventIndex; i--) {
            if (isOriginArg(args[i])) {
              originArg = args[i];
              break;
            }
          }
          const startLine = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
          // Check origin-exempt on the call lines + 2 lines above.
          const window = lines.slice(Math.max(0, startLine - 3), endLine);
          const exempt = window.some(l => EXEMPT_RE.test(l));
          if (!originArg && !exempt) {
            violations.push({
              file: fileRel,
              line: startLine,
              message:
                `${calleeText}() for ${evName} must pass an origin` +
                ` ({ kind: ... }) or carry a // origin-exempt: <reason> comment`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
};

/** Scan every production .ts under foliplus/js and report violations. */
const scan = (root = process.cwd()) => {
  const base = path.join(root, JS_ROOT);
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) files.push(full);
    }
  };
  walk(base);
  const all = [];
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const source = fs.readFileSync(file, "utf8");
    all.push(...findOriginDrift(source, rel));
  }
  return all;
};

/** CLI entry: scan, print, exit 1 on any violation. */
const runCli = (argv = process.argv.slice(2)) => {
  const root = argv[0] || process.cwd();
  const violations = scan(root);
  if (violations.length === 0) {
    console.log("event-origin: OK — every publish carries an origin");
    return 0;
  }
  for (const v of violations) {
    console.log(`${v.file}:${v.line}: ${v.message}`);
  }
  console.log(`event-origin: ${violations.length} violation(s)`);
  return 1;
};

export { findOriginDrift, scan, runCli };

if (
  process.argv[1] &&
  path.basename(import.meta.url) === path.basename(process.argv[1])
) {
  process.exit(runCli());
}
