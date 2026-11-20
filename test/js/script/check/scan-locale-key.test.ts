import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collect,
  collectAll,
  extractLiterals,
  isFullKey,
  prefixFor,
  stripComments,
  walk,
} from "#script/check/scan-locale-key.mjs";

// scan-locale-key.mjs — the locale-key scanner drives the Python test suite's
// _JS_USED_KEYS derivation. Test the pure extractors/collectors against
// synthetic sources so a matcher regression is caught without a full repo walk.

describe("prefixFor", () => {
  it("maps control/<Name>/... to the control name", () => {
    expect(prefixFor("control/LayerControl/ui.ts")).toBe("LayerControl");
    expect(prefixFor("control/MeasureControl/logic/x.ts")).toBe("MeasureControl");
  });

  it("returns null for shared/core and unknown top segments", () => {
    expect(prefixFor("core/layer/registry.ts")).toBeNull();
    expect(prefixFor("platform/dom.ts")).toBeNull();
    expect(prefixFor("control/NopeControl/x.ts")).toBeNull();
  });
});

describe("stripComments", () => {
  it("removes block and line comments", () => {
    const src = 'T("a") /* block */ // line\nT("b")';
    expect(stripComments(src)).toBe('T("a")  // line\nT("b")'.replace("// line", ""));
  });

  it("treats // as a comment start (documented scanner limitation)", () => {
    // Locale keys never contain "//", so the line-comment regex truncates a
    // string that does. This is the documented scanner behavior, not a leak.
    expect(stripComments('const x = "http://example.com";')).toBe('const x = "http:');
    expect(stripComments('T("a") // trailing comment')).toBe('T("a") ');
  });
});

describe("extractLiterals", () => {
  it("pulls single- and double-quoted literals", () => {
    expect(extractLiterals("T(\"a\") + _('b')")).toEqual(["a", "b"]);
  });

  it("does not cross an unescaped same-quote", () => {
    // The matcher is deliberately simple; it should not grab across an
    // intervening same quote in the same string region.
    expect(extractLiterals('"a" "b"')).toEqual(["a", "b"]);
  });
});

describe("isFullKey", () => {
  it("accepts dotted keys and rejects bare keys", () => {
    expect(isFullKey("LayerControl.title")).toBe(true);
    expect(isFullKey("title")).toBe(false);
  });
});

describe("collect", () => {
  it("scopes T() keys under the control prefix and passes full keys through", () => {
    const keys = collect(
      "control/SearchControl/ui.ts",
      'T("placeholder") T("SearchControl.full") _("global_key")',
    );
    expect(keys).toContain("SearchControl.placeholder");
    expect(keys).toContain("SearchControl.full");
    expect(keys).toContain("global_key");
  });

  it("keeps unscoped _() keys as-is", () => {
    const keys = collect("control/ExportControl/ui.ts", '_("common_ok")');
    expect(keys).toContain("common_ok");
  });

  it("captures localeFallback second arg", () => {
    const keys = collect(
      "control/HeatmapControl/ui.ts",
      'localeFallback("en", "heat.label", "Label")',
    );
    expect(keys).toContain("heat.label");
  });

  it("captures NAME_LABEL_KEY static props", () => {
    const keys = collect("control/ScaleControl/const.ts", 'NAME_LABEL_KEY = "short"');
    expect(keys).toContain("ScaleControl.short");
  });

  it("captures template literals with CONFIG.name suffix", () => {
    const keys = collect(
      "control/LayerControl/ui.ts",
      "const k = `${CONFIG.name}.popup_title_geo`;",
    );
    expect(keys).toContain("LayerControl.popup_title_geo");
  });

  it("skips commented-out keys", () => {
    const keys = collect("control/LayerControl/ui.ts", '// T("commented")');
    expect(keys.has("LayerControl.commented")).toBe(false);
  });
});

describe("collectAll / walk", () => {
  it("walks a synthetic root and returns the sorted union of keys", () => {
    const root = mkdtempSync(join(tmpdir(), "scan-locale-"));
    try {
      mkdirSync(join(root, "control", "LayerControl"), { recursive: true });
      writeFileSync(
        join(root, "control", "LayerControl", "ui.ts"),
        'T("title") T("help")',
      );
      writeFileSync(join(root, "control", "LayerControl", "util.ts"), 'T("close")');
      mkdirSync(join(root, "core"), { recursive: true });
      writeFileSync(join(root, "core", "x.ts"), '_("shared_key")');
      const keys = collectAll(root);
      expect(keys).toEqual([
        "LayerControl.close",
        "LayerControl.help",
        "LayerControl.title",
        "shared_key",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips node_modules and dist directories", () => {
    const root = mkdtempSync(join(tmpdir(), "scan-locale-"));
    try {
      mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
      mkdirSync(join(root, "dist"), { recursive: true });
      writeFileSync(join(root, "node_modules", "dep", "x.ts"), 'T("hidden")');
      writeFileSync(join(root, "dist", "y.ts"), 'T("bundled")');
      writeFileSync(join(root, "a.ts"), '_("visible")');
      const files = walk(root);
      expect(files.length).toBe(1);
      expect(collectAll(root)).toEqual(["visible"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
