// test/js/control/LayerControl/ui/style/fill.style — derivation invariants, string categories and future rows.
import { initFixture, installLeafletGlobals } from "../fixture.js";
import {
  details,
  initWithPerFeatureLayer,
  installChroma,
  makePerFeatureLayer,
  modeSelect,
  openPanel,
  switchMode,
} from "./fill.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { getIntent, setIntent } from "#control/LayerControl/ui/intent.js";
import {
  FILL_DIMENSION,
  applyFillToLayer,
  bindFillRow,
  buildFillRow,
} from "#control/LayerControl/ui/style/fill.js";
import { valueForUi } from "#control/LayerControl/ui/style/fillValue.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

/** The fill dimension's valueSource: the provenance (none / author / user)


 *  the registry and the row read to tell where the current fill comes from.


 *  The three states are driven directly against the descriptor — the same


 *  contract the per-dimension registry tests assert for the other


 *  dimensions, exercised here so the fill mode's own provenance is pinned. */

describe("FILL_DIMENSION.valueSource — provenance", () => {
  let manager: LayerController;

  let ui: LayerUI;

  const overlayLayer = {
    options: {},

    setZIndex: vi.fn(),

    eachLayer: vi.fn(),

    getBounds: vi.fn(() => ({
      isValid: () => true,

      getSouthWest: () => ({ lat: 0, lng: 0 }),

      getNorthEast: () => ({ lat: 1, lng: 1 }),
    })),
  };

  beforeEach(() => {
    installLeafletGlobals();

    ({ manager, ui } = initFixture({
      data: [{ id: "overlay1", name: "Overlay", role: "overlay", layer: overlayLayer }],
    }));
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();

    document.body.innerHTML = "";

    vi.clearAllMocks();
  });

  it("is none when the layer cannot carry a fill (gate rejects)", () => {
    expect(FILL_DIMENSION.valueSource!(ui, "not-registered")).toBe("none");
  });

  it("is author when the user has not set a fill slot", () => {
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities: { fill: "native" },
      geometryType: () => "polygon",
    } as never);

    expect(FILL_DIMENSION.valueSource!(ui, "overlay1")).toBe("author");
  });

  it("is user once provenance marks a fill slot", () => {
    vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
      capabilities: { fill: "native" },
      geometryType: () => "polygon",
    } as never);

    ui.intentStore.set("overlay1", "fillColor", "#ff0000");

    expect(FILL_DIMENSION.valueSource!(ui, "overlay1")).toBe("user");
  });
});

describe("fill solid derivation invariants", () => {
  // A per-feature layer mirrors the quickstart explore output the user

  // reported: each leaf carries its OWN author colour (__folium_color), so

  // the style bag holds one colour per leaf, not one shared base.

  afterEach(() => {
    document.body.innerHTML = "";

    vi.clearAllMocks();

    vi.unstubAllGlobals();
  });

  const fills = (
    layer: ReturnType<typeof initWithPerFeatureLayer>["layer"],
  ): unknown[] =>
    layer.leaves.map(
      (l: { setStyle: { mock: { calls: unknown[][] } } }) =>
        (l.setStyle.mock.calls.at(-1)?.[0] as { fillColor?: unknown })?.fillColor,
    );

  it("value -> solid flattens a per-feature layer to one colour", () => {
    installChroma(["#111111", "#222222"]);

    const { ui, layer } = initWithPerFeatureLayer({ colors: ["#0d0887", "#f0f921"] });

    setIntent(ui, "feature1", "fillStyleMode", "value");

    setIntent(ui, "feature1", "fillValue", {
      kind: "numeric",

      field: "count",

      method: "equal",

      classes: 2,

      scheme: "Reds",
    } as never);

    applyFillToLayer(ui, "feature1");

    flushStyleDimApply(FACE.FILL, "feature1");

    // The value mode classified the leaves: more than one colour is live.

    expect(new Set(fills(layer)).size).toBeGreaterThan(1);

    setIntent(ui, "feature1", "fillStyleMode", "solid");

    applyFillToLayer(ui, "feature1");

    flushStyleDimApply(FACE.FILL, "feature1");

    // SOLID owns exactly one colour: the authored base (first leaf's bag),

    // NOT the per-leaf author colours the bug restored.

    const painted = fills(layer);

    expect(new Set(painted).size).toBe(1);

    expect(painted[0]).toBe("#0d0887");
  });

  it("original -> solid flattens a per-feature layer to one colour (regression)", () => {
    const { ui, layer } = initWithPerFeatureLayer({ colors: ["#0d0887", "#f0f921"] });

    setIntent(ui, "feature1", "fillStyleMode", "solid");

    applyFillToLayer(ui, "feature1");

    flushStyleDimApply(FACE.FILL, "feature1");

    const painted = fills(layer);

    expect(new Set(painted).size).toBe(1);

    expect(painted[0]).toBe("#0d0887");
  });

  it("solid -> original restores the per-feature multi-colour paint", () => {
    const { ui, layer } = initWithPerFeatureLayer({ colors: ["#0d0887", "#f0f921"] });

    setIntent(ui, "feature1", "fillStyleMode", "solid");

    applyFillToLayer(ui, "feature1");

    flushStyleDimApply(FACE.FILL, "feature1");

    setIntent(ui, "feature1", "fillStyleMode", "original");

    applyFillToLayer(ui, "feature1");

    flushStyleDimApply(FACE.FILL, "feature1");

    // Original mode must keep its per-leaf author colours — the fix must not

    // flatten original to the base either.

    const painted = fills(layer);

    expect(new Set(painted).size).toBe(2);

    expect(new Set(painted)).toEqual(new Set(["#0d0887", "#f0f921"]));
  });

  it("solid with only an opacity intent stays one colour at that opacity", () => {
    const { ui, layer } = initWithPerFeatureLayer({ colors: ["#0d0887", "#f0f921"] });

    setIntent(ui, "feature1", "fillStyleMode", "solid");

    setIntent(ui, "feature1", "fillOpacity", 0.3);

    applyFillToLayer(ui, "feature1");

    flushStyleDimApply(FACE.FILL, "feature1");

    const calls = layer.leaves.map(
      (l: { setStyle: { mock: { calls: unknown[][] } } }) =>
        l.setStyle.mock.calls.at(-1)?.[0] as {
          fillColor?: unknown;

          fillOpacity?: unknown;
        },
    );

    expect(new Set(calls.map((c: { fillColor?: unknown }) => c?.fillColor)).size).toBe(
      1,
    );

    expect(calls.every((c: { fillOpacity?: unknown }) => c?.fillOpacity === 0.3)).toBe(
      true,
    );
  });
});

