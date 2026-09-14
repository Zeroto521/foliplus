import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";

// ===========================================================================
// setVisible — the programmatic write side of the visibility contract.
//
// `LayerInfo.visible`, `onToggle`, and the persisted hidden set all existed
// before this file; only the panel's checkbox wrote them, so a host page that
// wanted to hide a layer by id had to synthesize a DOM event against a row it
// does not own. These tests pin the new entry point and, through it, the
// checkbox path it now shares.
//
// Each test re-implements the map mock instead of importing the shared fixture
// in manager.test.ts on purpose: the shared one asserts the *whole* manager
// surface and would let a regression in `setVisible` get hidden by a
// coincidence in an unrelated assertion.

const layerFixture = () => ({ options: {} });

describe("LayerManager.setVisible", () => {
  let manager: LayerManager;
  let map: {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    invalidateSize: ReturnType<typeof vi.fn>;
    hasLayer: ReturnType<typeof vi.fn>;
    addLayer: ReturnType<typeof vi.fn>;
    removeLayer: ReturnType<typeof vi.fn>;
    getContainer: ReturnType<typeof vi.fn>;
    getPane: ReturnType<typeof vi.fn>;
    createPane: ReturnType<typeof vi.fn>;
    _container: HTMLElement;
    _layers: Record<string, unknown>;
    _paneRenderers: Record<string, unknown>;
    attributionControl: { _attributions: Record<string, number>; _update: () => void };
  };

  beforeEach(() => {
    window.localStorage.clear();
    window.CONF = { ...window.CONF, name: "LayerControl", locale_code: "en" };

    window.L.TileLayer = class TileLayer {
      options = { attribution: "© OpenStreetMap" };
      setZIndex = vi.fn();
    };
    window.L.GridLayer = class GridLayer {
      options = {};
    };
    window.L.Renderer = class Renderer {};
    window.L.Path = class Path {
      options = {};
    };
    window.L.Polygon = class Polygon {
      options = {};
    };
    window.L.Polyline = class Polyline {
      options = {};
    };
    window.L.Marker = class Marker {};
    window.L.CircleMarker = class CircleMarker {};
    window.L.stamp = vi.fn();
    window.L.svg = vi.fn(() => ({ addTo: vi.fn() }));

    const makePane = () => {
      const el = document.createElement("div");
      el.style.zIndex = "0";
      return el;
    };

    map = {
      on: vi.fn(),
      off: vi.fn(),
      invalidateSize: vi.fn(),
      // Track membership like the real Leaflet map does: syncVisibility()
      // derives LayerInfo.visible from hasLayer(), so a static false would
      // make every show read back as hidden.
      hasLayer: vi.fn(
        (layer: unknown) =>
          !!map._layers[String(L.stamp ? L.stamp(layer) : String(layer))],
      ),
      addLayer: vi.fn((layer: unknown) => {
        map._layers[String(L.stamp ? L.stamp(layer) : String(layer))] = layer;
      }),
      removeLayer: vi.fn((layer: unknown) => {
        delete map._layers[String(L.stamp ? L.stamp(layer) : String(layer))];
      }),
      getContainer: vi.fn(() => map._container),
      getPane: vi.fn(() => {
        const p = makePane();
        p.style.zIndex = "0";
        return p;
      }),
      createPane: vi.fn(() => {
        const p = makePane();
        p.classList.add("foliplus-layer-pane");
        return p;
      }),
      _container: document.createElement("div"),
      _layers: {},
      _paneRenderers: {},
      attributionControl: { _attributions: {}, _update: vi.fn() },
    };

    manager = new LayerManager(map, [
      { id: "overlay1", name: "Points", isBase: false, layer: layerFixture() },
    ]);
    manager.ui = new LayerUI(manager);
    manager.attachUI(document.createElement("div"));
  });

  it("hides a visible layer and syncs the row, the flag, and the callback", () => {
    const onToggle = vi.fn();
    manager.registerLayer({
      id: "ov",
      name: "Overlay",
      isBase: false,
      layer: layerFixture(),
      onToggle,
    });

    expect(manager.setVisible("ov", false)).toBe(true);

    expect(map.removeLayer).toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(manager.layerRegistry.get("ov")?.visible).toBe(false);

    // The panel row must not disagree with the map: a programmatic hide that
    // leaves the checkbox checked is a UI that lies about state.
    const item = manager.ui.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="ov"]`,
    ) as HTMLElement;
    const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(item.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
  });

  it("shows a hidden layer, un-removing it from the map", () => {
    // Seed the hidden state the same way the attach sweep would, so the
    // precondition (hidden on the map) is built by the real funnel.
    window.localStorage.setItem(
      CONST.STORAGE.VISIBILITY_KEY,
      JSON.stringify(["overlay1"]),
    );
    const seeded = new LayerManager(map, [
      { id: "overlay1", name: "Points", isBase: false, layer: layerFixture() },
    ]);
    seeded.ui = new LayerUI(seeded);
    seeded.attachUI(document.createElement("div"));
    expect(seeded.layerRegistry.get("overlay1")?.visible).toBe(false);

    expect(seeded.setVisible("overlay1", true)).toBe(true);
    expect(map.addLayer).toHaveBeenCalled();
    expect(seeded.layerRegistry.get("overlay1")?.visible).toBe(true);

    const item = seeded.ui.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="overlay1"]`,
    ) as HTMLElement;
    expect(item.querySelector('input[type="checkbox"]')?.checked).toBe(true);
  });

  it("fires the callback instead of touching the map for a canvas-only layer", () => {
    // No Leaflet layer: HeatmapControl's canvas registers onToggle only, so
    // there is nothing to add or remove and the callback is the whole
    // transition.
    const onToggle = vi.fn();
    manager.registerLayer({
      id: "canvas1",
      name: "Heat",
      isBase: false,
      onToggle,
    });

    expect(manager.setVisible("canvas1", false)).toBe(true);
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("returns false for an unknown id and reports it the same either way", () => {
    expect(manager.setVisible("nope", false)).toBe(false);
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.removeLayer).not.toHaveBeenCalled();
  });

  it("persists the hidden set so the choice survives a reload", () => {
    expect(manager.setVisible("overlay1", false)).toBe(true);
    // The write is debounced; flush the funnel and read the key back.
    manager.persistence.flushAll();
    const stored = window.localStorage.getItem(CONST.STORAGE.VISIBILITY_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual(["overlay1"]);

    // A fresh manager over the same storage replays the hide rather than
    // restoring the author's default.
    const fresh = new LayerManager(map, [
      { id: "overlay1", name: "Points", isBase: false, layer: layerFixture() },
    ]);
    fresh.ui = new LayerUI(fresh);
    fresh.attachUI(document.createElement("div"));
    expect(fresh.layerRegistry.get("overlay1")?.visible).toBe(false);
  });

  it("clears the persisted hide when a layer is shown again", () => {
    manager.setVisible("overlay1", false);
    manager.setVisible("overlay1", true);
    manager.persistence.flushAll();

    // The hidden set is absolute ("not on the map"), not a "user toggled"
    // delta, so re-showing empties it rather than deleting the key. Re-read it
    // the way a reload does and assert the layer comes back visible.
    const stored = window.localStorage.getItem(CONST.STORAGE.VISIBILITY_KEY);
    expect(JSON.parse(stored ?? "[]")).toEqual([]);

    const fresh = new LayerManager(map, [
      { id: "overlay1", name: "Points", isBase: false, layer: layerFixture() },
    ]);
    fresh.ui = new LayerUI(fresh);
    fresh.attachUI(document.createElement("div"));
    expect(fresh.layerRegistry.get("overlay1")?.visible).toBe(true);
  });

  it("keeps a base layer on the map but syncs its row and the hidden set", () => {
    const fresh = new LayerManager(map, [
      {
        id: "base1",
        name: "OSM",
        isBase: true,
        layer: { options: {} } as L.TileLayer,
        paneName: "tilePane",
      },
    ]);
    fresh.ui = new LayerUI(fresh);
    fresh.attachUI(document.createElement("div"));

    expect(fresh.setVisible("base1", false)).toBe(true);
    // The row follows; the map membership half is delegated to the registry's
    // findLayer, which resolves base tile layers through the map's own groups.
    const item = fresh.ui.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="base1"]`,
    ) as HTMLElement;
    expect(item.querySelector('input[type="checkbox"]')?.checked).toBe(false);
    expect(fresh.layerRegistry.get("base1")?.visible).toBe(false);
  });

  it("refuses before the panel is attached rather than no-op-ing", () => {
    const bare = new LayerManager(map, [
      { id: "overlay1", name: "Points", isBase: false, layer: layerFixture() },
    ]);
    // No ui: nothing to sync the row with and no hidden-set funnel to write,
    // so a success return would be a lie the caller cannot detect.
    expect(bare.setVisible("overlay1", false)).toBe(false);
    expect(bare.layerRegistry.get("overlay1")?.visible).not.toBe(false);
  });
});
