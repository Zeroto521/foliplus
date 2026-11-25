// test/js/control/LayerControl/ui/style/fill.apply — fillMode dispatch and the solid/value mode row.
import {
  RING,
  details,
  flushFill,
  initWithRampedLayer,
  initWithValues,
  installChroma,
  type makeLayer,
  type makeRampedLayer,
  modeSelect,
  openPanel,
  switchMode,
} from "./fill.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLASS_COUNT } from "#core/value/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { getIntent, setIntent } from "#control/LayerControl/ui/intent.js";
import {
  FILL_DIMENSION,
  applyFillToLayer,
  bindFillRow,
  buildFillRow,
  resetLayerFill,
} from "#control/LayerControl/ui/style/fill.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

describe("applyFillToLayer — fillMode dispatch", () => {
  const VALUE = {
    field: "count",

    method: "equal" as const,

    classes: 3,

    scheme: "Reds",
  };

  const COLORS = ["#111111", "#222222", "#333333"];

  let manager: LayerController;

  let ui: LayerUI;

  let rampLayer: ReturnType<typeof makeRampedLayer>;

  beforeEach(() => {
    installChroma(COLORS);

    const fixture = initWithRampedLayer([1, 5, 9]);

    manager = fixture.manager;

    ui = fixture.ui;

    rampLayer = fixture.rampLayer;
  });

  afterEach(() => {
    delete globalThis.chroma;

    manager?.debouncedEnforce?.cancel?.();

    document.body.innerHTML = "";

    vi.clearAllMocks();
  });

  const paintedColors = (): string[] =>
    rampLayer.leaves.map(
      leaf => leaf.setStyle.mock.calls.at(-1)![0].fillColor as string,
    );

  it("fillMode=ramp paints by value and ignores the stored solid color", () => {
    setIntent(ui, "overlay1", "fillColor", "#ff0000");

    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", VALUE);

    applyFillToLayer(ui, "overlay1");

    expect(paintedColors()).toEqual(COLORS);
  });

  it("a ramp config with no explicit mode paints the ramp", () => {
    // The pre-fillMode record shape: the config's presence alone selects the

    // mode, so a persisted record written before fillMode existed still paints.

    setIntent(ui, "overlay1", "fillColor", "#ff0000");

    setIntent(ui, "overlay1", "fillValue", VALUE);

    applyFillToLayer(ui, "overlay1");

    expect(paintedColors()).toEqual(COLORS);
  });

  it("resolves a stored field the data no longer offers, for display and paint", () => {
    // A stored ramp can outlive its column (a streamed layer replaced its

    // features). The row and the map must agree on the column in use: both

    // resolve the stale name to the first offered field. Before the shared

    // resolution the row showed that field while the map degraded to the

    // author's face.

    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", { ...VALUE, field: "gone" });

    expect(FILL_DIMENSION.value!(ui, "overlay1")).toMatchObject({
      mode: "value",

      value: { field: "count" },
    });

    applyFillToLayer(ui, "overlay1");

    expect(paintedColors()).toEqual(COLORS);
  });

  it("a category ramp with no findable carrier yields no field candidates", () => {
    // The category mode resolves the candidate list through the registry and

    // findLayer; when the carrier cannot be re-resolved at all (a stale entry

    // mid-teardown) the list is empty and the stored name resolves to the

    // empty field rather than throwing.

    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", { ...VALUE, kind: "category" });

    (ui.c.layerRegistry.get("overlay1") as { layer: unknown }).layer = null;

    vi.spyOn(ui.c, "findLayer").mockReturnValue(null);

    expect(FILL_DIMENSION.value!(ui, "overlay1")?.mode).toBe("value");
  });

  it("fillMode=solid never reads the ramp config", () => {
    setIntent(ui, "overlay1", "fillColor", "#ff0000");

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    setIntent(ui, "overlay1", "fillValue", VALUE);

    applyFillToLayer(ui, "overlay1");

    expect(rampLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#ff0000",

      fill: true,
    });
  });

  it("a mode=ramp record with no config falls back to the authored face", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "value");

    applyFillToLayer(ui, "overlay1");

    // Neither mode has a value, so nothing is written — the author's fill stays.

    expect(rampLayer.leaves[0].setStyle).not.toHaveBeenCalled();
  });

  it("the ramp mode carries the user's solid-mode opacity", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", VALUE);

    setIntent(ui, "overlay1", "fillOpacity", 0.25);

    applyFillToLayer(ui, "overlay1");

    expect(rampLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#111111",

      fillOpacity: 0.25,

      fill: true,
    });
  });

  it("the ramp mode omits the opacity when the user never set one", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", VALUE);

    applyFillToLayer(ui, "overlay1");

    // The author's declared opacity stays in force instead of being zeroed.

    expect(rampLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#111111",

      fill: true,
    });
  });

  it("switching back to solid with no solid override restores the author's face", () => {
    // A solid apply with nothing to own must clear the ramp's output, not

    // skip the walk: a skipped walk leaves the previous mode's color on the

    // map. The ramp config stays stored for the next switch.

    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", VALUE);

    applyFillToLayer(ui, "overlay1");

    expect(paintedColors()).toEqual(COLORS);

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    applyFillToLayer(ui, "overlay1");

    for (const leaf of rampLayer.leaves) {
      expect(leaf.setStyle.mock.calls.at(-1)![0]).toEqual({
        fillColor: "#aabbcc",

        fillOpacity: 0.5,

        fill: true,
      });
    }

    expect(getIntent(ui, "overlay1", "fillValue")).toEqual(VALUE);
  });

  it("an opacity-only solid apply after a ramp restores the author's color", () => {
    // Solid owns the whole fill face, so the color has to come back to the

    // author's too — otherwise the ramp's color would sit under the user's

    // opacity.

    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", VALUE);

    applyFillToLayer(ui, "overlay1");

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    setIntent(ui, "overlay1", "fillOpacity", 0.4);

    applyFillToLayer(ui, "overlay1");

    // One call, not a restore then a commit: the author's color and `fill`

    // flag ride the same payload as the user's opacity, so the ramp's color

    // is replaced rather than left sitting under it.

    const calls = rampLayer.leaves[0].setStyle.mock.calls.map(c => c[0]);

    expect(calls.at(-1)).toEqual({
      fillColor: "#aabbcc",

      fillOpacity: 0.4,

      fill: true,
    });
  });

  it("a color-only solid apply after a ramp preserves the author's opacity", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", VALUE);

    applyFillToLayer(ui, "overlay1");

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    setIntent(ui, "overlay1", "fillColor", "#777777");

    applyFillToLayer(ui, "overlay1");

    // One call, color only. The author's opacity is left in place rather

    // than rewritten, so the ramp's color is replaced without touching it -

    // `toEqual` above rejects a payload that carried a fillOpacity at all.

    const calls = rampLayer.leaves[0].setStyle.mock.calls.map(c => c[0]);

    expect(calls.at(-1)).toEqual({ fillColor: "#777777", fill: true });
  });

  it("a switch back to the ramp repaints it, with the stored config kept", () => {
    // Both directions: the inactive config is never deleted, only ignored, so

    // the ramp comes back exactly where it left off.

    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", VALUE);

    applyFillToLayer(ui, "overlay1");

    expect(paintedColors()).toEqual(COLORS);

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    applyFillToLayer(ui, "overlay1");

    setIntent(ui, "overlay1", "fillStyleMode", "value");

    applyFillToLayer(ui, "overlay1");

    expect(paintedColors()).toEqual(COLORS);

    expect(getIntent(ui, "overlay1", "fillValue")).toEqual(VALUE);
  });

  it("a ramp mode on a color basemap paints nothing rather than the stored solid", () => {
    // A basemap has no leaves to classify, so the ramp must degrade to the

    // pane's existing paint - and it must not fall through to the solid mode,

    // which would paint the stored solid color while the panel claims ramp.

    // The ramp config stays stored, so a later switch back has something to

    // restore against.

    manager.registerLayer({
      id: CONST.SOLID_BASEMAP_ID,

      name: "Color",

      role: "base",

      color: CONST.COLOR.DEFAULT,
    });

    setIntent(ui, CONST.SOLID_BASEMAP_ID, "fillColor", "#ff0000");

    setIntent(ui, CONST.SOLID_BASEMAP_ID, "fillStyleMode", "value");

    setIntent(ui, CONST.SOLID_BASEMAP_ID, "fillValue", VALUE);

    applyFillToLayer(ui, CONST.SOLID_BASEMAP_ID);

    expect(ui.currentColor).not.toBe("#ff0000");

    expect(getIntent(ui, CONST.SOLID_BASEMAP_ID, "fillColor")).toBe("#ff0000");

    expect(getIntent(ui, CONST.SOLID_BASEMAP_ID, "fillValue")).toEqual(VALUE);
  });

  it("FILL_DIMENSION.write selects the ramp mode and paints on the next frame", () => {
    const schedule = vi.fn();

    ui.c.persistence = { schedule } as never;

    FILL_DIMENSION.write!(ui, "overlay1", {
      mode: "value",

      value: VALUE,

      opacity: 0.4,
    });

    expect(getIntent(ui, "overlay1", "fillStyleMode")).toBe("value");

    expect(getIntent(ui, "overlay1", "fillValue")).toEqual(VALUE);

    expect(ui.intentStore.isUserSet("overlay1", "fillStyleMode")).toBe(true);

    expect(ui.intentStore.isUserSet("overlay1", "fillValue")).toBe(true);

    expect(schedule).toHaveBeenCalled();

    flushStyleDimApply(FACE.FILL, "overlay1");

    const last = rampLayer.leaves[0].setStyle.mock.calls.at(-1)![0];

    expect(last.fillColor).toBe(COLORS[0]);

    expect(last.fillOpacity).toBe(0.4);
  });

  it("FILL_DIMENSION.write with a solid patch leaves the ramp mode stored", () => {
    // The writer writes the keys it is given and no more: a color pick while

    // the ramp mode is active must not delete the stored ramp, which is what a

    // mode switch back restores.

    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", VALUE);

    FILL_DIMENSION.write!(ui, "overlay1", { color: "#ff0000", opacity: 0.5 });

    expect(getIntent(ui, "overlay1", "fillColor")).toBe("#ff0000");

    expect(getIntent(ui, "overlay1", "fillOpacity")).toBe(0.5);

    expect(getIntent(ui, "overlay1", "fillStyleMode")).toBe("value");

    expect(getIntent(ui, "overlay1", "fillValue")).toEqual(VALUE);
  });

  it("a solid switch leaves the author's face in force on mouseout", () => {
    // The ramp config stays stored across the switch (it is the mode's

    // next-time state, not evidence the mode is active), so the getter a ramp

    // apply registered is still reachable. The solid mode has to take the leaf

    // back, or the next mouseout would repaint the ramp over the author's

    // face. The getter's own mode check is asserted in fillValue.test.ts.

    const handlers: Array<() => void> = [];

    const leaf = {
      options: { fillColor: "#112233", fillOpacity: 0.6, fill: false },

      feature: { properties: { count: 1 }, geometry: { type: "Polygon" } },

      getLatLngs: RING,

      setStyle: vi.fn(),

      on: vi.fn((_type: string, fn: () => void) => {
        handlers.push(fn);
      }),
    };

    rampLayer.leaves[0] = leaf as never;

    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", VALUE);

    applyFillToLayer(ui, "overlay1");

    // folium's mouseout restores the author's face; the ramp's getter repays

    // the ramp color on top of it.

    leaf.setStyle({ fillColor: "#112233", fillOpacity: 0.6, fill: false });

    handlers[0]();

    expect(leaf.setStyle.mock.calls.at(-1)![0].fillColor).toBe(COLORS[0]);

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    applyFillToLayer(ui, "overlay1");

    leaf.setStyle.mockClear();

    // Re-registering the key replaces the ramp's getter instead of stacking a

    // second closure, so the leaf still holds one mouseout handler.

    expect(handlers).toHaveLength(1);

    // folium's mouseout restores the author's face...

    leaf.setStyle({ fillColor: "#112233", fillOpacity: 0.6, fill: false });

    // ...and the (now solid) getter leaves it alone.

    handlers[0]();

    expect(leaf.setStyle).toHaveBeenCalledTimes(1);
  });

  it("reset clears both the ramp config and the mode", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", VALUE);

    setIntent(ui, "overlay1", "fillOpacity", 0.25);

    resetLayerFill(ui, "overlay1");

    expect(getIntent(ui, "overlay1", "fillStyleMode")).toBeUndefined();

    expect(getIntent(ui, "overlay1", "fillValue")).toBeUndefined();

    expect(getIntent(ui, "overlay1", "fillOpacity")).toBeUndefined();

    expect(ui.intentStore.isUserSet("overlay1", "fillStyleMode")).toBe(false);

    expect(ui.intentStore.isUserSet("overlay1", "fillValue")).toBe(false);
  });
});

