import { runCli, trapExit } from "../fixture.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectExportedNames,
  generateRegistry,
  registryUsedExports,
} from "#script/build/scan-registry.mjs";

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
  tmpDir = PATH.join(OS.tmpdir(), `scan-registry-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const filePath = PATH.join(tmpDir, relative);
    mkdirSync(PATH.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
  }
  return tmpDir;
}

const usedExports = (dir: string): Record<string, string[]> =>
  registryUsedExports(dir) as Record<string, string[]>;

describe("registryUsedExports", () => {
  it("scans named imports from component files", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `import { dom, cssVar } from "#platform/dom.js";`,
      "Component2/index.ts": `import { debounce } from "#platform/debounce.js";`,
    });
    const result = usedExports(dir);
    expect(result["platform/dom"]).toContain("dom");
    expect(result["platform/dom"]).toContain("cssVar");
    expect(result["platform/debounce"]).toContain("debounce");
  });

  it("scans imports from subdirectories", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `import { foo } from "#platform/foo.js";`,
      "Component1/util.ts": `import { bar } from "#platform/bar.js";`,
    });
    const result = usedExports(dir);
    expect(result["platform/foo"]).toContain("foo");
    expect(result["platform/bar"]).toContain("bar");
  });

  it("ignores type-only imports", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `import { type SomeType, dom } from "#platform/dom.js";`,
    });
    const result = usedExports(dir);
    expect(result["platform/dom"]).toContain("dom");
    expect(result["platform/dom"]).not.toContain("SomeType");
  });

  it("resolves import * as to property access", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `
        import * as Icons from "#platform/icon.js";
        const x = Icons.ICON_CLOSE;
        const y = Icons.OPEN;
      `,
      "Component1/util.ts": `
        import * as Storage from "#platform/storage.js";
        Storage.loadRecord();
        Storage.saveRecord();
      `,
    });
    const result = usedExports(dir);
    expect(result["platform/icon"]).toContain("ICON_CLOSE");
    expect(result["platform/icon"]).toContain("OPEN");
    expect(result["platform/storage"]).toContain("loadRecord");
    expect(result["platform/storage"]).toContain("saveRecord");
  });

  it("ignores array methods on namespace imports", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `
        import * as Icons from "#platform/icon.js";
        const arr = [];
        arr.forEach(x => Icons[x]);
        arr.push(Icons.ICON_CLOSE);
        arr.length;
      `,
    });
    const result = usedExports(dir);
    expect(result["platform/icon"]).toContain("ICON_CLOSE");
    // Should NOT contain array methods
    expect(result["platform/icon"]).not.toContain("forEach");
    expect(result["platform/icon"]).not.toContain("push");
    expect(result["platform/icon"]).not.toContain("length");
  });

  it("scans core imports", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `
        import { COMPONENTS } from "#core/lifecycle/component.js";
        import { ensureHint } from "#core/overlay/hint.js";
        import { EventBus } from "#core/event/index.js";
      `,
    });
    const result = usedExports(dir);
    expect(result["core/lifecycle/component"]).toContain("COMPONENTS");
    expect(result["core/overlay/hint"]).toContain("ensureHint");
    expect(result["core/event"]).toContain("EventBus");
  });

  it("scans BaseControl import", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `import { BaseControl } from "#foliplus/BaseControl.js";`,
    });
    const result = usedExports(dir);
    expect(result["foliplus/BaseControl"]).toContain("BaseControl");
  });

  it("aggregates imports across files", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `import { dom } from "#platform/dom.js";`,
      "Component2/index.ts": `import { createIconButton, dom } from "#platform/dom.js";`,
    });
    const result = usedExports(dir);
    expect(result["platform/dom"]).toEqual(["createIconButton", "dom"]);
  });

  it("handles empty directory", () => {
    const dir = mkDir("empty", {});
    const result = usedExports(dir);
    expect(result).toEqual({});
  });

  it("resolves a top-level core barrel to the bare `core` key", () => {
    // The scanner maps a specifier onto a key with no domain awareness:
    // `#core/index.js` and `#core/geo/index.js` both strip the trailing
    // `/index.js`, so they come out as `core` and `core/geo`. The guard that
    // turns the bare `core` key into nothing lives in `generateRegistry`, not
    // here — if that layer ever lost its `index.ts` exclusion, `core` would be
    // published as a registry module. Locking the shape keeps that failure
    // visible at the scanner level instead of only at the registry.
    const dir = mkDir("test", {
      "core/geo/index.ts": `export const fromWgs84 = () => {};`,
      "core/index.ts": `export { fromWgs84 } from "./geo/index.js";`,
      "MyComponent/index.ts": `
        import { fromWgs84 } from "#core/geo/index.js";
        import { fromWgs84 as again } from "#core/index.js";
      `,
    });
    const result = usedExports(dir);
    expect(result).toEqual({
      core: ["fromWgs84"],
      "core/geo": ["fromWgs84"],
    });
  });

  it("ignores .d.ts files", () => {
    const dir = mkDir("test", {
      "Component1/index.ts": `import { dom } from "#platform/dom.js";`,
      "Component1/types.d.ts": `import { dom } from "#platform/dom.js";`,
    });
    const result = usedExports(dir);
    expect(result["platform/dom"]).toEqual(["dom"]);
  });
});

