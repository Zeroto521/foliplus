import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerManager } from "#foliplus/LayerControl/manager.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  applyFillToLayer,
  buildFillRow,
  commitFillColor,
  layerCanFill,
  resetLayerFill,
} from "#foliplus/LayerControl/ui/style/fill.js";
import { findItem, initFixture } from "../fixture.js";

/** A layer duck with a real setStyle spy and a set of child leaves each with
 *  their own setStyle. The parent's eachLayer callback dispatches to each
 *  child, matching how Leaflet LayerGroup.setStyle walks its tree. */
const makeFillableLayer = () => {
  const leaves: {
    options: { fillColor?: string; fillOpacity?: number };
    setStyle: ReturnType<typeof vi.fn>;
  }[] = [
    { options: { fillColor: "#aabbcc", fillOpacity: 0.5 }, setStyle: vi.fn() },
    { options: { fillColor: "#ddeeff", fillOpacity: 0.7 }, setStyle: vi.fn() },
  ];
  const parent = {
    options: {},
    eachLayer: vi.fn((fn: (child: unknown) => void) =>
      leaves.forEach(child => fn(child)),
    ),
    getBounds: vi.fn(() => ({
      isValid: vi.fn(() => true),
      getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),
      getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
    })),
    leaves,
  };
  return parent as unknown as L.Layer & { leaves: typeof leaves };
};

/** Build a LayerManager/UI fixture with a real fillable overlay layer
 *  registered under `overlay1`, replacing the fixture's bare polygon duck. */
const initWithFillLayer = () => {
  const fillLayer = makeFillableLayer();
  const { manager, ui, map } = initFixture({
    data: [
      {
        id: "overlay1",
        name: "Polygons",
        isBase: false,
        layer: fillLayer,
      },
      {
        id: "base1",
        name: "OSM",
        isBase: true,
        layer: { options: {}, setZIndex: vi.fn() } as never,
        paneName: "tilePane",
      },
    ],
  });
  ui.fieldCache.set("overlay1", [{ name: "count", numeric: true }]);
  return { manager, ui, map, fillLayer };
};

