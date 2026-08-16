import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { scanImports } from "../../../script/scan-registry.mjs";

const FS = require("fs");
const PATH = require("path");
const OS = require("os");

let tmpDir: string;

afterEach(() => {
  if (tmpDir) {
    try { FS.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

function mkDir(name: string, files: Record<string, string>): string {
  tmpDir = PATH.join(OS.tmpdir(), "scan-registry-test-" + Date.now());
  mkdirSync(tmpDir, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const filePath = PATH.join(tmpDir, relative);
    mkdirSync(PATH.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
  }
  return tmpDir;
}

describe("scanImports", () => {
  it("scans named imports from component files", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `import { dom, cssVar } from "#common/dom.js";`,
      "Component2/index.ts": `import { debounce } from "#common/debounce.js";`,
    });
    const result = scanImports(dir);
    expect(result["common/dom"]).toContain("dom");
    expect(result["common/dom"]).toContain("cssVar");
    expect(result["common/debounce"]).toContain("debounce");
  });

  it("scans imports from subdirectories", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `import { foo } from "#common/foo.js";`,
      "Component1/util.ts": `import { bar } from "#common/bar.js";`,
    });
    const result = scanImports(dir);
    expect(result["common/foo"]).toContain("foo");
    expect(result["common/bar"]).toContain("bar");
  });

  it("ignores type-only imports", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `import { type SomeType, dom } from "#common/dom.js";`,
    });
    const result = scanImports(dir);
    expect(result["common/dom"]).toContain("dom");
    expect(result["common/dom"]).not.toContain("SomeType");
  });

  it("resolves import * as to property access", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `
        import * as Icons from "#common/icon.js";
        const x = Icons.CLOSE;
        const y = Icons.OPEN;
      `,
      "Component1/util.ts": `
        import * as Storage from "#common/storage.js";
        Storage.load();
        Storage.save();
      `,
    });
    const result = scanImports(dir);
    expect(result["common/icon"]).toContain("CLOSE");
    expect(result["common/icon"]).toContain("OPEN");
    expect(result["common/storage"]).toContain("load");
    expect(result["common/storage"]).toContain("save");
  });

  it("ignores array methods on namespace imports", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `
        import * as Icons from "#common/icon.js";
        const arr = [];
        arr.forEach(x => Icons[x]);
        arr.push(Icons.CLOSE);
        arr.length;
      `,
    });
    const result = scanImports(dir);
    expect(result["common/icon"]).toContain("CLOSE");
    // Should NOT contain array methods
    expect(result["common/icon"]).not.toContain("forEach");
    expect(result["common/icon"]).not.toContain("push");
    expect(result["common/icon"]).not.toContain("length");
  });

  it("scans core imports", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `
        import { COMPONENTS } from "#core/component.js";
        import { ensureHint } from "#core/hint.js";
        import { EventBus } from "#core/event/index.js";
      `,
    });
    const result = scanImports(dir);
    expect(result["core/component"]).toContain("COMPONENTS");
    expect(result["core/hint"]).toContain("ensureHint");
    expect(result["core/event/index"]).toContain("EventBus");
  });

  it("scans BaseControl import", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `import { BaseControl } from "#foliplus/BaseControl.js";`,
    });
    const result = scanImports(dir);
    expect(result["foliplus/BaseControl"]).toContain("BaseControl");
  });

  it("aggregates imports across files", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `import { dom } from "#common/dom.js";`,
      "Component2/index.ts": `import { cssVar, escapeHTML } from "#common/dom.js";`,
    });
    const result = scanImports(dir);
    expect(result["common/dom"]).toEqual(["cssVar", "dom", "escapeHTML"]);
  });

  it("handles empty directory", () => {
    const dir = mkDir("empty", {});
    const result = scanImports(dir);
    expect(result).toEqual({});
  });

  it("ignores .d.ts files", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `import { dom } from "#common/dom.js";`,
      "Component1/types.d.ts": `import { dom } from "#common/dom.js";`,
    });
    const result = scanImports(dir);
    expect(result["common/dom"]).toEqual(["dom"]);
  });
});
