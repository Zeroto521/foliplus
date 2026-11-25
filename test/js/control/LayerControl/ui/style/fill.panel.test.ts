// test/js/control/LayerControl/ui/style/fill.panel — panel row rendering and the fillability gate.
import { findItem } from "../fixture.js";
import { initWithFillLayer, triggerOf } from "./fill.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PANEL_CLASS } from "#ui/panelClassName.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { setIntent } from "#control/LayerControl/ui/intent.js";
import { layerCanFill } from "#control/LayerControl/ui/style/fill.js";

describe("LayerUI style panel — fill color", () => {
  let manager: LayerController;

  let ui: LayerUI;

  beforeEach(() => {
    const fixture = initWithFillLayer();

    manager = fixture.manager;

    ui = fixture.ui;

    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();

    document.body.innerHTML = "";

    vi.clearAllMocks();

    vi.useRealTimers();
  });

  const fillRow = (item: HTMLElement): HTMLElement | null =>
    item.querySelector(`.${CONST.CLASSES.STYLE_FILL_ROW}`);

  const fillInput = (item: HTMLElement): HTMLInputElement | null =>
    item.querySelector(`.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`);
  // ─────────────────── row rendering ───────────────────

  it("renders the fill row for a fillable vector layer", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    expect(fillRow(item)).not.toBeNull();

    expect(fillInput(item)).not.toBeNull();

    expect(fillInput(item)!.type).toBe("color");
  });

  it("the fill row's aria-label comes from the scoped translator", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    expect(fillInput(item)!.getAttribute("aria-label")).toBe("LayerControl.style_fill");
  });

  it("the mode row's label matches the trigger's aria-label key", () => {
    // The row that owns the mode control reads "Fill"; the swatch's aria-label

    // stays the color key, so neither one lies about what it names.

    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const row = fillRow(item)!;

    const labelText = row.querySelector(`.${PANEL_CLASS.FORM_LABEL}`)!.textContent;

    const select = row.querySelector(
      `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
    ) as HTMLSelectElement;

    expect(labelText).toBe("LayerControl.style_fill_mode");

    expect(triggerOf(select).getAttribute("aria-label")).toBe(labelText);

    expect(fillInput(item)!.getAttribute("aria-label")).toBe("LayerControl.style_fill");
  });

  it("the swatch defaults to the authored paint when no fill is committed", () => {
    setIntent(ui, "overlay1", "fillStyleMode", "solid");

    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    // No user fill yet — the swatch shows the layer's authored fill color

    // (the first polygon leaf's options.fillColor), not a constant.

    expect(fillInput(item)!.value).toBe("#aabbcc");
  });

  it("reopening the panel seeds the swatch from intents.fillColor", () => {
    setIntent(ui, "overlay1", "fillColor", "#ff8800");

    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    expect(fillInput(item)!.value).toBe("#ff8800");
  });

  // ─────────────────── capability gate ───────────────────

  it("layerCanFill returns true for a solid-color basemap", () => {
    // The color basemap carries BOTH `color` (its fill) and `canvas` (the

    // face element the export renderer draws). Gating on `canvas` — as this

    // once did — drops its fill row, which is the one dimension this layer

    // exists to expose. `color` is the discriminator.

    manager.registerLayer({
      id: "colormap",

      name: "Color",

      role: "base",

      color: "#3366cc",

      canvas: document.createElement("canvas"),
    });

    expect(layerCanFill(ui, "colormap")).toBe(true);
  });

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

    ui.runtimeStore.setFields("line1", [{ name: "count", numeric: true }]);

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

    ui.runtimeStore.setFields("mixed1", [{ name: "count", numeric: true }]);

    expect(layerCanFill(ui, "mixed1")).toBe(true);

    const item = findItem(ui, "mixed1");

    ui.openStylePanel("mixed1");

    expect(fillRow(item)).not.toBeNull();
  });

  it("layerCanFill is false for a POINT geometry type — no fill axis", () => {
    // A surface that reports POINT (not POLYGON/LINE/UNKNOWN) has no fill

    // concept: the early-return guard at hasFillGeometry L85 rejects it

    // before the leaf walk. In reality Marker/Point layers report POINT and

    // never enter the walkStyleLeaves path.

    const marker = new L.Marker();

    marker.options = {};

    manager.registerLayer({
      id: "point1",

      name: "Points",

      layer: marker as never,
    });

    const fake = {
      capabilities: { opacity: "pane", zoomRange: "pane" },

      geometryType: () => "point",
    };

    vi.spyOn(ui.c, "surfaceFor").mockReturnValue(fake as never);

    expect(layerCanFill(ui, "point1")).toBe(false);
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

    vi.spyOn(ui.c, "surfaceFor").mockReturnValue(fake as never);

    expect(layerCanFill(ui, "mixed2")).toBe(false);
  });

  it("layerCanFill is true for a circle layer (Circle extends Polyline)", () => {
    // Real Leaflet: Circle is a Polyline subclass, so the geometry type

    // reports LINE — but Circle/CircleMarker carry a fill, so the areal gate

    // must not classify them as stroke-only.

    const circle = new L.Circle();

    circle.options = { fillColor: "#ff0000" };

    circle.setStyle = vi.fn();

    const layer = {
      options: {},

      eachLayer: vi.fn((fn: (child: unknown) => void) => fn(circle)),

      getBounds: vi.fn(() => ({
        isValid: vi.fn(() => true),

        getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),

        getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
      })),
    };

    manager.registerLayer({
      id: "circle1",

      name: "Circles",

      layer: layer as never,
    });

    ui.runtimeStore.setFields("circle1", [{ name: "count", numeric: true }]);

    expect(layerCanFill(ui, "circle1")).toBe(true);

    const item = findItem(ui, "circle1");

    ui.openStylePanel("circle1");

    expect(fillRow(item)).not.toBeNull();
  });

  // Gate unification: the third condition requires a real setStyle

  // leaf behind the layer. An empty group has eachLayer but yields no

  // children, so the carrier check finds no setStyle leaf to write to.

  it("layerCanFill is false for an empty group — eachLayer walks nothing", () => {
    manager.registerLayer({
      id: "empty1",

      name: "E",

      layer: {
        options: {},

        eachLayer: vi.fn(() => {
          // no children to dispatch
        }),

        getBounds: vi.fn(() => ({
          isValid: vi.fn(() => true),

          getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),

          getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
        })),
      } as never,
    });

    expect(layerCanFill(ui, "empty1")).toBe(false);
  });

  it("the swatch resolves a named authored color through the browser probe", () => {
    // jsdom cannot parse named colors and degrades to the default; the real

    // picker resolves them (Chromium: "gray" → #808080). The important

    // contract is that a non-hex authored value never reaches the input raw.

    const fixture = initWithFillLayer();

    fixture.fillLayer.leaves[0].options.fillColor = "gray";

    setIntent(fixture.ui, "overlay1", "fillStyleMode", "solid");

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

    ui.runtimeStore.setFields("cluster2", [{ name: "count", numeric: true }]);

    const item = findItem(ui, "cluster2");

    ui.openStylePanel("cluster2");

    expect(fillRow(item)).toBeNull();
  });
});