describe("LayerUI style panel — fill colour", () => {
  let manager: LayerManager;
  let ui: LayerUI;
  let map: any;

  let fillLayer: ReturnType<typeof makeFillableLayer>;

  beforeEach(() => {
    const fixture = initWithFillLayer();
    manager = fixture.manager;
    ui = fixture.ui;
    map = fixture.map;
    fillLayer = fixture.fillLayer;
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const panelOf = (item: HTMLElement): HTMLElement | undefined =>
    (item.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`) as HTMLElement | null) ??
    undefined;

  const fillRow = (item: HTMLElement): HTMLElement | null =>
    item.querySelector(`.${CONST.CLASSES.STYLE_FILL_ROW}`);

  const fillInput = (item: HTMLElement): HTMLInputElement | null =>
    item.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`);

  // ─────────────────── row rendering ───────────────────

  it("renders the fill row for a fillable vector layer", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    expect(fillRow(item)).not.toBeNull();
    expect(fillInput(item)).not.toBeNull();
    expect(fillInput(item)!.type).toBe("color");
  });

  it("the fill row's aria-label comes from the scoped translator", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    expect(fillInput(item)!.getAttribute("aria-label")).toBe("LayerControl.style_fill");
  });

  it("the fill row's label matches the row's aria-label key", () => {
    // Same key twice keeps label text and screen-reader name honest.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const row = fillRow(item)!;
    const labelText = row.querySelector(`.${CONST.CLASSES.FORM_LABEL}`)!.textContent;
    expect(labelText).toBe(fillInput(item)!.getAttribute("aria-label"));
  });

  it("the swatch defaults to the authored paint when no fill is committed", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    expect(fillInput(item)!.value).toBe("#000000");
  });

  it("reopening the panel seeds the swatch from fillColorMap", () => {
    ui.fillColorMap["overlay1"] = "#ff8800";

    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    expect(fillInput(item)!.value).toBe("#ff8800");
  });

  // ─────────────────── capability gate ───────────────────

  it("layerCanFill returns false for a canvas layer", () => {
    manager.registerLayer({
      id: "canvas1",
      name: "Heat",
      canvas: document.createElement("canvas"),
    });
    expect(layerCanFill(ui, "canvas1")).toBe(false);
  });

  it("layerCanFill returns false for a delegated (styleSetters) layer", () => {
    manager.registerLayer({
      id: "deleg1",
      name: "Delegated",
      layer: { options: {}, eachLayer: vi.fn() } as never,
      styleSetters: { labelShow: vi.fn() },
    });
    expect(layerCanFill(ui, "deleg1")).toBe(false);
  });

  it("layerCanFill returns false when the surface has no opacity carrier", () => {
    // MarkerCluster duck: `_topClusterLevel` triggers `opacity: "none"`.
    manager.registerLayer({
      id: "cluster1",
      name: "Cluster",
      layer: { options: {}, eachLayer: vi.fn(), _topClusterLevel: {} } as never,
    });
    expect(layerCanFill(ui, "cluster1")).toBe(false);
  });

  it("layerCanFill returns false when the surface has no zoom-range carrier", () => {
    // ImageOverlay duck: `opacity: "native"`, `zoomRange: "none"`. Even though
    // the surface can carry opacity, it is not a vector shape, so no fill.
    manager.registerLayer({
      id: "img1",
      name: "Img",
      layer: { options: {}, _url: "x" } as never,
    });
    const surface = manager.surfaceFor(manager.layerRegistry.get("img1")!);
    surface.capabilities.opacity = "native";
    surface.capabilities.zoomRange = "none";
    expect(layerCanFill(ui, "img1")).toBe(false);
  });

  it("layerCanFill returns false when the layer is not in the registry", () => {
    expect(layerCanFill(ui, "not-a-real-layer")).toBe(false);
  });

  it("the fill row is absent for a delegated drawer", () => {
    // Canvas + styleSetters → delegated drawer; even though the drawer has
    // its own Layer section, it excludes fill because LayerControl does not
    // own the write for a third-party layer.
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");
    expect(fillRow(item)).toBeNull();
  });

  it("the fill row is absent for a MarkerCluster surface", () => {
    manager.registerLayer({
      id: "cluster2",
      name: "Cluster2",
      layer: { options: {}, eachLayer: vi.fn(), _topClusterLevel: {} } as never,
    });
    ui.fieldCache.set("cluster2", [{ name: "count", numeric: true }]);
    const item = findItem(ui, "cluster2");
    ui.openStylePanel("cluster2");
    expect(fillRow(item)).toBeNull();
  });

  // ─────────────────── commit + persistence ───────────────────

  it("commitFillColor writes to the map, persists, and marks the override", () => {
    const setLayer = vi.spyOn(manager.persistence, "schedule");

    commitFillColor(ui, "overlay1", "#ff0000");

    expect(ui.fillColorMap["overlay1"]).toBe("#ff0000");
    expect(ui.userOverrides["overlay1"]).toContain("fillColor");
    expect(setLayer).toHaveBeenCalled();
    const fields = setLayer.mock.calls.at(-1)![0] as {
      layers: () => Record<string, { fillColor?: string; overrides?: string[] }>;
    };
    expect(fields.layers().overlay1.fillColor).toBe("#ff0000");
    expect(fields.layers().overlay1.overrides).toContain("fillColor");
  });

  it("commitFillColor normalises #rgb to #rrggbb before persisting", () => {
    commitFillColor(ui, "overlay1", "#f00");

    expect(ui.fillColorMap["overlay1"]).toBe("#ff0000");
  });

  it("commitFillColor no-ops when the value did not change", () => {
    ui.fillColorMap["overlay1"] = "#ff0000";
    const setLayer = vi.spyOn(manager.persistence, "schedule");

    commitFillColor(ui, "overlay1", "#ff0000");

    expect(setLayer).not.toHaveBeenCalled();
  });

  it("applyFillToLayer calls setStyle on every leaf with one it exposes", () => {
    applyFillToLayer(ui, "overlay1", "#123456");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
    });
    expect(fillLayer.leaves[1].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
    });
  });

  it("applyFillToLayer is a silent no-op for a layer with no leaves", () => {
    // §5.4: no honest write → do not persist a broken state. The gate
    // already prevents commit from reaching here for a non-vector layer,
    // but the walker itself must not throw on a group whose eachLayer
    // dispatches nothing.
    manager.registerLayer({
      id: "empty1",
      name: "Empty",
      layer: { options: {}, eachLayer: vi.fn() } as never,
    });
    expect(() => applyFillToLayer(ui, "empty1", "#123456")).not.toThrow();
  });

  it("applyFillToLayer is a no-op when the layer is not in the registry", () => {
    expect(() => applyFillToLayer(ui, "ghost", "#123456")).not.toThrow();
  });

  // ─────────────────── panel integration ───────────────────

  it("changing the swatch commits the colour through the live binder", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const input = fillInput(item)!;

    input.value = "#3366cc";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(ui.fillColorMap["overlay1"]).toBe("#3366cc");
    expect(ui.userOverrides["overlay1"]).toContain("fillColor");
  });

  it("the swatch keeps the value it was committed (no forced re-read)", () => {
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
    ui.fillColorMap["overlay1"] = "#ff0000";
    ui.userOverrides["overlay1"] = ["fillColor"];
    const setLayer = vi.spyOn(manager.persistence, "schedule");

    resetLayerFill(ui, "overlay1");

    expect(ui.fillColorMap["overlay1"]).toBeUndefined();
    expect(ui.userOverrides["overlay1"] ?? []).not.toContain("fillColor");
    expect(setLayer).toHaveBeenCalled();
  });

  it("resetLayerFill restores the authored fill colour on each leaf", () => {
    // First commit captures each leaf's authored base.
    commitFillColor(ui, "overlay1", "#ff0000");
    resetLayerFill(ui, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#aabbcc",
    });
    expect(fillLayer.leaves[1].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#ddeeff",
    });
  });

  it("resetLayerFill restores the Leaflet default when options.fillColor was unset", () => {
    delete fillLayer.leaves[0].options.fillColor;
    commitFillColor(ui, "overlay1", "#ff0000");
    resetLayerFill(ui, "overlay1");

    // No authored colour, no __folium_color — the fallback is Leaflet's own
    // default, which is what the browser would paint anyway.
    expect(fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#3388ff",
    });
  });

  it("reset on a missing layer id is a no-op", () => {
    expect(() => resetLayerFill(ui, "ghost")).not.toThrow();
  });

  it("the panel's Reset button restores the fill colour", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const input = fillInput(item)!;
    input.value = "#ff0000";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const reset = item.querySelector(".foliplus-style-reset-btn")!;
    reset.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(ui.fillColorMap["overlay1"]).toBeUndefined();
    expect(ui.userOverrides["overlay1"] ?? []).not.toContain("fillColor");
  });
});

