// test/js/control/LayerControl/ui/style/border.partial — partial-coverage invariants, per-geometry options and derivations.
import { initFixture, installLeafletGlobals } from "../fixture.js";
import {
  commitBorderNow,
  countRamp,
  installChroma,
  makeFeatureGroup,
  makeFeatureLeaf,
  makeHighlightLeaf,
  makeLayerForGeometry,
  registerFeatureLayer,
} from "./border.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIM, GEOM_TYPE, STYLE_MODE, type ValueConfig } from "#core/layer/index.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  getIntent,
  seedIntentMap,
  setIntent,
} from "#control/LayerControl/ui/intent.js";
import {
  BORDER_DIMENSION,
  applyBorderToLayer,
  bindBorderRow,
  borderValueForUi,
  buildBorderRow,
  commitBorderWeight,
  writeBorderValue,
} from "#control/LayerControl/ui/style/border.js";
import {
  FACE,
  flushStyleDimApply,
  hasStyleDimApply,
} from "#control/LayerControl/ui/style/styleBag.js";

describe("border partial-coverage invariants (partial-coverage)", () => {
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

  it("L252 keeps a stored category border value through a mode write", () => {
    // persistedBorderValue's category arm: a stored category record must not
    // be coerced to a numeric ramp when the user re-picks by value. The
    // border row owns its config independently, so a category record from a
    // persisted state survives a mode write unchanged.
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderValue", {
      kind: "category",
      field: "count",
      method: "equal",
      classes: 3,
      scheme: "Blues",
    });
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");
    const stored = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(stored.kind).toBe("category");
    expect(stored.scheme).toBe("Blues");
  });

  it("L273 refuses a value switch when the layer no longer offers numeric fields", () => {
    // writeBorderMode's empty-fields guard: the value mode needs a numeric
    // field to classify by. When the field cache empties between build and
    // change (data replaced), the switch must be refused — no mode write, no
    // seeded config, no partial UI state.
    // The leaves carry only a string property, so once the seeded numeric
    // cache is emptied the fallback leaf walk finds no numeric field either.
    const strLeaf = (_label: string): any => {
      const leaf = new L.Polyline() as any;
      leaf.options = { color: "#ff0000", weight: 2, stroke: true };
      leaf.feature = {
        geometry: { type: "Polygon" },
        // No value field at all — neither numeric nor categorical: a layer
        // with any field (a number column or a discrete string column)
        // legitimately offers the value mode, so the refusal case is exactly
        // an empty feature bag.
        properties: {},
      };
      const setStyle = vi.fn((style: Record<string, unknown>) => {
        Object.assign(leaf.options, style);
        return leaf;
      });
      leaf.setStyle = setStyle;
      leaf.on = vi.fn();
      return leaf;
    };
    const leaves = [strLeaf("a"), strLeaf("b"), strLeaf("c")];
    installLeafletGlobals();
    manager.registerLayer({
      id: "vec1",
      name: "vec1",
      layer: makeFeatureGroup(...leaves),
    });
    // Seed a numeric field cache so the row builds a mode select.
    ui.runtimeStore.setFields("vec1", [{ name: "count", numeric: true }]);
    const block = buildBorderRow(ui, "vec1") as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, "vec1", block);
    // Empty the cache: numericFields falls through to the leaf walk, which
    // finds no numeric property, so the value switch must be refused.
    ui.runtimeStore.setFields("vec1", []);
    changeSelect(modeSelectOf(block), "value");
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBeUndefined();
    expect(getIntent(ui, "vec1", "borderValue")).toBeUndefined();
  });

  it("L379 the ORIGINAL-mode pin returns null so folium's restore stands", () => {
    // pinStyleOnHighlight's ORIGINAL guard: once the mode reads as original,
    // the pin getter returns null — there is no user face to replay, so
    // folium's mouseout restore is the final paint and the author's stroke
    // stays.
    const leaf = makeHighlightLeaf("#00ff00", 3);
    manager.registerLayer({ id: "vec1", name: "V", layer: leaf });
    commitBorderNow(ui, "vec1", "color", "#abcdef"); // solid, pins
    setIntent(ui, "vec1", "borderStyleMode", "original");
    applyBorderToLayer(ui, "vec1"); // re-pin with the ORIGINAL getter
    leaf.setStyle.mockClear();
    leaf.fireMouseout();
    // folium's own handler restored the authored stroke; the pin getter
    // returned null, so no second write with the user's color.
    expect(leaf.setStyle).toHaveBeenCalledTimes(1);
    expect(leaf.setStyle).toHaveBeenCalledWith(leaf.authored);
    expect(leaf.options.color).toBe("#00ff00");
  });

  it("L663 a border row for a torn-down layer degrades to the two-state vocabulary", () => {
    // geometryKindOf's !layerInfo guard: a row built for a layer the registry
    // no longer knows (unregistered between data and panel build) must not
    // offer by_value — the null geometry reads as "not a line", so the
    // border degrades to original + single.
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves); // sets fields cache
    manager.unregisterLayer("vec1"); // registry entry gone
    // unload-label's invalidateFieldCache cleared the seeded cache; re-seed it so
    // buildBorderRow reaches geometryKindOf with fields present but no registry row.
    ui.runtimeStore.setFields("vec1", [{ name: "count", numeric: true }]);
    const block = buildBorderRow(ui, "vec1") as HTMLElement;
    const select = modeSelectOf(block);
    const values = select ? Array.from(select.options).map(o => o.value) : [];
    expect(values).not.toContain("value");
  });

  it("L746 a classes change with no out-of-vocabulary option converges cleanly", () => {
    // convergeClassesRow's no-extra guard (shared with fill): when the classes row only
    // carries in-vocabulary options (the normal 2..9 build), a change must
    // not throw and must keep the picked value.
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    changeSelect(modeSelectOf(block), "value");
    const classesSelect = block.querySelector(
      ".foliplus-style-fill-classes-select",
    ) as HTMLSelectElement | null;
    expect(classesSelect).not.toBeNull();
    classesSelect!.value = "5";
    classesSelect!.dispatchEvent(new Event("change"));
    const updated = getIntent(ui, "vec1", "borderValue") as ValueConfig;
    expect(updated.classes).toBe(5);
  });

  it("L877 a select change to the same mode is a no-op", () => {
    // bindBorderRow's same-mode guard: re-selecting the mode the select
    // already shows must not re-write the mode (a polygon whose stored value
    // reads back as original must not re-write "original").
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    const block = openBorderRow(manager, ui, "vec1", leaves);
    const select = modeSelectOf(block);
    expect(select!.value).toBe("original"); // default display mode
    changeSelect(select, "original"); // same value
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBeUndefined();
  });

  it("L880/L885 a select change with no detail slot skips the detail bind", () => {
    // bindBorderRow's detail-null guards: a block that carries a mode select
    // but no detail element (a manually assembled row) must not crash on the
    // change — the detail branch is skipped when there is nothing to render.
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    const block = document.createElement("div");
    block.className = "foliplus-style-border-block";
    block.setAttribute("data-style-dim", "border");
    const select = document.createElement("select");
    select.className = "foliplus-style-border-mode-select";
    select.appendChild(new Option("original", "original"));
    select.appendChild(new Option("solid", "solid"));
    select.appendChild(new Option("value", "value"));
    block.appendChild(select);
    document.body.appendChild(block);
    bindBorderRow(ui, "vec1", block);
    changeSelect(select, "solid");
    expect(getIntent(ui, "vec1", "borderStyleMode")).toBe("solid");
  });

  it("L913 BORDER_DIMENSION.value resolves a stored border value", () => {
    // value's resolvedValue arm: when a border value is stored, the dimension
    // value resolves the config's field against the layer's current numeric
    // fields (not left as the raw stored record).
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5), makeFeatureLeaf(9)];
    registerFeatureLayer(manager, ui, "vec1", leaves);
    setIntent(ui, "vec1", "borderValue", countRamp());
    const v = BORDER_DIMENSION.value(ui, "vec1") as {
      value?: ValueConfig;
    };
    expect(v.value).toEqual(countRamp());
  });
});