describe("generateRegistry", () => {
  /** Build a fake foliplus/js tree and return (jsDir, outputDir). */
  function buildFakeTree(files: Record<string, string>): [string, string] {
    tmpDir = PATH.join(OS.tmpdir(), `scan-registry-gen-${Date.now()}`);
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
      "platform/dom.ts": `export const dom = {};`,
      "core/event/index.ts": `export const EventBus = {};`,
      "runtime/index.ts": `import { dom } from "#platform/dom.js";`,
      "control/MyComponent/index.ts": `import { dom } from "#platform/dom.js";`,
      "control/MyComponent/util.ts": `import { EventBus } from "#core/event/index.js";`,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).toContain('window.foliplus.core["event"]');
    expect(output).toContain("#core/event/index.js");
    expect(output).toContain("window.foliplus.platform");
  });

  it("folds a non-barrel #core/<sub>/<file> import into the sub's namespace", () => {
    // canonicalSpec keys `#core/layer/const.js` as `core/layer/const`, a key
    // the namespace loop never reads — yet the runtime shim resolves that
    // specifier to `foliplus.core.layer`, so without the fold the name
    // registers nothing and the component reads `undefined`. The generated
    // import pulls from the sub's index.js, so the barrel must re-export
    // the name or the build fails.
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "core/layer/index.ts": `export const HIDDEN = "hidden";`,
      "core/layer/const.ts": `export const HIDDEN = "hidden";`,
      "control/MyComponent/index.ts": `import { HIDDEN } from "#core/layer/const.js";`,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).toContain('window.foliplus.core["layer"]');
    expect(output).toContain('from "#core/layer/index.js"');
    expect(output).toContain("HIDDEN");
    // The file key itself must not leak into the artifact.
    expect(output).not.toContain("core/layer/const");
  });

  it("skips a core subdirectory nothing imports from", () => {
    // The sub exists on disk (so the namespace loop visits it) but no
    // component imports anything from it — with or without folded file
    // keys, an empty name set must emit nothing rather than an empty
    // import.
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "core/lonely/index.ts": `export const nothing = 1;`,
      "control/MyComponent/index.ts": `import { dom } from "#platform/dom.js";`,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).not.toContain('window.foliplus.core["lonely"]');
    expect(output).not.toContain("#core/lonely/index.js");
  });

  it("skips core files registered in runtime/index.ts", () => {
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "core/component.ts": `export const COMPONENTS = {};`,
      "core/hint.ts": `export const ensureHint = () => {};`,
      "core/mode.ts": `export const ModeManager = {};`,
      "runtime/index.ts": `import { dom } from "#platform/dom.js";`,
      "control/MyComponent/index.ts": `
        import { COMPONENTS } from "#core/lifecycle/component.js";
        import { ensureHint } from "#core/overlay/hint.js";
        import { ModeManager } from "#core/lifecycle/mode.js";
        import { dom } from "#platform/dom.js";
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
      "platform/dom.ts": `export const dom = {};`,
      "core/event/index.ts": `export const EventBus = {};`,
      "core/component.ts": `export const COMPONENTS = {};`,
      "runtime/index.ts": ``,
      "control/MyComponent/index.ts": `import { EventBus } from "#core/event/index.js";`,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).toContain("core/event");
    expect(output).not.toContain("core/component");
  });

  it("never registers a bare domain barrel (core/index.ts)", () => {
    // coreSubs and coreSingleFiles both exclude index.ts, so the registry can
    // only ever expose core/<sub> or core/<file>. A `core/index` registration
    // would mean an import resolves to a specifier nobody bundles — a barrel
    // with no runtime surface.
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "core/geo/index.ts": `export const fromWgs84 = () => {};`,
      "core/index.ts": `export { fromWgs84 } from "./geo/index.js";`,
      "runtime/index.ts": ``,
      "control/MyComponent/index.ts": `
        import { fromWgs84 } from "#core/geo/index.js";
        import { fromWgs84 as again } from "#core/index.js";
      `,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).toContain('window.foliplus.core["geo"]');
    expect(output).not.toContain("core/index");
    expect(output).not.toContain("#core/index.js");
  });

  it("registers BaseControl", () => {
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "core/empty.ts": ``,
      "runtime/index.ts": ``,
      "control/MyComponent/index.ts": `import { BaseControl } from "#foliplus/BaseControl.js";`,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).toContain("window.foliplus.BaseControl");
    expect(output).toContain("#foliplus/BaseControl.js");
  });

  it("skips BaseControl when the import names nothing", () => {
    // An empty named import `import { } from "#foliplus/BaseControl.js"`
    // records an empty names array for the spec, so `baseNames` is `[]`
    // rather than falling back to `["BaseControl"]` — the `if` false branch.
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "core/empty.ts": ``,
      "runtime/index.ts": ``,
      "control/MyComponent/index.ts": `import { } from "#foliplus/BaseControl.js";`,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).not.toContain("BaseControlNS");
  });

  it("uses an empty ui list when no ui/ directory exists", () => {
    // The existsSync(uiDir) ? ... : [] false branch: a source tree without a
    // ui/ layer must not throw and must not emit a ui namespace line.
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "core/empty.ts": ``,
      "runtime/index.ts": ``,
      "control/MyComponent/index.ts": `import { dom } from "#platform/dom.js";`,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).toContain("window.foliplus.ui = {};");
    expect(output).not.toContain("ui/panelChrome");
  });

  it("publishes ui modules a component actually imports", () => {
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "ui/panelChrome.ts": `export const panelButton = () => {};`,
      "core/empty.ts": ``,
      "runtime/index.ts": ``,
      "control/MyComponent/index.ts": `
        import { panelButton } from "#ui/panelChrome.js";
        import { dom } from "#platform/dom.js";
      `,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).toContain('window.foliplus.ui["panelChrome"]');
    expect(output).toContain('from "#ui/panelChrome.js"');
    expect(output).toContain("panelButton");
  });

  it("publishes the ui barrel at window.foliplus.ui.index", () => {
    // A component importing from "#ui/index.js" is scanned under canonical
    // key "ui" (canonicalSpec strips /index), separate from the per-module
    // ui/<name> keys. The registry must publish the barrel's re-exports at
    // window.foliplus.ui["index"] — exactly the namespace the component shim
    // reads (sharedGlobalNamespace("#ui/index.js") === "foliplus.ui.index") —
    // and not flattened onto the ui root.
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "ui/panelChrome.ts": `export const panelButton = () => {};`,
      "ui/index.ts": `export { panelButton } from "./panelChrome.js";`,
      "core/empty.ts": ``,
      "runtime/index.ts": ``,
      "control/MyComponent/index.ts": `
        import { panelButton } from "#ui/index.js";
        import { dom } from "#platform/dom.js";
      `,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).toContain('window.foliplus.ui["index"]');
    expect(output).toContain('from "#ui/index.js"');
    // Published as an inline object literal: the generated file carries no
    // per-namespace variable names, so there is nothing to keep consistent.
    expect(output).toContain('window.foliplus.ui["index"] = {');
    expect(output).not.toContain("uiIndexNS");
    expect(output).toContain("panelButton");
  });

  it("skips a ui module nothing imports from", () => {
    // if (names.length === 0) continue — a ui module on disk that no
    // component imports must emit nothing (no empty namespace object).
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "ui/panelChrome.ts": `export const panelButton = () => {};`,
      "core/empty.ts": ``,
      "runtime/index.ts": ``,
      "control/MyComponent/index.ts": `import { dom } from "#platform/dom.js";`,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).not.toContain('window.foliplus.ui["panelChrome"]');
    expect(output).not.toContain("#ui/panelChrome.js");
  });
  it("writes valid output for empty component set", () => {
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "core/empty.ts": ``,
      "runtime/index.ts": ``,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).toContain("// AUTO-GENERATED");
    expect(output).toContain("window.foliplus = window.foliplus || {};");
  });

  it("core carries no domain barrel on disk", () => {
    // `script/build/build.mjs` skips `entry.name === "core"` when discovering
    // components, so `core/index.ts` was never an entry point; a file added
    // here would be a re-export nobody resolves. The four subdomain barrels are
    // load-bearing and must stay — they are the intended shape of `core`.
    const coreDir = resolve(process.cwd(), "foliplus/js", "core");
    expect(existsSync(join(coreDir, "index.ts"))).toBe(false);
    for (const sub of ["geo", "geocode", "layer", "event"]) {
      expect(existsSync(join(coreDir, sub, "index.ts"))).toBe(true);
    }
  });

  it("throws when a component imports a name the ui barrel does not re-export", () => {
    // The guard's core case: `ui/index.ts` re-exports `panelButton` but the
    // component asks the barrel for `missingName`. Without the guard the
    // registry would publish `window.foliplus.ui["index"] = { missingName }`
    // and the shimmed import would resolve to `undefined` at runtime.
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "ui/panelChrome.ts": `export const panelButton = () => {};`,
      "ui/index.ts": `export { panelButton } from "./panelChrome.js";`,
      "core/empty.ts": ``,
      "runtime/index.ts": ``,
      "control/MyComponent/index.ts": `
        import { missingName } from "#ui/index.js";
        import { dom } from "#platform/dom.js";
      `,
    });
    expect(() => generateRegistry(jsDir, buildDir)).toThrow(
      /does not re-export: missingName/,
    );
  });

  it("throws when the ui barrel is emptied but a component imports from it", () => {
    // A barrel whose re-exports were deleted while the component kept the
    // import is the silent-drift case: the build would stay green and the
    // component would read `undefined`. The guard must fail the build.
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "ui/panelChrome.ts": `export const panelButton = () => {};`,
      "ui/index.ts": `// emptied — no re-exports`,
      "core/empty.ts": ``,
      "runtime/index.ts": ``,
      "control/MyComponent/index.ts": `
        import { panelButton } from "#ui/index.js";
        import { dom } from "#platform/dom.js";
      `,
    });
    expect(() => generateRegistry(jsDir, buildDir)).toThrow(
      /does not re-export: panelButton/,
    );
  });

  it("throws when the ui barrel file is missing but a component imports from it", () => {
    // A barrel with no `index.ts` at all is the same failure one step
    // earlier: the component shim reads a namespace that is never published.
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "ui/panelChrome.ts": `export const panelButton = () => {};`,
      "core/empty.ts": ``,
      "runtime/index.ts": ``,
      "control/MyComponent/index.ts": `
        import { panelButton } from "#ui/index.js";
        import { dom } from "#platform/dom.js";
      `,
    });
    expect(() => generateRegistry(jsDir, buildDir)).toThrow(/index\.ts is missing/);
  });

  it("resolves export * from the ui barrel for validation", () => {
    // `export * from` re-exports the target module's whole surface, so the
    // guard must follow the star clause to collect `panelButton`.
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "ui/panelChrome.ts": `export const panelButton = () => {};`,
      "ui/index.ts": `export * from "./panelChrome.js";`,
      "core/empty.ts": ``,
      "runtime/index.ts": ``,
      "control/MyComponent/index.ts": `
        import { panelButton } from "#ui/index.js";
        import { dom } from "#platform/dom.js";
      `,
    });
    generateRegistry(jsDir, buildDir);
    const output = readRegistry(buildDir);
    expect(output).toContain('window.foliplus.ui["index"]');
    expect(output).toContain("panelButton");
  });

  it("lists every missing name in plural wording", () => {
    // Two dropped re-exports must both be reported, and the message chooses the
    // plural phrasing instead of naming a single export.
    const [jsDir, buildDir] = buildFakeTree({
      "platform/dom.ts": `export const dom = {};`,
      "ui/panelChrome.ts": `export const panelButton = () => {};`,
      "ui/index.ts": `// emptied — no re-exports`,
      "core/empty.ts": ``,
      "runtime/index.ts": ``,
      "control/MyComponent/index.ts": `
        import { missingOne, missingTwo } from "#ui/index.js";
        import { dom } from "#platform/dom.js";
      `,
    });
    expect(() => generateRegistry(jsDir, buildDir)).toThrow(
      /does not re-export: missingOne, missingTwo\. Add these names/,
    );
  });
});

