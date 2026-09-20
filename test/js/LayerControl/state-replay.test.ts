// State replay — stored intent must be replayed at the moment the object appears.
//
// Three instances of one failure: the user's intent is persisted, but the replay
// either never happens or happens too early (before the layer or the pane exists).
// Reading the record must therefore not prune against the registry, and every
// appearance point must re-apply what is stored:
//   1. an opacity set before a layer's annotation pane exists
//   2. a layer that registers after the record was loaded
//   3. a flush that lands before that late registration
//   4. annotation config for an id that only resolves at runtime
//
// Each test asserts an observable outcome and imports only the public API, so it
// fails on an assertion (not on a missing symbol) before the fix.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerPersistence } from "#foliplus/LayerControl/persistence.js";
import { applyOpacityStateOne } from "#foliplus/LayerControl/ui/state.js";
import { initFixture, installLeafletGlobals, makePane } from "./ui/fixture.js";

// The canvas stub keeps `renderLabels` off jsdom's missing 2d context — the pane
// it mounts into is what these tests assert on.
const mocks = vi.hoisted(() => {
  class MockAnnotationCanvas {
    paint = vi.fn();
    setVisible = vi.fn();
    destroy = vi.fn();
    constructor(_map: unknown, _pane: unknown) {}
  }
  return { MockAnnotationCanvas };
});

vi.mock("#foliplus/LayerControl/annotation/canvas.js", () => ({
  AnnotationCanvas: mocks.MockAnnotationCanvas,
}));

const seedStorage = (record: Record<string, unknown>) => {
  window.localStorage.setItem(CONST.STORAGE.KEY, JSON.stringify(record));
};

/** A map stub whose panes are stable per name — `map.getPane` in the shared
 *  fixtures returns a fresh div on every call, so a write through it would land
 *  on an element no later read could find. */
const makeMap = (): {
  map: Record<string, unknown>;
  panes: Map<string, HTMLElement>;
} => {
  installLeafletGlobals();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const panes = new Map<string, HTMLElement>();
  const paneFor = (name: string) => {
    let pane = panes.get(name);
    if (!pane) {
      pane = makePane();
      pane.classList.add("foliplus-layer-pane");
      container.appendChild(pane);
      panes.set(name, pane);
    }
    return pane;
  };

  const map: Record<string, unknown> = {
    on: vi.fn(),
    off: vi.fn(),
    invalidateSize: vi.fn(),
    hasLayer: vi.fn(() => false),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    getContainer: vi.fn(() => container),
    getPane: vi.fn((name: string) => paneFor(name)),
    createPane: vi.fn((name: string) => paneFor(name)),
    getZoom: vi.fn(() => 5),
    getMaxZoom: vi.fn(() => 18),
    getPanes: vi.fn(() => ({ mapPane: document.createElement("div") })),
    latLngToContainerPoint: vi.fn(() => ({ x: 10, y: 20 })),
    _container: container,
    _layers: {},
    _paneRenderers: {},
    _panes: panes,
    attributionControl: { _attributions: {}, _update: vi.fn() },
  };

  (window.L as unknown as { DomUtil: unknown }).DomUtil = {
    getPosition: () => ({ x: 0, y: 0 }),
  };

  return { map, panes };
};

const labelLayer = () =>
  ({
    options: {},
    eachLayer: (cb: (l: L.Layer) => void) =>
      cb({
        options: {},
        feature: { properties: { v: "1200" } },
        getLatLng: () => ({ lat: 35, lng: 105 }),
      }),
  }) as unknown as L.Layer;

describe("state replay", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.CONF = { ...window.CONF, name: "LayerControl", locale_code: "en" };
    document.body.innerHTML = "";
  });

  describe("opacity", () => {
    it("reaches an annotation pane created after the write", () => {
      // The stored opacity is applied on attach, when the layer has no
      // annotation pane yet — so the pane that is created later must pick the
      // value up at the moment it appears.
      seedStorage({
        layers: { overlay1: { opacity: 0.3, overrides: ["opacity"] } },
      });
      const { manager, ui, map } = initFixture();

      // `getPane` in the fixture returns a fresh div per call, so a write and a
      // later read would never meet. Stable panes per name, attached to the map
      // container, stand in for Leaflet's registry.
      const container = map._container as HTMLElement;
      const panes = new Map<string, HTMLElement>();
      const paneFor = (name: string) => {
        let pane = panes.get(name);
        if (!pane) {
          pane = document.createElement("div");
          pane.classList.add("foliplus-layer-pane");
          container.appendChild(pane);
          panes.set(name, pane);
        }
        return pane;
      };
      map.getPane = vi.fn((name: string) => paneFor(name));
      map.createPane = vi.fn((name: string) => paneFor(name));
      map.getPanes = vi.fn(() => ({ mapPane: document.createElement("div") }));
      map.latLngToContainerPoint = vi.fn(() => ({ x: 10, y: 20 }));
      (window.L as unknown as { DomUtil: unknown }).DomUtil = {
        getPosition: () => ({ x: 0, y: 0 }),
      };

      ui.opacityMap.overlay1 = 0.3;
      ui.userOverrides.overlay1 = ["opacity"];
      applyOpacityStateOne(ui, manager.layerRegistry.get("overlay1")!, 0.3);

      manager.annotation.setConfig("overlay1", {
        show: true,
        field: "v",
        color: "#ffffff",
        size: 11,
        format: "auto",
        collide: true,
      });
      (manager.layerRegistry.get("overlay1") as { layer: L.Layer }).layer =
        labelLayer();
      manager.annotation.renderLabels("overlay1");

      const pane = panes.get(CONST.ANNOTATION_PANE_PREFIX + "overlay1");
      expect(pane, "the annotation pane was created").toBeTruthy();
      expect(getComputedStyle(pane!).opacity).toBe("0.3");
    });
  });

  describe("order", () => {
    it("places a late registration at its persisted position", () => {
      seedStorage({ order: ["B", "H", "A"] });
      const { map } = makeMap();
      const m = new LayerManager(map as unknown as L.Map, [
        { id: "A", name: "A", isBase: false },
        { id: "B", name: "B", isBase: false },
      ]);

      m.registerLayer({ id: "H", name: "H", isBase: false });

      expect(m.layers.map(l => l.id)).toEqual(["B", "H", "A"]);
    });

    it("keeps a stored position across a flush that lands first", () => {
      // A flush between the record being loaded and the late registration
      // writes the live ids only; the stored position of the id that is not
      // registered yet must survive it.
      seedStorage({ order: ["B", "H", "A"] });
      const { map } = makeMap();
      const m = new LayerManager(map as unknown as L.Map, [
        { id: "A", name: "A", isBase: false },
        { id: "B", name: "B", isBase: false },
      ]);

      m.saveOrder();
      m.persistence.flushAll();

      const record = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!) as {
        order: string[] | null;
      };
      expect(record.order).toContain("H");
    });
  });

  describe("annotations", () => {
    it("keeps config for an id that is not registered yet", () => {
      seedStorage({
        annotations: {
          H: { show: true, field: "v", format: "auto", color: "#ffffff", size: 11 },
        },
      });

      expect(new LayerPersistence({ layers: [] } as never).load().annotations).toEqual({
        H: { show: true, field: "v", format: "auto", color: "#ffffff", size: 11 },
      });
    });
  });
});