describe("border options per geometry", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  const expectGeometryType = (id: string, kind: "line" | "polygon" | "point"): void => {
    const info = ui.c.layerRegistry.get(id);
    expect(info).toBeTruthy();
    const kindOf = ui.c.surfaceFor(info!).geometryType();
    expect(kindOf).toBe(
      kind === "line"
        ? GEOM_TYPE.LINE
        : kind === "polygon"
          ? GEOM_TYPE.POLYGON
          : GEOM_TYPE.POINT,
    );
  };

  const openBorderRow = (id: string): HTMLElement => {
    const block = buildBorderRow(ui, id) as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, id, block);
    return block;
  };

  const modeSelectOf = (block: HTMLElement): HTMLSelectElement | null =>
    block.querySelector(
      ".foliplus-style-border-mode-select",
    ) as HTMLSelectElement | null;

  const modeValues = (block: HTMLElement): string[] => {
    const select = modeSelectOf(block);
    return select ? Array.from(select.options).map(option => option.value) : [];
  };

  const registerGeometryLayer = (
    id: string,
    kind: "line" | "polygon" | "point",
  ): void => {
    registerFeatureLayer(manager, ui, id, [makeLayerForGeometry(kind)]);
  };

  const valueRamp = (): ValueConfig => countRamp();

  it("line: { original, single, value }", () => {
    registerGeometryLayer("g_line", "line");
    expectGeometryType("g_line", "line");
    expect(modeValues(openBorderRow("g_line"))).toEqual([
      STYLE_MODE.ORIGINAL,
      STYLE_MODE.SOLID,
      STYLE_MODE.VALUE,
    ]);
  });

  // Polygon only: a border that outlines a filled face offers follow-fill and
  // never by-value (the fill behind it classifies; the outline does not).
  it("polygon: { original, single, follow-fill } — never by-value", () => {
    registerGeometryLayer("g_polygon", "polygon");
    expectGeometryType("g_polygon", "polygon");
    expect(modeValues(openBorderRow("g_polygon"))).toEqual([
      STYLE_MODE.ORIGINAL,
      STYLE_MODE.SOLID,
      STYLE_MODE.FOLLOW_FILL,
    ]);
  });
  // Point carries value like a line: a CircleMarker's stroke is the marker's
  // own outline and classifies per marker, so by-value IS offered (the
  // reported colormap-border case).
  it("point: { original, single, value } — a marker stroke classifies", () => {
    registerGeometryLayer("g_point", "point");
    expectGeometryType("g_point", "point");
    expect(modeValues(openBorderRow("g_point"))).toEqual([
      STYLE_MODE.ORIGINAL,
      STYLE_MODE.SOLID,
      STYLE_MODE.VALUE,
    ]);
  });
  it("the column is the DIM single source (border)", () => {
    expect(DIM.BORDER).toBe("border");
    registerGeometryLayer("g_dim", "line");
    const block = openBorderRow("g_dim");
    expect(block.getAttribute("data-style-dim")).toBe(DIM.BORDER);
  });

  it("stored by-value on a non-line reads back as original (display fallback)", () => {
    registerGeometryLayer("g_poly_fb", "polygon");
    setIntent(ui, "g_poly_fb", "borderStyleMode", STYLE_MODE.VALUE);
    setIntent(ui, "g_poly_fb", "borderValue", valueRamp());
    const select = modeSelectOf(openBorderRow("g_poly_fb"));
    expect(select).not.toBeNull();
    // The illegal stored value must never surface as a selected "value".
    expect(select!.value).toBe(STYLE_MODE.ORIGINAL);
  });

  it("stored by-value on a line stays value (guard against always-original fallback)", () => {
    registerGeometryLayer("g_line_fb", "line");
    setIntent(ui, "g_line_fb", "borderStyleMode", STYLE_MODE.VALUE);
    setIntent(ui, "g_line_fb", "borderValue", valueRamp());
    const select = modeSelectOf(openBorderRow("g_line_fb"));
    expect(select).not.toBeNull();
    expect(select!.value).toBe(STYLE_MODE.VALUE);
  });

  it("guard 1: the option set is asserted exactly, so an extra illegal option fails", () => {
    // The product's set for a polygon is [original, solid, followFill]. A
    // hypothetical regression that adds by-value there would make modeValues
    // return [original, solid, followFill, value] — which toEqual rejects. The
    // assertion here is the same equality the matrix tests use; it documents
    // that containment would NOT catch the extra.
    registerGeometryLayer("g_guard1", "polygon");
    const actual = modeValues(openBorderRow("g_guard1"));
    const contract = [STYLE_MODE.ORIGINAL, STYLE_MODE.SOLID, STYLE_MODE.FOLLOW_FILL];
    expect(actual).toEqual(contract);
    // The negative property: adding the illegal option to the contract must NOT
    // equal the actual set — this is what makes the matrix red on an extra.
    const illegal = [...contract, STYLE_MODE.VALUE];
    expect(actual).not.toEqual(illegal);
  });

  it("guard 2: the line by-value read-back pins the fallback to geometry, not original", () => {
    // If displayBorderMode were changed to always return original, the
    // line-with-stored-value test above would fail. This test restates that
    // dependency as a direct invariant so the guard has its own name.
    registerGeometryLayer("g_guard2", "line");
    setIntent(ui, "g_guard2", "borderStyleMode", STYLE_MODE.VALUE);
    setIntent(ui, "g_guard2", "borderValue", valueRamp());
    const select = modeSelectOf(openBorderRow("g_guard2"));
    expect(select).not.toBeNull();
    expect(select!.value).not.toBe(STYLE_MODE.ORIGINAL);
  });
  it("guard 3: every mode option value is a vocab literal, never a locale key", () => {
    // The P1 regression: a generator-level name collision made the mode select
    // value the locale-key string "style_mode_original" instead of the vocab
    // literal "original". Every option value must be a vocab literal (in the
    // STYLE_MODE value set) and must never carry the "style_mode_" prefix.
    const vocabValues = new Set<string>(Object.values(STYLE_MODE));
    for (const kind of ["line", "polygon", "point"] as const) {
      const id = `g_guard3_${kind}`;
      registerGeometryLayer(id, kind);
      const values = modeValues(openBorderRow(id));
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(vocabValues.has(value)).toBe(true);
        expect(value).not.toMatch(/^style_mode_/);
      }
    }
  });

  it("value mode width input commits the stroke weight through the shared shell", () => {
    registerGeometryLayer("g_vwc", "line");
    setIntent(ui, "g_vwc", "borderStyleMode", STYLE_MODE.VALUE);
    setIntent(ui, "g_vwc", "borderValue", valueRamp());
    const detail = openBorderRow("g_vwc");
    const weight = detail.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement;
    expect(weight).not.toBeNull();
    weight.value = "8";
    weight.dispatchEvent(new Event("change", { bubbles: true }));
    applyBorderToLayer(ui, "g_vwc");
    expect(getIntent(ui, "g_vwc", "borderWeight")).toBe(8);
  });

  it("by-value border mode keeps the width input editable (every mode owns the weight)", () => {
    registerGeometryLayer("g_vw", "line");
    const detail = openBorderRow("g_vw");
    setIntent(ui, "g_vw", "borderStyleMode", STYLE_MODE.VALUE);
    const mode = modeValues(openBorderRow("g_vw"));
    expect(mode).toContain(STYLE_MODE.VALUE);
    const weight = detail.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement;
    expect(weight).not.toBeNull();
    expect(weight.disabled).toBe(false);
    // The fixture author stroke weight (makeLayerForGeometry) — the width
    // field reads the author's weight when no user weight is stored.
    expect(Number(weight.value)).toBe(2);
  });

  it("by-value border mode width input sits in the right column (size-row)", () => {
    registerGeometryLayer("g_vw2", "line");
    setIntent(ui, "g_vw2", "borderStyleMode", STYLE_MODE.VALUE);
    const detail = openBorderRow("g_vw2");
    // The width input's own row is the size-row (right-aligned column). The
    // fill value detail also right-aligns its opacity row (the shared
    // STYLE_SIZE_ROW hook) now, so scope the assertion to the weight input's
    // row rather than the first size-row in the detail.
    const weight = detail.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement;
    expect(weight).not.toBeNull();
    expect(weight.closest(".foliplus-style-size-row")).not.toBeNull();
  });

  it("per-feature original border mode also keeps the width input", () => {
    registerGeometryLayer("g_porig", "polygon");
    setIntent(ui, "g_porig", "borderStyleMode", STYLE_MODE.ORIGINAL);
    const detail = openBorderRow("g_porig");
    const weight = detail.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement;
    expect(weight).not.toBeNull();
    expect(weight.disabled).toBe(false);
  });
});

