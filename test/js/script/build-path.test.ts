import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { describe, expect, it } from "vitest";
import {
  ALIAS_TO_REL,
  PACKAGE_IMPORTS,
  SHARED_ALIASES,
  SHARED_MODULE_EXACTS,
  SHARED_MODULE_PREFIXES,
  SHARED_SPEC_REGEX_SOURCE,
  namespacePrefixRules,
  pathAliases,
  repoRoot,
  resolveJsRoot,
  testPathAliases,
} from "#script/build-path.mjs";

const ROOT = resolve(".");
// ALIAS_TO_REL is a plain JS object from build-path.mjs; index it through a
// string-keyed record so TS does not complain about dynamic alias lookups
// (the guard test legitimately walks every alias with a string key).
const ALIAS_DIRS = ALIAS_TO_REL as Record<string, string>;

describe("build-path.mjs", () => {
  it("resolves foliplus/js under the project root", () => {
    expect(resolveJsRoot(ROOT)).toBe(resolve(ROOT, "foliplus/js"));
  });

  it("pathAliases pins the shared # import prefixes", () => {
    const alias = pathAliases(ROOT);
    expect(Object.keys(alias)).toEqual([
      "#platform",
      "#core",
      "#ui",
      "#control",
      "#foliplus",
    ]);
    expect(alias["#platform"]).toBe(resolve(ROOT, "foliplus/js/platform"));
    expect(alias["#core"]).toBe(resolve(ROOT, "foliplus/js/core"));
    expect(alias["#ui"]).toBe(resolve(ROOT, "foliplus/js/ui"));
    expect(alias["#control"]).toBe(resolve(ROOT, "foliplus/js/control"));
    expect(alias["#foliplus"]).toBe(resolve(ROOT, "foliplus/js"));
  });

  it("testPathAliases adds #script without mutating pathAliases", () => {
    const shared = pathAliases(ROOT) as Record<string, string>;
    const test = testPathAliases(ROOT) as Record<string, string>;
    expect(test["#script"]).toBe(resolve(ROOT, "script"));
    expect(test["#platform"]).toBe(shared["#platform"]);
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
    // Full equality (not toMatchObject): an alias ADDED to package.json without
    // a build-path entry — or renamed on one side only — fails here too, so
    // ALIAS_TO_REL is the one place a tier rename is made (#979 bound only
    // build-path to import-boundary; this closes the package.json side).
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
    expect(pkg.imports).toEqual(PACKAGE_IMPORTS);
    // The glob table derives from the same mapping the aliases do, so every
    // specifier appears in both shapes with the same target directory.
    expect(PACKAGE_IMPORTS["#platform/*"]).toBe("./foliplus/js/platform/*");
    expect(PACKAGE_IMPORTS["#ui/*"]).toBe("./foliplus/js/ui/*");
    expect(PACKAGE_IMPORTS["#control/*"]).toBe("./foliplus/js/control/*");
    expect(PACKAGE_IMPORTS["#script/*"]).toBe("./script/*");
  });

  it("SHARED_MODULE_PREFIXES is #platform/#core only — #foliplus is aliased but not shared", () => {
    // The alias table has five entries (#platform/#core/#ui/#control/#foliplus), but only
    // #platform and #core have their whole namespace published on
    // window.foliplus. #foliplus/BaseControl.js is shared by exact name
    // (see SHARED_MODULE_EXACTS); every other #foliplus/* path — a component
    // importing its own const.js or config-schema.js — bundles normally
    // through esbuild's alias and must NOT be externalized. The old test
    // asserted the alias table and the shared set were equal; that
    // assumption is what externalized self-imports as empty shims.
    expect([...SHARED_MODULE_PREFIXES].sort()).toEqual(["core", "platform", "ui"]);
    for (const prefix of SHARED_MODULE_PREFIXES) {
      expect(Object.keys(pathAliases(ROOT))).toContain(`#${prefix}`);
    }
    expect(SHARED_MODULE_PREFIXES).not.toContain("foliplus");
  });

  it("SHARED_MODULE_EXACTS names only #foliplus/BaseControl.js", () => {
    // The single escape hatch: BaseControl is imported from
    // #foliplus/BaseControl.js (not #core/… or #platform/…), but the runtime
    // publishes it on window.foliplus.BaseControl, so it must still be
    // externalized.
    expect(SHARED_MODULE_EXACTS).toEqual(["#foliplus/BaseControl.js"]);
  });

  it("SHARED_SPEC_REGEX_SOURCE matches the shared set and rejects non-shared #foliplus/*", () => {
    const re = new RegExp(`^(${SHARED_SPEC_REGEX_SOURCE})$`);
    // Shared prefixes
    expect(re.test("#platform/dom.js")).toBe(true);
    expect(re.test("#core/overlay/hint.js")).toBe(true);
    expect(re.test("#core/layer/LayerFactory.js")).toBe(true);
    // Exact shared spec
    expect(re.test("#foliplus/BaseControl.js")).toBe(true);
    // #foliplus/* self-imports — bundled, not externalized
    expect(re.test("#foliplus/config-schema.js")).toBe(false);
    expect(re.test("#control/LayerControl/const.js")).toBe(false);
    expect(re.test("#control/LayerControl/ui/index.js")).toBe(false);
    expect(re.test("#control/SearchControl/const.js")).toBe(false);
    // Unrelated aliases
    expect(re.test("#script/build.mjs")).toBe(false);
    expect(re.test("#core")).toBe(false); // bare prefix without /
    expect(re.test("#platform")).toBe(false);
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
  it("ALIAS_TO_REL is the single source every consumer table derives from", () => {
    // The four tables that used to each spell the alias->dir mapping by hand:
    //   - package.json imports (Node resolution; cannot import this module)
    //   - esbuild alias (pathAliases -- reads ALIAS_TO_REL)
    //   - global-namespace-plugin prefix rewrite (namespacePrefixRules -- reads ALIAS_TO_REL)
    //   - import-boundary TIER (reads SHARED_MODULE_PREFIXES -- reads ALIAS_TO_REL)
    // A hand-edit to any one of them fails here instead of silently
    // externalizing or mis-routing an import at build time.
    expect(Object.keys(ALIAS_TO_REL)).toEqual([
      "#platform",
      "#core",
      "#ui",
      "#control",
      "#foliplus",
      "#script",
    ]);
    // SHARED_ALIASES is exactly ALIAS_TO_REL minus #script (vitest-only).
    expect([...SHARED_ALIASES].sort()).toEqual(
      Object.keys(ALIAS_TO_REL)
        .filter(k => k !== "#script")
        .sort(),
    );
  });

  it("SHARED_MODULE_PREFIXES derives from SHARED_ALIASES (not a hand-written list)", () => {
    // #control and #foliplus are aliased but deliberately NOT shared
    // prefixes: #control bundles per-component, #foliplus resolves to
    // foliplus/js (basename "js", not a directory under the shared namespace).
    // The derivation keeps the two in lockstep with the alias table, so a
    // tier rename cannot leave the shared-import regex and the plugin rewrite
    // table pointing at a namespace nobody publishes.
    const expected = SHARED_ALIASES.filter(
      spec => spec !== "#control" && ALIAS_DIRS[spec].split("/").pop() !== "js",
    ).map(spec => ALIAS_DIRS[spec].split("/").pop());
    expect([...SHARED_MODULE_PREFIXES].sort()).toEqual([...expected].sort());
    expect(SHARED_MODULE_PREFIXES).not.toContain("foliplus");
    expect(SHARED_MODULE_PREFIXES).not.toContain("control");
  });

  it("namespacePrefixRules rewrites every shared prefix and only those", () => {
    const rules = namespacePrefixRules();
    expect(Object.keys(rules).sort()).toEqual([...SHARED_MODULE_PREFIXES].sort());
    for (const prefix of SHARED_MODULE_PREFIXES) {
      const dir = ALIAS_DIRS[`#${prefix}`].split("/").pop();
      expect(rules[prefix]).toBe(`${dir}/`);
    }
    // The rewrite is keyed by the alias segment, not the directory name: a
    // shared spec "#platform/dom.js" becomes "platform/dom.js" under the source root.
    expect(rules["platform"]).toBe("platform/");
    expect(rules["core"]).toBe("core/");
    expect(rules["ui"]).toBe("ui/");
  });

  it("every #alias target directory exists on disk", () => {
    // A half-done rename (alias renamed, directory not, or vice versa) fails
    // here with a clear message instead of a cryptic ERR_PACKAGE_IMPORT_*
    // at test-import or build time.
    for (const [spec, rel] of Object.entries(ALIAS_TO_REL)) {
      expect(
        existsSync(resolve(ROOT, rel)),
        `${spec} -> ${rel}: target directory missing on disk`,
      ).toBe(true);
    }
  });
});
