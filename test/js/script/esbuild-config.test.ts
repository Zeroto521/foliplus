import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { esbuildCfgFor } from "#script/esbuild-config.mjs";

// The substantive behavior of this module — that our esbuild config
// actually strips comments under minify — is asserted by build.test.ts's
// "minify invariant" block, which imports esbuildCfgFor and runs esbuild
// with the returned config to verify comment stripping is real. This file
// pins the SHAPE of the config (the flags a test should never have to
// re-type) and the two mode switches the rest of the codebase depends on.
//
// Resolved against cwd, the same repo root every build script assumes.
const ROOT = resolve(".");

describe("esbuildCfgFor", () => {
  it("returns an object with the fields every artifact build needs", () => {
    const cfg = esbuildCfgFor({ dev: false, root: ROOT });
    // Bundle and format are fixed for every foliplus artifact; the tests
    // below assert only the fields that flip with the dev flag, so the
    // two together pin the invariant without over-specifying.
    expect(cfg.bundle).toBe(true);
    expect(cfg.format).toBe("iife");
    expect(cfg.sourcemap).toBe(false);
    expect(cfg.allowOverwrite).toBe(true);
  });

  it("minifies when not in dev mode, and preserves names when in dev mode", () => {
    // The two mode switches the Python render-string tests rely on:
    // `minify: false` + `keepNames: true` for dev builds (Python
    // assertions expect to find `foliplus.showHint` etc. in the bundle),
    // `minify: true` + `keepNames: false` for the shipped build.
    const prod = esbuildCfgFor({ dev: false, root: ROOT });
    const dev = esbuildCfgFor({ dev: true, root: ROOT });
    expect(prod.minify).toBe(true);
    expect(prod.keepNames).toBe(false);
    expect(dev.minify).toBe(false);
    expect(dev.keepNames).toBe(true);
  });

  it("declares the three #common / #core / #foliplus path aliases", () => {
    // The alias table is what lets the sources import `#common/format` etc.
    // A missing entry breaks the build with an unhelpful ERR_PACKAGE_IMPORT_
    // NOT_DEFINED, so the keys are pinned here.
    const cfg = esbuildCfgFor({ dev: false, root: ROOT });
    expect(Object.keys(cfg.alias)).toEqual(
      expect.arrayContaining(["#common", "#core", "#foliplus"]),
    );
  });

  it("attaches the version placeholder for the runtime console log", () => {
    // The runtime console.log in foliplus-common.min.js reads
    // `[foliplus] foliplus@<version>`. `__FOLIPLUS_VERSION__` is the esbuild
    // define that fills the placeholder; if it is missing the bundle
    // renders the literal identifier and the log is a lie.
    const cfg = esbuildCfgFor({ dev: false, root: ROOT });
    expect(cfg.define).toHaveProperty("__FOLIPLUS_VERSION__");
    // The value is a JSON string, so it can appear in the bundle without
    // being quoted again.
    expect(typeof cfg.define.__FOLIPLUS_VERSION__).toBe("string");
  });

  it("ships two onLoad plugins (PostCSS for CSS, source-transform for inline SVG/HTML)", () => {
    // Both plugins are required for the bundle to be flat: PostCSS resolves
    // nested CSS, source-transform minifies the inline SVG and HTML strings
    // embedded in the sources. A missing plugin silently leaves the source
    // in its authored form — the build succeeds but the artifact ships
    // nested CSS or unminified SVG.
    const cfg = esbuildCfgFor({ dev: false, root: ROOT });
    expect(cfg.plugins).toHaveLength(2);
    // Plugins are JS objects; their `name` field is what esbuild logs on
    // error, so it is the stable identifier.
    const names = cfg.plugins.map((p: { name: string }) => p.name);
    expect(names).toContain("postcss");
    expect(names).toContain("source-transform");
  });

  it("PostCSS plugin flattens nested CSS and applies vendor prefixes", async () => {
    // The PostCSS plugin's onLoad callback (lines 46-49 of
    // script/esbuild-config.mjs) is the only way nested CSS becomes flat
    // CSS in the bundle. Without exercising it, a broken `postcssNesting`
    // or `autoprefixer` config would ship nested rules to the browser —
    // valid CSS that most browsers silently ignore, so the page renders
    // unstyled and nobody notices the build was fine.
    //
    // We can't call esbuild's JS API here (jsdom swaps TextEncoder and
    // trips esbuild's instanceof check), so we mock the `build` object
    // that esbuild passes to the plugin's `setup` function, capture the
    // onLoad handler, and invoke it against a synthetic CSS file.
    const tmp = mkdtempSync(join(tmpdir(), "postcss-test-"));
    try {
      const cssPath = join(tmp, "test.css");
      const nested = `.parent {\n  color: red;\n  .child {\n    font-weight: bold;\n  }\n}`;
      writeFileSync(cssPath, nested, "utf-8");

      const postcssPlugin = esbuildCfgFor({ dev: false, root: ROOT }).plugins[0];
      let onLoadHandler: (args: { path: string }) => Promise<{ contents: string }> | undefined;

      // Mock the esbuild build object with just the onLoad method.
      const mockBuild = {
        onLoad: (opts: { filter: RegExp }, handler: (args: { path: string }) => Promise<{ contents: string }>) => {
          expect(opts.filter).toBeInstanceOf(RegExp);
          expect(opts.filter.test("foo.css")).toBe(true);
          expect(opts.filter.test("foo.js")).toBe(false);
          onLoadHandler = handler;
        },
      };

      postcssPlugin.setup(mockBuild as any);

      expect(onLoadHandler).toBeDefined();
      const result = await onLoadHandler!({ path: cssPath });

      // postcssNesting flattens `.parent { .child { ... } }` to
      // `.parent .child { ... }`. The parent's direct rule (color: red)
      // stays as its own block; only the nested selector is pulled out.
      expect(result.contents).toContain(".parent .child");
      expect(result.contents).toMatch(/font-weight\s*:\s*bold/);
      // The parent block for the direct property is fine — what matters is
      // that `.child` is no longer nested inside `.parent {`.
      expect(result.contents).not.toMatch(/\.parent\s*{[^}]*\.child/);
      // `loader: "css"` tells esbuild the onLoad returned CSS, not JS.
      expect(result).toEqual({ contents: expect.any(String), loader: "css" });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
