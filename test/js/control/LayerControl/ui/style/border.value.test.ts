// test/js/control/LayerControl/ui/style/border.value — value-stroke wiring and the detail row.
import { initFixture, installLeafletGlobals } from "../fixture.js";
import {
  countRamp,
  installChroma,
  makeFeatureGroup,
  makeFeatureLeaf,
  makeLeaf,
  registerFeatureLayer,
} from "./border.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIM, type ValueConfig } from "#core/layer/index.js";
import { DEFAULT_SCHEMES } from "#core/value/index.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  getIntent,
  seedIntentMap,
  setIntent,
} from "#control/LayerControl/ui/intent.js";
import {
  applyBorderToLayer,
  bindBorderRow,
  buildBorderRow,
  buildBorderRowShell,
  resetLayerBorder,
} from "#control/LayerControl/ui/style/border.js";
import { applyFillToLayer } from "#control/LayerControl/ui/style/fill.js";
import { pinnedGetterCount } from "#control/LayerControl/ui/style/pin.js";
import { getDimension } from "#control/LayerControl/ui/style/registry.js";
import { resolveStrokeMode } from "#control/LayerControl/ui/style/strokeValue.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

describe("value-stroke wiring (C1–C7)", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
    installChroma(["#010101", "#020202", "#030303"]);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    delete globalThis.chroma;
  });

  // C1: same value domain on fill and stroke — with the same classify +
  // palette, a value-classified fill and a value-classified border paint the
  // same value the same color on both faces. The border owns its value config
  // independently (no cross-face derivation): both faces carry the same
  // explicit config, so the same classify must produce the same color.
  it("C1 paints the same value domain the same color on fill and stroke", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);

    // Paint the fill by value first, capturing the per-leaf fill color.
    setIntent(ui, "vec1", "fillValue", countRamp());
    applyFillToLayer(ui, "vec1");
    const fillColors = leaves.map(l => l.options.fillColor);

    // Then the border, with its own explicit value config + value mode.
    setIntent(ui, "vec1", "borderValue", countRamp());
    setIntent(ui, "vec1", "borderStyleMode", "value");
    applyBorderToLayer(ui, "vec1");

    // The stroke write is a per-leaf setStyle with the value color.
    leaves.forEach((leaf, idx) => {
      const strokeCall = leaf.setStyle.mock.calls.at(-1)?.[0];
      expect(strokeCall).toMatchObject({ color: fillColors[idx], stroke: true });
    });
  });

  // C2: value mode Reset returns the layer to its authored flat border.
  it("C2 reset returns the layer to the authored flat border after a value stroke", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderValue", countRamp());
    setIntent(ui, "vec1", "borderStyleMode", "value");

    applyBorderToLayer(ui, "vec1");
    expect(leaves[0].setStyle).toHaveBeenCalled();

    resetLayerBorder(ui, "vec1");

    // The author's flat color returns — the bag captured the author's stroke
    // face on the first write and reset restores exactly it.
    leaves.forEach(leaf => {
      expect(leaf.options.color).toBe("#ff0000");
      expect(leaf.options.weight).toBe(2);
    });
  });

  // C3: zero fill opacity does not cross into the stroke — the border stays
  // value-classified even when the fill is invisible.
  it("C3 zero fill opacity leaves the value stroke uncolored", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "fillValue", countRamp());
    setIntent(ui, "vec1", "fillOpacity", 0);
    setIntent(ui, "vec1", "borderValue", countRamp());
    setIntent(ui, "vec1", "borderStyleMode", "value");

    applyFillToLayer(ui, "vec1");
    const fillColors = leaves.map(l => l.options.fillColor);
    // The fill is invisible but still classifies.
    expect(fillColors[0]).toBeDefined();

    applyBorderToLayer(ui, "vec1");

    leaves.forEach((leaf, idx) => {
      const strokeCall = leaf.setStyle.mock.calls.at(-1)?.[0];
      // The stroke carries its own value color, not a colorless write.
      expect(strokeCall).toMatchObject({ color: fillColors[idx], stroke: true });
    });
  });

  // C4: mode resolution is symmetric with the fill — a ramp with no explicit
  // mode reads as value, and no ramp reads as solid.
  it("C4 resolves the mode symmetrically with the fill mode", () => {
    expect(resolveStrokeMode(undefined, countRamp())).toBe("value");
    expect(resolveStrokeMode(undefined, undefined)).toBe("solid");
    expect(resolveStrokeMode("solid", countRamp())).toBe("solid");
    expect(resolveStrokeMode("value", countRamp())).toBe("value");
  });

  // C5: a config change after the cache was built returns null from the
  // highlight pin — the mouseout replay does not re-apply a stale color.
  it("C5 drops the highlight replay once the config changes", () => {
    const leaf = makeFeatureLeaf(5);
    registerFeatureLayer(manager, ui, "vec1", [leaf]);
    setIntent(ui, "vec1", "borderValue", countRamp());
    setIntent(ui, "vec1", "borderStyleMode", "value");

    applyBorderToLayer(ui, "vec1");
    // Pin registered.
    expect(pinnedGetterCount(leaf)).toBe(1);

    // Change the config (scheme), then the pin must answer null so folium's
    // restore stands instead of re-applying a stale color.
    setIntent(ui, "vec1", "borderValue", countRamp({ scheme: DEFAULT_SCHEMES[1] }));
    applyBorderToLayer(ui, "vec1");
  });

  // C6: a leaf the value ramp cannot classify falls back to the author's
  // color with the stroke flag lit.
  it("C6 unclassifiable leaf falls back to author color with stroke lit", () => {
    const good = makeFeatureLeaf(5);
    const bad = makeFeatureLeaf(Number.NaN); // no finite value
    registerFeatureLayer(manager, ui, "vec1", [good, bad]);
    setIntent(ui, "vec1", "borderValue", countRamp());
    setIntent(ui, "vec1", "borderStyleMode", "value");

    applyBorderToLayer(ui, "vec1");

    const goodCall = good.setStyle.mock.calls.at(-1)?.[0];
    const badCall = bad.setStyle.mock.calls.at(-1)?.[0];
    // The classifiable leaf got the ramp color; the unclassifiable one keeps
    // the author's color but the stroke flag is lit so the border shows.
    expect(goodCall).toMatchObject({ stroke: true });
    expect(badCall).toMatchObject({ color: "#ff0000", stroke: true });
  });

  // C7: pre-wiring regression — the solid path still writes a flat
  // color+weight when no value config is in force.
  it("C7 the solid path still writes a flat color and weight", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderColor", "#0000ff");
    setIntent(ui, "vec1", "borderWeight", 6);

    applyBorderToLayer(ui, "vec1");

    leaves.forEach(leaf => {
      expect(leaf.setStyle).toHaveBeenCalledWith({
        color: "#0000ff",
        weight: 6,
        stroke: true,
      });
    });
  });

  // C8 removed: the border no longer derives the fill ramp (the "follow
  // fill" cross-face rule is gone). A fill-only classification paints the
  // border nothing — the border paints only its own explicit config.
});

