// Mode-resolution contract — the shared resolver the mode-resolution convergence
// will introduce (resolveModeByValue) and the behaviours it must preserve.
//
// This file is pure contract: it asserts the CURRENT behaviour of
// resolveFillMode / resolveStrokeMode (regression guards that must stay green
// through every migration step) and the NEW symbols (resolveModeByValue /
// solidColorOf / effectiveFaceValue) that appear only after the migration
// lands (migration criteria — Section B).
//
// Section A (green today, must stay green): fill and stroke agree on the
// shared (mode, value) pairs — the one truth a single resolveModeByValue must
// reproduce.
// Section B (red until migrated, and RED, not skipped, if a symbol is missing):
// the convergence API's contract, asserted two ways:
//   B0 source-level guard — readFileSync the source file and require the
//      export to exist. This cannot be skipped, so a migration PR that forgets
//      to export a symbol turns RED instead of silently skipping.
//   B1-B4 behavioural criteria — each asserts real behaviour (not typeof),
//      and each migration step must also flip its it.skipIf into a plain it
//      (documented in the implementation-order list, §6.2).
import { repoPath } from "#test/path.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INTENT, type StyleMode, type ValueConfig } from "#core/layer/index.js";
import { DEFAULT_SCHEMES, METHOD } from "#core/value/index.js";
import { resolveFillMode } from "#control/LayerControl/ui/style/fillValue.js";
import { resolveStrokeMode } from "#control/LayerControl/ui/style/strokeValue.js";

// The new symbols — imported lazily so this file compiles before the
// migration lands. A missing export is a migration criterion (Section B),
// not a compile error.
let resolveModeByValue:
  | ((mode: StyleMode | undefined, value: ValueConfig | undefined) => StyleMode)
  | undefined;
let solidColorOf:
  | ((
      ui: unknown,
      layerId: string,
      face: "fill" | "stroke",
      opts?: { excludeBasemap?: boolean },
    ) => string | undefined)
  | undefined;
let effectiveFaceValue:
  | ((
      ui: unknown,
      layerId: string,
      face: "fill" | "stroke",
      opts?: { allowDeclared?: boolean },
    ) => ValueConfig | undefined)
  | undefined;
try {
  const mod = (await import("#control/LayerControl/ui/style/fillValue.js")) as Record<
    string,
    unknown
  >;
  if (typeof mod.resolveModeByValue === "function") {
    resolveModeByValue = mod.resolveModeByValue as never;
  }
} catch {
  /* not exported yet — B0 catches a missing export without depending on this */
}
try {
  const mod = (await import("#control/LayerControl/ui/style/styleBag.js")) as Record<
    string,
    unknown
  >;
  if (typeof mod.solidColorOf === "function") solidColorOf = mod.solidColorOf as never;
} catch {
  /* not exported yet */
}
try {
  const mod = (await import("#control/LayerControl/ui/style/fillValue.js")) as Record<
    string,
    unknown
  >;
  if (typeof mod.effectiveFaceValue === "function") {
    effectiveFaceValue = mod.effectiveFaceValue as never;
  }
} catch {
  /* not exported yet */
}

/** Read a tracked source file with normalized line endings. */
const sourceOf = (rel: string): string =>
  readFileSync(resolve(repoPath(), rel), "utf-8").replace(/\r\n/g, "\n");

/** Minimal LayerUI with a live intent map keyed by (id, key). */
const makeUI = (): any => {
  const intent = new Map<string, unknown>();
  return {
    intentStore: {
      get: (_id: string, key: string) => intent.get(key),
      setValue: (_id: string, key: string, value: unknown) => intent.set(key, value),
      clearValue: (_id: string, key: string) => intent.delete(key),
    },
    c: {
      layerRegistry: new Map(),
      findLayer: () => null,
    },
  };
};

const makeRamp = (overrides: Partial<ValueConfig> = {}): ValueConfig => ({
  field: "value",
  method: METHOD.EQUAL,
  classes: 3,
  scheme: DEFAULT_SCHEMES[0],
  ...overrides,
});

