import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  collectExports,
  collectSources,
  globalNamespacePlugin,
  runtimeTarget,
  scanSharedImports,
  sharedGlobalNamespace,
} from "#script/build/global-namespace-plugin.mjs";

// Tests for script/build/global-namespace-plugin.mjs — every exported symbol plus the
// plugin object itself:
//   runtimeTarget          — canonical spec → dotted runtime target (the unit
//                            mapping; sharedGlobalNamespace is a thin wrapper
//                            around this + `foliplus.` prefix)
//   sharedGlobalNamespace  — the wrapper's public surface, exercised against
//                            the real source tree
//   collectExports         — unit
//   collectSources         — unit
//   scanSharedImports      — unit
//   globalNamespacePlugin  — end to end, wired to a mock `build`
//
// They live in one file on purpose: this module once had a second test file,
// named for a script that never existed, and the two asserted the same mappings
// twice. One module, one test file, so the overlap cannot recur.
//
// Via vitest's cwd — the convention build.test.ts uses too.
const JS_DIR = resolve(process.cwd(), "foliplus/js");

// Specifier → path, for the two shared-library aliases only.
const ALIASES = new Map([
  ["#core/", resolve(JS_DIR, "core")],
  ["#common/", resolve(JS_DIR, "common")],
]);

// Every `from "…"` specifier across the production sources. A directory
// barrel (`#core/index.js`, `#common/index.js`) is only an entry point when
// the bundler points at it; nothing bundles them, so an import of one
// resolves to a namespace nobody publishes.
const aliasedSpecifiers = (): Map<string, string[]> => {
  const seen = new Map<string, string[]>();
  for (const dir of [...ALIASES.values()]) {
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const entry of readdirSync(cur, { withFileTypes: true })) {
        const full = join(cur, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        for (const match of readFileSync(full, "utf-8").matchAll(
          /from\s+["']([^"']+)["']/g,
        )) {
          const spec = match[1];
          if (spec.startsWith("#core/") || spec.startsWith("#common/")) {
            seen.set(spec, [...(seen.get(spec) ?? []), full]);
          }
        }
      }
    }
  }
  return seen;
};

describe("runtimeTarget", () => {
  it("keeps BaseControl at the top level", () => {
    expect(runtimeTarget("BaseControl")).toBe("BaseControl");
  });

  it("keeps core/hint at the top level", () => {
    expect(runtimeTarget("core/hint")).toBe("hint");
  });

  it("maps core subdirectories to core.<sub>", () => {
    expect(runtimeTarget("core/layer")).toBe("core.layer");
    expect(runtimeTarget("core/layer/index")).toBe("core.layer");
    expect(runtimeTarget("core/layer/LayerFactory")).toBe("core.layer");
    expect(runtimeTarget("core/component")).toBe("core.component");
    expect(runtimeTarget("core/event")).toBe("core.event");
  });

  it("maps common subdirectories to common.<sub>", () => {
    expect(runtimeTarget("common/dom")).toBe("common.dom");
    expect(runtimeTarget("common/log")).toBe("common.log");
  });

  it("returns a #-prefixed spec untouched", () => {
    // The barrel fall-through: runtimeTarget("#core/index") keeps the `#`
    // so the shim declaration is invalid JS and the build fails loudly.
    // sharedGlobalNamespace strips the `#` before calling, so this branch
    // only fires when runtimeTarget is called directly with a raw spec.
    expect(runtimeTarget("#core/index")).toBe("#core/index");
  });
});

