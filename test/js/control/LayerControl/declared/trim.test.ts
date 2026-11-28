import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Declared-string trim guard.
//
// Every declaration reader in this directory validates a CSS hex through
// isHexColor. Python trims a declared colour with the shared union set before
// its hex regex (foliplus/_declaration/paint.py, _declared_hex), so a JS reader
// that hands isHexColor an untrimmed string accepts fewer spellings than Python
// and the same declaration paints on one stack only. The inverse is just as bad:
// a trim that exists only in JS makes a colour paint on the panel and vanish in
// collection.
//
// The rule is structural, so this guard parses the sources with the TypeScript
// compiler API instead of a text window. The AST distinguishes a real
// CallExpression from a comment, a string/template/regex literal, and resolves
// shadowed scopes by construction - the false results a previous line-window
// heuristic produced (a comment green-washing an untrimmed read, a legal
// multi-statement trim reported red, a regex literal hiding a read) cannot
// happen here. The review probes for those cases are tests below.
//
// Discovery, not a hardcoded list: every module in declared/ that calls
// isHexColor is checked, so a new reader is covered without editing this file.
// A pin below names today's readers - if it fails, a new reader appeared and a
// human should look at it (and at the fill host-trim exemption).
//
// Known limitation (accepted, not exploitable): the scope search looks at the
// declarations of the nearest scope that binds the name, ignoring declaration
// POSITION. Only hoisted var or invalid TypeScript (a use before its const/let
// declaration) can reach a later declaration, so real code is unaffected.
//
// Module-local guard (not a repo-wide invariant), so it is deliberately not
// registered in test/js/toolchain-guard.test.ts.

const DECLARED_DIR = "foliplus/js/control/LayerControl/declared";
const TRIM_MODULE = `${DECLARED_DIR}/trim.ts`;
const TRIM_FN = "trimDeclaredString";
const HEX_FN = "isHexColor";

//: The readers that exist today. New entries are picked up by discovery; this
//: pin only forces a human to look at a newly appearing reader.
const EXPECTED_HEX_READERS = ["fill.ts", "parse.ts"];

const filePath = (name: string): string => `${DECLARED_DIR}/${name}`;

const read = (relativePath: string): string =>
  readFileSync(resolve(".", relativePath), "utf8");

const parse = (fileName: string, source: string): ts.SourceFile =>
  ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const isCallTo = (node: ts.Node | undefined, name: string): boolean =>
  node !== undefined &&
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === name;

/** True when the subtree contains a call to trimDeclaredString. */
const containsTrimCall = (root: ts.Node): boolean => {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (isCallTo(node, TRIM_FN)) {
      found = true;
      return;
    }
    node.forEachChild(visit);
  };
  visit(root);
  return found;
};

/**
 * The variable declarations of one scope that bind `name`.
 *
 * Only the scope itself is searched: nested blocks and functions are separate
 * scopes and are visited by the resolver on its way up, which is what makes
 * an inner shadowing binding win over an outer trimmed one.
 */
const declarationsInScope = (
  scope: ts.Node,
  name: string,
): ts.VariableDeclaration[] => {
  const found: ts.VariableDeclaration[] = [];
  const collect = (node: ts.Node): void => {
    if (node !== scope && (ts.isBlock(node) || ts.isFunctionLike(node))) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found.push(node);
      return;
    }
    node.forEachChild(collect);
  };
  if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
    for (const statement of scope.statements) collect(statement);
  }
  return found;
};

/**
 * Whether `identifier` resolves to a value produced by the shared trim,
 * following ONE alias hop: `const a = trimDeclaredString(raw); const b = a;`.
 * The one-hop limit is deliberate - it removes the false red the review found
 * while keeping the resolution chain short enough to reason about; a second hop
 * is a violation and the message names the binding.
 */
const resolveIdentifier = (
  identifier: ts.Identifier,
  hopsLeft: number,
): "ok" | "bad" | "unbound" => {
  let scope: ts.Node | undefined = identifier.parent;
  while (scope !== undefined) {
    const declarations = declarationsInScope(scope, identifier.text);
    if (declarations.length > 0) {
      const initializer = declarations[declarations.length - 1].initializer;
      if (initializer === undefined) return "bad";
      if (containsTrimCall(initializer)) return "ok";
      if (hopsLeft > 0 && ts.isIdentifier(initializer)) {
        return resolveIdentifier(initializer, hopsLeft - 1);
      }
      return "bad";
    }
    scope = scope.parent;
  }
  return "unbound";
};

/**
 * Why the isHexColor argument is not bound to the shared trim, or null when it
 * is: inline trimDeclaredString(...) or an identifier whose nearest binding (or
 * one alias hop from it) calls the shared trim.
 */
const unboundedArgument = (call: ts.CallExpression): string | null => {
  const argument = call.arguments[0];
  if (argument === undefined) return "isHexColor() has no argument";
  if (isCallTo(argument, TRIM_FN)) return null;
  if (ts.isIdentifier(argument)) {
    const resolved = resolveIdentifier(argument, 1);
    if (resolved === "ok") return null;
    if (resolved === "unbound") return `"${argument.text}" has no visible binding`;
    return `"${argument.text}" is bound to a value that never calls ${TRIM_FN}`;
  }
  return `the argument is not ${TRIM_FN}(...) or an identifier bound from it`;
};

