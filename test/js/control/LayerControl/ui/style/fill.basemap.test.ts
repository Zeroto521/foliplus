// test/js/control/LayerControl/ui/style/fill.basemap — color basemap fill and reset.
import { findItem } from "../fixture.js";
import {
  commitNow,
  initWithFillLayer,
  type makeFillableLayer,
} from "./fill.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { getIntent, setIntent } from "#control/LayerControl/ui/intent.js";
import {
  applyFillToLayer,
  bindFillRow,
  buildFillRow,
  commitFillColor,
  layerCanFill,
  resetLayerFill,
} from "#control/LayerControl/ui/style/fill.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

describe("LayerUI style panel — fill color", () => {
  let manager: LayerController;

  let ui: LayerUI;

  let fillLayer: ReturnType<typeof makeFillableLayer>;

  beforeEach(() => {
    const fixture = initWithFillLayer();

    manager = fixture.manager;

    ui = fixture.ui;

    fillLayer = fixture.fillLayer;

    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();

    document.body.innerHTML = "";

    vi.clearAllMocks();

    vi.useRealTimers();
  });

  const fillInput = (item: HTMLElement): HTMLInputElement | null =>
    item.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`);

  // ─────────────────── color basemap ───────────────────

  const registerColorBasemap = () => {
    manager.registerLayer({
      id: CONST.SOLID_BASEMAP_ID,

      name: "Color",

      role: "base",

      color: CONST.COLOR.DEFAULT,
    });

    const li = manager.layerRegistry.get(CONST.SOLID_BASEMAP_ID)!;

    (manager.surfaceFor(li) as any).capabilities = {
      opacity: "pane",

      zoomRange: "none",

      relocatable: false,

      bounds: false,

      fill: "native",

      stroke: "none",
    };

    ui.runtimeStore.setFields(CONST.SOLID_BASEMAP_ID, []);
  };
  it("layerCanFill returns true for a color basemap", () => {
    registerColorBasemap();

    expect(layerCanFill(ui, CONST.SOLID_BASEMAP_ID)).toBe(true);
  });

  it("applyFillToLayer routes a color basemap to showSolidBasemap, not leaf walk", () => {
    registerColorBasemap();

    setIntent(ui, CONST.SOLID_BASEMAP_ID, "fillColor", "#ff0000");

    applyFillToLayer(ui, CONST.SOLID_BASEMAP_ID);

    expect(ui.currentColor).toBe("#ff0000");
  });

  it("resetLayerFill restores the color basemap to its default", () => {
    registerColorBasemap();

    setIntent(ui, CONST.SOLID_BASEMAP_ID, "fillColor", "#ff0000");

    resetLayerFill(ui, CONST.SOLID_BASEMAP_ID);

    expect(ui.currentColor).toBe(CONST.COLOR.DEFAULT);

    expect(getIntent(ui, CONST.SOLID_BASEMAP_ID, "fillColor")).toBeUndefined();
  });

  it("buildFillRow renders only the color swatch for a color basemap", () => {
    registerColorBasemap();

    const row = buildFillRow(ui, CONST.SOLID_BASEMAP_ID);

    expect(
      row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();

    expect(row.querySelector(`.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`)).toBeNull();
  });

  it("applyFillToLayer on a color basemap with only opacity skips showSolidBasemap", () => {
    // L252: `color === undefined` branch — opacity-only on a color basemap

    // must not call showSolidBasemap (there is no color to show).

    registerColorBasemap();

    setIntent(ui, CONST.SOLID_BASEMAP_ID, "fillOpacity", 0.5);

    applyFillToLayer(ui, CONST.SOLID_BASEMAP_ID);

    // currentColor is untouched because only opacity was set

    expect(ui.currentColor).toBe(CONST.COLOR.DEFAULT);
  });

  it("commitFillColor on a color basemap never writes fillOpacity", () => {
    // A color basemap has no fillOpacity concept — the color routes to

    // showSolidBasemap and the fill-opacity map stays empty.

    registerColorBasemap();

    commitFillColor(ui, CONST.SOLID_BASEMAP_ID, "#ff0000");

    flushStyleDimApply(FACE.FILL, CONST.SOLID_BASEMAP_ID);

    expect(getIntent(ui, CONST.SOLID_BASEMAP_ID, "fillColor")).toBe("#ff0000");

    expect(getIntent(ui, CONST.SOLID_BASEMAP_ID, "fillOpacity")).toBeUndefined();

    expect(ui.currentColor).toBe("#ff0000");
  });

  it("commitFillColor handles a layer id that is not registered yet", () => {
    expect(() => commitFillColor(ui, "late-layer", "#ff0000")).not.toThrow();

    expect(getIntent(ui, "late-layer", "fillColor")).toBe("#ff0000");

    expect(ui.intentStore.isUserSet("late-layer", "fillColor")).toBe(true);
  });

  it("resetLayerFill is a no-op for a registered layer with no Leaflet object", () => {
    manager.registerLayer({
      id: "canvas1",

      name: "Canvas",

      canvas: document.createElement("canvas"),
    });

    setIntent(ui, "canvas1", "fillColor", "#ff0000");

    ui.intentStore.seedProvenance("canvas1", ["fillColor"]);

    resetLayerFill(ui, "canvas1");

    expect(getIntent(ui, "canvas1", "fillColor")).toBeUndefined();

    expect(ui.intentStore.dumpProvenance()["canvas1"]).toBeUndefined();
  });

  it("resetLayerFill walks past a leaf with no setStyle or eachLayer", () => {
    const fixture = initWithFillLayer();

    fixture.fillLayer.leaves[1] = { options: {} } as never;

    commitNow(fixture.ui, "overlay1", "color", "#ff0000");

    expect(() => resetLayerFill(fixture.ui, "overlay1")).not.toThrow();
  });

  it("captureBase falls back to Leaflet default when fillOpacity is unset too", () => {
    const fixture = initWithFillLayer();

    delete fixture.fillLayer.leaves[0].options.fillColor;

    delete fixture.fillLayer.leaves[0].options.fillOpacity;

    commitNow(fixture.ui, "overlay1", "color", "#ff0000");

    resetLayerFill(fixture.ui, "overlay1");

    // No authored color or opacity — reset restores the Leaflet color

    // fallback and the 0.2 fillOpacity default, both explicit so the user's

    // written values cannot linger (setStyle merges, it does not delete).

    expect(fixture.fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#3388ff",

      fillOpacity: 0.2,

      fill: true,
    });
  });

  it("bindFillRow tolerates a row without either control", () => {
    // Defensive: the row builder always emits both inputs, but a foreign or

    // partial row must not throw when bound.

    const row = document.createElement("div");

    expect(() => bindFillRow(ui, "overlay1", row)).not.toThrow();
  });

  // ─────────────────── panel integration ───────────────────

  it("changing the swatch commits the color through the live binder", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const input = fillInput(item)!;

    input.value = "#3366cc";

    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillColor")).toBe("#3366cc");

    expect(ui.intentStore.isUserSet("overlay1", "fillColor")).toBe(true);
  });

  it("the fill opacity input commits through the live binder", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const input = item.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;

    input.value = "50";

    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillOpacity")).toBe(0.5);

    expect(ui.intentStore.isUserSet("overlay1", "fillOpacity")).toBe(true);
  });

  it("the swatch keeps the value it was committed (no forced re-read)", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const input = fillInput(item)!;

    input.value = "#3366cc";

    input.dispatchEvent(new Event("input", { bubbles: true }));

    // The input is not rewritten by the commit pass — the value stays put

    // so the picker position is not reset while the user is holding it.

    expect(input.value).toBe("#3366cc");
  });

  // ─────────────────── reset ───────────────────

  it("resetLayerFill drops the persisted entry and the override marker", () => {
    setIntent(ui, "overlay1", "fillColor", "#ff0000");

    ui.intentStore.seedProvenance("overlay1", ["fillColor"]);

    const setLayer = vi.spyOn(manager.persistence, "schedule");

    resetLayerFill(ui, "overlay1");

    expect(getIntent(ui, "overlay1", "fillColor")).toBeUndefined();

    expect(ui.intentStore.isUserSet("overlay1", "fillColor")).toBe(false);

    expect(setLayer).toHaveBeenCalled();
  });

  it("resetLayerFill restores the authored fill color on each leaf", () => {
    // First commit captures each leaf's authored base.

    commitNow(ui, "overlay1", "color", "#ff0000");

    resetLayerFill(ui, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#aabbcc",

      fillOpacity: 0.5,

      fill: true,
    });

    expect(fillLayer.leaves[1].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#aabbcc",

      fillOpacity: 0.7,

      fill: true,
    });
  });

  it("resetLayerFill restores the author's fill flag, including fill:false", () => {
    // Write forces fill:true so the user's color is visible; Reset must put

    // the author's original fill:false back — leaving fill:true would paint

    // a fill nobody authored (border fix's fill twin).

    fillLayer.leaves[0].options.fill = false;

    fillLayer.leaves[1].options.fill = false;

    commitNow(ui, "overlay1", "color", "#ff0000");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#ff0000",

      fill: true,
    });

    fillLayer.leaves[0].setStyle.mockClear();

    fillLayer.leaves[1].setStyle.mockClear();

    resetLayerFill(ui, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#aabbcc",

      fillOpacity: 0.5,

      fill: false,
    });

    expect(fillLayer.leaves[1].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#aabbcc",

      fillOpacity: 0.7,

      fill: false,
    });
  });

  it("resetLayerFill restores the Leaflet default when options.fillColor was unset", () => {
    delete fillLayer.leaves[0].options.fillColor;

    commitNow(ui, "overlay1", "color", "#ff0000");

    resetLayerFill(ui, "overlay1");

    // No authored color — the fallback is Leaflet's own default.

    expect(fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#3388ff",

      fillOpacity: 0.5,

      fill: true,
    });
  });

  it("reset on a missing layer id is a no-op", () => {
    expect(() => resetLayerFill(ui, "ghost")).not.toThrow();
  });

  it("the panel's Reset button restores the fill color", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const input = fillInput(item)!;

    input.value = "#ff0000";

    input.dispatchEvent(new Event("input", { bubbles: true }));

    const reset = item.querySelector(".foliplus-style-reset-btn")!;

    reset.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "fillColor")).toBeUndefined();

    expect(ui.intentStore.isUserSet("overlay1", "fillColor")).toBe(false);
  });
});