describe("border solid derivation invariants", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
    installChroma(["#111111", "#222222"]);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    delete globalThis.chroma;
  });

  /** A per-feature border layer: each leaf carries its OWN author stroke, so
   *  the style bag holds one colour per leaf (the explore output shape the
   *  user reported). The border is the element's own stroke here (line leaf),
   *  so value mode is offered. */
  const makePerFeatureLeaf = (color: string, count: number): any => {
    installLeafletGlobals();
    const leaf = new (globalThis as any).L.Polyline() as any;
    leaf.options = { color, weight: 2, stroke: true };
    leaf.feature = {
      geometry: { type: "LineString" },
      properties: { count, __folium_color: color },
    };
    leaf.setStyle = vi.fn((style: Record<string, unknown>) => {
      Object.assign(leaf.options, style);
      return leaf;
    });
    leaf.on = vi.fn();
    return leaf;
  };

  const registerPerFeatureBorderLayer = (id: string, leaves: any[]): void => {
    installLeafletGlobals();
    manager.registerLayer({
      id,
      name: id,
      layer: makeFeatureGroup(...leaves),
      fillAuthor: {
        perFeature: true,
        distinct: leaves.length,
        stops: leaves.map((l: any) => l.options.color),
      },
    });
    ui.runtimeStore.setFields(id, [{ name: "count", numeric: true }]);
  };

  const strokes = (leaves: any[]): unknown[] =>
    leaves.map((l: any) => (l.setStyle.mock.calls.at(-1)?.[0] as any)?.color);

  it("value -> solid flattens a per-feature border to one colour", () => {
    const leaves = [makePerFeatureLeaf("#0d0887", 1), makePerFeatureLeaf("#f0f921", 9)];
    registerPerFeatureBorderLayer("vec1", leaves);
    // The layer is a line (border carries value). Paint it by value first.
    setIntent(ui, "vec1", "borderStyleMode", "value");
    setIntent(ui, "vec1", "borderValue", countRamp());
    applyBorderToLayer(ui, "vec1");
    flushStyleDimApply(FACE.STROKE, "vec1");
    // The value mode classified the leaves: more than one colour is live.
    expect(new Set(strokes(leaves)).size).toBeGreaterThan(1);

    setIntent(ui, "vec1", "borderStyleMode", "solid");
    applyBorderToLayer(ui, "vec1");
    flushStyleDimApply(FACE.STROKE, "vec1");
    // SOLID owns exactly one colour: the authored base (first leaf's stroke
    // bag), NOT the per-leaf author colours the bug restored.
    const painted = strokes(leaves);
    expect(new Set(painted).size).toBe(1);
    expect(painted[0]).toBe("#0d0887");
  });

  it("original -> solid flattens a per-feature border to one colour (regression)", () => {
    const leaves = [makePerFeatureLeaf("#0d0887", 1), makePerFeatureLeaf("#f0f921", 9)];
    registerPerFeatureBorderLayer("vec1", leaves);
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    applyBorderToLayer(ui, "vec1");
    flushStyleDimApply(FACE.STROKE, "vec1");
    const painted = strokes(leaves);
    expect(new Set(painted).size).toBe(1);
    expect(painted[0]).toBe("#0d0887");
  });

  it("solid -> original restores the per-feature multi-colour stroke", () => {
    const leaves = [makePerFeatureLeaf("#0d0887", 1), makePerFeatureLeaf("#f0f921", 9)];
    registerPerFeatureBorderLayer("vec1", leaves);
    setIntent(ui, "vec1", "borderStyleMode", "solid");
    applyBorderToLayer(ui, "vec1");
    flushStyleDimApply(FACE.STROKE, "vec1");
    setIntent(ui, "vec1", "borderStyleMode", "original");
    applyBorderToLayer(ui, "vec1");
    flushStyleDimApply(FACE.STROKE, "vec1");
    // Original mode must keep its per-leaf author colours — the fix must not
    // flatten original to the base either.
    const painted = strokes(leaves);
    expect(new Set(painted).size).toBe(2);
    expect(new Set(painted)).toEqual(new Set(["#0d0887", "#f0f921"]));
  });

  it("FOLLOW_FILL stays derived under a solid border mode (not overridden by the solid base)", () => {
    // The polygon (area) leaf is the follow-fill shape: the border is the
    // outline, the fill owns the face. Set a per-feature author fill, then
    // follow-fill — the border must trace each leaf's CURRENT fill colour,
    // never the solid border base.
    const leaves = [makePerFeatureLeaf("#0d0887", 1), makePerFeatureLeaf("#f0f921", 9)];
    registerPerFeatureBorderLayer("vec1", leaves);
    // Give the leaves distinct live fill paints (the fill face was applied).
    leaves[0].options.fillColor = "#111111";
    leaves[1].options.fillColor = "#222222";
    setIntent(ui, "vec1", "borderStyleMode", "followFill");
    applyBorderToLayer(ui, "vec1");
    flushStyleDimApply(FACE.STROKE, "vec1");
    const painted = strokes(leaves);
    expect(painted[0]).toBe("#111111");
    expect(painted[1]).toBe("#222222");
    expect(painted[0]).not.toBe(painted[1]);
    // The border colour intent stays absent: derived, not copied.
    expect(getIntent(ui, "vec1", "borderColor")).toBeUndefined();
  });
});

