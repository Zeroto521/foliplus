// Guard test for `script/check/class-owner.mjs` — every `foliplus-*` class
// token has one owner and consumers read it from the owner module.
//
// The red cases below are manufactured in a throwaway tree (via --root),
// never in the repo, so the lint chain stays green while this file is being
// written:
//
//   - A second owner module declaring the same token trips the duplicate scan.
//   - A non-owner module spelling the token as a bare literal trips the
//     consumer scan.
//
// The green case runs the real repo and proves the baseline is clean.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildOwnerMap,
  main,
  pyFiles,
  scanConsumers,
  scanOwnerFile,
  scanPyConsumers,
  stripPyComments,
  tokensIn,
  walk,
  walkPy,
} from "#script/check/class-owner.mjs";

/** Build a throwaway `foliplus/js` tree with the given source files. */
const tempRoot = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "class-owner-"));
  for (const [rel, source] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return dir;
};

describe("tokensIn", () => {
  it("extracts a single foliplus token", () => {
    expect(tokensIn("foliplus-input")).toEqual(["foliplus-input"]);
  });

  it("extracts both tokens from a composite value", () => {
    expect(tokensIn("foliplus-x foliplus-y")).toEqual(["foliplus-x", "foliplus-y"]);
  });

  it("ignores non-foliplus tokens", () => {
    expect(tokensIn("is-dragging leaflet-control")).toEqual([]);
  });

  it("ignores data-* attributes and CSS variables", () => {
    expect(tokensIn("data-foliplus-x")).toEqual([]);
    expect(tokensIn("--foliplus-x")).toEqual([]);
  });
});

