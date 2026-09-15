import { describe, expect, it } from "vitest";
import { orderCommonCss, parseImports, stripImports } from "#script/common-css.mjs";

/** Build a source from a list of imports plus an optional body. */
const src = (imports: string[], body = ".x { color: red; }") =>
  imports.map(i => `@import "${i}";`).join("\n") + (imports.length ? "\n" : "") + body;

describe("orderCommonCss", () => {
  it("puts an imported module before its importer", () => {
    const sources = new Map([
      ["panel.css", src(["token.css"])],
      ["token.css", src([])],
    ]);
    expect(orderCommonCss(sources)).toEqual(["token.css", "panel.css"]);
  });

  it("resolves transitive dependencies", () => {
    const sources = new Map([
      ["a.css", src(["b.css"])],
      ["b.css", src(["token.css"])],
      ["token.css", src([])],
    ]);
    expect(orderCommonCss(sources)).toEqual(["token.css", "b.css", "a.css"]);
  });

  it("keeps sibling modules in insertion order (deterministic tie-break)", () => {
    const sources = new Map([
      ["a.css", src(["token.css"])],
      ["z.css", src(["token.css"])],
      ["token.css", src([])],
    ]);
    // a.css and z.css do not import each other, so their relative order is
    // the caller's insertion order — build.mjs feeds keys sorted by filename.
    expect(orderCommonCss(sources)).toEqual(["token.css", "a.css", "z.css"]);
  });

  it("accepts an empty set", () => {
    expect(orderCommonCss(new Map())).toEqual([]);
  });

  it("throws on an import that resolves outside the set", () => {
    const sources = new Map([["a.css", src(["missing.css"])]]);
    expect(() => orderCommonCss(sources)).toThrow(
      /a\.css imports "missing\.css" which is not in css\/common/,
    );
  });

  it("throws on a self import", () => {
    const sources = new Map([["a.css", src(["a.css"])]]);
    expect(() => orderCommonCss(sources)).toThrow(/a\.css imports itself/);
  });

  it("throws on an import cycle and names the cycle path", () => {
    const sources = new Map([
      ["a.css", src(["b.css"])],
      ["b.css", src(["a.css"])],
    ]);
    expect(() => orderCommonCss(sources)).toThrow(
      /import cycle: a\.css → b\.css → a\.css/,
    );
  });
});

describe("parseImports", () => {
  it("collects quoted imports in declaration order, ignoring other lines", () => {
    const source =
      '/* header */\n@import "b.css";\n.x { color: red; }\n@import "a.css";';
    expect(parseImports(source)).toEqual(["b.css", "a.css"]);
  });

  it("returns an empty list for a source without imports", () => {
    expect(parseImports(".x { color: red; }")).toEqual([]);
  });
});

describe("stripImports", () => {
  it("removes @import statements and keeps everything else", () => {
    const source = '@import "token.css";\n\n.foliplus-x { color: red; }';
    expect(stripImports(source)).toBe("\n.foliplus-x { color: red; }");
  });

  it("leaves a source without imports untouched", () => {
    const source = ".foliplus-x { color: red; }";
    expect(stripImports(source)).toBe(source);
  });
});