describe("sharedGlobalNamespace", () => {
  it("maps BaseControl to foliplus.BaseControl", () => {
    expect(sharedGlobalNamespace("#foliplus/BaseControl.js")).toBe(
      "foliplus.BaseControl",
    );
  });

  it("maps hint.js to foliplus.hint", () => {
    expect(sharedGlobalNamespace("#core/hint.js")).toBe("foliplus.hint");
  });

  // Every other core-root single file reaches its namespace through the general
  // rule; component and mode no longer carry manual entries.
  it("maps component.js to foliplus.core.component", () => {
    expect(sharedGlobalNamespace("#core/component.js")).toBe("foliplus.core.component");
  });

  it("maps mode.js to foliplus.core.mode", () => {
    expect(sharedGlobalNamespace("#core/mode.js")).toBe("foliplus.core.mode");
  });

  it("maps controlEnv.js to foliplus.core.controlEnv", () => {
    expect(sharedGlobalNamespace("#core/controlEnv.js")).toBe(
      "foliplus.core.controlEnv",
    );
  });

  it("maps labelControl.js to foliplus.core.labelControl", () => {
    expect(sharedGlobalNamespace("#core/labelControl.js")).toBe(
      "foliplus.core.labelControl",
    );
  });

  it("maps leafletAdapter.js to foliplus.core.leafletAdapter", () => {
    // A core-root single file, so the general rule must cover it: the #common
    // fallback would build "foliplus.common.#core/leafletAdapter".
    expect(sharedGlobalNamespace("#core/leafletAdapter.js")).toBe(
      "foliplus.core.leafletAdapter",
    );
  });

  it("maps core subdirectory to foliplus.core.sub", () => {
    expect(sharedGlobalNamespace("#core/layer/index.js")).toBe("foliplus.core.layer");
    // Any file inside the subdomain resolves to the same namespace as its barrel.
    expect(sharedGlobalNamespace("#core/layer/LayerFactory.js")).toBe(
      "foliplus.core.layer",
    );
    expect(sharedGlobalNamespace("#core/event/index.js")).toBe("foliplus.core.event");
    expect(sharedGlobalNamespace("#core/geo/index.js")).toBe("foliplus.core.geo");
    expect(sharedGlobalNamespace("#core/geocode/index.js")).toBe(
      "foliplus.core.geocode",
    );
  });

  it("maps common modules to foliplus.common.mod", () => {
    expect(sharedGlobalNamespace("#common/dom.js")).toBe("foliplus.common.dom");
    expect(sharedGlobalNamespace("#common/storage.js")).toBe("foliplus.common.storage");
    expect(sharedGlobalNamespace("#common/log.js")).toBe("foliplus.common.log");
  });

  it("never maps a bare core barrel to a core namespace", () => {
    // The deleted `core/index.ts` barrel had an explicit mapping
    // (`foliplus.core.index`) that served no import. Left in place it was dead
    // code that also kept the barrel's name reachable from the build; with it
    // gone the specifier falls through to the `#common/*` fallback, which strips
    // the trailing `.js` and does not strip the leading alias. Either way the
    // result must not be a `foliplus.core.*` namespace.
    expect(sharedGlobalNamespace("#core/index.js")).not.toMatch(/^foliplus\.core\./);
  });
});

describe("sharedGlobalNamespace across the production tree", () => {
  it("gives every core-root single file a namespace that parses", () => {
    // A core-root single file the general rule misses would fall through to the
    // #common fallback and come out as "foliplus.common.#core/<name>" — the shim
    // declaration `var foliplus_common_#core/<name>_shim = …` is not valid JS,
    // so esbuild fails the component bundle while build.mjs still prints a tick
    // for it. Walking the directory keeps a newly added file from shipping a
    // stale artifact quietly.
    const coreDir = resolve(JS_DIR, "core");
    const singles = readdirSync(coreDir, { withFileTypes: true })
      .filter(f => f.isFile() && f.name.endsWith(".ts"))
      .map(f => f.name.replace(/\.ts$/, ""));
    expect(singles.length).toBeGreaterThan(0);

    for (const name of singles) {
      const spec = `#core/${name}.js`;
      const ns = sharedGlobalNamespace(spec);
      const segments = ns.split(".");
      expect(
        segments.every(s => /^[A-Za-z_$][\w$]*$/.test(s)),
        `${spec} → ${ns}`,
      ).toBe(true);
    }
  });

  it("gives hint, and only hint, a namespace outside foliplus.core", () => {
    // runtime/index.ts publishes `hint` directly on window.foliplus (the
    // Object.assign block), while component and mode are assigned under
    // foliplus.core. The general rule returns foliplus.core.<name> for every
    // other core-root file, so hint is the sole exception — and a new
    // core-root file must reach its namespace through that rule rather than by
    // adding an entry. `#core/hint.js` → foliplus.core.hint would read a
    // namespace nothing publishes.
    const singles = readdirSync(resolve(JS_DIR, "core"), { withFileTypes: true })
      .filter(f => f.isFile() && f.name.endsWith(".ts"))
      .map(f => f.name.replace(/\.ts$/, ""));
    const offRule = singles.filter(
      name => sharedGlobalNamespace(`#core/${name}.js`) !== `foliplus.core.${name}`,
    );
    expect(offRule).toEqual(["hint"]);
    expect(sharedGlobalNamespace("#core/hint.js")).toBe("foliplus.hint");
    // The two that used to carry manual entries, now served by the rule.
    expect(sharedGlobalNamespace("#core/component.js")).toBe("foliplus.core.component");
    expect(sharedGlobalNamespace("#core/mode.js")).toBe("foliplus.core.mode");
  });

  it("is never called for a bare core or common domain barrel", () => {
    // No production source imports `#core/index.js` or `#common/index.js`.
    // `core/index.ts` was a barrel nothing imported, so this handler never
    // ran for it. The four subdomain barrels (geo, geocode, layer, event)
    // are the intended shape — each one resolves to `foliplus.core.<sub>`.
    const imports = [...aliasedSpecifiers().entries()].filter(
      ([spec]) => /\/index\.js$/.test(spec) && /#(core|common)\/index\.js$/.test(spec),
    );
    expect(imports).toEqual([]);
  });
});