describe("collectExportedNames", () => {
  const dir = (files: Record<string, string>): string => mkDir("test", files);

  it("collects named re-exports from a module clause", () => {
    const d = dir({
      "ui/index.ts": `export { panelButton, closeButton } from "./panelChrome.js";`,
      "ui/panelChrome.ts": `export const panelButton = () => {}; export const closeButton = () => {};`,
    });
    const names = collectExportedNames(PATH.join(d, "ui/index.ts"));
    expect(names.has("panelButton")).toBe(true);
    expect(names.has("closeButton")).toBe(true);
  });

  it("publishes the alias name for a re-export clause", () => {
    const d = dir({
      "ui/index.ts": `export { panelButton as primaryButton } from "./panelChrome.js";`,
      "ui/panelChrome.ts": `export const panelButton = () => {};`,
    });
    const names = collectExportedNames(PATH.join(d, "ui/index.ts"));
    expect(names.has("primaryButton")).toBe(true);
    expect(names.has("panelButton")).toBe(false);
  });

  it("follows export * from a relative module", () => {
    const d = dir({
      "ui/index.ts": `export * from "./panelChrome.js";`,
      "ui/panelChrome.ts": `export const panelButton = () => {}; export const closeButton = () => {};`,
    });
    const names = collectExportedNames(PATH.join(d, "ui/index.ts"));
    expect(names.has("panelButton")).toBe(true);
    expect(names.has("closeButton")).toBe(true);
  });

  it("collects local re-exports and direct declarations", () => {
    const d = dir({
      "ui/index.ts": `
        export const made = () => {};
        export function built() {}
        const local = () => {};
        export { local as exportedLocal };
      `,
    });
    const names = collectExportedNames(PATH.join(d, "ui/index.ts"));
    expect(names.has("made")).toBe(true);
    expect(names.has("built")).toBe(true);
    expect(names.has("exportedLocal")).toBe(true);
  });

  it("does not count a default alias as a named export", () => {
    const d = dir({
      "ui/index.ts": `export { panelButton as default } from "./panelChrome.js";`,
      "ui/panelChrome.ts": `export const panelButton = () => {};`,
    });
    const names = collectExportedNames(PATH.join(d, "ui/index.ts"));
    expect(names.has("default")).toBe(false);
  });

  it("returns an empty set when the file does not exist", () => {
    const d = dir({ "ui/index.ts": `// nothing` });
    const names = collectExportedNames(PATH.join(d, "ui/missing.ts"));
    expect(names.size).toBe(0);
  });

  it("resolves an export * target that lives behind a directory index", () => {
    // `./panel.js` matches no file, so the guard falls back to
    // `panel/index.ts` — the layout the ui sub-modules use.
    const d = dir({
      "ui/index.ts": `export * from "./panel.js";`,
      "ui/panel/index.ts": `export const panelButton = () => {};`,
    });
    const names = collectExportedNames(PATH.join(d, "ui/index.ts"));
    expect(names.has("panelButton")).toBe(true);
  });

  it("ignores an export * target that resolves to no file", () => {
    // A misspelled target cannot be read here; the guard leaves it to esbuild
    // instead of failing the scan on it.
    const d = dir({ "ui/index.ts": `export * from "./absent.js";` });
    const names = collectExportedNames(PATH.join(d, "ui/index.ts"));
    expect(names.size).toBe(0);
  });

  it("ignores an empty entry in a re-export clause", () => {
    // A trailing comma leaves an empty part; it must not publish an empty name.
    const d = dir({
      "ui/index.ts": `export { panelButton, } from "./panelChrome.js";`,
      "ui/panelChrome.ts": `export const panelButton = () => {};`,
    });
    const names = collectExportedNames(PATH.join(d, "ui/index.ts"));
    expect(names.has("panelButton")).toBe(true);
    expect(names.size).toBe(1);
  });

  it("leaves an aliased export * target to esbuild", () => {
    // A bare alias specifier cannot be read by this scan; skipping it keeps the
    // guard from reporting a phantom missing export.
    const d = dir({ "ui/index.ts": `export * from "#platform/dom.js";` });
    const names = collectExportedNames(PATH.join(d, "ui/index.ts"));
    expect(names.size).toBe(0);
  });

  it("resolves a relative export * target without an extension", () => {
    const d = dir({
      "ui/index.ts": `export * from "./panelChrome";`,
      "ui/panelChrome.ts": `export const panelButton = () => {};`,
    });
    const names = collectExportedNames(PATH.join(d, "ui/index.ts"));
    expect(names.has("panelButton")).toBe(true);
  });

  it("stops on a cycle instead of recursing forever", () => {
    const d = dir({
      "ui/a.ts": `export * from "./b.js"; export const fromA = 1;`,
      "ui/b.ts": `export * from "./a.js"; export const fromB = 1;`,
    });
    const names = collectExportedNames(PATH.join(d, "ui/a.ts"));
    expect(names.has("fromA")).toBe(true);
    expect(names.has("fromB")).toBe(true);
  });

  it("stops following star chains past the depth bound", () => {
    const files: Record<string, string> = {
      "ui/index.ts": `export * from "./m0.js";`,
    };
    for (let i = 0; i < 18; i++) {
      files[`ui/m${i}.ts`] = `export * from "./m${i + 1}.js"; export const n${i} = 1;`;
    }
    files["ui/m18.ts"] = `export const leaf = 1;`;
    const d = dir(files);
    const names = collectExportedNames(PATH.join(d, "ui/index.ts"));
    expect(names.has("n0")).toBe(true);
    expect(names.has("leaf")).toBe(false);
  });
});

