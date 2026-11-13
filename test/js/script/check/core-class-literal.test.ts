// Guard test for `script/check/core-class-literal.mjs` — no scheme-picker
// class literal in core production code.
//
// The red case manufactures a bare `foliplus-scheme-picker-*` literal in a
// throwaway core tree and proves the scanner finds it. The green cases
// exercise the two-sided boundary: `data-foliplus-scheme-picker-x` (an
// attribute) and `--foliplus-scheme-picker-x` (a CSS variable) share the
// name but are not class tokens, and the left-side negative lookbehind must
// keep them out of the hit list.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, scan } from "#script/check/core-class-literal.mjs";

/** Build a throwaway `foliplus/js/core` tree with the given files, so a
 *  hit can be injected without touching production. */
const tempRoot = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "core-class-literal-"));
  for (const [rel, source] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return dir;
};

afterEach(() => {
  // mkdtempSync dirs are removed by each test that created them; nothing
  // global to restore.
});

describe("scan", () => {
  it("is empty on a core tree with no scheme-picker literals", () => {
    const root = tempRoot({
      "foliplus/js/core/value/scratch.ts": 'const x = "unrelated";',
    });
    try {
      expect(scan(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("finds a bare class literal in a core file", () => {
    const root = tempRoot({
      "foliplus/js/core/value/scratch.ts":
        'const sel = `<div class="foliplus-scheme-picker-bar"></div>`;',
    });
    try {
      const hits = scan(root);
      expect(hits).toHaveLength(1);
      expect(hits[0].token).toBe("foliplus-scheme-picker-bar");
      expect(hits[0].file).toContain("core/value/scratch.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not trip on a data-* attribute", () => {
    const root = tempRoot({
      "foliplus/js/core/value/scratch.ts": 'const a = "data-foliplus-scheme-picker-x";',
    });
    try {
      expect(scan(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not trip on a CSS variable", () => {
    const root = tempRoot({
      "foliplus/js/core/value/scratch.ts": 'const b = "--foliplus-scheme-picker-y";',
    });
    try {
      expect(scan(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not trip on a comment mention", () => {
    const root = tempRoot({
      "foliplus/js/core/value/scratch.ts":
        "// The foliplus-scheme-picker-bar recipe is shared.",
    });
    try {
      expect(scan(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("main --check", () => {
  it("exits 0 with no hits and 1 with a bare literal", () => {
    const cleanRoot = tempRoot({
      "foliplus/js/core/value/scratch.ts": "const x = 1;",
    });
    const dirtyRoot = tempRoot({
      "foliplus/js/core/value/scratch.ts": 'const c = "foliplus-scheme-picker-hidden";',
    });
    try {
      expect(main(["--check", "--root", cleanRoot])).toBe(0);
      expect(main(["--check", "--root", dirtyRoot])).toBe(1);
    } finally {
      rmSync(cleanRoot, { recursive: true, force: true });
      rmSync(dirtyRoot, { recursive: true, force: true });
    }
  });
});