// The 6 (mode, value) combinations the shared resolver must answer identically
// for the fill face and the stroke face.
const PARITY: Array<{
  mode: StyleMode | undefined;
  hasValue: boolean;
  expect: StyleMode;
}> = [
  { mode: undefined, hasValue: false, expect: "solid" },
  { mode: undefined, hasValue: true, expect: "value" },
  { mode: "solid", hasValue: false, expect: "solid" },
  { mode: "solid", hasValue: true, expect: "solid" },
  { mode: "value", hasValue: false, expect: "value" },
  { mode: "original", hasValue: true, expect: "original" },
];

afterEach(() => {
  vi.clearAllMocks();
});

describe("mode resolution contract (Section A — green now, must stay green)", () => {
  it("fill and stroke agree on every shared (mode, value) pair", () => {
    for (const { mode, hasValue, expect: expected } of PARITY) {
      const ui = makeUI();
      const value = hasValue ? makeRamp() : undefined;
      if (mode !== undefined) {
        ui.intentStore.setValue("overlay1", INTENT.FILL_MODE, mode);
      }
      // resolveFillMode reads the stored FILL_MODE intent and the live value.
      expect(resolveFillMode(ui, "overlay1", value)).toBe(expected);
      // resolveStrokeMode takes the mode and value as arguments (stroke has no
      // intent read of its own — the caller supplies both).
      expect(resolveStrokeMode(mode, value)).toBe(expected);
    }
  });

  it("a stored fill mode always wins over the value inference (fill side)", () => {
    const ui = makeUI();
    ui.intentStore.setValue("overlay1", INTENT.FILL_MODE, "original");
    expect(resolveFillMode(ui, "overlay1", makeRamp())).toBe("original");
  });

  it("no stored mode + no value config resolves to solid on both faces", () => {
    expect(resolveFillMode(makeUI(), "overlay1", undefined)).toBe("solid");
    expect(resolveStrokeMode(undefined, undefined)).toBe("solid");
  });
});