describe("CLI entry", () => {
  const SCRIPT = resolve(process.cwd(), "script", "build", "scan-registry.mjs");

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--help prints the usage and exits 0", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = trapExit();
    await expect(
      runCli("#script/build/scan-registry.mjs", ["node", SCRIPT, "--help"]),
    ).rejects.toThrow("exit:0");
    expect(exit).toHaveBeenCalledWith(0);
    expect(log.mock.calls.join("\n")).toContain("Usage:");
  });

  it("prints the error and exits 1 on an unknown flag", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = trapExit();
    await expect(
      runCli("#script/build/scan-registry.mjs", ["node", SCRIPT, "--bogus"]),
    ).rejects.toThrow("exit:1");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls.join("\n")).toContain("Unknown flag: --bogus");
  });

  it("runs the scan when launched directly as a script", async () => {
    // `process.argv[1]` matching this module's own URL is the guard's true
    // branch (`main()`), only reachable by re-importing with argv replaced.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCli("#script/build/scan-registry.mjs", ["node", SCRIPT]);
    const out = log.mock.calls.join("\n");
    expect(out).toContain("_shared-registry.ts written");
  });

  it("stays silent under --silent", async () => {
    // The `!opts.silent` guard's false branch: a silent run writes the registry
    // without printing the summary line.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCli("#script/build/scan-registry.mjs", ["node", SCRIPT, "--silent"]);
    expect(log).not.toHaveBeenCalled();
  });
});
