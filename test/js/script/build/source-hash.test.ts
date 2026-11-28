// test/js/script/build/source-hash — the manifest freshness hash is stable, order-independent and excludes build outputs
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { computeSourceHash, sourceFiles } from "#script/build/source-hash.mjs";

const roots: string[] = [];

/** Write a temp source tree, returning its root. */
const tree = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "source-hash-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = resolve(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
};

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("computeSourceHash", () => {
  it("is deterministic for the same tree", () => {
    const files = {
      "foliplus/js/a.ts": "export const a = 1;\n",
      "foliplus/css/a.css": ".a { color: red; }\n",
    };
    expect(computeSourceHash(tree(files))).toBe(computeSourceHash(tree(files)));
  });

  it("does not depend on the order files were created", () => {
    const forward = tree({
      "foliplus/js/a.ts": "a",
      "foliplus/js/b.ts": "b",
    });
    const backward = tree({
      "foliplus/js/b.ts": "b",
      "foliplus/js/a.ts": "a",
    });
    expect(computeSourceHash(forward)).toBe(computeSourceHash(backward));
  });

  it("changes when a JS source changes", () => {
    const before = tree({ "foliplus/js/a.ts": "export const a = 1;\n" });
    const after = tree({ "foliplus/js/a.ts": "export const a = 2;\n" });
    expect(computeSourceHash(before)).not.toBe(computeSourceHash(after));
  });

  it("changes when a CSS source changes", () => {
    const before = tree({ "foliplus/css/a.css": ".a { color: red; }\n" });
    const after = tree({ "foliplus/css/a.css": ".a { color: blue; }\n" });
    expect(computeSourceHash(before)).not.toBe(computeSourceHash(after));
  });

  it("changes when a source file is renamed without changing content", () => {
    const before = tree({ "foliplus/js/a.ts": "same" });
    const after = tree({ "foliplus/js/b.ts": "same" });
    expect(computeSourceHash(before)).not.toBe(computeSourceHash(after));
  });

  it("ignores dist/, .build/, node_modules/ and sourcemaps", () => {
    const base = {
      "foliplus/js/a.ts": "export const a = 1;\n",
      "foliplus/css/a.css": ".a { color: red; }\n",
    };
    const withOutputs = {
      ...base,
      "foliplus/dist/foliplus-common.min.js": "// built\n",
      "foliplus/dist/manifest.json": "{}\n",
      "foliplus/.build/js/_shared-registry.ts": "// generated\n",
      "foliplus/node_modules/x/index.js": "// dep\n",
      "foliplus/js/a.ts.map": JSON.stringify({ version: 3 }),
    };
    expect(computeSourceHash(tree(withOutputs))).toBe(computeSourceHash(tree(base)));
  });

  it("ignores files outside foliplus/js and foliplus/css", () => {
    const base = { "foliplus/js/a.ts": "a" };
    const extra = {
      ...base,
      "foliplus/control/Thing.py": "class Thing: pass\n",
      "foliplus/locale/en.json": "{}\n",
    };
    expect(computeSourceHash(tree(extra))).toBe(computeSourceHash(tree(base)));
  });

  it("handles a root with only one of the two trees, and an empty tree", () => {
    const jsOnly = tree({ "foliplus/js/a.ts": "a" });
    expect(computeSourceHash(jsOnly)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeSourceHash(tree({}))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("sourceFiles", () => {
  it("lists POSIX relative paths in sorted order", () => {
    const root = tree({
      "foliplus/js/b.ts": "b",
      "foliplus/js/A/a.ts": "a",
      "foliplus/css/c.css": "c",
    });
    expect(sourceFiles(root)).toEqual([
      "foliplus/css/c.css",
      "foliplus/js/A/a.ts",
      "foliplus/js/b.ts",
    ]);
  });
});
