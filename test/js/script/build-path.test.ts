import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { describe, expect, it } from "vitest";
import {
  PACKAGE_IMPORTS,
  SHARED_MODULE_EXACTS,
  SHARED_MODULE_PREFIXES,
  SHARED_SPEC_REGEX_SOURCE,
  pathAliases,
  repoRoot,
  resolveJsRoot,
  testPathAliases,
} from "#script/build-path.mjs";

const ROOT = resolve(".");

describe("build-path.mjs", () => {
  it("resolves foliplus/js under the project root", () => {
    expect(resolveJsRoot(ROOT)).toBe(resolve(ROOT, "foliplus/js"));
  });

  it("pathAliases pins the three shared # import prefixes", () => {
    const alias = pathAliases(ROOT);
    expect(Object.keys(alias)).toEqual(["#common", "#core", "#foliplus"]);
    expect(alias["#common"]).toBe(resolve(ROOT, "foliplus/js/common"));
    expect(alias["#core"]).toBe(resolve(ROOT, "foliplus/js/core"));
    expect(alias["#foliplus"]).toBe(resolve(ROOT, "foliplus/js"));
  });

  it("testPathAliases adds #script without mutating pathAliases", () => {
    const shared = pathAliases(ROOT) as Record<string, string>;
    const test = testPathAliases(ROOT) as Record<string, string>;
    expect(test["#script"]).toBe(resolve(ROOT, "script"));
    expect(test["#common"]).toBe(shared["#common"]);
    expect(shared["#script"]).toBeUndefined();
  });

  it("esbuild alias table is exactly the shared three keys (no #script)", () => {
    // esbuild must not gain #script — no component imports it. The test
    // alias table is the only place #script may appear.
    const cfgKeys = Object.keys(pathAliases(ROOT));
    expect(cfgKeys).not.toContain("#script");
  });

  it("package.json imports stay aligned with the single-source table", () => {
    // package.json cannot import this module for Node resolution, so the JSON
    // file remains the runtime source. This test is the drift check (#518
    // class): a hand-edit to either side fails here instead of at build time.
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
    expect(pkg.imports).toMatchObject(PACKAGE_IMPORTS);
    // The glob table derives from the same mapping the aliases do, so every
    // specifier appears in both shapes with the same target directory.
    expect(PACKAGE_IMPORTS["#common/*"]).toBe("./foliplus/js/common/*");
    expect(PACKAGE_IMPORTS["#script/*"]).toBe("./script/*");
  });

  it("SHARED_MODULE_PREFIXES is #common/#core only — #foliplus is aliased but not shared", () => {
    // The alias table has three entries (#common/#core/#foliplus), but only
    // #common and #core have their whole namespace published on
    // window.foliplus. #foliplus/BaseControl.js is shared by exact name
    // (see SHARED_MODULE_EXACTS); every other #foliplus/* path — a component
    // importing its own const.js or config-schema.js — bundles normally
    // through esbuild's alias and must NOT be externalized. The old test
    // asserted the alias table and the shared set were equal; that
    // assumption is what externalized self-imports as empty shims.
    expect([...SHARED_MODULE_PREFIXES].sort()).toEqual(["common", "core"]);
    for (const prefix of SHARED_MODULE_PREFIXES) {
      expect(Object.keys(pathAliases(ROOT))).toContain(`#${prefix}`);
    }
    expect(SHARED_MODULE_PREFIXES).not.toContain("foliplus");
  });

  it("SHARED_MODULE_EXACTS names only #foliplus/BaseControl.js", () => {
    // The single escape hatch: BaseControl is imported from
    // #foliplus/BaseControl.js (not #core/… or #common/…), but the runtime
    // publishes it on window.foliplus.BaseControl, so it must still be
    // externalized.
    expect(SHARED_MODULE_EXACTS).toEqual(["#foliplus/BaseControl.js"]);
  });

  it("SHARED_SPEC_REGEX_SOURCE matches the shared set and rejects non-shared #foliplus/*", () => {
    const re = new RegExp(`^(${SHARED_SPEC_REGEX_SOURCE})$`);
    // Shared prefixes
    expect(re.test("#common/dom.js")).toBe(true);
    expect(re.test("#core/hint.js")).toBe(true);
    expect(re.test("#core/layer/LayerFactory.js")).toBe(true);
    // Exact shared spec
    expect(re.test("#foliplus/BaseControl.js")).toBe(true);
    // #foliplus/* self-imports — bundled, not externalized
    expect(re.test("#foliplus/config-schema.js")).toBe(false);
    expect(re.test("#foliplus/LayerControl/const.js")).toBe(false);
    expect(re.test("#foliplus/LayerControl/ui/index.js")).toBe(false);
    expect(re.test("#foliplus/SearchControl/const.js")).toBe(false);
    // Unrelated aliases
    expect(re.test("#script/build.mjs")).toBe(false);
    expect(re.test("#core")).toBe(false); // bare prefix without /
    expect(re.test("#common")).toBe(false);
    expect(re.test("#foliplus/BaseControl.js")).toBe(true); // exact, sanity
  });

  it("repoRoot walks up to the nearest package.json from a nested dir", () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "foliplus-reporoot-"));
    try {
      mkdirSync(resolve(tmp, "a", "b", "c"), { recursive: true });
      writeFileSync(resolve(tmp, "package.json"), "{}", "utf-8");
      const url = pathToFileURL(resolve(tmp, "a", "b", "c", "file.mjs")).href;
      expect(repoRoot(url)).toBe(resolve(tmp));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("repoRoot throws when no package.json exists above the caller", () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "foliplus-reporoot-"));
    try {
      const url = pathToFileURL(resolve(tmp, "no", "pkg", "here", "file.mjs")).href;
      expect(() => repoRoot(url)).toThrow(/repoRoot: no package.json found above/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