describe("collectExports", () => {
  it("collects const/let/var/function/class declarations", () => {
    const code = `
      export const FOO = 1;
      export let BAR = 2;
      export var BAZ = 3;
      export function QUX() {}
      export class WIDGET {}
      export async function ASYNC() {}
    `.trim();

    const tmpDir = createTempFile("collect.test.ts", code);
    try {
      const exports = collectExports(tmpDir.path);
      expect(exports).toContain("FOO");
      expect(exports).toContain("BAR");
      expect(exports).toContain("BAZ");
      expect(exports).toContain("QUX");
      expect(exports).toContain("WIDGET");
      expect(exports).toContain("ASYNC");
    } finally {
      tmpDir.cleanup();
    }
  });

  it("collects named exports", () => {
    const code = `
      const A = 1;
      const B = 2;
      export { A, B };
    `.trim();

    const tmpDir = createTempFile("named.test.ts", code);
    try {
      expect(collectExports(tmpDir.path)).toContain("A");
      expect(collectExports(tmpDir.path)).toContain("B");
    } finally {
      tmpDir.cleanup();
    }
  });

  it("collects re-exported names", () => {
    const code = `
      export { X, Y } from "./other.js";
    `.trim();

    const tmpDir = createTempFile("reexport.test.ts", code);
    try {
      const exports = collectExports(tmpDir.path);
      expect(exports).toContain("X");
      expect(exports).toContain("Y");
    } finally {
      tmpDir.cleanup();
    }
  });

  it("collects export * from barrel", () => {
    const barrel = `
      export { A } from "./a.js";
      export { B } from "./b.js";
    `.trim();

    const aModule = createTempFile("a.test.ts", "export const A = 1;");
    const bModule = createTempFile("b.test.ts", "export const B = 2;");

    const barrelFile = createTempFile("barrel.test.ts", barrel);
    try {
      const exports = collectExports(barrelFile.path);
      expect(exports).toContain("A");
      expect(exports).toContain("B");
    } finally {
      aModule.cleanup();
      bModule.cleanup();
      barrelFile.cleanup();
    }
  });

  it("follows a bare `export * from` re-export", () => {
    // The STAR_RE branch (as opposed to RE_EXPORT_RE). A barrel that
    // star-re-exports a sub-module must surface every name the sub-module
    // exports — the shim generator keys on this so an `import * as` from
    // the barrel lands on real exports instead of `undefined`.
    const sub = `
      export const X = 1;
      export const Y = 2;
    `.trim();

    // Temp files land in OS tmp, so the sub-module must be referenced
    // by absolute path — the two files are not siblings.
    const subModule = createTempFile("star-sub.ts", sub);
    const barrelFile = createTempFile(
      "star-barrel.ts",
      `export * from "${subModule.path.replace(/\\/g, "/")}";`,
    );
    try {
      const exports = collectExports(barrelFile.path);
      expect(exports).toContain("X");
      expect(exports).toContain("Y");
    } finally {
      subModule.cleanup();
      barrelFile.cleanup();
    }
  });

  it("excludes type-only exports", () => {
    const code = `
      export type TypeName = string;
      export const value = 1;
    `.trim();

    const tmpDir = createTempFile("types.test.ts", code);
    try {
      const exports = collectExports(tmpDir.path);
      expect(exports).not.toContain("TypeName");
      expect(exports).toContain("value");
    } finally {
      tmpDir.cleanup();
    }
  });

  it("resolves .js to .ts", () => {
    const code = "export const FOO = 1;";
    const tmpDir = createTempFile("resolve.test.ts", code);
    try {
      // Ask for .js, should find .ts
      const exports = collectExports(tmpDir.path.replace(/.ts$/, ".js"));
      expect(exports).toContain("FOO");
    } finally {
      tmpDir.cleanup();
    }
  });

  it("returns empty for nonexistent file", () => {
    expect(collectExports("/nonexistent/file.js")).toEqual([]);
  });
});