describe("buildFillRow", () => {
  let ui: LayerUI;

  beforeEach(() => {
    const fixture = initWithFillLayer();
    ui = fixture.ui;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("emits a FORM_ROW with the row class and the swatch input", () => {
    const row = buildFillRow(ui, "overlay1");

    expect(row.classList.contains(CONST.CLASSES.FORM_ROW)).toBe(true);
    expect(row.classList.contains(CONST.CLASSES.STYLE_FILL_ROW)).toBe(true);
    expect(
      row.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`),
    ).not.toBeNull();
  });

  it("the label renders the locale key's translated value", () => {
    const row = buildFillRow(ui, "overlay1");
    const label = row.querySelector(`.${CONST.CLASSES.FORM_LABEL}`);

    expect(label?.textContent).toBe("LayerControl.style_fill");
  });

  // ─────────────────── captureBase fallback ───────────────────

  it("captureBase falls back to Leaflet default #3388ff when options.fillColor is unset", () => {
    // A bare Leaflet GeoJSON layer with no style function has no
    // options.fillColor — the swatch shows what the browser would paint.
    const fixture = initWithFillLayer();
    delete fixture.fillLayer.leaves[0].options.fillColor;

    commitFillColor(fixture.ui, "overlay1", "#ff0000");
    resetLayerFill(fixture.ui, "overlay1");

    expect(fixture.fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#3388ff",
    });
  });

  // ─────────────────── SVG repaint gate ───────────────────

  it("applyFillToLayer updates the SVG fill attribute (repaint gate)", () => {
    // User report: "改色后没生效". This gate asserts that a colour change
    // actually reaches the rendered fill — not just options.fillColor, but
    // the attribute Leaflet paints into the SVG. If Leaflet's setStyle
    // stopped triggering _updateStyle for fillColor-only writes, this test
    // would go red before the fix.
    const fixture = initWithFillLayer();
    const svgFill = vi.fn();
    const path = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5 },
      _path: { setAttribute: svgFill },
      _renderer: true as any,
      setStyle: vi.fn(function (this: any, style: Record<string, unknown>) {
        Object.assign(this.options, style);
        // Simulate Leaflet's _updateStyle: set the SVG fill attribute.
        this._path.setAttribute("fill", String(this.options.fillColor ?? ""));
      }),
      _updateStyle: vi.fn(),
      redraw: vi.fn(),
    };
    fixture.fillLayer.leaves[0] = path as never;

    applyFillToLayer(fixture.ui, "overlay1", "#ff0000");

    expect(svgFill).toHaveBeenCalledWith("fill", "#ff0000");
    expect(path.options.fillColor).toBe("#ff0000");
  });
});
