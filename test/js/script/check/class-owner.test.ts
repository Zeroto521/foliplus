// Guard test for `script/check/class-owner.mjs` — every `foliplus-*` class
// token has one owner and consumers read it from the owner module.
//
// The two red cases below are manufactured in a throwaway tree (via --root),
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
  scanConsumers,
  scanOwnerFile,
  tokensIn,
  walk,
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
});
