import { generateRegistry, scanImports } from "#script/scan-registry.mjs";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";

const FS = require("fs");
const PATH = require("path");
const OS = require("os");

let tmpDir: string;

afterEach(() => {
  if (tmpDir) {
    try {
      FS.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
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
    expect(result["core/event"]).toContain("EventBus");
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

describe("generateRegistry", () => {
  /** Build a fake foliplus/js tree and return (jsDir, outputDir). */
  function buildFakeTree(files: Record<string, string>): [string, string] {
    tmpDir = PATH.join(OS.tmpdir(), "scan-registry-gen-" + Date.now());
    const jsDir = PATH.join(tmpDir, "js");
    mkdirSync(jsDir, { recursive: true });
    for (const [relative, content] of Object.entries(files)) {
      const filePath = PATH.join(jsDir, relative);
      mkdirSync(PATH.dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, "utf-8");
    }
    return [jsDir, tmpDir];
  }

  function readRegistry(buildDir: string): string {
    return readFileSync(PATH.join(buildDir, "_shared-registry.ts"), "utf-8");
  }

  it("generates registry with shared modules", () => {
    const [jsDir, buildDir] = buildFakeTree({
      "common/dom.ts": `export const dom = {};`,
      "core/event/index.ts": `export const EventBus = {};`,
      "runtime/index.ts": `import { dom } from "#common/dom.js";`,
      "MyComponent/index.ts": `import { dom } from "#common/dom.js";`,
      "MyComponent/util.ts": `import { EventBus } from "#core/event/index.js";`,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).toContain('window.foliplus.core["event"]');
    expect(output).toContain("#core/event/index.js");
    expect(output).toContain("window.foliplus.common");
  });

  it("skips core files registered in runtime/index.ts", () => {
    const [jsDir, buildDir] = buildFakeTree({
      "common/dom.ts": `export const dom = {};`,
      "core/component.ts": `export const COMPONENTS = {};`,
      "core/hint.ts": `export const ensureHint = () => {};`,
      "core/mode.ts": `export const ModeManager = {};`,
      "runtime/index.ts": `import { dom } from "#common/dom.js";`,
      "MyComponent/index.ts": `
        import { COMPONENTS } from "#core/component.js";
        import { ensureHint } from "#core/hint.js";
        import { ModeManager } from "#core/mode.js";
        import { dom } from "#common/dom.js";
      `,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    // component/hint/mode are registered manually in runtime/index.ts → skipped.
    expect(output).not.toContain("core/component");
    expect(output).not.toContain("core/hint");
    expect(output).not.toContain("core/mode");
  });

  it("keeps core subdirectories (event) in registry", () => {
    const [jsDir, buildDir] = buildFakeTree({
      "common/dom.ts": `export const dom = {};`,
      "core/event/index.ts": `export const EventBus = {};`,
      "core/component.ts": `export const COMPONENTS = {};`,
      "runtime/index.ts": ``,
      "MyComponent/index.ts": `import { EventBus } from "#core/event/index.js";`,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).toContain("core/event");
    expect(output).not.toContain("core/component");
  });

  it("registers BaseControl", () => {
    const [jsDir, buildDir] = buildFakeTree({
      "common/dom.ts": `export const dom = {};`,
      "core/empty.ts": ``,
      "runtime/index.ts": ``,
      "MyComponent/index.ts": `import { BaseControl } from "#foliplus/BaseControl.js";`,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).toContain("window.foliplus.BaseControl");
    expect(output).toContain("#foliplus/BaseControl.js");
  });

  it("writes valid output for empty component set", () => {
    const [jsDir, buildDir] = buildFakeTree({
      "common/dom.ts": `export const dom = {};`,
      "core/empty.ts": ``,
      "runtime/index.ts": ``,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).toContain("// AUTO-GENERATED");
    expect(output).toContain("window.foliplus = window.foliplus || {};");
  });
});