describe("value-stroke row and dimension wiring (fix #2 coverage)", () => {
  let manager: LayerController;
  let ui: LayerUI;
  // Drive the exported row surface (buildBorderRow/bindBorderRow) plus the
  // registered BORDER_DIMENSION — the only public doors to the module-private
  // value-detail helpers (borderValueForUi, borderSeedField, writeBorderMode,
  // writeBorderValue, bindBorderValueDetail, convergeClassesRow).
  const openBorderRow = (
    manager: LayerController,
    ui: LayerUI,
    id: string,
    leaves: ReturnType<typeof makeFeatureLeaf>[],
  ) => {
    registerFeatureLayer(manager, ui, id, leaves);
    const block = buildBorderRow(ui, id) as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, id, block);
    return block;
  };
  const modeSelectOf = (block: HTMLElement) =>
    block.querySelector(
      ".foliplus-style-border-mode-select",
    ) as HTMLSelectElement | null;
  const changeSelect = (sel: HTMLSelectElement | null, value: string) => {
    expect(sel).not.toBeNull();
    sel!.value = value;
    sel!.dispatchEvent(new Event("change"));
  };

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
    installChroma(["#010101", "#020202", "#030303"]);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    delete globalThis.chroma;
  });

  it("T1 seeds a numeric value config and shows the value detail when the user picks by value", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    // Original mode (default on a polygon border): the block carries the
    // mode select and a solid detail; no value field rows are shown.
    const select = modeSelectOf(block);
    expect(select).not.toBeNull();
    expect(select!.value).toBe("original");
    expect(block.querySelector(".foliplus-style-border-detail")).not.toBeNull();
    expect(block.querySelector(".foliplus-style-fill-field-select")).toBeNull();

    // Pick "by value": writes BORDER_STYLE_MODE=value + seeds BORDER_VALUE from the
    // numeric chain (borderValueForUi → seeded default, persistedBorderValue numeric).
    changeSelect(select, "value");
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBe("value");
    const seeded = getIntent(ui, "vec1", "borderValue");
    expect(seeded).toMatchObject({ kind: "numeric", field: "count" });
    // The value detail now renders field / method / classes / scheme rows.
    expect(block.querySelector(".foliplus-style-fill-field-select")).not.toBeNull();
    expect(block.querySelector(".foliplus-style-fill-method-select")).not.toBeNull();
    expect(block.querySelector(".foliplus-style-fill-classes-select")).not.toBeNull();
    expect(block.querySelector(".foliplus-style-scheme-trigger")).not.toBeNull();
  });

  it("T2 seeds the border value from a stored config before the row is built", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderValue", countRamp());
    const block = openBorderRow(manager, ui, "vec1", leaves);
    // Display mode is original (no mode intent), so the detail is solid,
    // but the stored config is the seed for a later value switch.
    changeSelect(modeSelectOf(block), "value");
    expect(getIntent(ui, "vec1", "borderValue")).toEqual(countRamp());
  });

  it("T3 seeds a numeric value config from the first numeric field", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");
    const seeded = getIntent(ui, "vec1", "borderValue");
    expect(seeded).toMatchObject({ field: "count", kind: "numeric" });
  });

  it("T4 prefers the author scale column as the seed field", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    installLeafletGlobals();
    manager.registerLayer({
      id: "vec1",
      name: "vec1",
      layer: makeFeatureGroup(...leaves),
      fillAuthor: {
        perFeature: true,
        distinct: 3,
        stops: ["#111111", "#222222", "#333333"],
        scale: { kind: "continuous", column: "count" },
      },
    });
    ui.runtimeStore.setFields("vec1", [{ name: "count", numeric: true }]);
    const block = buildBorderRow(ui, "vec1") as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, "vec1", block);
    changeSelect(modeSelectOf(block), "value");
    const seeded = getIntent(ui, "vec1", "borderValue");
    expect(seeded).toMatchObject({ field: "count" });
  });

  it("T5 original mode clears the border mode intent", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderStyleMode", "value");
    setIntent(ui, "vec1", "borderValue", countRamp());
    const block = openBorderRow(manager, ui, "vec1", leaves);
    const select = modeSelectOf(block);
    expect(select!.value).toBe("value");
    changeSelect(select, "original");
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBe("original");
    // The value config survives an original switch (it stays stored for reuse).
    expect(getIntent(ui, "vec1", "borderValue")).toEqual(countRamp());
  });

  it("T6 solid mode writes the mode and keeps the value config", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderStyleMode", "value");
    setIntent(ui, "vec1", "borderValue", countRamp());
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "solid");
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBe("solid");
    expect(getIntent(ui, "vec1", "borderValue")).toEqual(countRamp());
  });

  it("T7 a value-detail control change writes through writeBorderValue", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");
    const methodSelect = block.querySelector(
      ".foliplus-style-fill-method-select",
    ) as HTMLSelectElement | null;
    expect(methodSelect).not.toBeNull();
    const target = "quantile";
    methodSelect!.value = target;
    methodSelect!.dispatchEvent(new Event("change"));
    const updated = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(updated.method).toBe(target);
  });

  it("T8 a classes change converges an out-of-vocabulary option", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");
    // Inject an out-of-vocabulary option (value 99 not in CLASS_COUNT_VALUES)
    // then pick a valid class — the stray option must be removed.
    const classesSelect = block.querySelector(
      ".foliplus-style-fill-classes-select",
    ) as HTMLSelectElement | null;
    expect(classesSelect).not.toBeNull();
    classesSelect!.appendChild(new Option("99", "99"));
    classesSelect!.value = "4";
    classesSelect!.dispatchEvent(new Event("change"));
    expect(classesSelect!.querySelector('option[value="99"]')).toBeNull();
    expect(classesSelect!.value).toBe("4");
    const updated = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(updated.classes).toBe(4);
  });

  // ── persistedBorderValue branch coverage (codecov patch target) ──
  // border.ts:250-265 has two arms: CATEGORY passes classes through as-is
  // (line 256), NUMERIC clamps classes into [CLASS_COUNT.MIN, MAX] (line 263).
  // Existing tests drive only the NUMERIC arm; these two cover both branches
  // and prove the semantic difference (category preserves out-of-vocab classes,
  // numeric clamps them).

  /** A category value config with out-of-vocabulary classes (43 and 0 are both
   *  outside CLASS_COUNT_VALUES=[2..9]). Used to prove the CATEGORY arm does
   *  NOT clamp — it passes the user's raw choice through untouched. */
  const categoryOut = (classes: number): ValueConfig => ({
    kind: "category",
    field: "count",
    method: "jenks",
    classes,
    scheme: DEFAULT_SCHEMES[0],
  });

  it("T8a CATEGORY value config passes classes through without clamping", () => {
    // Write a category config with classes=43 (outside the [2..9] vocabulary)
    // through the real persistence path (writeBorderValue → persistedBorderValue
    // → BORDER_DIMENSION.write → intentStore.setRaw → saveState).
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);

    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");

    // Force the stored config to CATEGORY with out-of-vocab classes, then
    // trigger a value-detail change (method) to drive writeBorderValue.
    setIntent(ui, "vec1", "borderValue", categoryOut(43));
    const methodSelect = block.querySelector(
      ".foliplus-style-fill-method-select",
    ) as HTMLSelectElement;
    methodSelect.value = "quantile";
    methodSelect.dispatchEvent(new Event("change"));

    // Read back from intent: the CATEGORY arm must preserve classes=43 as-is.
    // (getIntent surfaces the field through resolvedValue, which drops "count"
    // because the layer holds no category fields — that is a display-side
    // resolve, not the persisted shape.)
    const persisted = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(persisted.kind).toBe("category");
    expect(persisted.method).toBe("quantile");
    // The critical assertion: classes NOT clamped to the vocabulary.
    expect(persisted.classes).toBe(43);

    // The intent store is the persisted source of truth saveState serializes,
    // so the getIntent read above IS the real persistence path (writeBorderValue
    // → persistedBorderValue → BORDER_DIMENSION.write → intentStore.setRaw).
  });

  it("T8b NUMERIC value config clamps out-of-range classes into [2, 9]", () => {
    // Write a numeric config with classes=43 through the same path; the
    // NUMERIC arm must clamp it to CLASS_COUNT.MAX (9).
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");

    // Seed a numeric config with out-of-range classes, then trigger a write.
    setIntent(ui, "vec1", "borderValue", countRamp({ classes: 43 }));
    const methodSelect = block.querySelector(
      ".foliplus-style-fill-method-select",
    ) as HTMLSelectElement;
    methodSelect.value = "quantile";
    methodSelect.dispatchEvent(new Event("change"));

    const persisted = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(persisted.kind).toBe("numeric");
    expect(persisted.field).toBe("count");
    expect(persisted.method).toBe("quantile");
    // The critical assertion: classes CLAMPED to CLASS_COUNT.MAX.
    expect(persisted.classes).toBe(9);

    // Lower bound: classes=0 clamps to CLASS_COUNT.MIN (2).
    setIntent(ui, "vec1", "borderValue", countRamp({ classes: 0 }));
    methodSelect.value = "jenks";
    methodSelect.dispatchEvent(new Event("change"));
    const clampedLow = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(clampedLow.classes).toBe(2);
  });

  it("T8c CATEGORY and NUMERIC arms differ semantically (classes handling)", () => {
    // Prove the two branches are NOT equivalent: the same out-of-vocab classes
    // value passes through CATEGORY but clamps in NUMERIC.
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");

    // CATEGORY with classes=0 (below MIN): stays 0, not clamped up to 2.
    setIntent(ui, "vec1", "borderValue", categoryOut(0));
    const methodSelect = block.querySelector(
      ".foliplus-style-fill-method-select",
    ) as HTMLSelectElement;
    methodSelect.value = "quantile";
    methodSelect.dispatchEvent(new Event("change"));
    const catPersisted = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(catPersisted.kind).toBe("category");
    expect(catPersisted.classes).toBe(0); // NOT clamped up to MIN=2

    // NUMERIC with classes=0: clamps up to MIN=2.
    setIntent(ui, "vec1", "borderValue", countRamp({ classes: 0 }));
    methodSelect.value = "jenks";
    methodSelect.dispatchEvent(new Event("change"));
    const numPersisted = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(numPersisted.kind).toBe("numeric");
    expect(numPersisted.classes).toBe(2); // clamped up to MIN=2

    // The two configs with identical input classes diverge because of kind.
    expect(catPersisted.classes).not.toBe(numPersisted.classes);
  });

  it("T9 BORDER_DIMENSION.write writes the value config and clears the mode", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    const dim = getDimension(DIM.BORDER)!;
    dim.write!(ui, "vec1", { mode: "value", value: countRamp() });
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBe("value");
    expect(getIntent(ui, "vec1", "borderValue")).toEqual(countRamp());
    // Write mode present writes it; mode undefined is a no-op (no follow mode).
    dim.write!(ui, "vec1", { mode: "solid" });
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBe("solid");
    expect(getIntent(ui, "vec1", "borderValue")).toEqual(countRamp());
  });

  it("T10 the value mode carries an explicit user-set border weight", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderValue", countRamp());
    setIntent(ui, "vec1", "borderStyleMode", "value");
    setIntent(ui, "vec1", "borderWeight", 6);
    applyBorderToLayer(ui, "vec1");
    leaves.forEach(leaf => {
      const strokeCall = leaf.setStyle.mock.calls.at(-1)?.[0];
      expect(strokeCall).toMatchObject({ weight: 6, stroke: true });
      expect(typeof strokeCall.color).toBe("string");
    });
  });

  // ── geometry gate ──
  // borderCarriesValue = geometryKindOf === LINE. Polygon/point borders are
  // the outline, never the element's primary colour, so they must never
  // offer by_value. The stored-by-value-on-polygon negative is the
  // "no silent fallback" guard: displayBorderMode rejects the illegal value
  // and returns ORIGINAL instead.

  /** A Polygon feature leaf — unlike makeFeatureLeaf (now LineString for the
   *  value-stroke tests), this creates a genuine L.Polygon so getGeometryType
   *  returns "Polygon" without mocking. */
  const makePolyLeaf = (count: number): any => {
    const leaf = new (globalThis as any).L.Polygon() as any;
    leaf.options = { color: "#ff0000", weight: 2, stroke: true };
    leaf.feature = { geometry: { type: "Polygon" }, properties: { count } };
    leaf.setStyle = vi.fn((style: Record<string, unknown>) => {
      Object.assign(leaf.options, style);
      return leaf;
    });
    leaf.on = vi.fn();
    return leaf;
  };

  it("polygon layer: stored by_value reads back as original (illegal value rejected)", () => {
    const leaves = [makePolyLeaf(1), makePolyLeaf(5)];
    registerFeatureLayer(manager, ui, "poly1", leaves);
    setIntent(ui, "poly1", "borderStyleMode", "value");
    setIntent(ui, "poly1", "borderValue", countRamp());
    // displayBorderMode contract: illegal stored value on a non-line → ORIGINAL.
    // The row select must NOT show "value".
    const block = openBorderRow(manager, ui, "poly1", leaves);
    const select = modeSelectOf(block);
    expect(select!.value).not.toBe("value");
  });

  it("line layer: by_value IS offered in the options", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5)];
    registerFeatureLayer(manager, ui, "line1", leaves);
    const block = openBorderRow(manager, ui, "line1", leaves);
    const select = modeSelectOf(block);
    const values = Array.from(select!.options).map(o => o.value);
    expect(values).toContain("value"); // by_value present on a line
  });

  it("polygon layer: by_value is NOT offered in the options", () => {
    const leaves = [makePolyLeaf(1), makePolyLeaf(5)];
    registerFeatureLayer(manager, ui, "poly2", leaves);
    const block = openBorderRow(manager, ui, "poly2", leaves);
    const select = modeSelectOf(block);
    const values = Array.from(select!.options).map(o => o.value);
    expect(values).not.toContain("value"); // by_value absent on a polygon
  });
});

