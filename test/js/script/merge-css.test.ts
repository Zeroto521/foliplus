import { describe, expect, it } from "vitest";
import {
  expandEntry,
  mergeCss,
  orderCss,
  parseImports,
  stripImports,
} from "#script/merge-css.mjs";

/** Build a source from a list of imports plus an optional body. */
const src = (imports: string[], body = ".x { color: red; }") =>
  imports.map(i => `@import "${i}";`).join("\n") + (imports.length ? "\n" : "") + body;

describe("orderCss", () => {
  it("puts an imported module before its importer", () => {
    const sources = new Map([
      ["panel.css", src(["token.css"])],
      ["token.css", src([])],
    ]);
    expect(orderCss(sources, "common")).toEqual(["token.css", "panel.css"]);
  });

  it("resolves transitive dependencies", () => {
    const sources = new Map([
      ["a.css", src(["b.css"])],
      ["b.css", src(["token.css"])],
      ["token.css", src([])],
    ]);
    expect(orderCss(sources, "common")).toEqual(["token.css", "b.css", "a.css"]);
  });

  it("keeps sibling modules in insertion order (deterministic tie-break)", () => {
    const sources = new Map([
      ["a.css", src(["token.css"])],
      ["z.css", src(["token.css"])],
      ["token.css", src([])],
    ]);
    // a.css and z.css do not import each other, so their relative order is
    // the caller's insertion order — build.mjs feeds keys sorted by filename.
    expect(orderCss(sources, "common")).toEqual(["token.css", "a.css", "z.css"]);
  });

  it("accepts an empty set", () => {
    expect(orderCss(new Map(), "common")).toEqual([]);
  });

  it("throws on an import that resolves outside the set", () => {
    const sources = new Map([["a.css", src(["missing.css"])]]);
    expect(() => orderCss(sources, "common")).toThrow(
      /a\.css imports "missing\.css" which is not in css\/common/,
    );
  });

  it("throws on a self import", () => {
    const sources = new Map([["a.css", src(["a.css"])]]);
    expect(() => orderCss(sources, "common")).toThrow(/a\.css imports itself/);
  });

  it("throws on an import cycle and names the cycle path", () => {
    const sources = new Map([
      ["a.css", src(["b.css"])],
      ["b.css", src(["a.css"])],
    ]);
    expect(() => orderCss(sources, "common")).toThrow(
      /import cycle: a\.css → b\.css → a\.css/,
    );
  });

  it("names the component directory in error messages", () => {
    const sources = new Map([["a.css", src(["missing.css"])]]);
    expect(() => orderCss(sources, "LayerControl")).toThrow(
      /which is not in css\/LayerControl\//,
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

describe("mergeCss", () => {
  it("joins modules in dependency order with imports stripped", () => {
    const sources = new Map([
      ["panel.css", src(["token.css"], ".panel { color: red; }")],
      ["token.css", src([], ":root { --x: 1; }")],
    ]);
    expect(mergeCss(sources, "common")).toBe(
      ":root { --x: 1; }\n.panel { color: red; }",
    );
  });

  it("accepts an empty set", () => {
    expect(mergeCss(new Map(), "common")).toBe("");
  });
});

describe("expandEntry", () => {
  it("replaces each @import with its module, in entry order", () => {
    const sources = new Map([
      ["index.css", '@import "./a.css";\n@import "./b.css";'],
      ["a.css", ".a { color: red; }"],
      ["b.css", ".b { color: blue; }"],
    ]);
    expect(expandEntry(sources, "index.css", "LayerControl")).toBe(
      ".a { color: red; }\n.b { color: blue; }",
    );
  });

  it("keeps the entry's own rules in place around the modules", () => {
    const sources = new Map([
      ["index.css", '@import "./a.css";\n.own { color: green; }'],
      ["a.css", ".a { color: red; }"],
    ]);
    expect(expandEntry(sources, "index.css", "LayerControl")).toBe(
      ".a { color: red; }\n.own { color: green; }",
    );
  });

  it("strips a module's own imports (component modules are leaves; tokens live in css/common)", () => {
    const sources = new Map([
      ["index.css", '@import "./a.css";'],
      ["a.css", '@import "token.css";\n.a { color: red; }'],
      ["token.css", ":root { --x: 1; }"],
    ]);
    // The module's `@import "token.css"` is dropped — the shared tokens are
    // already injected via foliplus-common.min.css, so a component module must
    // not pull them in a second time.
    expect(expandEntry(sources, "index.css", "LayerControl")).toBe(
      ".a { color: red; }",
    );
  });

  it("throws when the entry is missing", () => {
    expect(() => expandEntry(new Map([["a.css", ".a {}"]]), "index.css", "X")).toThrow(
      /has no entry "index\.css"/,
    );
  });

  it("throws on an import that resolves outside the set", () => {
    const sources = new Map([["index.css", '@import "./nope.css";']]);
    expect(() => expandEntry(sources, "index.css", "LayerControl")).toThrow(
      /which is not in css\/LayerControl\//,
    );
  });
});
