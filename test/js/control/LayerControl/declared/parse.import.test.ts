// test/js/control/LayerControl/declared/parse.import — only the barrel is a
// public door, and readDeclared* lives only in declared/.
//
// The declared readers are the channel's public read. A caller that deep-imports
// ./declared/face.js (or the old flat declaredParse.js) couples itself to the
// parse that happens to serve it, and a later dimension split breaks it silently.
// The same goes for readDeclared* definitions: they belong to this directory, so
// a copy appearing next to the controller is a second declaration channel.
//
// The assertions are structural (import specifiers and export names, not a text
// window); the probes feed synthetic sources to the same helpers so the guard's
// teeth are visible without a second fixture tree.
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const ROOT = "foliplus/js/control/LayerControl";
const DECLARED = `${ROOT}/declared`;
const BARREL_SUFFIX = "declared/index.js";

const declaredFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts")) out.push(path.replace(/\\/g, "/"));
    }
  };
  walk(ROOT);
  return out;
};

type ImportRead = { names: string[]; specifier: string };

/** Names carried by one import/export clause element (a, a as b, type a as b).
 *  Only the *source* name is reported: the local alias does not affect which
 *  declared symbol the file reads. */
const clauseElementName = (element: ts.ImportOrExportSpecifier): string =>
  (element.propertyName ?? element.name).text;

/** Walk one TS source and collect what it imports. Named imports, namespace
 *  imports (import * as ns), default imports, dynamic import("...") and
 *  import("...").T types all name a module this file couples to; a regex over
 *  the named shape alone misses the other three, which is how a deep namespace
 *  or dynamic import of declared/ slipped past the guard. A namespace,
 *  dynamic, or ImportType read exposes every export the specifier ships, so it
 *  is reported under the opaque name "*" — the specifier is what is judged. */
const collectImports = (
  source: string,
): { reads: ImportRead[]; namespaceSpecifiers: string[] } => {
  const reads: ImportRead[] = [];
  const namespaceSpecifiers: string[] = [];
  const sf = ts.createSourceFile("probe.ts", source, ts.ScriptTarget.ES2022, true);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
      const clause = node.importClause;
      if (clause.name) reads.push({ names: [clause.name.text], specifier });
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          reads.push({ names: ["*"], specifier });
          namespaceSpecifiers.push(specifier);
        } else {
          reads.push({
            names: clause.namedBindings.elements.map(clauseElementName),
            specifier,
          });
        }
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        reads.push({ names: ["*"], specifier: arg.text });
        namespaceSpecifiers.push(arg.text);
      }
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument;
      if (ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal)) {
        reads.push({ names: ["*"], specifier: arg.literal.text });
        namespaceSpecifiers.push(arg.literal.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { reads, namespaceSpecifiers };
};

/** Back-compat name for the probes and the one production call site that reads
 *  the import list off a source. */
const namedImports = (source: string): ImportRead[] =>
  collectImports(source).reads;

/** Every exported name in one source (inline export const/function/type + export blocks). */
const exportedNames = (source: string): string[] => {
  const names: string[] = [];
  for (const match of source.matchAll(
    /export\s+(?:type\s+)?(?:const|function|type)\s+(\w+)/g,
  )) {
    names.push(match[1]);
  }
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const name = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.push(name);
    }
  }
  return names;
};

