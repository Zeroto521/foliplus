import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  PACKAGE_IMPORTS,
  SHARED_SPEC_PREFIXES,
  pathAliases,
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
    const shared = pathAliases(ROOT);
    const test = testPathAliases(ROOT);
    expect(test["#script"]).toBe(resolve(ROOT, "script"));
    expect(test["#common"]).toBe(shared["#common"]);
    expect(shared["#script"]).toBeUndefined();
  });

  it("esbuild alias table is exactly the shared three keys (no #script)", () => {
    // esbuild must not gain #script 鈥?no component imports it. The test
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
  });

  it("SHARED_SPEC_PREFIXES covers every # prefix consumers resolve", () => {
    // import-scan.mjs, global-namespace-plugin.mjs and pathAliases share this
    // list; a new namespace that only lands in one of them is the #518 bug.
    expect([...SHARED_SPEC_PREFIXES].sort()).toEqual(["common", "core", "foliplus"]);
    for (const key of Object.keys(pathAliases(ROOT))) {
      const bare = key.slice(1);
      expect(SHARED_SPEC_PREFIXES).toContain(bare);
    }
  });
});
