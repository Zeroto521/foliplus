import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TOKEN_RE,
  collectSources,
  parseClassDefs,
  stripComments,
} from "#script/check/lib/source-scan.mjs";

describe("TOKEN_RE", () => {
  it("accepts a plain foliplus class token", () => {
    expect(TOKEN_RE.test("foliplus-hidden")).toBe(true);
    expect(TOKEN_RE.test("foliplus-scheme-picker-row")).toBe(true);
  });

  it("rejects non-class strings", () => {
    expect(TOKEN_RE.test("hidden")).toBe(false);
    expect(TOKEN_RE.test("foliplus")).toBe(false);
    expect(TOKEN_RE.test("xfoliplus-hidden")).toBe(false);
    expect(TOKEN_RE.test("foliplus-Hidden")).toBe(false);
  });
});

describe("stripComments", () => {
  it("replaces block comments with spaces, preserving newlines", () => {
    const src = "const A = 1;\n/* a\n   block */\nconst B = 2;\n";
    const out = stripComments(src);
    expect(out).toBe("const A = 1;\n    \n           \nconst B = 2;\n");
  });

  it("replaces line comments with spaces, preserving newlines", () => {
    const src = "const A = 1; // note\nconst B = 2;\n";
    const out = stripComments(src);
    expect(out).toBe("const A = 1;        \nconst B = 2;\n");
  });

  it("keeps a // inside a string literal (URL, data URI) as content", () => {
    const src = 'const URL = "https://example.com/a";\nconst B = 2;\n';
    expect(stripComments(src)).toBe(src);
  });

  it("keeps a /* inside a string literal as content", () => {
    const src = 'const X = "a /* b */ c";\nconst B = 2;\n';
    expect(stripComments(src)).toBe(src);
  });

  it("keeps a // inside a single-quoted string as content", () => {
    const src = "const X = 'a // b';\nconst B = 2;\n";
    expect(stripComments(src)).toBe(src);
  });
});

describe("collectSources", () => {
  const makeTree = () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "source-scan-"));
    mkdirSync(path.join(dir, "a", "b"), { recursive: true });
    mkdirSync(path.join(dir, "skipme"), { recursive: true });
    writeFileSync(path.join(dir, "a", "one.ts"), "");
    writeFileSync(path.join(dir, "a", "two.js"), "");
    writeFileSync(path.join(dir, "a", "b", "three.mts"), "");
    writeFileSync(path.join(dir, "a", "b", "four.txt"), "");
    writeFileSync(path.join(dir, "skipme", "five.ts"), "");
    return dir;
  };

  it("collects matching suffixes recursively and skips skipDirs", () => {
    const dir = makeTree();
    try {
      const files = collectSources(dir, { skipDirs: new Set(["skipme"]) })
        .map(f => path.relative(dir, f).split(path.sep).join("/"))
        .sort();
      expect(files).toEqual(["a/b/three.mts", "a/one.ts", "a/two.js"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("honours a custom suffix allow-list", () => {
    const dir = makeTree();
    try {
      const files = collectSources(dir, { suffixes: [".ts"] })
        .map(f => path.relative(dir, f).split(path.sep).join("/"))
        .sort();
      expect(files).toEqual(["a/one.ts", "skipme/five.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns [] for a missing directory", () => {
    expect(collectSources(path.join(os.tmpdir(), "source-scan-missing-xyz"))).toEqual(
      [],
    );
  });
});

describe("parseClassDefs", () => {
  it("parses a single-line map", () => {
    const sites = parseClassDefs('const X = { DOT: "foliplus-dot" };\n');
    expect(sites).toEqual([{ token: "foliplus-dot", key: "DOT", owner: "X", line: 1 }]);
  });

  it("parses a multi-line map with a camelCase key", () => {
    const sites = parseClassDefs(
      'const X = {\n  active: "foliplus-is-active",\n} as const;\n',
    );
    expect(sites).toEqual([
      { token: "foliplus-is-active", key: "active", owner: "X", line: 2 },
    ]);
  });

  it("parses nested object literals", () => {
    const src =
      'const X = {\n  DOT: "foliplus-dot",\n  NEST: {\n    B: "foliplus-b",\n  },\n};\n';
    const sites = parseClassDefs(src);
    expect(sites).toEqual([
      { token: "foliplus-dot", key: "DOT", owner: "X", line: 2 },
      { token: "foliplus-b", key: "B", owner: "X", line: 4 },
    ]);
  });

  it("ignores composite values and selector strings", () => {
    const src =
      'const X = {\n  COMBO: "foliplus-a foliplus-b",\n  SEL: ".foliplus-c",\n};\n';
    expect(parseClassDefs(src)).toEqual([]);
  });

  it("parses a file-level named const", () => {
    const sites = parseClassDefs('const HIDDEN_CLASS = "foliplus-hidden";\n');
    expect(sites).toEqual([
      { token: "foliplus-hidden", key: "HIDDEN_CLASS", owner: "HIDDEN_CLASS", line: 1 },
    ]);
  });

  it("parses an exported const map", () => {
    const sites = parseClassDefs('export const X = { DOT: "foliplus-dot" };\n');
    expect(sites).toEqual([{ token: "foliplus-dot", key: "DOT", owner: "X", line: 1 }]);
  });

  it("ignores a function-local map (not column-0)", () => {
    const src = 'function f() {\n  const X = { DOT: "foliplus-dot" };\n}\n';
    expect(parseClassDefs(src)).toEqual([]);
  });

  it("ignores comments naming a class", () => {
    const src =
      '// const X = { DOT: "foliplus-dot" };\nconst Y = { A: "foliplus-a" };\n';
    expect(parseClassDefs(src)).toEqual([
      { token: "foliplus-a", key: "A", owner: "Y", line: 2 },
    ]);
  });

  it("skips a map whose brace never closes", () => {
    expect(parseClassDefs('const X = { DOT: "foliplus-dot";\n')).toEqual([]);
  });
});
