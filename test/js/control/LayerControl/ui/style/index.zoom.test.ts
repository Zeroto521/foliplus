// test/js/control/LayerControl/ui/style/index.zoom — zoom-range rows and live capability refresh.
import { GridLayer, findItem, initFixture } from "../fixture.js";
import { fillPct, keepBubble, restoreBubble } from "./index.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIM } from "#core/layer/index.js";
import { SLIDER_CLASS, sliderOf } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { applyProjection } from "#control/LayerControl/ui/apply.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  getIntent,
  seedIntentMap,
  setIntent,
} from "#control/LayerControl/ui/intent.js";
import { renderDelegatedStylePanel } from "#control/LayerControl/ui/style/delegated.js";
import { resetLayerOpacity } from "#control/LayerControl/ui/style/opacity.js";
import { getDimension } from "#control/LayerControl/ui/style/registry.js";
import { resetLayerZoomRange } from "#control/LayerControl/ui/style/zoomRange.js";

describe("LayerUI style panel — zoom range", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    restoreBubble();
    ({ manager, ui, map } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    keepBubble();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const panelOf = (item: HTMLElement): HTMLElement | undefined =>
    (item.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`) as HTMLElement | null) ??
    undefined;

  const zoomRowOf = (panel: HTMLElement): HTMLElement | null =>
    panel.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`);

  /** The primitive's host inside a zoom-range row. */
  const zoomHostOf = (row: HTMLElement): HTMLElement =>
    row.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_CONTROL}`) as HTMLElement;

  const zoomSliderOf = (row: HTMLElement) => sliderOf(zoomHostOf(row))!;

  const thumbOf = (row: HTMLElement, index: number): HTMLElement =>
    zoomHostOf(row).querySelectorAll<HTMLElement>(".foliplus-slider-thumb")[index];

  /** A real keyboard press on a thumb — the path the primitive listens on. */
  const press = (el: HTMLElement, key: string): void => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  };

  /** The live value bubble (is-on) for the focused thumb, or the first
   *  bubble node if no live one exists. With the anchor-keyed pool a stale
   *  parked node may precede the live one in DOM order, so a bare
   *  querySelector could read a fading node's text instead of the live one. */
  const bubbleOf = (): HTMLElement | null =>
    document.querySelector(".foliplus-slider-bubble.is-on") ??
    document.querySelector(".foliplus-slider-bubble");

  it("renders the zoom-range row for a pane-capable layer", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel);
    expect(row).not.toBeNull();
  });

  it("renders the fill, three dots, two handles and the values row", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    const host = zoomHostOf(row);

    expect(host.classList.contains(SLIDER_CLASS.ROOT)).toBe(true);
    expect(host.dataset.mode).toBe("range");
    expect(host.querySelector(".foliplus-slider-fill")).not.toBeNull();
    expect(host.querySelectorAll(".foliplus-slider-dot")).toHaveLength(3);
    expect(host.querySelectorAll(".foliplus-slider-thumb")).toHaveLength(2);

    const values = host.querySelector(".foliplus-slider-values") as HTMLElement;
    expect(values.querySelector(".foliplus-slider-value-min")?.textContent).toBe("0");
    expect(values.querySelector(".foliplus-slider-value-max")?.textContent).toBe("18");
    const current = values.querySelector(
      ".foliplus-slider-value-current",
    ) as HTMLElement;
    expect(current.textContent).toBe("5");
    expect(thumbOf(row, 0).getAttribute("aria-label")).toBe(
      ui.T("style_zoom_range_min"),
    );
    expect(thumbOf(row, 1).getAttribute("aria-label")).toBe(
      ui.T("style_zoom_range_max"),
    );
  });

  it("shows out-of-range class when current zoom is outside the range", () => {
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [0, 3]);
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE)).toBe(
      true,
    );
  });

  it("does not show out-of-range class when current zoom is inside the range", () => {
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [0, 18]);
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE)).toBe(
      false,
    );
  });

  it("moving a thumb updates map state and the visual row (live pass)", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;

    zoomSliderOf(row).setValue([5, 18]);

    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([5, 18]);
    expect(thumbOf(row, 0).getAttribute("aria-valuenow")).toBe("5");
    expect(thumbOf(row, 0).getAttribute("aria-valuemax")).toBe("18");
  });

  it("commit persists the range to localStorage", () => {
    vi.useFakeTimers();
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;

    zoomSliderOf(row).setValue([5, 18]);
    zoomSliderOf(row).commit();

    vi.advanceTimersByTime(400);
    const stored = JSON.parse(
      window.localStorage.getItem(CONST.STORAGE.KEY) ?? "{}",
    ).data;
    expect(stored.layers?.overlay1?.overrides).toContain("zoomRange");
    expect(stored.layers?.overlay1?.zoomRange).toEqual([5, 18]);
    vi.useRealTimers();
  });

  it("slides a collapsed pair as one instead of dead-locking", () => {
    // Both thumbs start on 10. Moving one toward the other must carry the
    // pair — clamping here would leave the value unable to move one way.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    zoomSliderOf(row).setValue([10, 10], { silent: true });

    press(thumbOf(row, 0), "ArrowRight");
    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([11, 11]);
    expect(zoomSliderOf(row).value).toEqual([11, 11]);

    press(thumbOf(row, 1), "ArrowLeft");
    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([10, 10]);
  });

  it("clamps a normal range at its neighbour instead of crossing", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    zoomSliderOf(row).setValue([5, 9], { silent: true });

    for (let index = 0; index < 4; index += 1) {
      press(thumbOf(row, 0), "ArrowRight");
    }
    // Four steps land the lower thumb on the upper one.
    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([9, 9]);

    // Once collapsed, the next step carries both thumbs.
    press(thumbOf(row, 0), "ArrowRight");
    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([10, 10]);
  });

  it("clamps zoom values to map bounds", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;

    zoomSliderOf(row).setValue([-5, 10]);

    const range = getIntent(ui, "overlay1", "zoomRange");
    expect(range![0]).toBeGreaterThanOrEqual(0);
    expect(zoomSliderOf(row).value).toEqual([0, 10]);
  });

  it("moves the current dot on zoomend", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    const before = row.querySelector<HTMLElement>(".foliplus-slider-dot-current")!.style
      .left;

    map.getZoom.mockReturnValue(12);
    ui.onZoomEnd?.();

    // setMarks rebuilds the dots when the current level moves, so the live
    // node is the new one, not the reference captured before the event.
    const after = row.querySelector(".foliplus-slider-dot-current") as HTMLElement;
    expect(after.style.left).not.toBe(before);
  });

  it("updates values row on zoomend", () => {
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [0, 18]);
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    const current = row.querySelector(".foliplus-slider-value-current") as HTMLElement;
    const beforeCurrent = current.textContent;

    map.getZoom.mockReturnValue(12);
    ui.onZoomEnd?.();

    const afterCurrent = row.querySelector(
      ".foliplus-slider-value-current",
    ) as HTMLElement;
    expect(afterCurrent.textContent).toBe("12");
    expect(beforeCurrent).not.toBe(afterCurrent.textContent);
  });

  it("covers only the dots the selected range reaches", () => {
    // A range covers [min, max]: the 0 and 18 limit dots sit outside
    // [4, 9] and stay grey, while the current-zoom dot at 5 is inside.
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [4, 9]);
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    const dotAt = (at: number): HTMLElement =>
      row.querySelector(`.foliplus-slider-dot[data-at="${at}"]`) as HTMLElement;

    expect(dotAt(0).classList.contains("foliplus-slider-dot-covered")).toBe(false);
    expect(dotAt(5).classList.contains("foliplus-slider-dot-covered")).toBe(true);
    expect(dotAt(18).classList.contains("foliplus-slider-dot-covered")).toBe(false);
  });

  it("leaves the current dot grey when it sits outside the range", () => {
    const item = findItem(ui, "overlay1");
    // Current zoom is 5; the range starts above it.
    setIntent(ui, "overlay1", "zoomRange", [7, 10]);
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    const currentDot = (): HTMLElement =>
      row.querySelector(".foliplus-slider-dot-current") as HTMLElement;
    expect(currentDot().classList.contains("foliplus-slider-dot-covered")).toBe(false);

    // A range that covers the current level lights the same dot.
    zoomSliderOf(row).setValue([0, 10]);
    expect(currentDot().classList.contains("foliplus-slider-dot-covered")).toBe(true);
  });

  it("renders the zoom-range row for a canvas layer", () => {
    // A canvas has no Leaflet layer to add/remove, so the range's carrier is
    // the canvas's `HIDDEN` class — the executor's visible op is the carrier
    // for every surface, so capability alone decides (42.1).
    manager.registerLayer({
      id: "canvas1",
      name: "Canvas",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    const panel = renderDelegatedStylePanel(ui, "canvas1");
    expect(panel).not.toBeNull();
    expect(zoomRowOf(panel!)).not.toBeNull();
  });

  it("hides a canvas layer through its HIDDEN class when the range excludes the zoom", () => {
    const canvas = document.createElement("canvas");
    manager.registerLayer({
      id: "canvas1",
      name: "Canvas",
      canvas,
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "canvas1");
    ui.openStylePanel("canvas1");
    const row = zoomRowOf(panelOf(item)!)!;

    // The current zoom is 5. Pushing the lower bound past it takes the canvas
    // out of range, and its HIDDEN class is what hides it.
    zoomSliderOf(row).setValue([6, 18]);
    expect(getIntent(ui, "canvas1", "zoomRange")).toEqual([6, 18]);
    expect(canvas.classList.contains("hidden")).toBe(true);

    // Dragging the bound back drops it again — the write is reversible.
    zoomSliderOf(row).setValue([0, 18]);
    expect(getIntent(ui, "canvas1", "zoomRange")).toEqual([0, 18]);
    expect(canvas.classList.contains("hidden")).toBe(false);
  });

  it("gives a delegated layers-kind layer (Measure shape) a zoom row that hides it", () => {
    // Measure's createLayers shape: a real layer, so the range's carrier is map
    // membership rather than a canvas HIDDEN class.
    const measureLayer = { options: {}, eachLayer: vi.fn() } as never;
    manager.registerLayer({
      id: "measure1",
      name: "Measure",
      layer: measureLayer,
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "measure1");
    ui.openStylePanel("measure1");
    const row = zoomRowOf(panelOf(item)!)!;

    zoomSliderOf(row).setValue([6, 18]);

    expect(getIntent(ui, "measure1", "zoomRange")).toEqual([6, 18]);
    expect(map.removeLayer).toHaveBeenCalledWith(measureLayer);
  });

  it("gives the fixture's tile base layer a zoom row: the GridLayer native min/maxZoom is the carrier", () => {
    // The old `li.role !== "base"` blanket was dropped; the fixture's base1 is
    // a TileLayer (GridLayer subclass) whose options.minZoom/maxZoom are the
    // honest carrier, so the row now renders for it just like any overlay.
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const panel = panelOf(item)!;
    if (!panel) return;
    const row = zoomRowOf(panel);
    expect(row).not.toBeNull();
  });

  it("reset button clears zoom range and restores full map range", () => {
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [5, 15]);
    ui.intentStore.seedProvenance("overlay1", ["zoomRange"]);
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const resetBtn = panel.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    resetBtn.click();

    expect(getIntent(ui, "overlay1", "zoomRange")).toBeUndefined();
    expect(ui.intentStore.dumpProvenance()["overlay1"]).toBeUndefined();
  });

  it("zoomToPct returns 0 when map min equals max (degenerate range)", () => {
    map.getMinZoom.mockReturnValue(7);
    map.getMaxZoom.mockReturnValue(7);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(row).not.toBeNull();
  });

  it("renders zoom-range row when map has a single zoom level", () => {
    map.getMinZoom.mockReturnValue(3);
    map.getMaxZoom.mockReturnValue(3);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(row).not.toBeNull();
    expect(zoomSliderOf(row).value).toEqual([3, 3]);
    expect(thumbOf(row, 0).getAttribute("aria-valuenow")).toBe("3");
    expect(thumbOf(row, 1).getAttribute("aria-valuenow")).toBe("3");
  });

  it("delegated panel includes zoom-range row when capability is present", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const hasRow = panel.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`);
    expect(hasRow).not.toBeNull();
  });

  it("the live pass paints the opacity fill and floats the value", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    const slider = sliderOf(host)!;

    slider.setValue(40);

    // The live pass moves the fill ...
    const fill = host.querySelector(".foliplus-slider-fill") as HTMLElement;
    expect(fillPct(fill)).toBeCloseTo(0.4);

    // ... and the bubble is the singleton portaled to <body>, shown once the
    // thumb has focus (the same path a keyboard user takes).
    const thumb = host.querySelector(".foliplus-slider-thumb") as HTMLElement;
    thumb.focus();
    let bubble = bubbleOf();
    expect(bubble).not.toBeNull();
    expect(bubble!.hidden).toBe(false);
    expect(bubble!.textContent).toBe("40");

    // A second live pass updates that one bubble instead of stacking another.
    slider.setValue(60);
    expect(document.querySelectorAll(".foliplus-slider-bubble")).toHaveLength(1);
    bubble = bubbleOf();
    expect(bubble!.textContent).toBe("60");

    // Blur is the release path.
    thumb.blur();
    expect(bubble!.classList.contains("is-on")).toBe(false);
  });

  it("a single-level map yields a zero percentage rather than NaN", () => {
    map.getMinZoom.mockReturnValue(7);
    map.getMaxZoom.mockReturnValue(7);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;

    zoomSliderOf(row).setValue([7, 7]);

    const values = row.querySelector(".foliplus-slider-values")!;
    expect(values.textContent).not.toMatch(/NaN/);
    expect(thumbOf(row, 0).style.left).toBe("0%");
  });

  it("keeps working when the row has lost its marks and current label", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;

    // The primitive caches the nodes it paints while syncing, so removing
    // them must not throw — a row a consumer emptied (or a stale panel) still
    // answers a value change.
    row.querySelector(".foliplus-slider-marks")?.remove();
    row.querySelector(".foliplus-slider-value-current")?.remove();

    expect(() => {
      zoomSliderOf(row).setValue([4, map.getMaxZoom()]);
      zoomSliderOf(row).commit();
    }).not.toThrow();
    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([4, map.getMaxZoom()]);
  });

  it("the zoom-range live pass updates the map and the bubble", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;

    zoomSliderOf(row).setValue([0, 10]);

    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([0, 10]);
    const thumb = thumbOf(row, 1);
    thumb.focus();
    const bubble = bubbleOf()!;
    expect(bubble).not.toBeNull();
    expect(bubble.textContent).toBe("10");
    expect(bubble.classList.contains("is-on")).toBe(true);

    thumb.blur();
    expect(bubble.classList.contains("is-on")).toBe(false);
  });

  it("OOR state marks the row when current zoom is outside range", () => {
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [7, 10]);
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;

    // Current zoom (5) is outside [7, 10] — out-of-range state should be active.
    expect(row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE)).toBe(
      true,
    );
    expect(row.title).toContain("style_zoom_range_out_of_range");
  });

  it("out-of-range sync clears the class when zoom returns inside range", () => {
    const item = findItem(ui, "overlay1");
    setIntent(ui, "overlay1", "zoomRange", [7, 10]);
    ui.openStylePanel("overlay1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE)).toBe(
      true,
    );

    // Move the range to cover current zoom (5) — OOR clears.
    zoomSliderOf(row).setValue([0, 10]);

    expect(row.classList.contains(CONST.CLASSES.STYLE_ZOOM_RANGE_OUT_OF_RANGE)).toBe(
      false,
    );
    expect(row.title).toContain("style_zoom_range_current");
  });

  it("renders no Layer rows for a delegated layer that carries neither", () => {
    // MarkerCluster duck: opacity "none" and zoomRange "none". The delegated
    // label controls are the panel's whole content — the Layer section has
    // nothing to put in it.
    manager.registerLayer({
      id: "cluster3",
      name: "Cluster3",
      layer: { options: {}, eachLayer: vi.fn(), _topClusterLevel: {} } as never,
      styleProvider: () => ({ labelShow: true, labelSize: 14, labelColor: "#ff0000" }),
      styleSetters: { labelShow: vi.fn(), labelSize: vi.fn(), labelColor: vi.fn() },
    });
    const item = findItem(ui, "cluster3");
    ui.openStylePanel("cluster3");
    const panel = panelOf(item)!;

    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).toBeNull();
    expect(zoomRowOf(panel)).toBeNull();
    expect(
      panel.querySelector(`.${CONST.CLASSES.STYLE_LABEL_SIZE_INPUT}`),
    ).not.toBeNull();
  });

  it("still commits when the opacity row has lost its rail and fill", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    const slider = sliderOf(host)!;

    // The thumb outlives the rail it was drawn in, and the rail took the fill
    // with it. Neither ornament carries the value — the slider instance does,
    // so the write still has to land.
    host.querySelector(".foliplus-slider-rail")?.remove();
    slider.setValue(30);

    expect(host.querySelector(".foliplus-slider-fill")).toBeNull();
    expect(li.opacity).toBe(0.3);
  });

  it("resets the range when the row has lost a thumb", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    setIntent(ui, "overlay1", "zoomRange", [4, 9]);
    row.querySelector('.foliplus-slider-thumb[data-index="1"]')?.remove();

    // The reset pass syncs the row's remaining marks, so a missing thumb has
    // to be skipped rather than dereferenced — and the refresh still has to
    // rebuild the panel at the end of the handler.
    const reset = panel.querySelector(".foliplus-style-reset-btn")!;
    reset.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(getIntent(ui, "overlay1", "zoomRange")).toBeUndefined();
    expect(panelOf(item)).toBeDefined();
  });

  it("skips a layer that was unregistered mid-drag", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const row = zoomRowOf(panel)!;
    const thumb = thumbOf(row, 0);

    zoomSliderOf(row).setValue([4, 18]);
    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([4, 18]);

    // The row outlives its layer: nothing is left to write the range into, so
    // the live pass has to bail instead of writing a range for a ghost.
    manager.unregisterLayer("overlay1");
    press(thumb, "ArrowRight");
    press(thumb, "ArrowRight");

    expect(getIntent(ui, "overlay1", "zoomRange")).toEqual([4, 18]);
  });

  it("gives a delegated layer a zoom row when only opacity is unavailable", () => {
    manager.registerLayer({
      id: "rangeOnly",
      name: "RangeOnly",
      layer: { options: {}, eachLayer: vi.fn() },
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    // `detectCapabilities` never returns an opacity-less surface that can still
    // carry a zoom range, so the two gates' independence is pinned by hand: each
    // row answers to its own capability, never to its neighbor's.
    const li = manager.layerRegistry.get("rangeOnly")!;
    manager.surfaceFor(li).capabilities.opacity = "none";

    const item = findItem(ui, "rangeOnly");
    ui.openStylePanel("rangeOnly");
    const panel = panelOf(item)!;

    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).toBeNull();
    expect(zoomRowOf(panel)).not.toBeNull();
  });

  it("gives an label layer a zoom row when only opacity is unavailable", () => {
    // Same split, label flavour: the panel still offers the zoom range.
    manager.registerLayer({
      id: "annotOnly",
      name: "AnnotOnly",
      layer: { options: {}, eachLayer: vi.fn() },
    });
    ui.runtimeStore.setFields("annotOnly", [{ name: "count", numeric: true }]);
    const li = manager.layerRegistry.get("annotOnly")!;
    manager.surfaceFor(li).capabilities.opacity = "none";

    const item = findItem(ui, "annotOnly");
    ui.openStylePanel("annotOnly");
    const panel = panelOf(item)!;

    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).toBeNull();
    expect(zoomRowOf(panel)).not.toBeNull();
  });

  // The two slider ends read the layer's author-declared bounds from the
  // WeakMap snapshot in apply.ts, not from `layer.options.maxZoom` (or
  // minZoom) directly — the map's max can change after the bounds are
  // frozen, and the slider must track the author's declaration, not the
  // map's current state. The tests below cover the freeze, the finite
  // fallback when the layer declares nothing, and the persistence-replay
  // path.
  it("the slider's max bound is the layer's declared maxZoom, not the map's", () => {
    const li = manager.layerRegistry.get("base1")!;
    (li.layer!.options as { maxZoom?: number }).maxZoom = 15;
    map.getMaxZoom.mockReturnValue(18);
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(thumbOf(row, 1).getAttribute("aria-valuemax")).toBe("15");
  });

  it("does not ratchet the slider's max when the map derives from the write", () => {
    // If dispatchStateOp wrote layer.options.maxZoom, Leaflet would derive
    // the map's max from the layer's max, and the map's max would drop to
    // the last drag. The WeakMap snapshot prevents the slider from
    // re-reading the polluted value. The mock simulates the pollution.
    const li = manager.layerRegistry.get("base1")!;
    (li.layer!.options as { maxZoom?: number }).maxZoom = 15;
    map.getMaxZoom.mockReturnValue(18);
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(thumbOf(row, 1).getAttribute("aria-valuemax")).toBe("15");

    zoomSliderOf(row).setValue([0, 10]);
    // Polluted map max after the drag — the ratchet case.
    map.getMaxZoom.mockReturnValue(10);
    (ui.c as any).onZoomend?.();
    // Reopen the panel and check the bound has not been narrowed.
    ui.closeStylePanel?.(false);
    ui.openStylePanel("base1");
    const newRow = zoomRowOf(panelOf(item)!)!;
    expect(thumbOf(newRow, 1).getAttribute("aria-valuemax")).toBe("15");
  });

  it("falls back to a finite max when the layer and the map both declare none", () => {
    // A bare TileLayer without options.maxZoom reports Infinity from
    // map.getMaxZoom() in real Leaflet. The values row would print the
    // literal string "Infinity" and the slider would have an unbounded
    // right end; both are fixed by the finite fallback.
    const li = manager.layerRegistry.get("base1")!;
    delete (li.layer!.options as { maxZoom?: number }).maxZoom;
    map.getMaxZoom.mockReturnValue(Infinity);
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const row = zoomRowOf(panelOf(item)!)!;
    const max = thumbOf(row, 1).getAttribute("aria-valuemax");
    expect(max).not.toBe("Infinity");
    expect(Number(max)).toBe(20);
    const maxLabel = row.querySelector(".foliplus-slider-value-max") as HTMLElement;
    expect(maxLabel.textContent).not.toBe("Infinity");
  });

  it("the slider's min bound is the layer's declared minZoom, not the map's", () => {
    const li = manager.layerRegistry.get("base1")!;
    (li.layer!.options as { minZoom?: number }).minZoom = 2;
    map.getMinZoom.mockReturnValue(0);
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(thumbOf(row, 0).getAttribute("aria-valuemin")).toBe("2");
  });

  it("does not ratchet the slider's min when the map derives from the write", () => {
    const li = manager.layerRegistry.get("base1")!;
    (li.layer!.options as { minZoom?: number }).minZoom = 3;
    map.getMinZoom.mockReturnValue(0);
    const item = findItem(ui, "base1");
    ui.openStylePanel("base1");
    const row = zoomRowOf(panelOf(item)!)!;
    expect(thumbOf(row, 0).getAttribute("aria-valuemin")).toBe("3");

    zoomSliderOf(row).setValue([7, 18]);
    map.getMinZoom.mockReturnValue(7);
    ui.closeStylePanel?.(false);
    ui.openStylePanel("base1");
    const newRow = zoomRowOf(panelOf(item)!)!;
    expect(thumbOf(newRow, 0).getAttribute("aria-valuemin")).toBe("3");
  });

  it("persistence replay: slider bounds are the author's declared range, not the persisted zoomRange", () => {
    // On reload, applyUserState fires applyProjection before any panel opens.
    // The zoomRange resolves through the visible op — no write to
    // layer.options — so the author's declared bounds are never mutated.
    // The slider reads them on first panel open via the WeakMap snapshot.
    const gridLayer = new GridLayer();
    (gridLayer as unknown as { setOpacity: unknown }).setOpacity = vi.fn();
    manager.registerLayer({
      id: "grid1",
      name: "Grid",
      role: "overlay",
      layer: gridLayer,
    });
    // Author declared no maxZoom: the fallback is the map's declared max.
    setIntent(ui, "grid1", "zoomRange", [0, 10]);
    applyProjection(ui, "grid1");
    // The layer's options are untouched — the zoomRange did not write.
    expect((gridLayer.options as { maxZoom?: number }).maxZoom).toBeUndefined();
    const item = findItem(ui, "grid1");
    ui.openStylePanel("grid1");
    const row = zoomRowOf(panelOf(item)!)!;
    // The author declared no max, so it fell back to the map's 18 —
    // not the persisted zoomRange value of 10.
    expect(Number(thumbOf(row, 1).getAttribute("aria-valuemax"))).toBe(18);
  });
});