describe("mode resolution contract (Section B — migration criteria)", () => {
  // B0 — source-level guard. Cannot be skipped: a migration PR that forgets
  // to export a symbol turns RED here, even if the behavioural criteria below
  // were left on skipIf.
  // Whether a module exports a name — either inline (export function X /
  // export const X) or through a trailing export { ... X ... } block. The
  // migration may use either style; both make the symbol importable.
  const isExported = (source: string, name: string): boolean => {
    if (new RegExp(`export\\s+(?:function|const|class)\\s+${name}\\b`).test(source)) {
      return true;
    }
    const block = source.match(/export\s*\{([^}]*)\}/);
    if (block) {
      return new RegExp(`\\b${name}\\b`).test(block[1]);
    }
    return false;
  };

  it("source files export the convergence symbols (unskippable)", () => {
    const fillValue = sourceOf(
      "foliplus/js/control/LayerControl/ui/style/fillValue.ts",
    );
    const strokeValue = sourceOf(
      "foliplus/js/control/LayerControl/ui/style/strokeValue.ts",
    );
    const styleBag = sourceOf("foliplus/js/control/LayerControl/ui/style/styleBag.ts");
    expect(isExported(fillValue, "resolveModeByValue"), "resolveModeByValue").toBe(
      true,
    );
    expect(isExported(fillValue, "effectiveFaceValue"), "effectiveFaceValue").toBe(
      true,
    );
    expect(isExported(styleBag, "solidColorOf"), "solidColorOf").toBe(true);
    // resolveModeByValue lives in fillValue.ts; strokeValue.ts must import it
    // (not re-export it). This source-level check proves S1 wired the stroke
    // side to the shared resolver — a stroke file that still inlines its own
    // mode ?? (ramp ? value : solid) would fail here.
    expect(strokeValue).toMatch(/resolveModeByValue/);
    expect(strokeValue).toMatch(/from\s+["']\.\/fillValue\.js["']/);
  });

  it("resolveModeByValue reproduces every parity row (S1)", () => {
    for (const { mode, hasValue, expect: expected } of PARITY) {
      expect(resolveModeByValue!(mode, hasValue ? makeRamp() : undefined)).toBe(
        expected,
      );
    }
  });

  it("resolveModeByValue matches the live fill resolver on every row (S1)", () => {
    for (const { mode, hasValue } of PARITY) {
      const ui = makeUI();
      if (mode !== undefined) {
        ui.intentStore.setValue("overlay1", INTENT.FILL_MODE, mode);
      }
      const value = hasValue ? makeRamp() : undefined;
      expect(resolveModeByValue!(mode, value)).toBe(
        resolveFillMode(ui, "overlay1", value),
      );
    }
  });

  it.skipIf(!solidColorOf)(
    "solidColorOf excludes a basemap (excludeBasemap returns undefined)",
    () => {
      // A colour basemap has no leaves to classify: its fill is the pane's
      // paint. solidColorOf must answer undefined for it, not a derived color.
      const ui = makeUI();
      ui.c.layerRegistry.set("base1", {
        id: "base1",
        name: "Base",
        role: "base",
        color: "#abcdef",
        layer: { options: {}, setZIndex: vi.fn() },
      } as never);
      const got = solidColorOf!(ui, "base1", "fill", { excludeBasemap: true });
      expect(got).toBeUndefined();
    },
  );

  it.skipIf(!solidColorOf)(
    "solidColorOf derives the authored base for a per-feature layer",
    () => {
      // A per-feature layer's solid color must come from the author's base
      // (styleBaseOf), not any per-leaf value — the #1050/#1058 regression
      // surface. Build a per-feature fixture: leaves each carry their own
      // author colour, but styleBaseOf must read the shared base.
      const ui = makeUI();
      const baseColor = "#aabbcc";
      const leaf = () => ({
        options: { fillColor: baseColor, fillOpacity: 0.5, fill: true },
        setStyle: vi.fn(),
        eachLayer: undefined,
      });
      const leaves = [leaf(), leaf()];
      const parent = {
        options: {},
        eachLayer: vi.fn((fn: (c: unknown) => void) => leaves.forEach(c => fn(c))),
        leaves,
      } as never;
      ui.c.layerRegistry.set("feature1", {
        id: "feature1",
        name: "Per feature",
        role: "overlay",
        layer: parent,
        fillAuthor: { perFeature: true, distinct: 2, stops: [baseColor, "#ffffff"] },
      } as never);
      const got = solidColorOf!(ui, "feature1", "fill");
      expect(got).toBe(baseColor);
    },
  );

  it.skipIf(!effectiveFaceValue)(
    "effectiveFaceValue keeps fill's declared fallback and stroke's stored-only semantics",
    () => {
      // Four-cell truth table: (stored, declared) × allowDeclared.
      // Cell 1: stored + declared + allowDeclared=true → stored wins (fill).
      // Cell 2: stored + declared + allowDeclared=false → stored (stroke).
      // Cell 3: no stored + declared + allowDeclared=true → declared (fill).
      // Cell 4: no stored + declared + allowDeclared=false → undefined (stroke).
      // Cell 5: stored + no declared → stored regardless of allowDeclared.
      const stored = makeRamp({ field: "storedCol" });
      const layer = { options: { foliplus: { fill: { field: "declaredCol" } } } };

      // Cell 1 + 2: stored present, declared present.
      {
        const ui = makeUI();
        ui.intentStore.setValue("overlay1", INTENT.FILL_VALUE, stored);
        ui.c.findLayer = () => layer as never;
        expect(
          effectiveFaceValue!(ui, "overlay1", "fill", { allowDeclared: true }),
        ).toEqual(stored);
        expect(
          effectiveFaceValue!(ui, "overlay1", "stroke", { allowDeclared: false }),
        ).toEqual(stored);
      }
      // Cell 3 + 4: no stored, declared present.
      {
        const ui = makeUI();
        ui.c.findLayer = () => layer as never;
        const fill = effectiveFaceValue!(ui, "overlay1", "fill", {
          allowDeclared: true,
        });
        expect(fill).toEqual(expect.objectContaining({ field: "declaredCol" }));
        expect(
          effectiveFaceValue!(ui, "overlay1", "stroke", { allowDeclared: false }),
        ).toBeUndefined();
      }
      // Cell 5: stored present, no declared.
      {
        const ui = makeUI();
        ui.intentStore.setValue("overlay1", INTENT.FILL_VALUE, stored);
        ui.c.findLayer = () => ({ options: {} }) as never;
        expect(
          effectiveFaceValue!(ui, "overlay1", "fill", { allowDeclared: true }),
        ).toEqual(stored);
        expect(
          effectiveFaceValue!(ui, "overlay1", "stroke", { allowDeclared: false }),
        ).toEqual(stored);
      }
    },
  );
});
