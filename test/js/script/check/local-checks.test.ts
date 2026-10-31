import { describe, expect, it } from "vitest";
import {
  collectChangedFiles,
  mapJsTests,
  mapPyTests,
  vitestCmd,
} from "#script/check/local-checks.mjs";

// The mapping helpers are pure: they take an injected existence probe, so the
// path rules can be asserted without touching the real tree.

const allExist = () => true;
const noneExist = () => false;

describe("mapJsTests", () => {
  it("maps a component source file to its sibling test file", () => {
    const paths = mapJsTests(["foliplus/js/HeatmapControl/manager.ts"], allExist);
    expect(paths).toEqual(["test/js/HeatmapControl/manager.test.ts"]);
  });

  it("falls back to the component test dir when no sibling test exists", () => {
    const paths = mapJsTests(
      ["foliplus/js/HeatmapControl/ui.ts"],
      p => p === "test/js/HeatmapControl", // dir exists, sibling file does not
    );
    expect(paths).toEqual(["test/js/HeatmapControl"]);
  });

  it("maps a top-level foliplus/js file to its test file", () => {
    const paths = mapJsTests(["foliplus/js/BaseControl.ts"], allExist);
    expect(paths).toEqual(["test/js/BaseControl.test.ts"]);
  });

  it("maps a shared common file to its sibling test", () => {
    const paths = mapJsTests(["foliplus/js/common/dom.ts"], allExist);
    expect(paths).toEqual(["test/js/common/dom.test.ts"]);
  });

  it("maps a script module to its test file", () => {
    const paths = mapJsTests(["script/build/build.mjs"], allExist);
    expect(paths).toEqual(["test/js/script/build/build.test.ts"]);
  });

  it("returns [] when no changed file maps to a test", () => {
    expect(mapJsTests([], noneExist)).toEqual([]);
    expect(mapJsTests(["foliplus/css/HeatmapControl.css"], noneExist)).toEqual([]);
  });
});

describe("mapPyTests", () => {
  it("maps a control module to its test/python subdir", () => {
    const paths = mapPyTests(
      ["foliplus/HeatmapControl.py"],
      p => p === "test/python/HeatmapControl",
    );
    expect(paths).toEqual(["test/python/HeatmapControl"]);
  });

  it("maps a control module to its test file when no subdir exists", () => {
    const paths = mapPyTests(
      ["foliplus/ScaleControl.py"],
      p => p === "test/python/ScaleControl.py",
    );
    expect(paths).toEqual(["test/python/ScaleControl.py"]);
  });

  it("maps a changed test/python file to itself", () => {
    const paths = mapPyTests(["test/python/test_locale.py"], allExist);
    expect(paths).toEqual(["test/python/test_locale.py"]);
  });

  it("returns [] when no changed file maps to a test", () => {
    expect(mapPyTests([], noneExist)).toEqual([]);
  });
});

describe("collectChangedFiles", () => {
  it("dedupes and drops .foliplus scratch", () => {
    const files = collectChangedFiles({
      changedFiles: ["foliplus/js/X.ts", "foliplus/js/X.ts", ".foliplus/tmp/a.js"],
    });
    expect(files).toEqual(["foliplus/js/X.ts"]);
  });
});

describe("vitestCmd", () => {
  it("runs vitest through the Windows spawn shim", () => {
    const cmd = vitestCmd(["test/js/X.test.ts"]);
    expect(cmd).toContain("--import");
    expect(cmd).toContain("vite-spawn-patch.mjs");
    expect(cmd).toContain("--pool=threads");
    expect(cmd).toContain("test/js/X.test.ts");
  });

  it("passes multiple test paths", () => {
    const cmd = vitestCmd(["test/js/a.test.ts", "test/js/b.test.ts"]);
    expect(cmd).toContain("test/js/a.test.ts");
    expect(cmd).toContain("test/js/b.test.ts");
  });
});