describe("category field fill — string-only layer", () => {
  let ui: LayerUI;

  let layer: ReturnType<typeof makePerFeatureLayer>;

  beforeEach(() => {
    installLeafletGlobals();

    layer = makePerFeatureLayer(["#0d0887", "#6a00a8", "#b12a90"]);

    // A string-only layer: drop the numeric column, keep the categorical one.

    for (const leaf of layer.leaves) {
      const props = (leaf as { feature: { properties: Record<string, unknown> } })
        .feature.properties;

      delete props.count;

      delete props.__folium_color;
    }

    ({ ui } = initFixture({
      data: [{ id: "overlay1", name: "Strings", role: "overlay", layer }],
    }));

    ui.runtimeStore.setFields("overlay1", [{ name: "cat", numeric: false }]);
  });

  afterEach(() => {
    document.body.innerHTML = "";

    vi.clearAllMocks();

    vi.unstubAllGlobals();
  });

  it("offers the value mode for a string-only layer (fill)", () => {
    const block = openPanel(ui);

    const select = modeSelect(block);

    expect(select.querySelector(`option[value="value"]`)).not.toBeNull();

    // ORIGINAL is always offered for a fill-capable layer.

    expect(select.querySelector(`option[value="original"]`)).not.toBeNull();
  });

  it("seeds a category config on the string field and shows no method/classes row", () => {
    const block = openPanel(ui);

    switchMode(block, "value");

    expect(getIntent(ui, "overlay1", "fillValue")).toMatchObject({
      kind: "category",

      field: "cat",
    });

    const detail = details(block);

    expect(
      detail.querySelector(`.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`),
    ).toBeNull();

    expect(
      detail.querySelector(`.${CONST.CLASSES.STYLE_FILL_CLASSES_SELECT}`),
    ).toBeNull();

    expect(
      detail.querySelector(`.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`),
    ).not.toBeNull();

    expect(
      detail.querySelector(`.${CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER}`),
    ).not.toBeNull();
  });

  it("offers the qualitative palettes for a category config", () => {
    const block = openPanel(ui);

    switchMode(block, "value");

    const value = getIntent(ui, "overlay1", "fillValue") as Record<string, unknown>;

    expect(["Set3", "Paired", "Set1", "Set2", "Dark2"]).toContain(value.scheme);
  });

  it("refuses a value switch when the layer has no value field at all", () => {
    // Empty the bag entirely.

    for (const leaf of layer.leaves) {
      const props = (leaf as { feature: { properties: Record<string, unknown> } })
        .feature.properties;

      for (const k of Object.keys(props)) delete props[k];
    }

    ui.runtimeStore.setFields("overlay1", []);

    const block = buildFillRow(ui, "overlay1");

    bindFillRow(ui, "overlay1", block);

    const select = block.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement | null;

    // ORIGINAL + SOLID still apply; only VALUE is gone.

    expect(select).not.toBeNull();

    expect(select!.querySelector('option[value="value"]')).toBeNull();

    expect(select!.querySelector('option[value="original"]')).not.toBeNull();

    expect(getIntent(ui, "overlay1", "fillStyleMode")).toBeUndefined();
  });

  it("keeps the selected category field in the intent after a field switch", () => {
    // P3 guard: render and bind must agree. After the panel binds the value

    // detail and the user picks another categorical field, the intent's

    // field must follow — otherwise the panel shows one field while the map

    // paints another (the bindFillDetail regression).

    const block = openPanel(ui);

    switchMode(block, "value");

    const fieldSelect = block.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
    ) as HTMLSelectElement | null;

    expect(fieldSelect).not.toBeNull();

    // The layer only has "cat"; add a second categorical column to switch to.

    for (const leaf of layer.leaves) {
      const props = (leaf as { feature: { properties: Record<string, unknown> } })
        .feature.properties;

      props.name = props.cat;
    }

    ui.runtimeStore.setFields("overlay1", [
      { name: "cat", numeric: false },

      { name: "name", numeric: false },
    ]);

    // Rebind so the picker sees the second field.

    const block2 = buildFillRow(ui, "overlay1");

    bindFillRow(ui, "overlay1", block2);

    const select2 = block2.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
    ) as HTMLSelectElement | null;

    if (!select2) throw new Error("field select missing");

    select2.value = "name";

    select2.dispatchEvent(new Event("change"));

    const value = getIntent(ui, "overlay1", "fillValue") as
      Record<string, unknown> | undefined;

    expect(value?.field).toBe("name");
  });

  it("falls back to a numeric seed when the layer reference cannot be resolved (P2-1)", () => {
    const seeded = valueForUi(ui, "ghost", ["count"]);

    expect(seeded.kind).toBe("numeric");

    expect(seeded.field).toBe("count");
  });

  it("switching to a category field re-seeds a sequential scheme to the qualitative default (P2-1)", () => {
    for (const leaf of layer.leaves) {
      const props = (leaf as { feature: { properties: Record<string, unknown> } })
        .feature.properties;

      props.count = 1;

      props.name = props.cat;
    }

    ui.runtimeStore.setFields("overlay1", [
      { name: "count", numeric: true },

      { name: "cat", numeric: false },

      { name: "name", numeric: false },
    ]);

    setIntent(ui, "overlay1", "fillValue", {
      kind: "numeric",

      field: "count",

      method: "equal",

      classes: 3,

      scheme: "Viridis",
    } as never);

    const block = openPanel(ui);

    switchMode(block, "value");

    const fieldSelect = block.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
    ) as HTMLSelectElement | null;

    expect(fieldSelect).not.toBeNull();

    fieldSelect!.value = "name";

    fieldSelect!.dispatchEvent(new Event("change"));

    const value = getIntent(ui, "overlay1", "fillValue") as
      Record<string, unknown> | undefined;

    expect(value?.kind).toBe("category");

    expect(value?.field).toBe("name");

    expect(value?.scheme).toBe("Set3");
  });

  it("switching to a numeric field re-seeds a qualitative scheme to the sequential default (P2-1)", () => {
    for (const leaf of layer.leaves) {
      const props = (leaf as { feature: { properties: Record<string, unknown> } })
        .feature.properties;

      props.count = 1;
    }

    ui.runtimeStore.setFields("overlay1", [
      { name: "count", numeric: true },

      { name: "cat", numeric: false },
    ]);

    setIntent(ui, "overlay1", "fillValue", {
      kind: "category",

      field: "cat",

      method: "equal",

      classes: 3,

      scheme: "Set3",
    } as never);

    const block = openPanel(ui);

    switchMode(block, "value");

    const fieldSelect = block.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
    ) as HTMLSelectElement | null;

    expect(fieldSelect).not.toBeNull();

    fieldSelect!.value = "count";

    fieldSelect!.dispatchEvent(new Event("change"));

    const value = getIntent(ui, "overlay1", "fillValue") as
      Record<string, unknown> | undefined;

    expect(value?.kind).toBe("numeric");

    expect(value?.field).toBe("count");

    expect(value?.scheme).toBe("Viridis");
  });

  it("resolves a field switch on an unregistered layer to a numeric seed (P2-1)", () => {
    ui.runtimeStore.setFields("ghost", [
      { name: "count", numeric: true },

      { name: "name", numeric: false },
    ]);

    const block = buildFillRow(ui, "ghost");

    document.body.appendChild(block);

    bindFillRow(ui, "ghost", block);

    const select = block.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement | null;

    expect(select).not.toBeNull();

    select!.value = "value";

    select!.dispatchEvent(new Event("change", { bubbles: true }));

    const fieldSelect = block.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
    ) as HTMLSelectElement | null;

    expect(fieldSelect).not.toBeNull();

    fieldSelect!.value = "name";

    fieldSelect!.dispatchEvent(new Event("change", { bubbles: true }));

    const value = getIntent(ui, "ghost", "fillValue") as
      Record<string, unknown> | undefined;

    expect(value?.kind).toBe("numeric");

    expect(value?.field).toBe("name");
  });
});

describe("fill value opacity row (P4) and cmap opacity row (P3) — future slices", () => {
  it.todo("offers an editable opacity number in the value detail");

  it.todo("commits 40 as 0.4 without rewriting the value config");

  it.todo("shows the same override when switching back to solid");

  it.todo("keeps the cmap rows and adds a separate readonly opacity row (uniform)");

  it.todo("shows the em-dash when the author's per-leaf opacity is inconsistent");
});
