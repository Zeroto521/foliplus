import { describe, expect, it } from "vitest";
import {
  POSITIONS,
  buildSkeleton,
  controlSlug,
  insertSortedLine,
  isValidControlName,
  patchApiRst,
  patchComponentTs,
  patchInitPy,
  patchLocaleKeys,
  patchReadme,
  splitArgv,
} from "#script/new-control.mjs";

const COMPONENT_TS = `const COMPONENTS = {
  MeasureControl: "MeasureControl",
  ExportControl: "ExportControl",
  HeatmapControl: "HeatmapControl",
} as const;
`;

const API_RST = `.. autosummary::
   :toctree: api

   BaseControl
   ExportControl
   locale
`;

const INIT_PY = `from .BaseControl import BaseControl
from .ExportControl import ExportControl

__all__ = [
    "BaseControl",
    "ExportControl",
]
`;

const README = `| Control | Description |
| :------ | :---------- |
| 📷 **ExportControl**     | Capture a region. |
| 🔥 **HeatmapControl**    | Hexbin heatmap. |
`;

const LOCALE_PY = `_JS_USED_KEYS = {
    "foliplus.close_label",
    # ExportControl
    "ExportControl.btn_title",
}
`;

describe("isValidControlName", () => {
  it("accepts PascalCase *Control", () => {
    expect(isValidControlName("FooControl")).toBe(true);
    expect(isValidControlName("ScaleControl")).toBe(true);
  });

  it("rejects non-Control or non-PascalCase names", () => {
    expect(isValidControlName("foo")).toBe(false);
    expect(isValidControlName("fooControl")).toBe(false);
    expect(isValidControlName("Control")).toBe(false);
    expect(isValidControlName("FooBar")).toBe(false);
  });
});

describe("controlSlug", () => {
  it("strips Control and lowercases", () => {
    expect(controlSlug("ScaleControl")).toBe("scale");
    expect(controlSlug("FullscreenControl")).toBe("fullscreen");
  });

  it("kebab-cases multi-word names", () => {
    expect(controlSlug("FooBarControl")).toBe("foo-bar");
  });
});

describe("splitArgv", () => {
  it("separates the positional name from flags", () => {
    const { positional, flagTokens } = splitArgv([
      "FooControl",
      "--description=hello",
      "--force",
    ]);
    expect(positional).toEqual(["FooControl"]);
    expect(flagTokens).toEqual(["--description=hello", "--force"]);
  });

  it("keeps space-separated flag values with their flag", () => {
    const { positional, flagTokens } = splitArgv([
      "FooControl",
      "--description",
      "hello world",
      "--icon",
      "🧪",
    ]);
    expect(positional).toEqual(["FooControl"]);
    expect(flagTokens).toEqual(["--description", "hello world", "--icon", "🧪"]);
  });
});

describe("insertSortedLine", () => {
  it("inserts alphabetically among existing keys", () => {
    const out = insertSortedLine(
      COMPONENT_TS,
      { start: "const COMPONENTS = {", end: "} as const;" },
      'ScaleControl: "ScaleControl",',
    );
    expect(out).toContain('ScaleControl: "ScaleControl",');
    // E < H < M < S — Scale lands after MeasureControl, before the closing brace.
    expect(out.indexOf("MeasureControl")).toBeLessThan(out.indexOf("ScaleControl"));
    expect(out.indexOf("ScaleControl")).toBeLessThan(out.indexOf("} as const;"));
  });

  it("is a no-op when the line already exists", () => {
    const line = 'ExportControl: "ExportControl",';
    expect(
      insertSortedLine(
        COMPONENT_TS,
        { start: "const COMPONENTS = {", end: "} as const;" },
        line,
      ),
    ).toBe(COMPONENT_TS);
  });

  it("throws when the start marker is missing", () => {
    expect(() =>
      insertSortedLine("nope", { start: "const X = {", end: "}" }, "a: 1,"),
    ).toThrow(/marker not found/);
  });
});

