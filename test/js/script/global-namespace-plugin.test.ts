import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  collectExports,
  globalNamespacePlugin,
  sharedGlobalNamespace,
} from "#script/global-namespace-plugin.mjs";

const JS_DIR = resolve(__dirname, "../../../foliplus/js");

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