describe("fill mode row — solid ↔ color by value", () => {
  let manager: LayerController;

  let ui: LayerUI;

  let layer: ReturnType<typeof makeLayer>;

  beforeEach(() => {
    ({ manager, ui, layer } = initWithValues());
  });

  afterEach(() => {
    document.body.innerHTML = "";

    vi.clearAllMocks();

    vi.unstubAllGlobals();
  });

  it("switching to by-value seeds the default ramp and repaints per leaf", () => {
    installChroma(["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"]);

    const block = openPanel(ui);

    switchMode(block, "value");

    expect(getIntent(ui, "overlay1", "fillStyleMode")).toBe("value");

    expect(getIntent(ui, "overlay1", "fillValue")).toEqual({
      kind: "numeric",

      field: "count",

      method: CONST.FILL_VALUE.METHOD_DEFAULT,

      classes: CLASS_COUNT.DEFAULT,

      scheme: CONST.FILL_VALUE.SCHEME_DEFAULT,
    });

    // jenks/quantile read the simple-statistics CDN global, which jsdom does

    // not load; equal interval classifies on its own, so the paint assertion

    // below exercises the real ramp colors.

    const method = details(block).querySelector(
      `.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`,
    ) as HTMLSelectElement;

    method.value = "equal";

    method.dispatchEvent(new Event("change", { bubbles: true }));

    flushFill();

    const rampColors = [
      "#111111",

      "#222222",

      "#333333",

      "#444444",

      "#555555",

      "#666666",
    ];

    for (const leaf of layer.leaves) {
      const call = leaf.setStyle.mock.calls.at(-1)?.[0];

      expect(rampColors).toContain(call?.fillColor);
    }

    // The detail slot now shows the ramp mode's three rows.

    expect(
      details(block).querySelector(`.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`),
    ).not.toBeNull();
  });

  it("switching back to solid keeps the ramp config for the next switch", () => {
    installChroma(["#111111", "#222222"]);

    const block = openPanel(ui);

    switchMode(block, "value");

    switchMode(block, "solid");

    expect(getIntent(ui, "overlay1", "fillStyleMode")).toBe("solid");

    expect(getIntent(ui, "overlay1", "fillValue")).toMatchObject({ field: "count" });

    // The solid mode is back: swatch + opacity, no ramp controls.

    expect(
      details(block).querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();

    expect(
      details(block).querySelector(`.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`),
    ).toBeNull();
  });

  it("a stored category value config survives mode re-entry unclamped", () => {
    // persistedValue (fill.ts) has two modes: the category mode returns the

    // record as-is (no class-count clamp — method/classes are type-required

    // but unused at runtime on a category), while only the numeric mode clamps

    // classes to the persistence validator's range. A category record must

    // survive re-entering the value mode (writeFillMode persists

    // valueForUi(...) through persistedValue's category mode) without being

    // coerced to numeric.

    installChroma(["#111111", "#222222"]);

    setIntent(ui, "overlay1", "fillValue", {
      kind: "category",

      field: "count",

      method: "equal",

      classes: 3,

      scheme: "Reds",
    });

    const block = openPanel(ui);

    switchMode(block, "solid");

    switchMode(block, "value");

    expect(getIntent(ui, "overlay1", "fillValue")).toMatchObject({
      kind: "category",

      method: "equal",

      classes: 3,

      scheme: "Reds",
    });
  });

  it("keeps the mode row but writes no mode when there is no value field", () => {
    // A text-only layer: the field cache has no numeric entry and the tree

    // walk fallback finds no finite number either. ORIGINAL + SOLID still

    // apply (a fill-capable layer always has a baseline state), VALUE is absent.

    ui.runtimeStore.setFields("overlay1", []);

    for (const leaf of layer.leaves) {
      // No numeric and no categorical property: the honest no-value layer.

      leaf.feature.properties = {};
    }

    const block = buildFillRow(ui, "overlay1");

    bindFillRow(ui, "overlay1", block);

    const select = block.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;

    expect(select).not.toBeNull();

    expect(select.querySelector('option[value="value"]')).toBeNull();

    expect(select.querySelector('option[value="original"]')).not.toBeNull();

    expect(getIntent(ui, "overlay1", "fillStyleMode")).toBeUndefined();

    expect(getIntent(ui, "overlay1", "fillValue")).toBeUndefined();
  });

  it("a color basemap keeps the single-swatch row (solid only)", () => {
    manager.registerLayer({
      id: "colormap",

      name: "Color",

      role: "base",

      color: "#3366cc",

      canvas: document.createElement("canvas"),
    });

    const row = buildFillRow(ui, "colormap");

    bindFillRow(ui, "colormap", row);

    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`)).toBeNull();

    const color = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;

    expect(color).not.toBeNull();

    // The single row binds the same live swatch the solid mode uses.

    color.value = "#123456";

    color.dispatchEvent(new Event("input", { bubbles: true }));

    flushFill();

    expect(getIntent(ui, "colormap", "fillColor")).toBe("#123456");
  });

  it("falls back to the tree walk when the field cache is empty", () => {
    // The cache can be cold (or hold only labelable text fields) while the

    // features still carry numbers; the ramp field list must not go empty.

    ui.runtimeStore.setFields("overlay1", []);

    const block = buildFillRow(ui, "overlay1");

    bindFillRow(ui, "overlay1", block);

    const select = modeSelect(block);

    expect(
      (select.querySelector('option[value="value"]') as HTMLOptionElement).disabled,
    ).toBe(false);

    switchMode(block, "value");

    expect(getIntent(ui, "overlay1", "fillValue")).toMatchObject({ field: "count" });
  });

  it("reads the stored value mode as an absent option when the layer has no field", () => {
    // A record can outlive the data it was built for (field removed). The

    // stored VALUE mode reads first, but the VALUE option is absent (nothing

    // to classify), so the bridged select shows no selection; ORIGINAL +

    // SOLID are the honest modes and the detail degrades to solid controls.

    ui.runtimeStore.setFields("overlay1", []);

    for (const leaf of layer.leaves) {
      leaf.feature.properties = {};
    }

    setIntent(ui, "overlay1", "fillStyleMode", "value");

    setIntent(ui, "overlay1", "fillValue", {
      field: "count",

      method: "jenks",

      classes: 3,

      scheme: "Blues",
    } as never);

    const block = buildFillRow(ui, "overlay1");

    const select = block.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;

    // The mode row exists with ORIGINAL + SOLID; VALUE's option is gone and

    // the select falls back to no selection ("").

    expect(select).not.toBeNull();

    expect(select.querySelector('option[value="value"]')).toBeNull();

    expect(select.value).toBe("");

    expect(
      details(block).querySelector(`.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`),
    ).toBeNull();
  });
});
