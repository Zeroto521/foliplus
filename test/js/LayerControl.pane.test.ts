import { PaneManager } from "#foliplus/LayerControl/LayerControl.pane.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock L.svg — needed by PaneManager.ensurePane
beforeEach(() => {
  vi.clearAllMocks();
  window.L.svg = vi.fn(() => ({ addTo: vi.fn() }));
  window.L.stamp = vi.fn(obj => obj.__id ?? (obj.__id = ++count));
  window.L.Path = class {};
  window.L.Marker = class {};
});
let count = 0;

describe("PaneManager", () => {
  it("isDefaultPane returns true for standard Leaflet panes", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    expect(pm.isDefaultPane("overlayPane")).toBe(true);
    expect(pm.isDefaultPane("markerPane")).toBe(true);
    expect(pm.isDefaultPane("tilePane")).toBe(true);
    expect(pm.isDefaultPane("shadowPane")).toBe(true);
    expect(pm.isDefaultPane("mapPane")).toBe(true);
  });

  it("isDefaultPane returns true for fallback panes", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    // FALLBACK_PANE_PREFIX = "foliplus_pane_"
    expect(pm.isDefaultPane("foliplus_pane_123")).toBe(true);
    expect(pm.isDefaultPane("foliplus_pane_xyz")).toBe(true);
  });

  it("isDefaultPane returns false for custom panes", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    expect(pm.isDefaultPane("measure_graph")).toBe(false);
    expect(pm.isDefaultPane("measure_label")).toBe(false);
    expect(pm.isDefaultPane("my-custom-pane")).toBe(false);
  });

  it("getLayerPanes returns the layer's custom pane", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = { options: { pane: "measure_graph" } };
    // discoverChildPanes walks options.pane on the layer itself
    const panes = pm.getLayerPanes(layer);
    expect(panes).toContain("measure_graph");
  });

  it("getLayerPanes returns fallback pane when registered", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = { options: {} };
    const stamp = 42;
    window.L.stamp = vi.fn(() => stamp);
    pm.fallbackPaneMap.set(stamp, "foliplus_pane_42");
    expect(pm.getLayerPanes(layer)).toEqual(["foliplus_pane_42"]);
  });

  it("getLayerPanes falls back to overlayPane/markerPane by default", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = { options: {} };
    expect(pm.getLayerPanes(layer)).toEqual(["overlayPane", "markerPane"]);
  });

  it("ensurePane reuses an existing pane without creating", () => {
    const existingPane = document.createElement("div");
    const map = {
      getPane: vi.fn(() => existingPane),
      createPane: vi.fn(),
    };
    const pm = new PaneManager(map);
    const result = pm.ensurePane("measure_graph", false);
    expect(map.createPane).not.toHaveBeenCalled();
    expect(result.pane).toBe(existingPane);
    expect(result.renderer).toBeNull();
  });

  it("ensurePane creates a pane and adds the layer-pane class", () => {
    const newPane = document.createElement("div");
    const map = {
      getPane: vi.fn(() => null),
      createPane: vi.fn(() => newPane),
    };
    const pm = new PaneManager(map);
    pm.ensurePane("measure_graph", false);
    expect(map.createPane).toHaveBeenCalledWith("measure_graph");
    expect(newPane.classList.contains("foliplus-layer-pane")).toBe(true);
  });

  it("ensurePane creates an SVG renderer when needRenderer is true", () => {
    const pane = document.createElement("div");
    const map = {
      getPane: vi.fn(() => pane),
      createPane: vi.fn(),
    };
    const pm = new PaneManager(map);
    const result = pm.ensurePane("measure_graph", true);
    expect(window.L.svg).toHaveBeenCalledWith({ pane: "measure_graph" });
    expect(result.renderer).toBeDefined();
  });

  it("ensurePane reuses an existing renderer", () => {
    const pane = document.createElement("div");
    const renderer = { addTo: vi.fn() };
    const map = {
      getPane: vi.fn(() => pane),
      createPane: vi.fn(),
      foliplus_renderer_measure_graph: renderer,
    };
    const pm = new PaneManager(map);
    const result = pm.ensurePane("measure_graph", true);
    expect(window.L.svg).not.toHaveBeenCalled();
    expect(result.renderer).toBe(renderer);
  });

  it("discoverChildPanes filters out default panes", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = {
      options: { pane: "overlayPane" },
    };
    expect(pm.discoverChildPanes(layer)).toEqual([]);
  });

  it("bumpLabelPanes sets z + 1 on label panes", () => {
    const pane = document.createElement("div");
    const map = { getPane: vi.fn(() => pane), createPane: vi.fn() };
    const pm = new PaneManager(map);
    pm.labelPanes.add("measure_label");
    const layer = { options: { pane: "measure_label" } };
    pm.bumpLabelPanes(layer, 600);
    expect(pane.style.zIndex).toBe("601");
  });

  it("reset clears the pane cache", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    pm.paneCache.set(1, ["a"]);
    pm.reset();
    expect(pm.paneCache.size).toBe(0);
  });

  it("destroy clears all pane state", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    pm.paneCache.set(1, ["a"]);
    pm.fallbackPaneMap.set(2, "foliplus_pane_2");
    pm.labelPanes.add("label");
    pm.destroy();
    expect(pm.paneCache.size).toBe(0);
    expect(pm.fallbackPaneMap.size).toBe(0);
    expect(pm.labelPanes.size).toBe(0);
  });

  it("migrateLayers is a no-op for empty input", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    expect(() => pm.migrateLayers([])).not.toThrow();
  });

  it("migrateLayers moves path nodes into the target pane", () => {
    const paneEl = document.createElement("div");
    const container = document.createElement("div");
    const path = document.createElement("path");
    const map = { getPane: vi.fn(() => paneEl), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = {
      getElement: () => path,
      options: {} as Record<string, unknown>,
      eachLayer: undefined,
    };
    Object.setPrototypeOf(layer, new window.L.Path());
    const renderer = { _container: container };
    pm.migrateLayers([{ layer, paneName: "measure_graph", renderer }]);
    expect(layer.options.pane).toBe("measure_graph");
    expect(layer.options.paneSet).toBe(true);
    expect(path.parentNode).toBe(container);
  });

  it("migrateLayers moves marker icons into the pane", () => {
    const paneEl = document.createElement("div");
    const icon = document.createElement("img");
    const shadow = document.createElement("img");
    const map = { getPane: vi.fn(() => paneEl), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = {
      getElement: () => icon,
      _shadow: shadow,
      options: {},
      eachLayer: undefined,
    };
    // Force instanceof checks by setting prototypes
    Object.setPrototypeOf(layer, new window.L.Marker());
    const renderer = { _container: document.createElement("div") };
    pm.migrateLayers([{ layer, paneName: "measure_graph", renderer }]);
    expect(icon.parentNode).toBe(paneEl);
    expect(shadow.parentNode).toBe(paneEl);
  });

  it("migrateLayers skips layers without a paneName", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = { options: {}, eachLayer: undefined };
    expect(() =>
      pm.migrateLayers([{ layer, paneName: null, renderer: null }]),
    ).not.toThrow();
  });
});