describe("border category value wiring", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
    installChroma(["#111111", "#222222"]);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    delete globalThis.chroma;
  });

  /** A line leaf carrying a string property only (GADM NAME_3 shape): no
   *  numeric column, so the by-value entry is the category machine. */
  const makeStringLineLeaf = (name: string): any => {
    installLeafletGlobals();
    const leaf = new (globalThis as any).L.Polyline() as any;
    leaf.options = { color: "#0d0887", weight: 2, stroke: true };
    leaf.feature = {
      geometry: { type: "LineString" },
      properties: { name },
    };
    leaf.setStyle = vi.fn((style: Record<string, unknown>) => {
      Object.assign(leaf.options, style);
      return leaf;
    });
    leaf.on = vi.fn();
    return leaf;
  };

  const registerStringLayer = (id: string, leaves: any[]): void => {
    installLeafletGlobals();
    manager.registerLayer({ id, name: id, layer: makeFeatureGroup(...leaves) });
    ui.runtimeStore.setFields(id, [{ name: "name", numeric: false }]);
  };

  const openBorderRow = (id: string): HTMLElement => {
    const block = buildBorderRow(ui, id) as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, id, block);
    return block;
  };

  const modeSelectOf = (block: HTMLElement): HTMLSelectElement | null =>
    block.querySelector(
      ".foliplus-style-border-mode-select",
    ) as HTMLSelectElement | null;

  const changeSelect = (sel: HTMLSelectElement | null, value: string): void => {
    expect(sel).not.toBeNull();
    sel!.value = value;
    sel!.dispatchEvent(new Event("change"));
  };
  /** A leaf with both a numeric and a string property, for the kind
   *  re-inference tests: inferFieldKind walks the leaf properties to decide
   *  whether a switched field is numeric or categorical. */
  const makeMixedLeaf = (count: number, name: string): any => {
    installLeafletGlobals();
    const leaf = new (globalThis as any).L.Polyline() as any;
    leaf.options = { color: "#ff0000", weight: 2, stroke: true };
    leaf.feature = {
      geometry: { type: "Polygon" },
      properties: { count, name },
    };

    const setStyle = vi.fn((style: Record<string, unknown>) => {
      Object.assign(leaf.options, style);
      return leaf;
    });
    leaf.setStyle = setStyle;
    leaf.on = vi.fn();
    return leaf;
  };
  it("string-only line offers original/single/value (P2-2 matrix row)", () => {
    registerStringLayer("g_cat", [makeStringLineLeaf("a"), makeStringLineLeaf("b")]);
    const select = modeSelectOf(openBorderRow("g_cat"));
    expect(select).not.toBeNull();
    expect(Array.from(select!.options).map(o => o.value)).toEqual([
      STYLE_MODE.ORIGINAL,
      STYLE_MODE.SOLID,
      STYLE_MODE.VALUE,
    ]);
  });

  it("entering value on a string-only line seeds a category config (no method/classes rows)", () => {
    registerStringLayer("g_cat2", [makeStringLineLeaf("a"), makeStringLineLeaf("b")]);
    const block = openBorderRow("g_cat2");
    changeSelect(modeSelectOf(block), STYLE_MODE.VALUE);
    const stored = getIntent(ui, "g_cat2", "borderValue") as ValueConfig;
    expect(stored.kind).toBe("category");
    expect(block.querySelector(".foliplus-style-fill-method-select")).toBeNull();
    expect(block.querySelector(".foliplus-style-fill-classes-select")).toBeNull();
    expect(block.querySelector(".foliplus-style-fill-field-select")).not.toBeNull();
    expect(block.querySelector(".foliplus-style-scheme-trigger")).not.toBeNull();
  });

  it("switching field numeric -> category re-infers the kind (P2-1)", () => {
    const leaves = [makeMixedLeaf(1, "a"), makeMixedLeaf(5, "b")];
    registerFeatureLayer(manager, ui, "g_mix", leaves);
    const block = openBorderRow("g_mix");
    changeSelect(modeSelectOf(block), STYLE_MODE.VALUE);
    let stored = getIntent(ui, "g_mix", "borderValue") as ValueConfig;
    expect(stored.kind).toBe("numeric");
    ui.runtimeStore.setFields("g_mix", [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ]);
    const fieldSelect = block.querySelector(
      ".foliplus-style-fill-field-select",
    ) as HTMLSelectElement;
    fieldSelect.value = "name";
    fieldSelect.dispatchEvent(new Event("change"));
    stored = getIntent(ui, "g_mix", "borderValue") as ValueConfig;
    expect(stored.kind).toBe("category");
    expect(stored.field).toBe("name");
  });

  it("switching field category -> numeric re-infers the kind (P2-1)", () => {
    const leaves = [makeMixedLeaf(1, "a"), makeMixedLeaf(5, "b")];
    registerFeatureLayer(manager, ui, "g_mix2", leaves);
    ui.runtimeStore.setFields("g_mix2", [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ]);
    const block = openBorderRow("g_mix2");
    changeSelect(modeSelectOf(block), STYLE_MODE.VALUE);
    let stored = getIntent(ui, "g_mix2", "borderValue") as ValueConfig;
    expect(stored.kind).toBe("numeric");
    const fieldSelect = block.querySelector(
      ".foliplus-style-fill-field-select",
    ) as HTMLSelectElement;
    fieldSelect.value = "name";
    fieldSelect.dispatchEvent(new Event("change"));
    stored = getIntent(ui, "g_mix2", "borderValue") as ValueConfig;
    expect(stored.kind).toBe("category");
    fieldSelect.value = "count";
    fieldSelect.dispatchEvent(new Event("change"));
    stored = getIntent(ui, "g_mix2", "borderValue") as ValueConfig;
    expect(stored.kind).toBe("numeric");
    expect(stored.field).toBe("count");
  });

  it("a stored sequential scheme on a category record falls back for the picker (P2-1)", () => {
    const leaves = [makeFeatureLeaf(1), makeFeatureLeaf(5)];
    registerFeatureLayer(manager, ui, "g_sch", leaves);
    setIntent(ui, "g_sch", "borderValue", {
      kind: "category",
      field: "count",
      method: "equal",
      classes: 3,
      scheme: "Blues",
    } as ValueConfig);
    const block = openBorderRow("g_sch");
    changeSelect(modeSelectOf(block), STYLE_MODE.VALUE);
    const stored = getIntent(ui, "g_sch", "borderValue") as ValueConfig;
    expect(stored.scheme).toBe("Blues");
  });

  it("switching a line layer field to a category column falls the sequential scheme back to Set3 (P2-1)", () => {
    const leaves = [makeMixedLeaf(1, "a"), makeMixedLeaf(5, "b")];
    registerFeatureLayer(manager, ui, "g_catsw", leaves);
    ui.runtimeStore.setFields("g_catsw", [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ]);
    setIntent(ui, "g_catsw", "borderValue", {
      kind: "numeric",
      field: "count",
      method: "equal",
      classes: 3,
      scheme: "Viridis",
    } as ValueConfig);
    const block = openBorderRow("g_catsw");
    changeSelect(modeSelectOf(block), STYLE_MODE.VALUE);
    const fieldSelect = block.querySelector(
      ".foliplus-style-fill-field-select",
    ) as HTMLSelectElement | null;
    expect(fieldSelect).not.toBeNull();
    fieldSelect!.value = "name";
    fieldSelect!.dispatchEvent(new Event("change"));
    const stored = getIntent(ui, "g_catsw", "borderValue") as ValueConfig;
    expect(stored.kind).toBe("category");
    expect(stored.field).toBe("name");
    expect(stored.scheme).toBe("Set3");
  });

  it("resolves a field switch on an unregistered layer to a numeric border seed (P2-1)", () => {
    const leaves = [makeMixedLeaf(1, "a"), makeMixedLeaf(5, "b")];
    registerFeatureLayer(manager, ui, "g_bghost", leaves);
    ui.runtimeStore.setFields("g_bghost", [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ]);
    // Drop the layer from the registry: the seed path must degrade to the
    // numeric machine rather than throw on a null layer reference.
    manager.unregisterLayer("g_bghost");
    const seeded = borderValueForUi(ui, "g_bghost", ["count", "name"]);
    expect(seeded.kind).toBe("numeric");
    expect(seeded.field).toBe("count");
    // A field switch on the same unresolved reference stays numeric.
    const merged = writeBorderValue(ui, "g_bghost", { field: "name" });
    expect(merged.kind).toBe("numeric");
    expect(merged.field).toBe("name");
  });
  it("keeps a category scheme that the vocabulary offers through a field switch (P2-1)", () => {
    const leaves = [makeMixedLeaf(1, "a"), makeMixedLeaf(5, "b")];
    registerFeatureLayer(manager, ui, "g_catsp", leaves);
    ui.runtimeStore.setFields("g_catsp", [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ]);
    setIntent(ui, "g_catsp", "borderValue", {
      kind: "category",
      field: "count",
      method: "equal",
      classes: 3,
      scheme: "Set3",
    } as ValueConfig);
    const block = openBorderRow("g_catsp");
    changeSelect(modeSelectOf(block), STYLE_MODE.VALUE);
    const fieldSelect = block.querySelector(
      ".foliplus-style-fill-field-select",
    ) as HTMLSelectElement | null;
    expect(fieldSelect).not.toBeNull();
    fieldSelect!.value = "name";
    fieldSelect!.dispatchEvent(new Event("change"));
    const stored = getIntent(ui, "g_catsp", "borderValue") as ValueConfig;
    expect(stored.kind).toBe("category");
    expect(stored.field).toBe("name");
    expect(stored.scheme).toBe("Set3");
  });
});