describe("collectExports with as alias", () => {
  it("returns the alias name for export { X as Y }", () => {
    // Both the declaration name AND the alias are valid exports
    const code = "export const INNER = 1;\nexport { INNER as OUTER };";
    const tmpDir = createTempFile("alias.test.ts", code);
    try {
      const exports = collectExports(tmpDir.path);
      expect(exports).toContain("OUTER");
      expect(exports).toContain("INNER");
    } finally {
      tmpDir.cleanup();
    }
  });

  it("uses alias name when re-exporting from another module", () => {
    const code =
      'export { DEFAULT_TIMEOUT_MS as GEOCODE_TIMEOUT_MS } from "./other.js";';
    const tmpDir = createTempFile("alias2.test.ts", code);
    const fs = require("fs");
    const path = require("path");
    const otherPath = path.join(path.dirname(tmpDir.path), "other.js");
    try {
      fs.writeFileSync(otherPath, "export const DEFAULT_TIMEOUT_MS = 5000;", "utf-8");
      const exports = collectExports(tmpDir.path);
      // The alias name is present (from the re-export line)
      expect(exports).toContain("GEOCODE_TIMEOUT_MS");
      // The local name is also present (recursive resolution of the target)
      expect(exports).toContain("DEFAULT_TIMEOUT_MS");
    } finally {
      tmpDir.cleanup();
      try {
        fs.unlinkSync(otherPath);
      } catch {}
    }
  });
});

