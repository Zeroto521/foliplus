import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  POSITIONS,
  SPEC,
  buildSkeleton,
  controlSlug,
  insertSortedLine,
  isValidControlName,
  parseArgs,
  patchApiRst,
  patchComponentTs,
  patchInitPy,
  patchLocaleKeys,
  patchReadme,
  report,
  scaffoldControl,
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

/** Minimal repo fixture that scaffoldControl can patch. */
function mkFixture(files: Record<string, string>): string {
  const root = join(tmpdir(), "new-control-test-" + Date.now() + Math.random());
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, ...rel.split("/"));
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf-8");
  }
  return root;
}

const FIXTURE = {
  "foliplus/__init__.py": INIT_PY,
  "foliplus/js/core/component.ts": COMPONENT_TS,
  "doc/source/api.rst": API_RST,
  "README.md": README,
  "test/python/test_locale.py": LOCALE_PY,
};

let tmpRoot: string | undefined;

afterEach(() => {
  if (tmpRoot) {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    tmpRoot = undefined;
  }
});

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
    expect(isValidControlName("")).toBe(false);
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

  it("handles empty argv", () => {
    expect(splitArgv([])).toEqual({ positional: [], flagTokens: [] });
  });
});

describe("parseArgs", () => {
  it("lifts the positional name onto the result", () => {
    const opts = parseArgs(["FooControl", "--force"]);
    expect(opts.name).toBe("FooControl");
    expect(opts.force).toBe(true);
    expect(opts.errors).toEqual([]);
  });

  it("defaults position and leaves name null when absent", () => {
    const opts = parseArgs([]);
    expect(opts.name).toBeNull();
    expect(opts.position).toBe("topleft");
    expect(opts.description).toBe("");
  });

  it("surfaces unknown-flag errors", () => {
    const opts = parseArgs(["--nope"]);
    expect(opts.errors.length).toBeGreaterThan(0);
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
    expect(out.indexOf("MeasureControl")).toBeLessThan(out.indexOf("ScaleControl"));
    expect(out.indexOf("ScaleControl")).toBeLessThan(out.indexOf("} as const;"));
  });

  it("skips comment lines when ordering", () => {
    const text = `const COMPONENTS = {
  // header
  ExportControl: "ExportControl",
} as const;
`;
    const out = insertSortedLine(
      text,
      { start: "const COMPONENTS = {", end: "} as const;" },
      'ScaleControl: "ScaleControl",',
    );
    expect(out.indexOf("ExportControl")).toBeLessThan(out.indexOf("ScaleControl"));
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

  it("throws when the end marker is missing", () => {
    expect(() =>
      insertSortedLine(
        "const COMPONENTS = {\n  A: 1,\n",
        { start: "const COMPONENTS = {", end: "} as const;" },
        "B: 2,",
      ),
    ).toThrow(/end marker not found/);
  });
});

describe("patchInitPy", () => {
  it("adds the import and a sorted __all__ entry", () => {
    const out = patchInitPy(INIT_PY, "AlphaControl");
    expect(out).toContain("from .AlphaControl import AlphaControl");
    expect(out.indexOf('"AlphaControl"')).toBeLessThan(out.indexOf('"BaseControl"'));
    expect(out.indexOf('"BaseControl"')).toBeLessThan(out.indexOf('"ExportControl"'));
  });

  it("is idempotent when the import already exists", () => {
    const once = patchInitPy(INIT_PY, "AlphaControl");
    expect(patchInitPy(once, "AlphaControl")).toBe(once);
  });

  it("keeps __all__ sorted when only the export is missing", () => {
    const text = `from .BaseControl import BaseControl
from .ScaleControl import ScaleControl

__all__ = [
    "BaseControl",
]
`;
    const out = patchInitPy(text, "ScaleControl");
    // Import already present → no change.
    expect(out).toBe(text);
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

  it("throws when no control table row exists", () => {
    expect(() => patchReadme("no table", "FooControl", "x")).toThrow(
      /README control table/,
    );
  });
});

describe("patchLocaleKeys", () => {
  it("seeds a per-control key block before the set close", () => {
    const out = patchLocaleKeys(LOCALE_PY, "ScaleControl");
    expect(out).toContain("# ScaleControl");
    expect(out).toContain('"ScaleControl.title"');
    expect(out.indexOf("ScaleControl.title")).toBeLessThan(out.indexOf("\n}"));
  });

  it("is a no-op when the key already exists", () => {
    const text = `_JS_USED_KEYS = {
    "ScaleControl.title",
}
`;
    expect(patchLocaleKeys(text, "ScaleControl")).toBe(text);
  });

  it("throws when _JS_USED_KEYS is missing", () => {
    expect(() => patchLocaleKeys("nothing", "FooControl")).toThrow(
      /_JS_USED_KEYS not found/,
    );
  });

  it("throws when the set has no closing brace line", () => {
    expect(() => patchLocaleKeys("_JS_USED_KEYS = {\n", "FooControl")).toThrow(
      /closing brace/,
    );
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
    const tokens = [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(m => m[1]);
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
    expect(tokens.length).toBeGreaterThan(0);
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

  it("accepts only known Leaflet positions", () => {
    expect([...POSITIONS].sort()).toEqual([
      "bottomleft",
      "bottomright",
      "topleft",
      "topright",
    ]);
  });
});

describe("scaffoldControl", () => {
  it("creates skeleton files and patches every registry", () => {
    tmpRoot = mkFixture(FIXTURE);
    const result = scaffoldControl(
      { name: "FooControl", description: "Foo.", position: "topright", icon: "🧪" },
      tmpRoot,
    );

    expect(result.created.sort()).toEqual([
      "foliplus/FooControl.py",
      "foliplus/css/FooControl.css",
      "foliplus/js/FooControl/index.ts",
      "foliplus/locale/FooControl.en.json",
      "foliplus/locale/FooControl.zh.json",
      "test/python/test_FooControl.py",
    ]);
    expect(result.patched.sort()).toEqual([
      "README.md",
      "doc/source/api.rst",
      "foliplus/__init__.py",
      "foliplus/js/core/component.ts",
      "test/python/test_locale.py",
    ]);
    expect(result.skipped).toEqual([]);

    expect(readFileSync(join(tmpRoot, "foliplus", "__init__.py"), "utf-8")).toContain(
      "from .FooControl import FooControl",
    );
    expect(
      readFileSync(join(tmpRoot, "foliplus", "js", "core", "component.ts"), "utf-8"),
    ).toContain('FooControl: "FooControl",');
    expect(readFileSync(join(tmpRoot, "doc", "source", "api.rst"), "utf-8")).toContain(
      "FooControl",
    );
    expect(readFileSync(join(tmpRoot, "README.md"), "utf-8")).toContain(
      "**FooControl**",
    );
    expect(
      readFileSync(join(tmpRoot, "test", "python", "test_locale.py"), "utf-8"),
    ).toContain('"FooControl.title"');
    expect(
      readFileSync(join(tmpRoot, "foliplus", "js", "FooControl", "index.ts"), "utf-8"),
    ).toContain('from "#core/controlEnv.js"');
  });

  it("is idempotent on a second run without --force", () => {
    tmpRoot = mkFixture(FIXTURE);
    scaffoldControl({ name: "FooControl", description: "Foo." }, tmpRoot);
    const again = scaffoldControl({ name: "FooControl", description: "Foo." }, tmpRoot);
    expect(again.created).toEqual([]);
    expect(again.patched).toEqual([]);
    expect(again.skipped.length).toBeGreaterThan(0);
  });

  it("uses CRLF-preserving patches when the fixture is CRLF", () => {
    const crlfInit = INIT_PY.replace(/\n/g, "\r\n");
    tmpRoot = mkFixture({ ...FIXTURE, "foliplus/__init__.py": crlfInit });
    scaffoldControl({ name: "FooControl", description: "Foo." }, tmpRoot);
    const out = readFileSync(join(tmpRoot, "foliplus", "__init__.py"), "utf-8");
    expect(out).toContain("from .FooControl import FooControl");
    expect(out.includes("\r\n")).toBe(true);
  });

  it("rethrows and logs when a registry mutator fails", () => {
    // README without any **…Control** row → patchReadme throws.
    tmpRoot = mkFixture({ ...FIXTURE, "README.md": "no table here\n" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      scaffoldControl({ name: "FooControl", description: "x" }, tmpRoot),
    ).toThrow(/README control table/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("report", () => {
  it("prints created / patched / skipped sections", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    report({
      created: ["foliplus/FooControl.py"],
      patched: ["README.md"],
      skipped: ["foliplus/__init__.py"],
      name: "FooControl",
      description: "x",
      position: "topleft",
      icon: "x",
    });
    const out = spy.mock.calls.map(c => c.join(" ")).join("\n");
    expect(out).toContain("scaffolded FooControl");
    expect(out).toContain("+ foliplus/FooControl.py");
    expect(out).toContain("~ README.md");
    expect(out).toContain("· foliplus/__init__.py");
    expect(out).toContain("Manual next steps");
    spy.mockRestore();
  });
});

describe("SPEC", () => {
  it("documents root / description / position / icon / force", () => {
    for (const key of ["root", "description", "position", "icon", "force", "help"]) {
      expect(SPEC).toHaveProperty(key);
    }
    expect(SPEC.root.default).toBeTruthy();
  });
});