describe("border VALUE mode with no value field (defensive fallbacks)", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  /** A line layer whose features carry no numeric/categorical property, so
   *  hasValueField() is false while the geometry still offers the value mode.
   *  This is the state a stored "value" mode can reach after the layer's
   *  fields disappear (a data refresh), which is exactly the fallback the
   *  detail builder and binder must survive. */
  const registerFieldlessLine = (id: string): any => {
    installLeafletGlobals();
    const leaf = makeLayerForGeometry("line");
    leaf.feature.properties = {};
    manager.registerLayer({ id, name: id, layer: makeFeatureGroup(leaf) });
    return leaf;
  };

  it("VALUE mode falls back to the solid detail and binds through the shell", () => {
    const leaf = registerFieldlessLine("nf_line");
    setIntent(ui, "nf_line", "borderStyleMode", STYLE_MODE.VALUE);

    const block = buildBorderRow(ui, "nf_line") as HTMLElement;
    document.body.appendChild(block);
    bindBorderRow(ui, "nf_line", block);

    // The detail builder's no-field arm: the solid rows, never the value rows.
    const color = block.querySelector(
      ".foliplus-style-border-color-input",
    ) as HTMLInputElement | null;
    const weight = block.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement | null;
    expect(color).not.toBeNull();
    expect(weight).not.toBeNull();
    expect(block.querySelector(".foliplus-style-fill-field-select")).toBeNull();

    // The binder's no-field arm: the shell commits colour and weight.
    color!.value = "#123456";
    color!.dispatchEvent(new Event("input", { bubbles: true }));
    flushStyleDimApply(FACE.STROKE, "nf_line");
    expect(getIntent(ui, "nf_line", "borderColor")).toBe("#123456");

    weight!.value = "7";
    weight!.dispatchEvent(new Event("change", { bubbles: true }));
    flushStyleDimApply(FACE.STROKE, "nf_line");
    expect(getIntent(ui, "nf_line", "borderWeight")).toBe(7);

    // The shell's onblur flush: the trailing frame lands on the leaf.
    color!.dispatchEvent(new Event("blur"));
    expect(leaf.options.color).toBe("#123456");
  });

  it("valueSource reports none / author / user", () => {
    // none: a layer the border cannot paint at all.
    manager.registerLayer({
      id: "vs_canvas",
      name: "C",
      canvas: document.createElement("canvas"),
    });
    expect((BORDER_DIMENSION as any).valueSource(ui, "vs_canvas")).toBe("none");

    // author: a paintable layer with no border intent.
    registerFieldlessLine("vs_author");
    expect((BORDER_DIMENSION as any).valueSource(ui, "vs_author")).toBe("author");

    // user: one border intent is enough to make the face user-owned. The
    // commit channel is what marks provenance (setIntent alone does not).
    commitBorderWeight(ui, "vs_author", 4);
    flushStyleDimApply(FACE.STROKE, "vs_author");
    expect((BORDER_DIMENSION as any).valueSource(ui, "vs_author")).toBe("user");
  });

  it("value() returns undefined for a layer that is not registered", () => {
    expect(BORDER_DIMENSION.value(ui, "ghost_layer")).toBeUndefined();
  });

  it("write() with no keys does not schedule an apply", () => {
    registerFieldlessLine("nf_write");
    expect(hasStyleDimApply(FACE.STROKE, "nf_write")).toBe(false);
    BORDER_DIMENSION.write!(ui, "nf_write", {});
    expect(hasStyleDimApply(FACE.STROKE, "nf_write")).toBe(false);
  });
});
