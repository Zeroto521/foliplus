import { readFileSync } from "fs";
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
// shadowed scopes by construction - the three false results a previous
// line-window heuristic produced (a comment green-washing an untrimmed read, a
// legal multi-statement trim reported red, and a regex literal hiding a read)
// cannot happen here. The review probes for those cases are tests below.
//
// Module-local guard (not a repo-wide invariant), so it is deliberately not
// registered in test/js/toolchain-guard.test.ts.

const READERS = [
  "foliplus/js/control/LayerControl/declaredParse.ts",
  "foliplus/js/control/LayerControl/declaredFill.ts",
];
const TRIM_MODULE = "foliplus/js/control/LayerControl/declaredTrim.ts";
const TRIM_FN = "trimDeclaredString";
const HEX_FN = "isHexColor";

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
 * Why the isHexColor argument is not bound to the shared trim, or null when it
 * is: inline trimDeclaredString(...) or a const/let initialiser that calls it
 * in the nearest scope that declares the identifier.
 */
const unboundedArgument = (call: ts.CallExpression): string | null => {
  const argument = call.arguments[0];
  if (argument === undefined) return "isHexColor() has no argument";
  if (isCallTo(argument, TRIM_FN)) return null;
  if (ts.isIdentifier(argument)) {
    let scope: ts.Node | undefined = argument.parent;
    while (scope !== undefined) {
      const declarations = declarationsInScope(scope, argument.text);
      if (declarations.length > 0) {
        const initializer = declarations[declarations.length - 1].initializer;
        if (initializer !== undefined && containsTrimCall(initializer)) return null;
        return `"${argument.text}" is bound to a value that never calls ${TRIM_FN}`;
      }
      scope = scope.parent;
    }
    return `"${argument.text}" has no visible binding`;
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
  it.each(READERS)("%s", reader => {
    const source = read(reader);
    const { reads, problems } = hexReadProblems(reader, source);
    expect(reads).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  it("declaredTrim.ts exports the one trim function", () => {
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
  it("declaredParse.ts has no bare .trim()", () => {
    expect(hostTrimCalls("declaredParse.ts", read(READERS[0]))).toEqual([]);
  });

  it("declaredFill.ts keeps only the isName empty-check", () => {
    const calls = hostTrimCalls("declaredFill.ts", read(READERS[1]));
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
  it("b2: a trim as the first statement of an arrow function is legal", () => {
    const source = [
      "const readBorder = (data: { color: string }) => {",
      "  const color = trimDeclaredString(data.color);",
      "  if (isHexColor(color)) return color;",
      "  return null;",
      "};",
    ].join("\n");
    expect(hexReadProblems("probe.ts", source).problems).toEqual([]);
  });

  it("d: an inner shadowing binding is a violation", () => {
    const source = [
      "const readBorder = (outer: string) => {",
      "  const color = trimDeclaredString(outer);",
      "  {",
      "    const color = outer;",
      "    if (isHexColor(color)) return color;",
      "  }",
      "  return color;",
      "};",
    ].join("\n");
    expect(hexReadProblems("probe.ts", source).problems).toHaveLength(1);
  });

  it("e: isHexColor inside a string or template literal is not a call", () => {
    const source = [
      "const readBorder = (data: { color: string }) => {",
      '  const note = "isHexColor(data.color) appears here";',
      "  const tpl = `isHexColor(data.color)`;",
      "  const color = trimDeclaredString(data.color);",
      "  if (isHexColor(color)) return note + tpl + color;",
      "  return null;",
      "};",
    ].join("\n");
    const { reads, problems } = hexReadProblems("probe.ts", source);
    expect(reads).toBe(1);
    expect(problems).toEqual([]);
  });

  it("f: a regex literal containing // does not hide the read after it", () => {
    const source = [
      "const readBorder = (data: { color: string }) => {",
      "  const pattern = /\\/\\//; if (isHexColor(data.color)) return pattern.source;",
      "  return null;",
      "};",
    ].join("\n");
    expect(hexReadProblems("probe.ts", source).problems).toHaveLength(1);
  });
});