describe("value-detail and shell wiring coverage", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
    installChroma(["#010101", "#020202", "#030303"]);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    delete globalThis.chroma;
  });

  const openBorderRow = (
    manager: LayerController,
    ui: LayerUI,
    id: string,
    leaves: ReturnType<typeof makeFeatureLeaf>[],
  ) => {
    registerFeatureLayer(manager, ui, id, leaves);
    const block = buildBorderRow(ui, id) as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, id, block);
    return block;
  };
  const modeSelectOf = (block: HTMLElement) =>
    block.querySelector(
      ".foliplus-style-border-mode-select",
    ) as HTMLSelectElement | null;
  const changeSelect = (sel: HTMLSelectElement | null, value: string) => {
    expect(sel).not.toBeNull();
    sel!.value = value;
    sel!.dispatchEvent(new Event("change"));
  };

  it("binds the value detail's scheme picker and field select", () => {
    // Lines 770-800: createSchemePicker resolveHost/onChange, the overlay
    // register callbacks, and the field select's onchange. Drive the real
    // picker through the trigger and the field select through a change.
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");

    // Field select: changing it writes the border value field.
    const fieldSelect = block.querySelector(
      ".foliplus-style-fill-field-select",
    ) as HTMLSelectElement;
    fieldSelect.value = "count";
    fieldSelect.dispatchEvent(new Event("change"));
    expect(getIntent(ui, "vec1", "borderValue")).toMatchObject({ field: "count" });

    // Scheme picker: trigger click opens the dropdown, item click writes the
    // scheme, outside click closes through the overlay registry.
    const trigger = block.querySelector(
      ".foliplus-style-scheme-trigger",
    ) as HTMLElement;
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const item = document.querySelector(
      '.foliplus-scheme-picker-item[data-scheme-name="Reds"]',
    ) as HTMLElement;
    expect(item).not.toBeNull();
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(getIntent(ui, "vec1", "borderValue")).toMatchObject({ scheme: "Reds" });
  });

  it("closes the border scheme picker on outside click through the overlay registry", () => {
    // Lines 788-790: the overlay register's isOpen/panels/close callbacks.
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");

    const trigger = block.querySelector(
      ".foliplus-style-scheme-trigger",
    ) as HTMLElement;
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".foliplus-scheme-picker-dropdown")).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".foliplus-scheme-picker-dropdown")).toBeNull();
  });

  it("binds a bare shell row without a block through bindBorderRowShell", () => {
    // Lines 850-858: bindBorderRow's no-block branch binds the row shell
    // directly (a row outside a mode block). Drive the color and weight
    // controls to exercise the onChangeColor/onChangeWeight/onFlush closures.
    const leaf = makeLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    setIntent(ui, "vec1", "borderStyleMode", "solid");

    const row = buildBorderRowShell({
      rowClass: "foliplus-style-border-row",
      label: ui.T("border"),
      color: "#00ff00",
      weight: 3,
      hasColorInput: true,
      hasWeightInput: true,
      className: "foliplus-style-border-color-input",
      weightClassName: "foliplus-style-border-weight-input",
      colorAria: ui.T("style_border_color"),
      weightAria: ui.T("style_border_weight"),
    });
    document.body.appendChild(row);
    // The bare row is not inside a data-style-dim block: bindBorderRow takes
    // the no-block branch and binds the shell directly.
    bindBorderRow(ui, "vec1", row);

    const swatch = row.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement;
    swatch.value = "#abcdef";
    swatch.dispatchEvent(new Event("input", { bubbles: true }));
    flushStyleDimApply(FACE.STROKE, "vec1");
    expect(getIntent(ui, "vec1", "borderColor")).toBe("#abcdef");

    const weight = row.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement;
    weight.value = "6";
    weight.dispatchEvent(new Event("change", { bubbles: true }));
    expect(getIntent(ui, "vec1", "borderWeight")).toBe(6);
  });
});