const hexReadProblems = (
  fileName: string,
  source: string,
): { reads: number; problems: string[] } => {
  const sourceFile = parse(fileName, source);
  let reads = 0;
  const problems: string[] = [];
  const visit = (node: ts.Node): void => {
    if (isCallTo(node, HEX_FN)) {
      reads += 1;
      const reason = unboundedArgument(node as ts.CallExpression);
      if (reason !== null) {
        const line =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        problems.push(`${fileName}:${line}: ${reason}`);
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return { reads, problems };
};

/** Every declared*.ts module in this directory that reads a CSS hex. */
const discoverHexReaders = (): string[] =>
  readdirSync(resolve(".", DECLARED_DIR))
    .filter(name => name.endsWith(".ts"))
    .filter(name => hexReadProblems(filePath(name), read(filePath(name))).reads > 0)
    .sort();

/** Bare .trim() calls (no argument), which use the host default. */
const hostTrimCalls = (fileName: string, source: string): ts.CallExpression[] => {
  const sourceFile = parse(fileName, source);
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "trim" &&
      node.arguments.length === 0
    ) {
      calls.push(node);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return calls;
};

describe("every declared hex reader trims through trimDeclaredString", () => {
  const readers = discoverHexReaders();

  it("discovers the declared readers that read a hex", () => {
    expect(
      readers,
      "A declared reader that calls isHexColor appeared or disappeared. Confirm it\n" +
        "trims through trimDeclaredString, update EXPECTED_HEX_READERS, and re-check\n" +
        "the fill host-trim exemption in this file.",
    ).toEqual(EXPECTED_HEX_READERS);
  });

  it.each(readers)("%s", reader => {
    const source = read(filePath(reader));
    const { reads, problems } = hexReadProblems(reader, source);
    expect(reads).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  it("trim.ts exports the one trim function", () => {
    const sourceFile = parse(TRIM_MODULE, read(TRIM_MODULE));
    const exported = sourceFile.statements.some(
      statement =>
        ts.isExportDeclaration(statement) &&
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.some(element => element.name.text === TRIM_FN),
    );
    expect(exported).toBe(true);
  });
});

describe("no host trim on the declared-string path", () => {
  it("parse.ts has no bare .trim()", () => {
    expect(hostTrimCalls("parse.ts", read(filePath("parse.ts")))).toEqual([]);
  });

  it("fill.ts keeps only the isName empty-check", () => {
    const calls = hostTrimCalls("fill.ts", read(filePath("fill.ts")));
    expect(calls).toHaveLength(1);
    const [call] = calls;
    const target = call.expression as ts.PropertyAccessExpression;
    expect(ts.isPropertyAccessExpression(call.expression)).toBe(true);
    expect(ts.isIdentifier(target.expression)).toBe(true);
    expect((target.expression as ts.Identifier).text).toBe("value");
    // isName tests emptiness (value.trim().length > 0) and stores the value as
    // written; field and scheme names are opaque identifiers, not colours. A
    // new trim in this module must be justified, and this exemption updated.
    expect(ts.isPropertyAccessExpression(call.parent)).toBe(true);
    expect((call.parent as ts.PropertyAccessExpression).name.text).toBe("length");
  });
});

describe("the guard is structural, not a text window (review probes)", () => {
  const source = (lines: string[]): string => lines.join("\n");

  it("b2: a trim as the first statement of an arrow function is legal", () => {
    const text = source([
      "const readBorder = (data: { color: string }) => {",
      "  const color = trimDeclaredString(data.color);",
      "  if (isHexColor(color)) return color;",
      "  return null;",
      "};",
    ]);
    expect(hexReadProblems("probe.ts", text).problems).toEqual([]);
  });

  it("d: an inner shadowing binding is a violation", () => {
    const text = source([
      "const readBorder = (outer: string) => {",
      "  const color = trimDeclaredString(outer);",
      "  {",
      "    const color = outer;",
      "    if (isHexColor(color)) return color;",
      "  }",
      "  return color;",
      "};",
    ]);
    expect(hexReadProblems("probe.ts", text).problems).toHaveLength(1);
  });

  it("e: isHexColor inside a string or template literal is not a call", () => {
    const text = source([
      "const readBorder = (data: { color: string }) => {",
      '  const note = "isHexColor(data.color) appears here";',
      "  const tpl = `isHexColor(data.color)`;",
      "  const color = trimDeclaredString(data.color);",
      "  if (isHexColor(color)) return note + tpl + color;",
      "  return null;",
      "};",
    ]);
    const { reads, problems } = hexReadProblems("probe.ts", text);
    expect(reads).toBe(1);
    expect(problems).toEqual([]);
  });

  it("f: a regex literal containing // does not hide the read after it", () => {
    const text = source([
      "const readBorder = (data: { color: string }) => {",
      "  const pattern = /\\/\\//; if (isHexColor(data.color)) return pattern.source;",
      "  return null;",
      "};",
    ]);
    expect(hexReadProblems("probe.ts", text).problems).toHaveLength(1);
  });

  it("alias: one hop from a trimmed binding is legal", () => {
    const text = source([
      "const readBorder = (raw: string) => {",
      "  const color = trimDeclaredString(raw);",
      "  const color2 = color;",
      "  if (isHexColor(color2)) return color2;",
      "  return null;",
      "};",
    ]);
    expect(hexReadProblems("probe.ts", text).problems).toEqual([]);
  });

  it("alias: an untrimmed source reached by one hop is a violation", () => {
    const text = source([
      "const readBorder = (raw: string) => {",
      "  const color = raw;",
      "  const color2 = color;",
      "  if (isHexColor(color2)) return color2;",
      "  return null;",
      "};",
    ]);
    expect(hexReadProblems("probe.ts", text).problems).toHaveLength(1);
  });
});