describe("reset on an id the registry does not know", () => {
  it("resetLayerOpacity returns before touching state", () => {
    // `if (!ui.c.layerRegistry.has(layerId)) return` — a Reset aimed at a
    // layer that has already left must not rewrite the record or save.
    const { ui } = initFixture({});
    setIntent(ui, "ghost", "opacity", 0.4);
    ui.intentStore.seedProvenance("ghost", ["opacity"]);
    expect(() => resetLayerOpacity(ui, "ghost")).not.toThrow();
    expect(getIntent(ui, "ghost", "opacity")).toBe(0.4);
    expect(ui.intentStore.dumpProvenance().ghost).toEqual(["opacity"]);
  });

  it("resetLayerZoomRange returns before touching state", () => {
    const { ui } = initFixture({});
    setIntent(ui, "ghost", "zoomRange", [3, 12]);
    ui.intentStore.seedProvenance("ghost", ["zoomRange"]);
    expect(() => resetLayerZoomRange(ui, "ghost")).not.toThrow();
    expect(getIntent(ui, "ghost", "zoomRange")).toEqual([3, 12]);
    expect(ui.intentStore.dumpProvenance().ghost).toEqual(["zoomRange"]);
  });
});

describe("reset whose dimension reports no delta", () => {
  // `reset?` is typed `ProjectionDelta | void`: a dimension runs its own side
  // effects and is free to report nothing back. Both entry points fall back to
  // the empty delta for that case, so the publish contract still holds — a
  // reset that cannot say what moved announces nothing.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resetLayerOpacity returns the empty delta", () => {
    const { ui } = initFixture({});
    const descriptor = getDimension(DIM.OPACITY)!;
    const resetSpy = vi.spyOn(descriptor, "reset").mockReturnValue(undefined);

    expect(resetLayerOpacity(ui, "overlay1")).toEqual({
      wroteVisible: false,
      intentMoved: false,
    });
    expect(resetSpy).toHaveBeenCalledWith(ui, "overlay1");
  });

  it("resetLayerZoomRange returns the empty delta", () => {
    const { ui } = initFixture({});
    const descriptor = getDimension(DIM.ZOOM_RANGE)!;
    const resetSpy = vi.spyOn(descriptor, "reset").mockReturnValue(undefined);

    expect(resetLayerZoomRange(ui, "overlay1")).toEqual({
      wroteVisible: false,
      intentMoved: false,
    });
    expect(resetSpy).toHaveBeenCalledWith(ui, "overlay1");
  });
});