describe("patchInitPy", () => {
  it("adds the import and a sorted __all__ entry", () => {
    const out = patchInitPy(INIT_PY, "AlphaControl");
    expect(out).toContain("from .AlphaControl import AlphaControl");
    expect(out.indexOf('"AlphaControl"')).toBeLessThan(out.indexOf('"BaseControl"'));
    expect(out.indexOf('"BaseControl"')).toBeLessThan(out.indexOf('"ExportControl"'));
  });

  it("is idempotent", () => {
    const once = patchInitPy(INIT_PY, "AlphaControl");
    expect(patchInitPy(once, "AlphaControl")).toBe(once);
  });
});

describe("patchComponentTs", () => {
  it("adds the name to COMPONENTS", () => {
    const out = patchComponentTs(COMPONENT_TS, "ScaleControl");
    expect(out).toContain('ScaleControl: "ScaleControl",');
  });
});

describe("patchApiRst", () => {
  it("inserts before locale", () => {
    const out = patchApiRst(API_RST, "ScaleControl");
    expect(out).toMatch(/\n\s+ScaleControl\n/);
    expect(out.indexOf("ScaleControl")).toBeLessThan(out.indexOf("locale"));
  });

  it("does not duplicate an existing entry", () => {
    expect(patchApiRst(API_RST, "ExportControl")).toBe(API_RST);
  });
});

describe("patchReadme", () => {
  it("appends a table row after the last Control row", () => {
    const out = patchReadme(README, "ScaleControl", "Scale bar.", "📐");
    expect(out).toContain("**ScaleControl**");
    expect(out.indexOf("HeatmapControl")).toBeLessThan(out.indexOf("ScaleControl"));
  });

  it("does not duplicate an existing row", () => {
    expect(patchReadme(README, "ExportControl", "x", "x")).toBe(README);
  });
});

describe("patchLocaleKeys", () => {
  it("seeds a per-control key block before the set close", () => {
    const out = patchLocaleKeys(LOCALE_PY, "ScaleControl");
    expect(out).toContain("# ScaleControl");
    expect(out).toContain('"ScaleControl.title"');
    expect(out.indexOf("ScaleControl.title")).toBeLessThan(out.indexOf("\n}"));
  });
});

describe("buildSkeleton", () => {
  const skeleton = buildSkeleton({
    name: "FooControl",
    description: "Foo the map.",
    position: "topleft",
    icon: "🧪",
  });

  it("creates the dual-stack file set", () => {
    expect([...skeleton.files.keys()].sort()).toEqual([
      "foliplus/FooControl.py",
      "foliplus/css/FooControl.css",
      "foliplus/js/FooControl/index.ts",
      "foliplus/locale/FooControl.en.json",
      "foliplus/locale/FooControl.zh.json",
      "test/python/test_FooControl.py",
    ]);
  });

  it("uses the core controlEnv import (not the old common/guard path)", () => {
    const ts = skeleton.files.get("foliplus/js/FooControl/index.ts");
    expect(ts).toContain('from "#core/controlEnv.js"');
    expect(ts).not.toContain("#common/guard.js");
  });

  it("only references design tokens that exist in token.css", () => {
    const css = skeleton.files.get("foliplus/css/FooControl.css");
    const tokens = [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
    const allowed = new Set([
      "--space-sm",
      "--space-md",
      "--ctrl-bg",
      "--text-primary",
      "--border-thin",
      "--divider-color",
      "--radius-lg",
      "--font-size-sm",
    ]);
    for (const t of tokens) expect(allowed.has(t)).toBe(true);
  });

  it("writes matching en/zh locale tables with locale.code", () => {
    const en = JSON.parse(skeleton.files.get("foliplus/locale/FooControl.en.json"));
    const zh = JSON.parse(skeleton.files.get("foliplus/locale/FooControl.zh.json"));
    expect(en["locale.code"]).toBe("en");
    expect(zh["locale.code"]).toBe("zh");
    expect(en["FooControl.title"]).toBe("Foo the map.");
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  it("accepts only known Leaflet positions at the type level", () => {
    expect([...POSITIONS].sort()).toEqual([
      "bottomleft",
      "bottomright",
      "topleft",
      "topright",
    ]);
  });
});