describe("scanOwnerFile", () => {
  it("finds a token in a vocabulary object", () => {
    const src =
      'const THING_CLASS = { KEY: "foliplus-thing" } as const;\nexport { THING_CLASS };\n';
    const root = tempRoot({ "foliplus/js/ui/thingClassName.ts": src });
    try {
      const abs = path.join(root, "foliplus/js/ui/thingClassName.ts");
      const sites = scanOwnerFile(abs, "foliplus/js/ui/thingClassName.ts");
      expect(sites).toHaveLength(1);
      expect(sites[0].token).toBe("foliplus-thing");
      expect(sites[0].owner).toBe("foliplus/js/ui/thingClassName.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips selector values and composite values", () => {
    const src = [
      "const SEL = {",
      '  PICKER: ".foliplus-x",',
      "};",
      "const CLASSES = {",
      '  COMPOSITE: "foliplus-x foliplus-y",',
      "};",
      "export { SEL, CLASSES };",
    ].join("\n");
    const root = tempRoot({ "foliplus/js/control/X/const.ts": src });
    try {
      const abs = path.join(root, "foliplus/js/control/X/const.ts");
      const sites = scanOwnerFile(abs, "foliplus/js/control/X/const.ts");
      expect(sites).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("dedupes the same token declared by two keys in one object", () => {
    // Two keys in one object spelling the same token are one owner site,
    // not two (the guard against PATH_SOLID / PATH_DASHED duplication).
    const src = [
      "const THING_CLASS = {",
      '  A: "foliplus-thing",',
      '  B: "foliplus-thing",',
      "} as const;",
      "export { THING_CLASS };",
    ].join("\n");
    const root = tempRoot({ "foliplus/js/ui/thingClassName.ts": src });
    try {
      const abs = path.join(root, "foliplus/js/ui/thingClassName.ts");
      const sites = scanOwnerFile(abs, "foliplus/js/ui/thingClassName.ts");
      expect(sites).toHaveLength(1);
      expect(sites[0].token).toBe("foliplus-thing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("buildOwnerMap", () => {
  it("reports a second owner module as a duplicate", () => {
    const a = 'const A = { K: "foliplus-shared" } as const;\nexport { A };\n';
    const c =
      'const CLASSES = { K: "foliplus-shared" } as const;\nexport { CLASSES };\n';
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": a,
      "foliplus/js/control/X/const.ts": c,
    });
    try {
      const map = buildOwnerMap(root);
      expect(map.get("foliplus-shared")).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("scanConsumers", () => {
  it("flags a non-owner module that spells an owned token", () => {
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const consumer = [
      "export function paint() {",
      '  const cls = "foliplus-x";',
      "  return cls;",
      "}",
    ].join("\n");
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "foliplus/js/control/X/ui.ts": consumer,
    });
    try {
      const ownerMap = buildOwnerMap(root);
      const hits = scanConsumers(root, ownerMap, { includeCore: false });
      expect(hits).toHaveLength(1);
      expect(hits[0].token).toBe("foliplus-x");
      expect(hits[0].file).toBe("foliplus/js/control/X/ui.ts");
      expect(hits[0].owners[0].owner).toBe("foliplus/js/ui/aClassName.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not flag a consumer that is itself the owner", () => {
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const root = tempRoot({ "foliplus/js/ui/aClassName.ts": vocab });
    try {
      const ownerMap = buildOwnerMap(root);
      expect(scanConsumers(root, ownerMap, { includeCore: false })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips core when includeCore is false and scans it when true", () => {
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const coreSrc = [
      "export function f() {",
      '  const cls = "foliplus-x";',
      "  return cls;",
      "}",
    ].join("\n");
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "foliplus/js/core/c.ts": coreSrc,
    });
    try {
      const ownerMap = buildOwnerMap(root);
      expect(scanConsumers(root, ownerMap, { includeCore: false })).toEqual([]);
      const withCore = scanConsumers(root, ownerMap, { includeCore: true });
      expect(withCore).toHaveLength(1);
      expect(withCore[0].file).toBe("foliplus/js/core/c.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips a token spelled inside an excluded directory", () => {
    // test/ (and foliplus/locale, doc, script, .foliplus) are readers of the
    // class names, not TS-import consumers — a literal there is not a drift.
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "test/js/x.ts": 'export const cls = "foliplus-x";',
    });
    try {
      const ownerMap = buildOwnerMap(root);
      expect(scanConsumers(root, ownerMap, { includeCore: false })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips a non-owner file that lives in an excluded directory", () => {
    // EXCLUDED_DIR_PARTS (test, doc, script, .foliplus, foliplus/locale) are
    // readers of the class names, not TS-import consumers; a literal there is
    // not a drift even when it spells an owned token. The excluded check runs
    // on the path segments, so a file at foliplus/js/test/x.ts is skipped.
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "foliplus/js/test/x.ts": 'export const c = "foliplus-x";',
    });
    try {
      const ownerMap = buildOwnerMap(root);
      expect(scanConsumers(root, ownerMap, { includeCore: false })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads single-quoted and template literals", () => {
    const vocab =
      'const A = { K: "foliplus-x", L: "foliplus-y" } as const;\nexport { A };\n';
    const consumer = [
      "export const a = 'foliplus-x';",
      "export const b = `foliplus-y`;",
    ].join("\n");
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "foliplus/js/control/X/ui.ts": consumer,
    });
    try {
      const ownerMap = buildOwnerMap(root);
      const hits = scanConsumers(root, ownerMap, { includeCore: false });
      expect(hits).toHaveLength(2);
      expect(hits.map(h => h.token).sort()).toEqual(["foliplus-x", "foliplus-y"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips a template literal with interpolation", () => {
    // `${...}` makes the literal non-static; only static literals are policed.
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const consumer = "export const t = `foliplus-x ${v}`;";
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "foliplus/js/control/X/ui.ts": consumer,
    });
    try {
      const ownerMap = buildOwnerMap(root);
      expect(scanConsumers(root, ownerMap, { includeCore: false })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores a token with no declared owner", () => {
    // Unknown tokens are duplicate-class-def's problem, not this guard's.
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "foliplus/js/control/X/ui.ts": 'export const c = "foliplus-orphan";',
    });
    try {
      const ownerMap = buildOwnerMap(root);
      expect(scanConsumers(root, ownerMap, { includeCore: false })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not flag a file that owns the token in a hand-built map", () => {
    // Defensive: an ownerMap entry may point at a non-owner file that also
    // spells the token; that file is an owner, not a drifting consumer.
    const ownerMap = new Map<
      string,
      { token: string; owner: string; line: number }[]
    >();
    ownerMap.set("foliplus-x", [
      { token: "foliplus-x", owner: "foliplus/js/control/X/ui.ts", line: 1 },
    ]);
    const root = tempRoot({
      "foliplus/js/control/X/ui.ts": 'export const c = "foliplus-x";',
    });
    try {
      expect(scanConsumers(root, ownerMap, { includeCore: false })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("walk", () => {
  it("recurses into subdirectories and only reads code files", () => {
    const root = tempRoot({
      "foliplus/js/a.ts": "export const a = 1;\n",
      "foliplus/js/nested/deep/b.ts": "export const b = 2;\n",
      "foliplus/js/style.css": "body { color: red; }\n",
    });
    try {
      const jsRoot = path.join(root, "foliplus/js");
      const files = walk(jsRoot).map(f =>
        f.slice(jsRoot.length + 1).replace(/\\/g, "/"),
      );
      expect(files).toContain("a.ts");
      expect(files).toContain("nested/deep/b.ts");
      expect(files.some(f => f.endsWith(".css"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns an empty list for a non-existent directory", () => {
    // The guard lets the walker be pointed at a path that is not there
    // (e.g. a freshly created tree before the source root exists) without
    // crashing — it yields no files and the scans are vacuously clean.
    expect(walk(path.join(os.tmpdir(), `class-owner-missing-${Date.now()}`))).toEqual(
      [],
    );
  });
});

describe("scanPyConsumers", () => {
  it("flags a Python string literal spelling an owned token", () => {
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const py = 'class X:\n    CLS = "foliplus-x"\n';
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "foliplus/control/X.py": py,
    });
    try {
      const ownerMap = buildOwnerMap(root);
      const hits = scanPyConsumers(root, ownerMap);
      expect(hits).toHaveLength(1);
      expect(hits[0].token).toBe("foliplus-x");
      expect(hits[0].file).toBe("foliplus/control/X.py");
      expect(hits[0].owners[0].owner).toBe("foliplus/js/ui/aClassName.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not flag a token mentioned only in a docstring or comment", () => {
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const py = [
      '"""Uses the foliplus-x class for theming."""',
      "# foliplus-x in a comment",
      "class X: pass",
    ].join("\n");
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "foliplus/control/X.py": py,
    });
    try {
      const ownerMap = buildOwnerMap(root);
      expect(scanPyConsumers(root, ownerMap)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips a token with no declared owner", () => {
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const py = 'class X:\n    CLS = "foliplus-orphan"\n';
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "foliplus/control/X.py": py,
    });
    try {
      const ownerMap = buildOwnerMap(root);
      expect(scanPyConsumers(root, ownerMap)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips an interpolated f-string literal", () => {
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const py = 'CLS = f"foliplus-x-{n}"\n';
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "foliplus/control/X.py": py,
    });
    try {
      const ownerMap = buildOwnerMap(root);
      expect(scanPyConsumers(root, ownerMap)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits 1 with --check when a Python file spells an owned token", () => {
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const py = 'class X:\n    CLS = "foliplus-x"\n';
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "foliplus/control/X.py": py,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main(["--check", "--root", root])).toBe(1);
      const calls = errorSpy.mock.calls.flat().join("\n");
      expect(calls).toContain("Python non-owner bare literals");
      expect(calls).toContain("foliplus-x");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("walkPy finds python files and skips the locale dir", () => {
    const root = tempRoot({
      "foliplus/control/a.py": "x = 1\n",
      "foliplus/control/b.py": "y = 2\n",
      "foliplus/locale/LayerControl/en.json": "{}\n",
      "foliplus/locale/LayerControl/zh.py": "z = 3\n",
    });
    try {
      const pyRoot = path.join(root, "foliplus");
      const files = walkPy(pyRoot).map(x =>
        x.slice(pyRoot.length + 1).replace(/\\/g, "/"),
      );
      expect(files.sort()).toEqual(["control/a.py", "control/b.py"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stripPyComments removes docstrings and comments", () => {
    const py = [
      '"""module docstring foliplus-x"""',
      "# comment foliplus-x",
      'CLS = "foliplus-x"  # trailing foliplus-x',
    ].join("\n");
    const stripped = stripPyComments(py);
    expect(stripped).not.toContain("module docstring");
    expect(stripped).not.toContain("# comment");
    expect(stripped).toContain('CLS = "foliplus-x"');
  });

  it("pyFiles returns the python source files under the root", () => {
    const root = tempRoot({
      "foliplus/control/a.py": "x = 1\n",
      "foliplus/control/b.py": "y = 2\n",
      "foliplus/js/notpy.ts": "const a = 1;\n",
    });
    try {
      const files = pyFiles(root);
      expect(files).toHaveLength(2);
      expect(files.some(x => x.endsWith("a.py"))).toBe(true);
      expect(files.some(x => x.endsWith("b.py"))).toBe(true);
      expect(files.some(x => x.endsWith("notpy.ts"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("walkPy tolerates a missing directory", () => {
    // Regression for the !fs.existsSync early return: a missing scan root
    // must yield no files, not throw.
    expect(walkPy(path.join(os.tmpdir(), "class-owner-missing-py"))).toEqual([]);
  });

  it("scanPyConsumers skips an interpolated f-string literal with a real $", () => {
    // The \${...} interpolated-skip branch is only reached when the literal
    // contains a dollar sign; a plain f-string prefix does not count.
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const py = 'CLS = "foliplus-x $n"\n';
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "foliplus/control/X.py": py,
    });
    try {
      const ownerMap = buildOwnerMap(root);
      expect(scanPyConsumers(root, ownerMap)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("scanPyConsumers finds a hit in a single-quoted python string", () => {
    // Both quote styles are scanned; the single-quote branch of the literal
    // regex must also be exercised.
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const py = "class X:\n    CLS = \'foliplus-x\'\n";
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "foliplus/control/X.py": py,
    });
    try {
      const ownerMap = buildOwnerMap(root);
      const hits = scanPyConsumers(root, ownerMap);
      expect(hits).toHaveLength(1);
      expect(hits[0].token).toBe("foliplus-x");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("main", () => {
  it("exits 0 on a clean tree and 1 on a duplicate with --check", () => {
    const cleanVocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const dirtyConst =
      'const CLASSES = { K: "foliplus-x" } as const;\nexport { CLASSES };\n';
    const cleanRoot = tempRoot({ "foliplus/js/ui/aClassName.ts": cleanVocab });
    const dirtyRoot = tempRoot({
      "foliplus/js/ui/aClassName.ts": cleanVocab,
      "foliplus/js/control/X/const.ts": dirtyConst,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main(["--check", "--root", cleanRoot])).toBe(0);
      expect(main(["--check", "--root", dirtyRoot])).toBe(1);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      rmSync(cleanRoot, { recursive: true, force: true });
      rmSync(dirtyRoot, { recursive: true, force: true });
    }
  });

  it("exits 1 when a non-owner file spells an owned token with --check", () => {
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const consumer = [
      "export function paint() {",
      '  const cls = "foliplus-x";',
      "  return cls;",
      "}",
    ].join("\n");
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "foliplus/js/control/X/ui.ts": consumer,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main(["--check", "--root", root])).toBe(1);
      expect(errorSpy).toHaveBeenCalled();
      const calls = errorSpy.mock.calls.flat().join("\n");
      expect(calls).toContain("Non-owner bare literals");
      expect(calls).toContain("foliplus-x");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("inventory mode exits 0 even when there are failures", () => {
    // Without --check the script prints the inventory and always exits 0;
    // the failure is reported but is not a lint error in inventory mode.
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const consumer = [
      "export function paint() {",
      '  const cls = "foliplus-x";',
      "  return cls;",
      "}",
    ].join("\n");
    const root = tempRoot({
      "foliplus/js/ui/aClassName.ts": vocab,
      "foliplus/js/control/X/ui.ts": consumer,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main(["--root", root])).toBe(0);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports the all-tiers scope when --include-core is passed", () => {
    const vocab = 'const A = { K: "foliplus-x" } as const;\nexport { A };\n';
    const root = tempRoot({ "foliplus/js/ui/aClassName.ts": vocab });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(main(["--include-core", "--root", root])).toBe(0);
      expect(logSpy).toHaveBeenCalled();
      const calls = logSpy.mock.calls.flat().join("\n");
      expect(calls).toContain("all tiers");
    } finally {
      logSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses process.cwd() when --root is absent", () => {
    // The real repo is the clean baseline; no --root means the default
    // (process.cwd()) is scanned and the baseline passes.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main([])).toBe(0);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("falls back to the caller root when --root has no value", () => {
    // A dangling --root (no value) leaves the caller-supplied root in place;
    // the real repo is clean, so the scan passes and exit is 0.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main(["--root"])).toBe(0);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