// ── Capability live refresh ─────────────────────────────────────
// The style panel gates its rows on the surface capability projection when it
// is built, so a recovery must reach a panel that is already open. The
// controller announces projection changes at the tail of every ordering pass
// (LAYER_CAPABILITY_CHANGED) and the open drawer re-renders from the fresh
// projection.

describe("style panel live capability refresh", () => {
  /** A container whose children can change under the surface, with Leaflet's
   *  membership shape (eachLayer / addLayer / removeLayer / hasLayer). */
  const mutableGroup = (children: unknown[] = []) => {
    const group = {
      options: {} as Record<string, unknown>,
      children,
      eachLayer(fn: (child: unknown) => void) {
        for (const child of group.children) fn(child);
      },
      addLayer(layer: unknown) {
        group.children.push(layer);
        return group;
      },
      removeLayer(layer: unknown) {
        group.children = group.children.filter(child => child !== layer);
        return group;
      },
      hasLayer(layer: unknown) {
        return group.children.includes(layer);
      },
    };
    return group as unknown as L.Layer & { children: unknown[] };
  };

  it("re-renders an open panel when the capability recovers", () => {
    const { manager, ui } = initFixture({ data: [] });
    const group = mutableGroup([new window.L.Path()]);
    manager.registerLayer({
      id: "recover1",
      name: "Recover",
      role: "overlay",
      layer: group,
    });
    // Seed the capability snapshot with the healthy projection (first sight is
    // recorded silently) before the degrade, so the recovery is a real diff.
    manager.enforceOrder();
    const surface = manager.surfaceFor(manager.layerRegistry.get("recover1")!);
    expect(surface.capabilities.opacity).toBe("pane");
    const item = findItem(ui, "recover1");

    // A leaf no migrator can relocate: a pane opacity write would fade part of
    // the layer and miss the rest, so the axis must degrade.
    const foreign = { options: {}, getElement: () => document.createElement("div") };
    group.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();
    expect(surface.capabilities.opacity).toBe("none");

    ui.openStylePanel("recover1");
    expect(ui.overlayPanel.stylePanelLayerId).toBe("recover1");
    expect(item.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).toBeNull();

    // The foreign leaf leaves. A pass re-derives the projection; the panel that
    // is open right now must show the recovered row without a close/reopen.
    manager.onLayerRemove({ layer: foreign } as never);
    group.removeLayer(foreign);
    manager.enforceOrder();

    expect(surface.capabilities.opacity).toBe("pane");
    expect(ui.overlayPanel.stylePanelLayerId).toBe("recover1");
    expect(item.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).not.toBeNull();

    // The other direction too: a degrade while the panel is open drops the
    // row instead of leaving a control that would write into a foreign tree.
    group.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();
    expect(surface.capabilities.opacity).toBe("none");
    expect(ui.overlayPanel.stylePanelLayerId).toBe("recover1");
    expect(item.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).toBeNull();
  });
});
