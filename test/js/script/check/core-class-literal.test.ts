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
import { afterEach, describe, expect, it, vi } from "vitest";
import { main, scan, walk } from "#script/check/core-class-literal.mjs";

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

  it("does not trip on a .selector string", () => {
    const root = tempRoot({
      "foliplus/js/core/value/scratch.ts": 'const sel = ".foliplus-scheme-picker-x";',
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

describe("walk", () => {
  it("recurses into subdirectories and skips non-code files", () => {
    // Covers both arms of the extension test inside walk: a nested
    // directory is walked (e.isDirectory arm), a .css file is skipped
    // (regex does not match), and a .ts file is included (regex matches).
    const root = tempRoot({
      "foliplus/js/core/value/scratch.ts": "const x = 1;",
      "foliplus/js/core/style.css": "body { color: red; }",
      "foliplus/js/core/nested/deep/inner.ts": "const y = 2;",
    });
    try {
      const rootDir = path.resolve(root, "foliplus/js/core");
      const files = walk(rootDir).map(f =>
        f.slice(rootDir.length + 1).replace(/\\/g, "/"),
      );
      expect(files).toContain("value/scratch.ts");
      expect(files).toContain("nested/deep/inner.ts");
      expect(files.some(f => f.endsWith(".css"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("main (inventory mode, no hits)", () => {
  it("logs each hit to stderr when not in --check mode", () => {
    // Covers the for-loop and console.error arm in main that runs when
    // hits exist and --check is not passed (exit code is still 0).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const root = tempRoot({
      "foliplus/js/core/value/scratch.ts": 'const c = "foliplus-scheme-picker-hidden";',
    });
    try {
      expect(main(["--root", root])).toBe(0);
      expect(errorSpy).toHaveBeenCalled();
      const calls = errorSpy.mock.calls.flat().join("\n");
      expect(calls).toContain("foliplus-scheme-picker-hidden");
      expect(calls).toContain("Read these from");
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("main --root handling", () => {
  it("resolves a --root flag value when given", () => {
    // Covers the argv[rootIdx+1] arm: --root present means its value is
    // resolved, not the process.cwd() fallback.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const root = tempRoot({
      "foliplus/js/core/value/scratch.ts": "const x = 1;",
    });
    try {
      expect(main(["--root", root])).toBe(0);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to process.cwd() when --root is absent", () => {
    // Covers the `?? root` arm: no --root flag means the default
    // (process.cwd()) is used. We run against the repo itself, which is
    // clean (no scheme-picker literals in core), so exit is 0.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(main([])).toBe(0);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("falls back to cwd when --root has no value", () => {
    // A dangling --root (no value after it) is malformed argv. The guard
    // must not crash: override is undefined, root stays process.cwd(), and
    // scan runs against the repo core tree (which is clean).
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(main(["--root"])).toBe(0);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});