describe("collectSources", () => {
  it("collects .ts sources from a directory recursively", () => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const base = path.join(os.tmpdir(), "dsh-test-cs-" + Date.now());
    fs.mkdirSync(base, { recursive: true });
    fs.mkdirSync(path.join(base, "sub"), { recursive: true });
    fs.writeFileSync(path.join(base, "a.ts"), "export const A = 1;", "utf-8");
    fs.writeFileSync(path.join(base, "sub", "b.ts"), "export const B = 2;", "utf-8");
    fs.writeFileSync(path.join(base, "c.d.ts"), "export type C = string;", "utf-8");
    try {
      const sources = collectSources(base);
      expect(sources).toHaveLength(2);
      expect(sources[0]).toContain("A");
      expect(sources[1]).toContain("B");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("scanSharedImports", () => {
  it("collects named imports from #core/#common/#foliplus", () => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const base = path.join(os.tmpdir(), "dsh-test-si-" + Date.now());
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(
      path.join(base, "comp.ts"),
      [
        'import { ensureHint, HINT_DURATION } from "#core/hint.js";',
        'import { BaseControl } from "#foliplus/BaseControl.js";',
        'import { dom, createIconButton } from "#common/dom.js";',
        'import { createTranslator } from "#common/locale.js";',
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(base, "helper.ts"),
      'import { fromWgs84 } from "#core/geo/index.js";',
      "utf-8",
    );
    try {
      const { used, starUsed } = scanSharedImports(base);
      expect(used.has("#core/hint.js")).toBe(true);
      expect(used.get("#core/hint.js")).toEqual(
        new Set(["ensureHint", "HINT_DURATION"]),
      );
      expect(used.has("#foliplus/BaseControl.js")).toBe(true);
      expect(used.get("#foliplus/BaseControl.js")).toEqual(new Set(["BaseControl"]));
      expect(used.has("#common/dom.js")).toBe(true);
      expect(used.get("#common/dom.js")).toEqual(new Set(["dom", "createIconButton"]));
      expect(used.has("#core/geo/index.js")).toBe(true);
      expect(used.get("#core/geo/index.js")).toEqual(new Set(["fromWgs84"]));
      expect(used.has("#common/locale.js")).toBe(true);
      expect(used.get("#common/locale.js")).toEqual(new Set(["createTranslator"]));
      expect(starUsed.size).toBe(0);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("scans #foliplus/BaseControl.js but not component self-imports", () => {
    // Regression for #628: only #foliplus/BaseControl.js is shared; a
    // component's own #foliplus/<Component>/… imports bundle normally via
    // esbuild's alias. The scanner must not record them, so the registry
    // generator and the plugin don't try to shim them.
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const base = path.join(os.tmpdir(), "dsh-test-si-fol-" + Date.now());
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(
      path.join(base, "comp.ts"),
      [
        'import { BaseControl } from "#foliplus/BaseControl.js";',
        'import { CONST } from "#foliplus/LayerControl/const.js";',
        'import { Z_INDEX } from "#foliplus/LayerControl/ui/style/zoomRange.js";',
        'import { ConfigSchema } from "#foliplus/config-schema.js";',
      ].join("\n"),
      "utf-8",
    );
    try {
      const { used } = scanSharedImports(base);
      expect(used.has("#foliplus/BaseControl.js")).toBe(true);
      expect(used.get("#foliplus/BaseControl.js")).toEqual(new Set(["BaseControl"]));
      expect(used.has("#foliplus/LayerControl/const.js")).toBe(false);
      expect(used.has("#foliplus/LayerControl/ui/style/zoomRange.js")).toBe(false);
      expect(used.has("#foliplus/config-schema.js")).toBe(false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("tracks star import property usage", () => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const base = path.join(os.tmpdir(), "dsh-test-si2-" + Date.now());
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(
      path.join(base, "comp.ts"),
      [
        'import * as Icons from "#common/icon.js";',
        "console.log(Icons.ICON_LOADING);",
        "console.log(Icons.ICON_CLOSE);",
      ].join("\n"),
      "utf-8",
    );
    try {
      const { used, starUsed } = scanSharedImports(base);
      expect(used.size).toBe(0);
      expect(starUsed.has("#common/icon.js")).toBe(true);
      expect(starUsed.get("#common/icon.js")).toEqual(
        new Set(["ICON_LOADING", "ICON_CLOSE"]),
      );
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("handles import { X as Y } notation", () => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const base = path.join(os.tmpdir(), "dsh-test-si3-" + Date.now());
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(
      path.join(base, "comp.ts"),
      'import { ensureHint as H } from "#core/hint.js";',
      "utf-8",
    );
    try {
      const { used } = scanSharedImports(base);
      expect(used.has("#core/hint.js")).toBe(true);
      expect(used.get("#core/hint.js")).toEqual(new Set(["ensureHint"]));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("globalNamespacePlugin", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliplus-plugin-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // Wire the plugin to a minimal mock `build`, capturing its onResolve/onLoad
  // callbacks so they can be invoked directly (no esbuild build needed).
  // `entryPoints` omitted exercises the no-entryPoints (scanDir null) path.
  const setupPlugin = (entryPoints?: unknown) => {
    const handlers: {
      onResolve: (opts: { path: string }) => { path: string; namespace: string };
      onLoad: (opts: { path: string }) => { contents: string; loader: string };
      onResolveOpts: { filter: RegExp } | undefined;
    } = {
      onResolve: () => ({ path: "", namespace: "" }),
      onLoad: () => ({ contents: "", loader: "js" }),
      onResolveOpts: undefined,
    };
    const build: {
      initialOptions: { entryPoints?: unknown };
      onResolve: unknown;
      onLoad: unknown;
    } = { initialOptions: {}, onResolve: undefined, onLoad: undefined };
    if (entryPoints !== undefined) {
      build.initialOptions = { entryPoints };
    }
    globalNamespacePlugin(dir).setup({
      ...build,
      onResolve: (
        opts: { filter: RegExp },
        cb: (o: { path: string }) => { path: string; namespace: string },
      ) => {
        handlers.onResolve = cb;
        handlers.onResolveOpts = opts;
      },
      onLoad: (
        _opts: unknown,
        cb: (o: { path: string }) => { contents: string; loader: string },
      ) => {
        handlers.onLoad = cb;
      },
    } as unknown as Parameters<ReturnType<typeof globalNamespacePlugin>["setup"]>[0]);
    return handlers;
  };

  it("resolves #core/#common/#foliplus imports to the shared namespace", () => {
    const { onResolve } = setupPlugin([join(dir, "index.ts")]);
    expect(onResolve({ path: "#core/layer.js" })).toEqual({
      path: "#core/layer.js",
      namespace: "foliplus-shared",
    });
  });

  it("onResolve filter matches the shared set and rejects non-shared #foliplus/*", () => {
    // Regression for #628: the old filter `^#(common|core|foliplus)/`
    // externalized component self-imports (#foliplus/LayerControl/const.js,
    // #foliplus/config-schema.js) as empty shims, which then resolved to
    // `undefined` at runtime. The new filter is anchored and only accepts
    // #common/*, #core/*, and the exact #foliplus/BaseControl.js.
    const { onResolveOpts } = setupPlugin([join(dir, "index.ts")]);
    const filter = onResolveOpts!.filter;
    expect(filter.test("#core/layer.js")).toBe(true);
    expect(filter.test("#common/dom.js")).toBe(true);
    expect(filter.test("#core/layer/LayerFactory.js")).toBe(true);
    expect(filter.test("#foliplus/BaseControl.js")).toBe(true);
    expect(filter.test("#foliplus/LayerControl/const.js")).toBe(false);
    expect(filter.test("#foliplus/LayerControl/ui/index.js")).toBe(false);
    expect(filter.test("#foliplus/config-schema.js")).toBe(false);
    expect(filter.test("#foliplus/BaseControl.js")).toBe(true);
    expect(filter.test("#script/build.mjs")).toBe(false);
    expect(filter.test("#core")).toBe(false);
  });

  it("handles a string entryPoints and a missing initialOptions", () => {
    // esbuild accepts entryPoints as a single string; and no entryPoints at
    // all means no pre-scan (scanDir null) — the plugin must not throw.
    expect(() => setupPlugin(join(dir, "index.ts"))).not.toThrow();
    expect(() => setupPlugin(undefined)).not.toThrow();
  });

  it("shims named imports via usedExports", () => {
    writeFileSync(
      join(dir, "index.ts"),
      'import { Foo } from "#core/layer/foo.js";\n',
      "utf-8",
    );
    const { onLoad } = setupPlugin([join(dir, "index.ts")]);
    const result = onLoad({ path: "#core/layer/foo.js" });
    expect(result.loader).toBe("js");
    expect(result.contents).toContain("export const Foo =");
  });

  it("shims star-imported property usage via starUsed", () => {
    writeFileSync(
      join(dir, "index.ts"),
      'import * as Storage from "#common/storage.js";\nStorage.loadRecord();\n',
      "utf-8",
    );
    const { onLoad } = setupPlugin([join(dir, "index.ts")]);
    const result = onLoad({ path: "#common/storage.js" });
    expect(result.contents).toContain("export const loadRecord =");
  });

  it("falls back to collectExports and returns empty for unknown files", () => {
    writeFileSync(join(dir, "index.ts"), "", "utf-8");
    const { onLoad } = setupPlugin([join(dir, "index.ts")]);
    expect(onLoad({ path: "#common/nonexistent.js" })).toEqual({
      contents: "",
      loader: "js",
    });
  });
});

// Helper: create a temp .ts file and return { path, cleanup }
const tmpDir = require("os").tmpdir();
let tmpCount = 0;

function createTempFile(name: string, content: string) {
  const fs = require("fs");
  const path = require("path");
  const filePath = path.join(tmpDir, "dsh-test-" + tmpCount++ + "-" + name);
  fs.writeFileSync(filePath, content, "utf-8");
  return {
    path: filePath,
    cleanup: () => {
      try {
        fs.unlinkSync(filePath);
      } catch {}
    },
  };
}
