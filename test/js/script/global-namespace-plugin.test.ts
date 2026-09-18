import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  collectExports,
  globalNamespacePlugin,
  sharedGlobalNamespace,
} from "#script/global-namespace-plugin.mjs";

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
      const cur = stack.pop();
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

describe("sharedGlobalNamespace", () => {
  it("maps #core/layer/* to foliplus.core.layer", () => {
    expect(sharedGlobalNamespace("#core/layer/index.js")).toBe("foliplus.core.layer");
    expect(sharedGlobalNamespace("#core/layer/LayerFactory.js")).toBe(
      "foliplus.core.layer",
    );
  });

  it("maps #core/hint.js to foliplus.hint", () => {
    expect(sharedGlobalNamespace("#core/hint.js")).toBe("foliplus.hint");
  });

  it("maps #core/labelControl.js to foliplus.core.labelControl", () => {
    expect(sharedGlobalNamespace("#core/labelControl.js")).toBe(
      "foliplus.core.labelControl",
    );
  });

  it("maps #foliplus/BaseControl.js to foliplus.BaseControl", () => {
    expect(sharedGlobalNamespace("#foliplus/BaseControl.js")).toBe(
      "foliplus.BaseControl",
    );
  });

  it("maps core subdomain barrels to foliplus.core.<sub>", () => {
    expect(sharedGlobalNamespace("#core/geo/index.js")).toBe("foliplus.core.geo");
    expect(sharedGlobalNamespace("#core/geocode/index.js")).toBe(
      "foliplus.core.geocode",
    );
  });

  it("maps #common/<mod>.js to foliplus.common.<mod>", () => {
    expect(sharedGlobalNamespace("#common/dom.js")).toBe("foliplus.common.dom");
    expect(sharedGlobalNamespace("#common/log.js")).toBe("foliplus.common.log");
  });

  it("gives every core-root single file a namespace that parses", () => {
    // A core-root single file with no explicit mapping falls through to the
    // #common branch and comes out as "foliplus.common.#core/<name>" — the shim
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
  it("never maps a bare core barrel to a core namespace", () => {
    // The deleted `core/index.ts` barrel had an explicit mapping here
    // (`foliplus.core.index`) that served no import. Left in place it was
    // dead code that also kept the barrel's name reachable from the build;
    // with it gone the specifier falls through to the `#common/*` fallback
    // below, which strips the trailing `.js` and does not strip the leading
    // alias. Either way the result must not be a `foliplus.core.*` namespace.
    expect(sharedGlobalNamespace("#core/index.js")).not.toMatch(/^foliplus\.core\./);
  });
});

describe("collectExports", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliplus-exports-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("collects named declarations", () => {
    const f = join(dir, "a.ts");
    writeFileSync(
      f,
      "export const foo = 1;\nexport function bar() {}\nexport class Baz {}\n",
    );
    expect(collectExports(f)).toEqual(["foo", "bar", "Baz"]);
  });

  it("follows export * from barrels", () => {
    const sub = join(dir, "sub.ts");
    writeFileSync(sub, "export const x = 1;\n");
    const barrel = join(dir, "index.ts");
    writeFileSync(barrel, 'export * from "./sub.js";\n');
    expect(collectExports(barrel)).toEqual(["x"]);
  });

  it("follows export { x } from re-exports", () => {
    const sub = join(dir, "src.ts");
    writeFileSync(sub, "export const y = 1;\n");
    const re = join(dir, "re.ts");
    writeFileSync(re, 'export { y } from "./src.js";\n');
    expect(collectExports(re)).toEqual(["y"]);
  });

  it("handles type exports without leaking them", () => {
    const f = join(dir, "types.ts");
    writeFileSync(
      f,
      "export type Foo = string;\nexport interface Bar {}\nexport const value = 1;\n",
    );
    const names = collectExports(f);
    expect(names).toContain("value");
    expect(names).not.toContain("Foo");
    expect(names).not.toContain("Bar");
  });
});

describe("globalNamespacePlugin", () => {
  const dir = mkdtempSync(join(tmpdir(), "foliplus-plugin-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // Wire the plugin to a minimal mock `build`, capturing its onResolve/onLoad
  // callbacks so they can be invoked directly (no esbuild build needed).
  const setupPlugin = () => {
    const handlers = {};
    globalNamespacePlugin(dir).setup({
      initialOptions: { entryPoints: [join(dir, "index.ts")] },
      onResolve: (_opts, cb) => {
        handlers.onResolve = cb;
      },
      onLoad: (_opts, cb) => {
        handlers.onLoad = cb;
      },
    });
    return handlers;
  };

  it("resolves #core/#common/#foliplus imports to the shared namespace", () => {
    const { onResolve } = setupPlugin();
    expect(onResolve({ path: "#core/layer.js" })).toEqual({
      path: "#core/layer.js",
      namespace: "foliplus-shared",
    });
  });

  it("shims named imports via usedExports", () => {
    writeFileSync(
      join(dir, "index.ts"),
      'import { Foo } from "#core/layer/foo.js";\n',
      "utf-8",
    );
    const { onLoad } = setupPlugin();
    const result = onLoad({ path: "#core/layer/foo.js" });
    expect(result.loader).toBe("js");
    expect(result.contents).toContain("export const Foo =");
  });

  it("shims star-imported property usage via starUsed", () => {
    writeFileSync(
      join(dir, "index.ts"),
      'import * as Storage from "#common/storage.js";\nStorage.load();\n',
      "utf-8",
    );
    const { onLoad } = setupPlugin();
    const result = onLoad({ path: "#common/storage.js" });
    expect(result.contents).toContain("export const load =");
  });

  it("falls back to collectExports and returns empty for unknown files", () => {
    writeFileSync(join(dir, "index.ts"), "", "utf-8");
    const { onLoad } = setupPlugin();
    expect(onLoad({ path: "#common/nonexistent.js" })).toEqual({
      contents: "",
      loader: "js",
    });
  });
});