/** Problems for one importer source: a deep/hidden readDeclared* door. */
const importProblems = (file: string, source: string): string[] => {
  const problems: string[] = [];
  const flagged = new Set<string>();
  const inDeclared =
    file.startsWith(`${DECLARED}/`) && !file.endsWith("/declared/index.ts");
  const { reads, namespaceSpecifiers } = collectImports(source);
  for (const specifier of namespaceSpecifiers) {
    // A namespace, dynamic import(), or ImportType read exposes every export
    // the specifier ships, so a deep one is the same coupling a deep named
    // import is — just harder to see. Only specifiers that actually target
    // declared/ are interesting: the rest are unrelated modules that happen
    // to be namespace-imported. `*` never appears in `reads`, so this loop
    // and the named loop below cannot double-report the same specifier.
    const targetsDeclared =
      specifier.includes("/declared/") ||
      (inDeclared && specifier.startsWith("./") && !specifier.endsWith(BARREL_SUFFIX));
    if (!targetsDeclared) continue;
    if (specifier.endsWith(BARREL_SUFFIX)) continue;
    flagged.add(specifier);
    if (inDeclared && specifier.startsWith("./")) {
      problems.push(
        `${file}: namespace import inside declared/ via ${specifier}`,
      );
    } else {
      problems.push(
        `${file}: namespace import from ${specifier} (only */declared/index.js exposes them)`,
      );
    }
  }
  for (const { names, specifier } of reads) {
    const declaredReads = names.filter(name => name.startsWith("readDeclared"));
    if (declaredReads.length === 0) continue;
    flagged.add(specifier);
    if (inDeclared && specifier.startsWith("./")) {
      problems.push(
        `${file}: readDeclared* imported inside declared/ via ${specifier}`,
      );
    } else if (!specifier.endsWith(BARREL_SUFFIX)) {
      problems.push(
        `${file}: readDeclared* imported from ${specifier} (only */declared/index.js exposes them)`,
      );
    }
  }
  if (!inDeclared) {
    for (const { specifier } of namedImports(source)) {
      if (specifier.includes("/declared/") && !specifier.endsWith(BARREL_SUFFIX)) {
        if (flagged.has(specifier)) continue;
        problems.push(
          `${file}: deep import of the declared directory via ${specifier}`,
        );
      }
    }
  }
  return problems;
};

describe("readDeclared* has one public door", () => {
  it("every importer goes through declared/index.js", () => {
    const problems = declaredFiles()
      .filter(file => !file.startsWith(`${DECLARED}/`))
      .flatMap(file => importProblems(file, readFileSync(file, "utf8")));
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("no *exported* readDeclared* is defined outside declared/", () => {
    const outside = declaredFiles()
      .filter(file => !file.startsWith(`${DECLARED}/`))
      .flatMap(file =>
        exportedNames(readFileSync(file, "utf8")).map(name => ({ name, file })),
      )
      .filter(({ name }) => name.startsWith("readDeclared"));
    expect(outside).toEqual([]);
  });

  it("the barrel re-exports every readDeclared* the directory defines", () => {
    const defined = new Set(
      declaredFiles()
        .filter(file => file.startsWith(`${DECLARED}/`))
        .filter(file => !file.endsWith("/index.ts"))
        .flatMap(file => exportedNames(readFileSync(file, "utf8")))
        .filter(name => name.startsWith("readDeclared")),
    );
    const barrelled = new Set(
      exportedNames(readFileSync(`${DECLARED}/index.ts`, "utf8")).filter(name =>
        name.startsWith("readDeclared"),
      ),
    );
    expect([...barrelled].sort()).toEqual([...defined].sort());
  });

  it("probes: a deep import and a foreign definition are both violations", () => {
    expect(
      importProblems(
        `${ROOT}/ui/style/icon.ts`,
        'import { readDeclaredIcon } from "#control/LayerControl/declared/face.js";',
      ),
    ).toHaveLength(1);
    expect(
      importProblems(
        `${ROOT}/domain/orchestration.ts`,
        'import { readDeclaredOpacity } from "../declared/index.js";',
      ),
    ).toEqual([]);
    expect(exportedNames("export { readDeclaredOpacity };")).toEqual([
      "readDeclaredOpacity",
    ]);
  });
});

describe("namespace/dynamic/ImportType also guarded", () => {
  it("namespace import of a deep declared module is a violation", () => {
    expect(importProblems(
      `${ROOT}/ui/style/icon.ts`,
      'import * as ns from "#control/LayerControl/declared/face.js";\nvoid ns.readDeclaredIcon;',
    )).toHaveLength(1);
  });

  it("dynamic import of a deep declared module is a violation", () => {
    expect(importProblems(
      `${ROOT}/ui/style/icon.ts`,
      'const m = await import("#control/LayerControl/declared/face.js");\nvoid m.readDeclaredIcon;',
    )).toHaveLength(1);
  });

  it("ImportType of a deep declared module is a violation", () => {
    expect(importProblems(
      `${ROOT}/ui/style/icon.ts`,
      'type T = import("#control/LayerControl/declared/face.js").readDeclaredIcon;\nexport type { T };',
    )).toHaveLength(1);
  });

  it("namespace import through the barrel is fine", () => {
    expect(importProblems(
      `${ROOT}/ui/style/icon.ts`,
      'import * as ns from "#control/LayerControl/declared/index.js";\nvoid ns.readDeclaredIcon;',
    )).toEqual([]);
  });
});
