import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerManager } from "#foliplus/LayerControl/manager.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  applyFillToLayer,
  bindFillRow,
  buildFillRow,
  commitFillColor,
  commitFillOpacity,
  layerCanFill,
  replayFillState,
  resetLayerFill,
} from "#foliplus/LayerControl/ui/style/fill.js";
import { findItem, initFixture, installLeafletGlobals } from "../fixture.js";

/** A layer duck with a real setStyle spy and a set of polygon leaves each
 *  with their own setStyle. The leaves are `L.Polygon` instances so the areal
 *  gate in `layerCanFill` admits the layer. The parent's eachLayer callback
 *  dispatches to each child, matching how Leaflet LayerGroup.setStyle walks
 *  its tree. */
const makeFillableLayer = () => {
  const makeLeaf = (options: { fillColor?: string; fillOpacity?: number }) => {
    const leaf = new L.Polygon() as L.Polygon & {
      options: { fillColor?: string; fillOpacity?: number };
      setStyle: ReturnType<typeof vi.fn>;
    };
    leaf.options = options;
    leaf.setStyle = vi.fn();
    return leaf;
  };
  const leaves = [
    makeLeaf({ fillColor: "#aabbcc", fillOpacity: 0.5 }),
    makeLeaf({ fillColor: "#ddeeff", fillOpacity: 0.7 }),
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
  // Install the stub classes FIRST so `new L.Polygon()` below creates leaves
  // of the same class identity the manager's checks use (repeated installs
  // keep the module-level class, so initFixture does not invalidate them).
  installLeafletGlobals();
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

describe("LayerUI style panel — fill color", () => {
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

    // No user fill yet — the swatch shows the layer's authored fill color
    // (the first polygon leaf's options.fillColor), not a constant.
    expect(fillInput(item)!.value).toBe("#aabbcc");
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

  it("layerCanFill is false for a line layer — no fill concept", () => {
    // A PolyLine passes the capability check (vector shape) but has no fill
    // concept: a fill row there would write a value with no visual effect.
    const line = new L.Polyline();
    line.options = { color: "#000000", weight: 2 };
    line.setStyle = vi.fn();
    manager.registerLayer({
      id: "line1",
      name: "Line",
      layer: line as never,
    });
    ui.fieldCache.set("line1", [{ name: "count", numeric: true }]);
    expect(layerCanFill(ui, "line1")).toBe(false);

    const item = findItem(ui, "line1");
    ui.openStylePanel("line1");
    expect(fillRow(item)).toBeNull();
  });

  it("layerCanFill is true for a mixed polygon+line layer with a polygon leaf", () => {
    // A mixed GeoJSON keeps the row when at least one leaf can carry a fill;
    // the write reaches exactly the polygon leaves.
    const poly = new L.Polygon();
    poly.options = { fillColor: "#ff0000" };
    poly.setStyle = vi.fn();
    const line = new L.Polyline();
    line.options = { color: "#000000" };
    line.setStyle = vi.fn();
    const mixed = {
      options: {},
      eachLayer: vi.fn((fn: (child: unknown) => void) => {
        fn(poly);
        fn(line);
      }),
      getBounds: vi.fn(() => ({
        isValid: vi.fn(() => true),
        getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),
        getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
      })),
    };
    manager.registerLayer({
      id: "mixed1",
      name: "Mixed",
      layer: mixed as never,
    });
    ui.fieldCache.set("mixed1", [{ name: "count", numeric: true }]);
    expect(layerCanFill(ui, "mixed1")).toBe(true);

    const item = findItem(ui, "mixed1");
    ui.openStylePanel("mixed1");
    expect(fillRow(item)).not.toBeNull();
  });

  it("layerCanFill is false when the mixed layer resolves no Leaflet object", () => {
    // UNKNOWN geometry with no layer object to walk — the gate must not
    // assume leaves exist when it cannot reach them. In reality a missing
    // layer also flips the surface capabilities to "none", so this state is
    // only reachable through a surface that still reports UNKNOWN.
    manager.registerLayer({
      id: "mixed2",
      name: "Mixed2",
      layer: null as never,
    });
    manager.layerRegistry.get("mixed2")!.layer = null;
    const fake = {
      capabilities: { opacity: "pane", zoomRange: "pane" },
      geometryType: () => "unknown",
    };
    vi.spyOn(ui.m, "surfaceFor").mockReturnValue(fake as never);

    expect(layerCanFill(ui, "mixed2")).toBe(false);
  });

  it("the swatch resolves a named authored color through the browser probe", () => {
    // jsdom cannot parse named colors and degrades to the default; the real
    // picker resolves them (Chromium: "gray" → #808080). The important
    // contract is that a non-hex authored value never reaches the input raw.
    const fixture = initWithFillLayer();
    fixture.fillLayer.leaves[0].options.fillColor = "gray";
    fixture.ui.openStylePanel("overlay1");
    const item = findItem(fixture.ui, "overlay1");
    const value = fillInput(item)!.value;
    expect(value).toMatch(/^#[0-9a-f]{6}$/);
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

  it("commitFillColor normalizes #rgb to #rrggbb before persisting", () => {
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
    ui.fillColorMap["overlay1"] = "#123456";
    applyFillToLayer(ui, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
    });
    expect(fillLayer.leaves[1].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
    });
  });

  it("applyFillToLayer is a silent no-op for a layer with no leaves", () => {
    // No honest write → do not persist a broken state. The gate
    // already prevents commit from reaching here for a non-vector layer,
    // but the walker itself must not throw on a group whose eachLayer
    // dispatches nothing.
    manager.registerLayer({
      id: "empty1",
      name: "Empty",
      layer: { options: {}, eachLayer: vi.fn() } as never,
    });
    ui.fillColorMap["empty1"] = "#123456";
    expect(() => applyFillToLayer(ui, "empty1")).not.toThrow();
  });

  it("applyFillToLayer is a no-op when the layer is not in the registry", () => {
    ui.fillColorMap["ghost"] = "#123456";
    expect(() => applyFillToLayer(ui, "ghost")).not.toThrow();
  });

  it("commitFillColor walks past a node with no setStyle or eachLayer", () => {
    // The hollow-check walk falls through a leaf that exposes neither a
    // setter nor children — it must not throw, and the color still commits.
    const fixture = initWithFillLayer();
    fixture.fillLayer.leaves[1] = { options: {} } as never;

    expect(() => commitFillColor(fixture.ui, "overlay1", "#ff0000")).not.toThrow();
    expect(fixture.ui.fillColorMap["overlay1"]).toBe("#ff0000");
  });

  it("mouseout on a leaf re-applies the user's fill after folium resets it", () => {
    // folium's highlight_on_hover restores the ORIGINAL style on mouseout;
    // the fill row's listener must reapply the user's color and opacity so
    // a hover cannot undo them.
    const fixture = initWithFillLayer();
    let handler: (() => void) | null = null;
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5 },
      setStyle: vi.fn(),
      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };
    fixture.fillLayer.leaves[0] = leaf;
    fixture.ui.fillColorMap["overlay1"] = "#123456";
    fixture.ui.fillOpacityMap["overlay1"] = 0.4;

    applyFillToLayer(fixture.ui, "overlay1");
    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      fillColor: "#123456",
      fillOpacity: 0.4,
    });

    // folium's mouseout handler sets the original style back…
    leaf.setStyle({ fillColor: "#aabbcc", fillOpacity: 0.5 });
    // …and our listener restores the user's fill.
    handler!();

    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      fillColor: "#123456",
      fillOpacity: 0.4,
    });
  });

  it("mouseout on a leaf with no stored fill does not touch the style", () => {
    const fixture = initWithFillLayer();
    let handler: (() => void) | null = null;
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5 },
      setStyle: vi.fn(),
      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };
    fixture.fillLayer.leaves[0] = leaf;
    applyFillToLayer(fixture.ui, "overlay1"); // nothing stored — early return

    // applyFillToLayer never reached the walk, so no listener is attached:
    // folium's own hover handling stays untouched for an uncommitted layer.
    expect(leaf.on).not.toHaveBeenCalled();
  });

  it("mouseout reapplies only the stored fill color", () => {
    const fixture = initWithFillLayer();
    let handler: (() => void) | null = null;
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5 },
      setStyle: vi.fn(),
      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };
    fixture.fillLayer.leaves[0] = leaf;
    fixture.ui.fillColorMap["overlay1"] = "#123456";

    applyFillToLayer(fixture.ui, "overlay1");
    handler!();

    // fillOpacity is absent from the maps, so the reapply omits it — the
    // author's opacity stays in force.
    expect(leaf.setStyle).toHaveBeenLastCalledWith({ fillColor: "#123456" });
  });

  it("mouseout reapplies only the stored fill opacity", () => {
    const fixture = initWithFillLayer();
    let handler: (() => void) | null = null;
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5 },
      setStyle: vi.fn(),
      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };
    fixture.fillLayer.leaves[0] = leaf;
    fixture.ui.fillOpacityMap["overlay1"] = 0.4;

    applyFillToLayer(fixture.ui, "overlay1");
    handler!();

    expect(leaf.setStyle).toHaveBeenLastCalledWith({ fillOpacity: 0.4 });
  });

  it("mouseout after the fill was reset does not rewrite the style", () => {
    const fixture = initWithFillLayer();
    let handler: (() => void) | null = null;
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5 },
      setStyle: vi.fn(),
      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };
    fixture.fillLayer.leaves[0] = leaf;
    fixture.ui.fillColorMap["overlay1"] = "#123456";

    applyFillToLayer(fixture.ui, "overlay1");
    // Reset clears the maps; the listener from the earlier commit is still
    // attached (reset does not unbind it), so the reapply must no-op.
    delete fixture.ui.fillColorMap["overlay1"];
    delete fixture.ui.fillOpacityMap["overlay1"];
    leaf.setStyle.mockClear();

    handler!();

    expect(leaf.setStyle).not.toHaveBeenCalled();
  });

  it("attaches the reapply listener to leaves, not to the group", () => {
    // A folium GeoJson is a LayerGroup that ALSO exposes setStyle. The
    // listener must live on each leaf — mouseout fires there, never on the
    // group — so a group with both methods must still recurse.
    const leaves = [
      {
        options: { fillColor: "#aabbcc", fillOpacity: 0.5 },
        setStyle: vi.fn(),
        on: vi.fn(),
      },
      {
        options: { fillColor: "#ddeeff", fillOpacity: 0.7 },
        setStyle: vi.fn(),
        on: vi.fn(),
      },
    ];
    const group = {
      options: {},
      setStyle: vi.fn(),
      eachLayer: vi.fn((fn: (child: unknown) => void) =>
        leaves.forEach(child => fn(child)),
      ),
      getBounds: vi.fn(() => ({
        isValid: vi.fn(() => true),
        getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),
        getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
      })),
    };
    manager.registerLayer({
      id: "group1",
      name: "Group",
      layer: group as never,
    });
    ui.fieldCache.set("group1", [{ name: "count", numeric: true }]);
    ui.fillColorMap["group1"] = "#123456";

    applyFillToLayer(ui, "group1");

    expect(leaves[0].setStyle).toHaveBeenCalledWith({ fillColor: "#123456" });
    expect(leaves[1].setStyle).toHaveBeenCalledWith({ fillColor: "#123456" });
    expect(leaves[0].on).toHaveBeenCalledWith("mouseout", expect.any(Function));
    expect(leaves[1].on).toHaveBeenCalledWith("mouseout", expect.any(Function));
    expect(group.setStyle).not.toHaveBeenCalled();
  });

  it("the reapply listener calls setStyle with the leaf as `this`", () => {
    // Leaflet's Path.setStyle reads `this.options`; the detached reference
    // captured by the listener must stay bound to its layer or the reapply
    // throws "Cannot convert undefined or null to object".
    const fixture = initWithFillLayer();
    let handler: (() => void) | null = null;
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0.5 },
      setStyle: vi.fn(function (
        this: { options: Record<string, unknown> },
        s: Record<string, unknown>,
      ) {
        Object.assign(this.options, s);
      }),
      on: vi.fn((_type: string, fn: () => void) => {
        handler = fn;
      }),
    };
    fixture.fillLayer.leaves[0] = leaf;
    fixture.ui.fillColorMap["overlay1"] = "#123456";

    applyFillToLayer(fixture.ui, "overlay1");
    handler!();

    expect(leaf.options.fillColor).toBe("#123456");
  });

  it("commitFillColor handles a layer id that is not registered yet", () => {
    // The hollow-check walks only registered layers; an unregistered id still
    // records the user's choice so a late registration can replay it.
    expect(() => commitFillColor(ui, "late-layer", "#ff0000")).not.toThrow();
    expect(ui.fillColorMap["late-layer"]).toBe("#ff0000");
    expect(ui.userOverrides["late-layer"]).toContain("fillColor");
  });

  it("resetLayerFill is a no-op for a registered layer with no Leaflet object", () => {
    manager.registerLayer({
      id: "canvas1",
      name: "Canvas",
      canvas: document.createElement("canvas"),
    });
    ui.fillColorMap["canvas1"] = "#ff0000";
    ui.userOverrides["canvas1"] = ["fillColor"];

    resetLayerFill(ui, "canvas1");

    expect(ui.fillColorMap["canvas1"]).toBeUndefined();
    expect(ui.userOverrides["canvas1"]).toBeUndefined();
  });

  it("resetLayerFill walks past a leaf with no setStyle or eachLayer", () => {
    const fixture = initWithFillLayer();
    fixture.fillLayer.leaves[1] = { options: {} } as never;
    commitFillColor(fixture.ui, "overlay1", "#ff0000");

    expect(() => resetLayerFill(fixture.ui, "overlay1")).not.toThrow();
  });

  it("captureBase falls back to Leaflet default when fillOpacity is unset too", () => {
    const fixture = initWithFillLayer();
    delete fixture.fillLayer.leaves[0].options.fillColor;
    delete fixture.fillLayer.leaves[0].options.fillOpacity;

    commitFillColor(fixture.ui, "overlay1", "#ff0000");
    resetLayerFill(fixture.ui, "overlay1");

    // No authored color or opacity — reset restores only the color
    // fallback and skips the fillOpacity write entirely.
    expect(fixture.fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#3388ff",
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
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const input = fillInput(item)!;

    input.value = "#3366cc";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(ui.fillColorMap["overlay1"]).toBe("#3366cc");
    expect(ui.userOverrides["overlay1"]).toContain("fillColor");
  });

  it("the fill opacity input commits through the live binder", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const input = item.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
    ) as HTMLInputElement;

    input.value = "50";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(ui.fillOpacityMap["overlay1"]).toBe(0.5);
    expect(ui.userOverrides["overlay1"]).toContain("fillOpacity");
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

  it("resetLayerFill restores the authored fill color on each leaf", () => {
    // First commit captures each leaf's authored base.
    commitFillColor(ui, "overlay1", "#ff0000");
    resetLayerFill(ui, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#aabbcc",
      fillOpacity: 0.5,
    });
    expect(fillLayer.leaves[1].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#ddeeff",
      fillOpacity: 0.7,
    });
  });

  it("resetLayerFill restores the Leaflet default when options.fillColor was unset", () => {
    delete fillLayer.leaves[0].options.fillColor;
    commitFillColor(ui, "overlay1", "#ff0000");
    resetLayerFill(ui, "overlay1");

    // No authored color — the fallback is Leaflet's own default.
    expect(fillLayer.leaves[0].setStyle).toHaveBeenLastCalledWith({
      fillColor: "#3388ff",
      fillOpacity: 0.5,
    });
  });

  it("reset on a missing layer id is a no-op", () => {
    expect(() => resetLayerFill(ui, "ghost")).not.toThrow();
  });

  it("the panel's Reset button restores the fill color", () => {
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
  let manager: LayerManager;

  beforeEach(() => {
    const fixture = initWithFillLayer();
    ui = fixture.ui;
    manager = fixture.manager;
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

  it("falls back to the Leaflet default for an unregistered layer", () => {
    // No registry entry, no authored color — the swatch shows Leaflet's own
    // fill default rather than inventing one.
    const row = buildFillRow(ui, "ghost");
    const input = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;

    expect(input.value).toBe("#3388ff");
  });

  it("falls back to the Leaflet default when no leaf declares a fill color", () => {
    const fixture = initWithFillLayer();
    delete fixture.fillLayer.leaves[0].options.fillColor;
    delete fixture.fillLayer.leaves[1].options.fillColor;

    const row = buildFillRow(fixture.ui, "overlay1");
    const input = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;

    expect(input.value).toBe("#3388ff");
  });

  it("degrades to the default swatch when the browser probe returns a non-hex", () => {
    // The <input type=color> probe always yields hex in jsdom and Chromium;
    // if a UA ever returns garbage, the swatch must not receive it raw.
    const orig = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementationOnce(
      (tag: string, ...args: unknown[]) => {
        const el = orig(tag, ...args);
        if (tag === "input") {
          Object.defineProperty(el, "value", { get: () => "zzz", set: () => {} });
        }
        return el;
      },
    );
    ui.fillColorMap["overlay1"] = "gray";

    const row = buildFillRow(ui, "overlay1");
    const input = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
    ) as HTMLInputElement;

    expect(input.value).toBe("#000000");
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
      fillOpacity: 0.5,
    });
  });

  // ─────────────────── SVG repaint gate ───────────────────

  it("applyFillToLayer updates the SVG fill attribute (repaint gate)", () => {
    // User report: "改色后没生效". This gate asserts that a color change
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
    fixture.ui.fillColorMap["overlay1"] = "#ff0000";

    applyFillToLayer(fixture.ui, "overlay1");

    expect(svgFill).toHaveBeenCalledWith("fill", "#ff0000");
    expect(path.options.fillColor).toBe("#ff0000");
  });

  it("commitFillColor bumps fillOpacity to 0.2 on a hollow layer", () => {
    // The user's "改色后没生效" report: a hollow polygon (fillOpacity=0)
    // has its fill invisible, so a color change is user-invisible. This
    // test asserts that commitFillColor bumps fillOpacityMap to a visible
    // value, making the color change actually visible.
    const fixture = initWithFillLayer();
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0 },
      setStyle: vi.fn(),
    };
    fixture.fillLayer.leaves[0] = leaf;

    commitFillColor(fixture.ui, "overlay1", "#ff0000");

    expect(fixture.ui.fillOpacityMap["overlay1"]).toBe(0.2);
    expect(fixture.ui.userOverrides["overlay1"]).toContain("fillOpacity");
    expect(leaf.setStyle).toHaveBeenCalledWith({
      fillColor: "#ff0000",
      fillOpacity: 0.2,
    });
  });

  it("commitFillColor does not bump fillOpacity when the user set it explicitly", () => {
    // If the user explicitly set fillOpacity (even to 0), their choice wins.
    const fixture = initWithFillLayer();
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0 },
      setStyle: vi.fn(),
    };
    fixture.fillLayer.leaves[0] = leaf;
    fixture.ui.fillOpacityMap["overlay1"] = 0;

    commitFillColor(fixture.ui, "overlay1", "#ff0000");

    expect(fixture.ui.fillOpacityMap["overlay1"]).toBe(0);
    expect(leaf.setStyle).toHaveBeenCalledWith({
      fillColor: "#ff0000",
      fillOpacity: 0,
    });
  });

  it("commitFillOpacity writes to the map, persists, and marks the override", () => {
    const setLayer = vi.spyOn(manager.persistence, "schedule");

    commitFillOpacity(ui, "overlay1", 50);

    expect(ui.fillOpacityMap["overlay1"]).toBe(0.5);
    expect(ui.userOverrides["overlay1"]).toContain("fillOpacity");
    expect(setLayer).toHaveBeenCalled();
  });

  it("commitFillOpacity no-ops when the value did not change", () => {
    ui.fillOpacityMap["overlay1"] = 0.5;
    const setLayer = vi.spyOn(manager.persistence, "schedule");

    commitFillOpacity(ui, "overlay1", 50);

    expect(setLayer).not.toHaveBeenCalled();
  });

  it("commitFillOpacity clamps out-of-range values", () => {
    commitFillOpacity(ui, "overlay1", 150);
    expect(ui.fillOpacityMap["overlay1"]).toBe(1);

    commitFillOpacity(ui, "overlay1", -10);
    expect(ui.fillOpacityMap["overlay1"]).toBe(0);
  });

  it("resetLayerFill clears fillOpacityMap and restores the author's opacity", () => {
    const fixture = initWithFillLayer();
    const leaf = {
      options: { fillColor: "#aabbcc", fillOpacity: 0 },
      setStyle: vi.fn(),
    };
    fixture.fillLayer.leaves[0] = leaf;

    commitFillColor(fixture.ui, "overlay1", "#ff0000");
    expect(fixture.ui.fillOpacityMap["overlay1"]).toBe(0.2);

    resetLayerFill(fixture.ui, "overlay1");

    expect(fixture.ui.fillOpacityMap["overlay1"]).toBeUndefined();
    expect(fixture.ui.userOverrides["overlay1"] ?? []).not.toContain("fillOpacity");
    expect(leaf.setStyle).toHaveBeenLastCalledWith({
      fillColor: "#aabbcc",
      fillOpacity: 0,
    });
  });
});

describe("replayFillState", () => {
  let ui: LayerUI;
  let manager: LayerManager;
  let fillLayer: ReturnType<typeof makeFillableLayer>;

  beforeEach(() => {
    const fixture = initWithFillLayer();
    ui = fixture.ui;
    manager = fixture.manager;
    fillLayer = fixture.fillLayer;
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("applies a stored fill color and opacity onto every leaf", () => {
    ui.fillColorMap["overlay1"] = "#123456";
    ui.fillOpacityMap["overlay1"] = 0.4;

    replayFillState(ui, "overlay1");

    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
      fillOpacity: 0.4,
    });
    expect(fillLayer.leaves[1].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
      fillOpacity: 0.4,
    });
  });

  it("is a no-op when only one fill dimension is stored", () => {
    ui.fillColorMap["overlay1"] = "#123456";

    replayFillState(ui, "overlay1");

    // The absent dimension is omitted from the write so the author's
    // fillOpacity stays in force.
    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
    });
  });

  it("is a no-op for a layer outside the registry", () => {
    ui.fillColorMap["ghost"] = "#123456";
    expect(() => replayFillState(ui, "ghost")).not.toThrow();
  });

  it("attachUI replays a stored fill onto a registered layer", () => {
    // Regression: the initial layers never go through registerLayer (where
    // the id-specified replay lives), so attach itself must replay fill —
    // otherwise a reload shows the author's default color.
    const fillLayer = makeFillableLayer();
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({
        layers: {
          overlay1: { fillColor: "#123456", overrides: ["fillColor"] },
        },
      }),
    );
    const fixture = initFixture({
      data: [
        { id: "overlay1", name: "Polygons", isBase: false, layer: fillLayer },
        {
          id: "base1",
          name: "OSM",
          isBase: true,
          layer: { options: {}, setZIndex: vi.fn() } as never,
          paneName: "tilePane",
        },
      ],
    });

    expect(fixture.manager.ui!.fillColorMap["overlay1"]).toBe("#123456");
    expect(fillLayer.leaves[0].setStyle).toHaveBeenCalledWith({
      fillColor: "#123456",
    });
  });
});
