import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  applyUserState,
  dropPersistedLayerState,
  loadPersistedState,
  markOverride,
  saveFoldState,
  saveNamesState,
  saveState,
  setVisible,
  unmarkOverride,
} from "#foliplus/LayerControl/ui/state.js";
import { EVENTS, ensureEvents } from "#foliplus/core/event/index.js";
import { GEOM_TYPE } from "#foliplus/core/layer/const.js";
import type { LayerInfo, PaneSpec } from "#foliplus/core/layer/index.js";
import { ensureModes } from "#foliplus/core/mode.js";
import {
  allFolded,
  attachWithGroup,
  findItem,
  initFixture,
  overlayFoldBtn,
  pressKey,
} from "./fixture.js";
import { GridLayer, TileLayer, installLeafletGlobals } from "./fixture.js";

/** The pane spec list `createLayers` derives from an ordered name list: the
 *  first name is the base pane, everything after it a `sub`. */
const specs = (...names: string[]): PaneSpec[] =>
  names.map((name, i) => ({ role: i === 0 ? "base" : "sub", order: i, name }));

describe("LayerUI visibility persistence (visibleMap)", () => {
  // Reusable layer stubs at module scope so standalone test blocks don't
  // depend on initFixture()'s internal scope.
  const testPolyLayer = {
    options: {},
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => ({ isValid: () => true })),
  };

  const makeTestMap = () => {
    const removeLayer = vi.fn();
    const addLayer = vi.fn();
    const panes = new Map<
      string,
      {
        style: Record<string, string>;
        classList: { add: () => void; remove: () => void };
      }
    >();
    const getPane = vi.fn((name: string) => {
      let p = panes.get(name);
      if (!p) {
        p = { style: {}, classList: { add: vi.fn(), remove: vi.fn() } };
        panes.set(name, p);
      }
      return p;
    });
    return {
      map: {
        on: vi.fn(),
        off: vi.fn(),
        hasLayer: vi.fn(l => l === testPolyLayer),
        addLayer,
        removeLayer,
        getContainer: vi.fn(() => {
          const el = document.createElement("div");
          el.id = "map";
          return el;
        }),
        getPane,
        getPanes: vi.fn(() => ({ mapPane: document.createElement("div") })),
        createPane: vi.fn(() => document.createElement("div")),
        options: { maxZoom: 18 },
        foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
      },
      addLayer,
      removeLayer,
      panes,
    };
  };

  beforeEach(() => {
    installLeafletGlobals();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  // ─────────────────── load / apply on attach ───────────────────

  describe("loadPersistedState / applyUserState", () => {
    it("restores a hidden overlay on attach and removes it from the map", () => {
      const { map, removeLayer } = makeTestMap();
      const m = new LayerManager(map, [
        {
          id: "overlay1",
          name: "Polygons",
          group: "overlay",
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m);
      u.visibleMap = {overlay1: false};
      u.intentProvenance = { overlay1: ["visible"] };

      u.applyUserState();

      expect(removeLayer).toHaveBeenCalledWith(testPolyLayer);
      expect(u.visibleMap["overlay1"] === false).toBe(true);
      expect(u.intentVisible("overlay1")).toBe(false);
    });

    it("re-adds a layer the user un-hid, once the visibility key exists", () => {
      // folium renders a show=False layer absent from the map and nothing else
      // puts it back, so the hide half of the round trip had no inverse: a
      // layer the user left visible was correctly absent from visibleMap, and the
      // sweep left it off the map. That is what made a checked Commuting Routes
      // come back unchecked after a reload.
      const { map, removeLayer } = makeTestMap();
      const m = new LayerManager(map, [
        {
          id: "overlay1",
          name: "Polygons",
          group: "overlay",
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m);
      // The user checked the layer ON, so it is absent from visibleMap -- but the
      // key exists, so every registered layer must be on the map.
      u.visibleMap = {other: false};
      // The user unhid overlay1 (a `show=False` folium layer), so it is absent
      // from visibleMap -- but a `visible` override says it must come back on.
      u.intentProvenance = { overlay1: ["visible"] };
      // Simulate the layer being off the map (folium show=False).
      map.hasLayer = vi.fn(() => false);

      u.applyUserState();

      expect(map.addLayer).toHaveBeenCalledWith(testPolyLayer);
      expect(removeLayer).not.toHaveBeenCalled();
      expect(m.intentVisible("overlay1")).toBe(true);
    });

    it("leaves the author's show=False defaults alone when the key is absent", () => {
      // No visibility key means the user never chose, so an unhide sweep must
      // not override the author's show=False. Without this guard the first load
      // of a map like QuickStart re-added every hidden overlay.
      const { map } = makeTestMap();
      const m = new LayerManager(map, [
        {
          id: "overlay1",
          name: "Polygons",
          group: "overlay",
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m);
      u.visibleMap = {};
      // No user override —overlay1 keeps its author's declared state, which
      // is `show=False` (absent from the map). Nothing must force it on.
      u.intentProvenance = {};
      map.hasLayer = vi.fn(() => false);

      u.applyUserState();

      expect(map.addLayer).not.toHaveBeenCalled();
      // The author's `show=False` default is not a user choice, so the
      // intent record stays untouched — the layer's membership on the map
      // reflects that author default, not this load's decision.
      expect(m.intentVisible("overlay1")).toBe(true);
    });

    it("writes the canvas HIDDEN class for a callback-only layer the user un-hid", () => {
      // Canvas/heatmap layers have no Leaflet layer to addLayer, so the inverse
      // path must clear the canvas's `HIDDEN` class instead or they stay
      // hidden after a reload.
      const { map } = makeTestMap();
      const canvas = document.createElement("canvas");
      canvas.classList.add("hidden");
      const m = new LayerManager(map, [
        {
          id: "canvas1",
          name: "Canvas",
          layer: null,
          canvas,
        },
      ]);
      const u = new LayerUI(m);
      u.visibleMap = {};
      // A canvas layer with a `visible` override clears `HIDDEN` instead of
      // `addLayer` -- it has no Leaflet layer to add.
      u.intentProvenance = { canvas1: ["visible"] };

      u.applyUserState();

      expect(canvas.classList.contains("hidden")).toBe(false);
    });

    it("keeps hidden ids that have no registry entry", () => {
      // A missing registry entry is not evidence that the stored state should
      // go: HeatmapControl and MeasureControl register in their own
      // constructor, after this UI has attached, so their ids are unresolvable
      // on the first sweep. A queued registration and an id never seen are
      // indistinguishable here, and either may still arrive —both are kept.
      const { map } = makeTestMap();
      const m = new LayerManager(map, [
        {
          id: "overlay1",
          name: "Polygons",
          group: "overlay",
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m);
      u.visibleMap = {overlay1: false, later: false, ghost: false, gone: false};
      m.pendingRegistrations.push({
        id: "later",
        name: "Later",
        group: "overlay",
        layer: testPolyLayer,
      } as any);

      u.applyUserState();

      expect(u.visibleMap).toEqual({overlay1: false, later: false, ghost: false, gone: false});
    });

    it("schedules no write and drops no stored id", () => {
      // The sweep used to delete the ids that were not in the registry and
      // write the deletion back to storage. That is the bug this file guards:
      // a late-registering layer (heatmap, measure) lost its stored hidden
      // state on the first attach of every reload, so it came back visible
      // with no explanation. The sweep is a projection now; the record is
      // read-only as far as it is concerned.
      window.localStorage.setItem(
        CONST.STORAGE.KEY,
        JSON.stringify({
          layers: {
            overlay1: { visible: false, overrides: ["visible"] },
            ghost: { visible: false, overrides: ["visible"] },
            gone: { visible: false, overrides: ["visible"] },
          },
        }),
      );
      const { map } = makeTestMap();
      const m = new LayerManager(map, [
        {
          id: "overlay1",
          name: "Polygons",
          group: "overlay",
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m);
      u.loadPersistedState();
      const schedule = vi.spyOn(u.m.persistence, "schedule");

      u.applyUserState();

      expect(schedule).not.toHaveBeenCalled();
      expect(u.visibleMap).toEqual({overlay1: false, ghost: false, gone: false});
      const stored = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!);
      expect(Object.keys(stored.layers).sort()).toEqual(["ghost", "gone", "overlay1"]);
    });

    it("writes the canvas HIDDEN class for canvas-only layers (canvas/heatmap)", () => {
      const { map } = makeTestMap();
      const canvas = document.createElement("canvas");
      const m = new LayerManager(map, [
        {
          id: "canvas1",
          name: "Canvas",
          layer: null,
          canvas,
        },
      ]);
      const u = new LayerUI(m);
      u.visibleMap["canvas1"] = false;

      u.applyUserState();

      expect(canvas.classList.contains("hidden")).toBe(true);
    });

    it("loads hidden ids from localStorage into visibleMap", () => {
      const { map } = makeTestMap();
      window.localStorage.setItem(
        CONST.STORAGE.KEY,
        JSON.stringify({
          layers: {
            overlay1: { visible: false, overrides: ["visible"] },
            base1: { visible: false, overrides: ["visible"] },
          },
        }),
      );
      const m = new LayerManager(map, [
        { id: "overlay1", name: "O", group: "overlay", layer: testPolyLayer },
        { id: "base1", name: "B", group: "base", layer: new TileLayer() },
      ]);
      const u = new LayerUI(m);

      u.loadPersistedState();

      expect(u.visibleMap).toEqual({overlay1: false, base1: false});
    });

    it("loads persisted fill color and opacity into their maps", () => {
      const { map } = makeTestMap();
      window.localStorage.setItem(
        CONST.STORAGE.KEY,
        JSON.stringify({
          layers: {
            overlay1: {
              fillColor: "#ff8800",
              fillOpacity: 0.35,
              overrides: ["fillColor", "fillOpacity"],
            },
          },
        }),
      );
      const m = new LayerManager(map, [
        { id: "overlay1", name: "O", group: "overlay", layer: testPolyLayer },
      ]);
      const u = new LayerUI(m);

      u.loadPersistedState();

      expect(u.fillColorMap["overlay1"]).toBe("#ff8800");
      expect(u.fillOpacityMap["overlay1"]).toBe(0.35);
      expect(u.intentProvenance["overlay1"]).toEqual(["fillColor", "fillOpacity"]);
    });

    it("ignores a fill override whose value is missing or invalid", () => {
      const { map } = makeTestMap();
      window.localStorage.setItem(
        CONST.STORAGE.KEY,
        JSON.stringify({
          layers: {
            a: { overrides: ["fillColor"] },
            b: { fillColor: "", overrides: ["fillColor"] },
            c: { fillOpacity: "high", overrides: ["fillOpacity"] },
            d: { fillColor: "#00ff00", overrides: ["fillColor"] },
          },
        }),
      );
      const m = new LayerManager(map, [
        { id: "a", name: "A", group: "overlay", layer: testPolyLayer },
        { id: "b", name: "B", group: "overlay", layer: testPolyLayer },
        { id: "c", name: "C", group: "overlay", layer: testPolyLayer },
        { id: "d", name: "D", group: "overlay", layer: testPolyLayer },
      ]);
      const u = new LayerUI(m);

      u.loadPersistedState();

      expect(u.fillColorMap["a"]).toBeUndefined();
      expect(u.fillColorMap["b"]).toBeUndefined();
      expect(u.fillOpacityMap["c"]).toBeUndefined();
      expect(u.fillColorMap["d"]).toBe("#00ff00");
    });

    it("dropPersistedLayerState clears the fill maps and their provenance", () => {
      const { map } = makeTestMap();
      const m = new LayerManager(map, [
        { id: "overlay1", name: "O", group: "overlay", layer: testPolyLayer },
      ]);
      const u = new LayerUI(m);
      u.visibleMap["overlay1"] = false;
      u.opacityMap["overlay1"] = 0.5;
      u.zoomRangeMap["overlay1"] = [3, 12];
      u.fillColorMap["overlay1"] = "#ff0000";
      u.fillOpacityMap["overlay1"] = 0.5;
      u.intentProvenance["overlay1"] = [
        "visible",
        "opacity",
        "zoomRange",
        "fillColor",
        "fillOpacity",
      ];

      dropPersistedLayerState(u, "overlay1");

      expect(u.visibleMap["overlay1"] === false).toBe(false);
      expect(u.opacityMap["overlay1"]).toBeUndefined();
      expect(u.zoomRangeMap["overlay1"]).toBeUndefined();
      expect(u.fillColorMap["overlay1"]).toBeUndefined();
      expect(u.fillOpacityMap["overlay1"]).toBeUndefined();
      expect(u.intentProvenance["overlay1"]).toBeUndefined();
    });

    it("ignores non-array/corrupt storage data", () => {
      const { map } = makeTestMap();
      window.localStorage.setItem(CONST.STORAGE.KEY, "not-json");
      const m = new LayerManager(map, [
        { id: "overlay1", name: "O", group: "overlay", layer: testPolyLayer },
      ]);
      const u = new LayerUI(m);

      u.loadPersistedState();

      expect(u.visibleMap).toEqual({});
    });
  });

  // ─────────────────── save on toggle ───────────────────

  describe("saveState on toggle", () => {
    it("persists a hidden overlay when the user unchecks it", () => {
      const { map, removeLayer } = makeTestMap();
      const m = new LayerManager(map, [
        {
          id: "overlay1",
          name: "Polygons",
          group: "overlay",
          layer: testPolyLayer,
        },
      ]);
      map.hasLayer.mockReturnValue(true);
      const u = new LayerUI(m);
      u.visibleMap = {};

      vi.useFakeTimers();
      u.setVisible("overlay1", false);
      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
      vi.useRealTimers();

      // The record carries both the value and the provenance: a hidden layer
      // shows up under `layers` with `visible: false` and a `visible` override.
      const stored = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!);
      expect(stored.layers.overlay1.visible).toBe(false);
      expect(stored.layers.overlay1.overrides).toContain("visible");
    });

    it("records a re-check as visible:true so the layer comes back on reload", () => {
      // The old test asserted the id was dropped from the hidden array; the new
      // model keeps the entry because it knows the user touched it, and reload
      // must restore `visible=true` rather than reverting to the author's
      // `show=False` default.
      const { map } = makeTestMap();
      const m = new LayerManager(map, [
        {
          id: "overlay1",
          name: "Polygons",
          group: "overlay",
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m);
      u.visibleMap = {overlay1: false};
      u.intentProvenance = { overlay1: ["visible"] };

      vi.useFakeTimers();
      u.setVisible("overlay1", true);
      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
      vi.useRealTimers();

      const stored = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!);
      expect(stored.layers.overlay1.visible).toBe(true);
      expect(stored.layers.overlay1.overrides).toContain("visible");
    });

    it("debounces rapid saves into one localStorage write", () => {
      const { map } = makeTestMap();
      const m = new LayerManager(map, [
        { id: "overlay1", name: "O", group: "overlay", layer: testPolyLayer },
      ]);
      const u = new LayerUI(m);

      vi.useFakeTimers();
      const originalStorage = window.localStorage;
      const setItem = vi.fn();
      Object.defineProperty(window, "localStorage", {
        value: {
          getItem: () => null,
          setItem,
          removeItem: vi.fn(),
          clear: () => {
            setItem.mockReset();
          },
        },
        writable: true,
        configurable: true,
      });
      try {
        u.setVisible("overlay1", false);
        u.setVisible("overlay1", true);
        u.setVisible("overlay1", false);
        expect(setItem).not.toHaveBeenCalled();

        vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
      } finally {
        Object.defineProperty(window, "localStorage", {
          value: originalStorage,
          writable: true,
          configurable: true,
        });
        vi.useRealTimers();
      }

      expect(setItem).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────── color-layer is transient ───────────────────

  describe("color layer activation is transient", () => {
    it("does not pollute visibleMap when color layer activates", () => {
      const { map } = makeTestMap();
      const m = new LayerManager(map, [
        { id: "overlay1", name: "O", group: "overlay", layer: testPolyLayer },
        { id: "base1", name: "OSM", group: "base", layer: new TileLayer() },
      ]);
      const u = new LayerUI(m);
      u.visibleMap = {overlay1: false};
      // Simulate a container + rows so showSolidBasemap can iterate bases.
      const container = document.createElement("div");
      document.body.appendChild(container);
      m.uiContainer = container;
      map.getPane.mockReturnValue({
        classList: { add: vi.fn(), remove: vi.fn() },
        appendChild: vi.fn(),
        style: {},
      });

      u.showSolidBasemap("#000000");

      // overlay1 was hidden before the color activation and should stay hidden.
      expect(u.visibleMap["overlay1"] === false).toBe(true);
      // No base-layer id was added even though showSolidBasemap deselects all bases.
      expect(u.visibleMap).toEqual({overlay1: false});
    });
  });

  // ─────────────────── initTypesAndVisibility color-fallback semantics ──

  describe("color-layer fallback respects hidden state", () => {
    beforeEach(() => {
      window.localStorage.clear();
      vi.useRealTimers();
    });

    afterEach(() => {
      document.body.innerHTML = "";
      vi.clearAllMocks();
      vi.useRealTimers();
      window.localStorage.clear();
    });

    // Build a fixture with an explicit set of layers and control the 300ms
    // initTypesAndVisibility timeout so the full attach flow runs deterministically.
    const attachFixture = (
      data: Array<{
        id: string;
        name: string;
        group?: "base" | "overlay";
        layer?: any;
      }>,
    ) => {
      window.CONF.name = "LayerControl";
      window.CONF.locale_code = "en";
      const removeLayer = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      const map: any = {
        on: vi.fn(),
        off: vi.fn(),
        invalidateSize: vi.fn(),
        hasLayer: vi.fn(() => true),
        addLayer: vi.fn(),
        removeLayer,
        fitBounds: vi.fn(),
        flyTo: vi.fn(),
        getZoom: vi.fn(() => 5),
        getMaxZoom: vi.fn(() => 18),
        getMinZoom: vi.fn(() => 0),
        options: { maxZoom: 18 },
        getBounds: vi.fn(() => ({
          pad: vi.fn(() => ({})),
          getSouthWest: () => ({ lat: 20, lng: 90 }),
          getNorthWest: () => ({ lat: 50, lng: 90 }),
          getNorthEast: () => ({ lat: 50, lng: 120 }),
          getSouthEast: () => ({ lat: 20, lng: 120 }),
        })),
        getContainer: vi.fn(() => container),
        getPane: vi.fn(() => document.createElement("div")),
        getPanes: vi.fn(() => ({ mapPane: document.createElement("div") })),
        createPane: vi.fn(() => document.createElement("div")),
        _container: container,
        _layers: {},
        options: { maxZoom: 18 },
        attributionControl: { _attributions: {}, _update: vi.fn() },
        foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
      };
      const manager = new LayerManager(map, data);
      manager.enforceOrder();
      manager.ui = new LayerUI(manager);
      vi.useFakeTimers();
      manager.attachUI(container);
      vi.advanceTimersByTime(350);
      vi.useRealTimers();
      return { manager, ui: manager.ui!, map, removeLayer };
    };

    it("does NOT show the color layer when all registered base layers are hidden", () => {
      const poly = {
        options: {},
        eachLayer: vi.fn(),
        getBounds: vi.fn(() => ({ isValid: vi.fn(() => true) })),
      };
      const base1 = new TileLayer();
      const base2 = new TileLayer();
      window.localStorage.setItem(
        CONST.STORAGE.KEY,
        JSON.stringify({
          layers: {
            base1: { visible: false, overrides: ["visible"] },
            base2: { visible: false, overrides: ["visible"] },
          },
        }),
      );
      const { ui, map } = attachFixture([
        { id: "overlay1", name: "O", group: "overlay", layer: poly },
        {
          id: "base1",
          name: "B1",
          group: "base",
          layer: base1,
          paneName: "tilePane",
        },
        {
          id: "base2",
          name: "B2",
          group: "base",
          layer: base2,
          paneName: "tilePane",
        },
      ]);

      // Both bases were removed from the map by applyUserState().
      expect(map.removeLayer).toHaveBeenCalledWith(base1);
      expect(map.removeLayer).toHaveBeenCalledWith(base2);
      // Color-layer fallback must NOT activate when the user intentionally hid every base.
      const colorItem = ui.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
      ) as HTMLElement | null;
      expect(colorItem?.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
      // The hidden set is preserved after the attach pass.
      expect(ui.visibleMap).toEqual({base1: false, base2: false});
    });

    it("does not activate the colour layer when no base layers are registered", () => {
      // Intent-only invariant: no code fallback when there are no basemaps.
      // First-load visibility is the author's `show=` —if the author wrote
      // no basemap, the map is empty (A—hatch) rather than the colour being
      // silently drawn to fill the blank.
      const poly = {
        options: {},
        eachLayer: vi.fn(),
        getBounds: vi.fn(() => ({ isValid: vi.fn(() => true) })),
      };
      const { ui, map } = attachFixture([
        { id: "overlay1", name: "O", group: "overlay", layer: poly },
      ]);

      const colorItem = ui.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
      ) as HTMLElement | null;
      expect(colorItem?.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
      expect(map.removeLayer).not.toHaveBeenCalled();
      expect(ui.visibleMap).toEqual({});
    });

    it("keeps the color layer off when at least one base layer remains visible", () => {
      const poly = {
        options: {},
        eachLayer: vi.fn(),
        getBounds: vi.fn(() => ({ isValid: vi.fn(() => true) })),
      };
      const base1 = new TileLayer();
      window.localStorage.setItem(
        CONST.STORAGE.KEY,
        JSON.stringify({
          layers: { base1: { visible: false, overrides: ["visible"] } },
        }),
      );
      const { ui, map } = attachFixture([
        { id: "overlay1", name: "O", group: "overlay", layer: poly },
        {
          id: "base1",
          name: "B1",
          group: "base",
          layer: base1,
          paneName: "tilePane",
        },
      ]);

      // base1 was hidden, but overlay1 is visible and there are no visible bases.
      // However, only base1 is hidden (not "all bases"), so the color fallback
      // must NOT activate —the user might re-show base1 at any time.
      expect(map.removeLayer).toHaveBeenCalledWith(base1);
      const colorItem = ui.uiContainer.querySelector(
        `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
      ) as HTMLElement | null;
      expect(colorItem?.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
    });
  });

  // ─────────────────── applyUserState with multiple layers ───────────────────

  describe("applyUserState with multiple hidden layers", () => {
    it("handles overlay, base, and canvas layers in one pass", () => {
      const poly = {
        options: {},
        eachLayer: vi.fn(),
        getBounds: vi.fn(() => ({ isValid: vi.fn(() => true) })),
      };
      const baseLayer = new TileLayer();
      const canvas = document.createElement("canvas");
      const { map, removeLayer } = (() => {
        const rl = vi.fn();
        return {
          map: {
            on: vi.fn(),
            off: vi.fn(),
            hasLayer: vi.fn(() => true),
            addLayer: vi.fn(),
            removeLayer: rl,
            getContainer: vi.fn(() => document.createElement("div")),
            getPane: vi.fn(() => document.createElement("div")),
            getPanes: vi.fn(() => ({ mapPane: document.createElement("div") })),
            createPane: vi.fn(() => document.createElement("div")),
            options: { maxZoom: 18 },
            foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
          },
          removeLayer: rl,
        };
      })();
      const m = new LayerManager(map, [
        { id: "overlay1", name: "O", group: "overlay", layer: poly },
        { id: "base1", name: "B1", group: "base", layer: baseLayer },
        { id: "canvas1", name: "Canvas", layer: null, canvas },
      ]);
      const u = new LayerUI(m);
      u.visibleMap = {overlay1: false, base1: false, canvas1: false};
      u.intentProvenance = {
        overlay1: ["visible"],
        base1: ["visible"],
        canvas1: ["visible"],
      };

      u.applyUserState();

      expect(removeLayer).toHaveBeenCalledWith(poly);
      expect(removeLayer).toHaveBeenCalledWith(baseLayer);
      expect(canvas.classList.contains("hidden")).toBe(true);
      expect(u.intentVisible("overlay1")).toBe(false);
      expect(u.intentVisible("base1")).toBe(false);
      expect(u.intentVisible("canvas1")).toBe(false);
      expect(u.visibleMap).toEqual({overlay1: false, base1: false, canvas1: false});
    });
  });
});

describe("label config seed — read order (write-new / read-old)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("layers[id].annotation wins over the legacy segment; legacy alone still seeds", () => {
    // The compat contract in one round trip: a record carrying BOTH keys
    // for the same id reads the current one, an id only the legacy segment
    // knows (a v2 record) still seeds, and neither side is migrated into
    // the other by the read.
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({
        version: 3,
        annotations: {
          legacyOnly: { show: true, field: "l", format: "int" },
          both: { show: false, field: "old" },
        },
        layers: {
          both: {
            overrides: [],
            annotation: { show: true, field: "new", format: "comma" },
          },
          withOverride: {
            overrides: ["opacity"],
            opacity: 0.5,
            annotation: { show: true, field: "p" },
          },
        },
      }),
    );
    const { ui } = initFixture();
    loadPersistedState(ui);

    expect(ui.labelConfigs.both).toEqual({
      show: true,
      field: "new",
      format: "comma",
    });
    expect(ui.labelConfigs.legacyOnly).toEqual({
      show: true,
      field: "l",
      format: "int",
    });
    expect(ui.labelConfigs.withOverride).toEqual({ show: true, field: "p" });
  });
});

describe("ui/state saveFoldState", () => {
  it("schedules the folded set through persistence", () => {
    const schedule = vi.fn();
    const ui = {
      foldedGroups: new Set(["overlay"]),
      m: {
        persistence: { schedule },
        annotation: { configEntries: () => [] },
      },
    } as unknown as LayerUI;
    saveFoldState(ui);
    // schedule takes a getter map so a later write can read the live state
    // instead of a snapshot at schedule time.
    expect(schedule).toHaveBeenCalledTimes(1);
    const fields = schedule.mock.calls[0][0] as { foldedGroups: () => string[] };
    expect(fields.foldedGroups()).toEqual(["overlay"]);
  });
});

// ─────────────────── opacity apply / restore / retention ─────────────────

describe("LayerUI opacity restore / retention", () => {
  const makeMap = () => {
    const setStyle = vi.fn();
    const layer = { options: {}, setStyle } as unknown as L.Layer;
    const panes = new Map<
      string,
      {
        style: Record<string, string>;
        classList: { add: () => void; remove: () => void };
      }
    >();
    const getPane = vi.fn((name: string) => {
      let p = panes.get(name);
      if (!p) {
        p = { style: {}, classList: { add: vi.fn(), remove: vi.fn() } };
        panes.set(name, p);
      }
      return p;
    });
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      hasLayer: vi.fn(() => true),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getContainer: vi.fn(() => {
        const el = document.createElement("div");
        el.id = "map";
        return el;
      }),
      getPane,
      createPane: vi.fn(() => ({
        style: {},
        classList: { add: vi.fn(), remove: vi.fn() },
      })),
      foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
      getZoom: vi.fn(() => 4),
      getMaxZoom: vi.fn(() => 18),
      getMinZoom: vi.fn(() => 0),
      options: { maxZoom: 18 },
    };
    return { map, layer, setStyle, panes };
  };

  beforeEach(() => {
    installLeafletGlobals();
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("applyUserState restores a stored opacity onto Path layers", () => {
    const { map, layer, panes } = makeMap();
    const m = new LayerManager(map, [{ id: "overlay1", name: "Poly", layer }]);
    const u = new LayerUI(m);
    u.opacityMap = { overlay1: 0.45 };

    u.applyUserState();

    expect(m.layerRegistry.get("overlay1")?.opacity).toBe(0.45);
    // The pane carrier received the write (multiplicative over each feature).
    const writtenPane = [...panes.values()].find(p => p.style.opacity === "0.45");
    expect(writtenPane).toBeDefined();
  });

  it("applyUserState(id) applies opacity for a late-registered canvas layer", () => {
    const { map } = makeMap();
    const canvas = document.createElement("canvas");
    const m = new LayerManager(map, [
      { id: "heat", name: "Heat", canvas, layer: null },
    ]);
    const u = new LayerUI(m);
    u.opacityMap = { heat: 0.25 };

    u.applyUserState("heat");

    expect(canvas.style.opacity).toBe("0.25");
    expect(m.layerRegistry.get("heat")?.opacity).toBe(0.25);
  });

  it("keeps opacity entries whose layers are gone", () => {
    // An unresolvable id is not a leak to clean up —it may belong to a
    // component that registers later, and the user's stored opacity must not
    // revert to the author default while it waits.
    const { map, layer, panes } = makeMap();
    const m = new LayerManager(map, [{ id: "overlay1", name: "Poly", layer }]);
    const u = new LayerUI(m);
    u.opacityMap = { overlay1: 0.4, ghost: 0.1 };

    u.applyUserState();

    expect(u.opacityMap).toEqual({ overlay1: 0.4, ghost: 0.1 });
    // The live entry was written to the pane; the unresolvable one was kept
    // in memory and written nowhere.
    const writtenPanes = [...panes.values()].filter(p => p.style.opacity);
    expect(writtenPanes).toHaveLength(1);
    expect(writtenPanes[0].style.opacity).toBe("0.4");
  });

  it("keeps a zoom range and its provenance for a layer that is gone", () => {
    // Both halves stay. Only a provenance marker with no value is invalid
    // ({@link markOverride} refuses it), never a value whose layer has not
    // registered yet.
    const { map, layer } = makeMap();
    const m = new LayerManager(map, [{ id: "overlay1", name: "Poly", layer }]);
    const u = new LayerUI(m);
    u.zoomRangeMap = { overlay1: [4, 10], ghost: [2, 8] };
    u.intentProvenance = { ghost: ["zoomRange"] };

    u.applyUserState();

    expect(u.zoomRangeMap).toEqual({ overlay1: [4, 10], ghost: [2, 8] });
    expect(u.intentProvenance.ghost).toEqual(["zoomRange"]);
  });

  it("leaves a live layer alone when no opacity is stored", () => {
    const { map, layer, setStyle } = makeMap();
    const m = new LayerManager(map, [{ id: "overlay1", name: "Poly", layer }]);
    const u = new LayerUI(m);
    u.opacityMap = {};

    u.applyUserState();

    expect(setStyle).not.toHaveBeenCalled();
    expect(m.layerRegistry.get("overlay1")?.opacity).toBe(1);
  });
});

describe("event-driven row refresh", () => {
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    if (!manager.layerRegistry.get("overlay2")) {
      manager.registerLayer({
        id: "overlay2",
        name: "Circles",
        group: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
      });
    }
    window.localStorage.clear();
  });

  it("onLayerItemCountChange re-renders the type label and count column", () => {
    const events = ensureEvents(ui.m.map);
    const info = manager.layerRegistry.get("overlay1")!;
    // A numeric feature-count provider makes the count column render (the
    // fixture's default layers have none).
    info.featureCountProvider = () => 42;

    const item = findItem(ui, "overlay1");
    events.emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "overlay1" });

    expect(item.title).toContain("42");
    expect(item.querySelector(CONST.SEL.COUNT_COL)?.textContent).toContain("42");
    // The type icon column re-detects geometry for an iconSvg-less layer.
    expect(item.querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`)).not.toBeNull();
  });

  it("onLayerItemCountChange re-stamps the type snapshot from the surface's probe", () => {
    // 33.2 authority: the surface owns the geometry probe; the manager never
    // calls getGeometryType directly. Writing layerInfo.type here is a snapshot
    // sync for render, not a second source of truth. The fixture's plain object
    // is not an L.Polygon, so the surface resolves it to EMPTY, which the
    // branch stamps verbatim.
    const info = manager.layerRegistry.get("overlay1")!;
    const geomSpy = vi
      .spyOn(manager.surfaces.get("overlay1"), "geometryType")
      .mockReturnValue(GEOM_TYPE.POLYGON);

    ensureEvents(ui.m.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "overlay1" });

    expect(geomSpy).toHaveBeenCalledTimes(1);
    expect(info.type).toBe(GEOM_TYPE.POLYGON);
    expect(
      findItem(ui, "overlay1").querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`),
    ).not.toBeNull();
  });

  it("onLayerItemCountChange falls back to UNKNOWN for an iconSvg-less layer with no resolvable layer object", () => {
    // Canvas / late-registered surface: findLayer returns null, so the branch
    // paints SVGs.UNKNOWN and stamps the snapshot.
    const info = manager.layerRegistry.get("overlay1")!;
    vi.spyOn(manager, "findLayer").mockReturnValue(null);

    ensureEvents(ui.m.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "overlay1" });

    expect(info.type).toBe(GEOM_TYPE.UNKNOWN);
    expect(
      findItem(ui, "overlay1").querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`)
        ?.innerHTML,
    ).toContain("svg");
  });

  it("onLayerItemCountChange leaves an iconSvg layer's custom SVG untouched", () => {
    // iconSvg-only layers short-circuit the geometry branch: the type column
    // keeps the custom icon, layerInfo.type stays at CUSTOM (list.ts stamped it
    // at init), and the surface is never probed.
    const iconSvg = '<svg viewBox="0 0 8 8"><rect width="8" height="8"/></svg>';
    manager.registerLayer({
      id: "custom1",
      name: "Custom",
      group: "overlay",
      iconSvg,
    });
    const info = manager.layerRegistry.get("custom1")!;
    const item = findItem(ui, "custom1");
    expect(info.type).toBe(GEOM_TYPE.CUSTOM);
    expect(item.querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`)?.innerHTML).toContain(
      "rect",
    );

    ensureEvents(ui.m.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "custom1" });

    expect(item.querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`)?.innerHTML).toContain(
      "rect",
    );
    expect(info.type).toBe(GEOM_TYPE.CUSTOM);
  });

  it("onLayerItemCountChange re-applies the layer opacity to finalized geometry", () => {
    // A measurement finalized at store.add fires LAYER_ITEM_COUNT_CHANGE. The
    // panes were painted at full opacity while the preview was live; this is
    // when the opacity "snaps in" to the real geometry.
    const events = ensureEvents(ui.m.map);
    const li = manager.layerRegistry.get("overlay1")!;
    li.paneSpecs = specs("__test_opacity_pane__");
    // The projection reads `opacityMap[id]` gated by the `intentProvenance`
    // provenance marker, so both must be set for the stored value to flow
    // through —a raw `opacityMap` write is not a user intent.
    ui.opacityMap = { overlay1: 0.4 };
    ui.intentProvenance.overlay1 = ["opacity"];

    const paneEl = document.createElement("div");
    vi.spyOn(manager.map, "getPane").mockReturnValue(paneEl);

    events.emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "overlay1" });

    expect(paneEl.style.opacity).toBe("0.4");
    expect(li.opacity).toBe(0.4);
  });

  it("subscribeControlAttached reruns init when another control attaches", () => {
    const events = ensureEvents(ui.m.map);
    events.emit(EVENTS.CONTROL_ATTACHED, { component: "ScaleControl" });
    // The callback keeps the rendered rows intact (init re-syncs, no error).
    expect(
      ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.LAYER_ITEM}`).length,
    ).toBeGreaterThan(0);
  });
});

// ─────────────────── intentProvenance + per-layer persistence ───────────────────

describe("ui/state intentProvenance and per-layer state persistence", () => {
  let manager: LayerManager;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("a user hide goes into visibleMap and persists visible:false", () => {
    // The record has to distinguish "user hid it" from "author declared
    // show=False" -- the same visibleMap value is either. markOverride is what
    // records that distinction: without it, reload would drop the id and the
    // layer would come back visible, undoing the user's last choice.
    const schedule = vi.fn();
    const bare = {
      visibleMap: {},
      opacityMap: {},
      fillColorMap: {},
      fillOpacityMap: {},
      intentProvenance: {},
      m: {
        persistence: { schedule },
        annotation: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    setVisible(bare, "overlay1", false);

    expect(bare.intentProvenance.overlay1).toContain("visible");
    const fields = schedule.mock.calls[0][0] as {
      layers: () => Record<string, { visible?: boolean; overrides: string[] }>;
    };
    expect(fields.layers()).toEqual({
      overlay1: { visible: false, overrides: ["visible"] },
    });
  });

  it("a user unhide persists visible:true rather than dropping the entry", () => {
    // The old test asserted the id was dropped from the hidden set. The new
    // model keeps the entry because it knows the user touched the layer --
    // dropping it would fall back to the author's show=False default, so the
    // unhide would only be visible for the current session.
    const schedule = vi.fn();
    const bare = {
      visibleMap: {overlay1: false},
      opacityMap: {},
      fillColorMap: {},
      fillOpacityMap: {},
      intentProvenance: { overlay1: ["visible"] },
      m: {
        persistence: { schedule },
        annotation: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    setVisible(bare, "overlay1", true);

    expect(bare.visibleMap["overlay1"] === false).toBe(false);
    const fields = schedule.mock.calls[0][0] as {
      layers: () => Record<string, { visible?: boolean; overrides: string[] }>;
    };
    expect(fields.layers()).toEqual({
      overlay1: { visible: true, overrides: ["visible"] },
    });
  });

  it("persists a moved zoom range together with its provenance", () => {
    // The author's min_zoom / max_zoom is only the starting value, so moving the
    // handles has to mark provenance too -- without it the range would be read
    // back as a declaration and dropped, and the user's drag would not survive
    // a reload.
    const schedule = vi.fn();
    const bare = {
      visibleMap: {},
      opacityMap: {},
      fillColorMap: {},
      fillOpacityMap: {},
      zoomRangeMap: { overlay1: [4, 10] },
      intentProvenance: { overlay1: ["zoomRange"] },
      m: {
        persistence: { schedule },
        annotation: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    saveState(bare);

    const fields = schedule.mock.calls[0][0] as {
      layers: () => Record<string, { zoomRange?: number[]; overrides: string[] }>;
    };
    expect(fields.layers()).toEqual({
      overlay1: { zoomRange: [4, 10], overrides: ["zoomRange"] },
    });
  });

  it("drops the zoom range back to the author's default on reset", () => {
    // Reset is one rule: drop the provenance, and the value follows it. A
    // provenance with no live value must never be persisted -- the record cannot
    // say "the user reset this", so absence is what restores the declared value.
    const schedule = vi.fn();
    const bare = {
      visibleMap: {},
      opacityMap: {},
      fillColorMap: {},
      fillOpacityMap: {},
      zoomRangeMap: {},
      intentProvenance: { overlay1: ["zoomRange"] },
      m: {
        persistence: { schedule },
        annotation: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    unmarkOverride(bare, "overlay1", "zoomRange");
    saveState(bare);

    expect(bare.intentProvenance.overlay1).toBeUndefined();
    const fields = schedule.mock.calls[0][0] as {
      layers: () => Record<string, unknown>;
    };
    expect(fields.layers()).toEqual({});
  });

  it("keeps the other dimensions when one is reset", () => {
    // Reset is per dimension, so unmarking zoomRange must not drop the layer's
    // other choices -- wiping the whole entry here would make one Reset button
    // forget the opacity the user set moments earlier.
    const bare = {
      intentProvenance: { overlay1: ["visible", "zoomRange"] },
    } as unknown as LayerUI;

    unmarkOverride(bare, "overlay1", "zoomRange");

    expect(bare.intentProvenance.overlay1).toEqual(["visible"]);
  });

  it("drops an entry whose only marker holds no live value", () => {
    // The mirror of the markOverride refusal, from the write side: a marker that
    // lost its value must not be written as an empty entry, which the next read
    // would discard anyway. Failing closed here keeps the invariant that every
    // persisted marker has a value.
    const schedule = vi.fn();
    const bare = {
      visibleMap: {},
      opacityMap: {},
      fillColorMap: {},
      fillOpacityMap: {},
      zoomRangeMap: {},
      intentProvenance: { overlay1: ["opacity"] },
      m: {
        persistence: { schedule },
        annotation: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    saveState(bare);

    const fields = schedule.mock.calls[0][0] as {
      layers: () => Record<string, unknown>;
    };
    expect(fields.layers()).toEqual({});
  });

  it("refuses a marker for a dimension with no live value, loudly", () => {
    // buildLayerStates filters a marker whose value is missing, so recording it
    // here would mean the user's action vanishes on the next write with nothing
    // in the console. The gate therefore refuses it and says so instead of
    // accepting a marker that cannot survive a flush.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schedule = vi.fn();
    const bare = {
      visibleMap: {},
      opacityMap: {},
      fillColorMap: {},
      fillOpacityMap: {},
      zoomRangeMap: {},
      intentProvenance: {},
      m: {
        persistence: { schedule },
        annotation: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    markOverride(bare, "overlay1", "zoomRange");

    expect(bare.intentProvenance.overlay1).toBeUndefined();
    expect(schedule).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain("no stored value for this dimension");
    warn.mockRestore();
  });

  it("refuses a border marker for a dimension that holds no stroke", () => {
    // The guard is per dimension, so the two border dimensions need the same
    // refusal as zoom range: marking a border with no value would be filtered
    // out of the next write and the user's action would vanish silently.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bare = {
      visibleMap: {},
      opacityMap: {},
      zoomRangeMap: {},
      borderColorMap: {},
      borderWeightMap: {},
      intentProvenance: {},
      m: { persistence: { schedule: vi.fn() } },
    } as unknown as LayerUI;

    markOverride(bare, "overlay1", "borderColor");
    markOverride(bare, "overlay1", "borderWeight");

    expect(bare.intentProvenance.overlay1).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(
      warn.mock.calls.every(([msg]) => String(msg).includes("no stored value")),
    ).toBe(true);
    warn.mockRestore();
  });

  it("restores a stored opacity and zoom range from the record", () => {
    // The record keeps the value and the provenance side by side, so a restore
    // must move them to the matching live maps. Reading the value without the
    // provenance would persist an author default as if the user had chosen it.
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({
        order: null,
        foldedGroups: ["Overlay"],
        renamedNames: {},
        annotations: {},
        layers: {
          overlay1: {
            opacity: 0.35,
            zoomRange: [3, 12],
            overrides: ["opacity", "zoomRange"],
          },
        },
      }),
    );

    loadPersistedState(ui);

    expect(ui.foldedGroups).toEqual(new Set(["Overlay"]));
    expect(ui.opacityMap).toEqual({ overlay1: 0.35 });
    expect(ui.zoomRangeMap).toEqual({ overlay1: [3, 12] });
    expect(ui.intentProvenance.overlay1).toEqual(["opacity", "zoomRange"]);
  });

  it("restores a stored border color and width from the record", () => {
    // The border maps are the row's own source of truth, so a restore has to
    // move the stored stroke into them: without it the drawer would reopen
    // showing the author's stroke while the map kept painting the user's last
    // choice.
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({
        order: null,
        foldedGroups: [],
        renamedNames: {},
        annotations: {},
        layers: {
          overlay1: {
            borderColor: "#0000ff",
            borderWeight: 4.5,
            overrides: ["borderColor", "borderWeight"],
          },
        },
      }),
    );

    loadPersistedState(ui);

    expect(ui.borderColorMap).toEqual({ overlay1: "#0000ff" });
    expect(ui.borderWeightMap).toEqual({ overlay1: 4.5 });
    expect(ui.intentProvenance.overlay1).toEqual(["borderColor", "borderWeight"]);
  });

  it("persists an opacity change together with its provenance", () => {
    const schedule = vi.fn();
    const bare = {
      visibleMap: {},
      opacityMap: { overlay1: 0.6 },
      zoomRangeMap: {},
      fillColorMap: {},
      fillOpacityMap: {},
      intentProvenance: { overlay1: ["opacity"] },
      m: {
        persistence: { schedule },
        annotation: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    saveState(bare);

    const fields = schedule.mock.calls[0][0] as {
      layers: () => Record<string, { opacity?: number; overrides: string[] }>;
    };
    expect(fields.layers()).toEqual({
      overlay1: { opacity: 0.6, overrides: ["opacity"] },
    });
  });

  it("persists border values by type presence, not truthiness", () => {
    // The gate (hasLiveValue) and the writer both speak typeof, so undefined
    // is the only absence: a weight of 0 survives while a marker whose value
    // went missing drops its whole entry. An empty string still reads as a
    // string here — no writer can produce one (hydration is truthy and the
    // color input only ever yields hex), and the read side discards it via
    // isHexColor, so a truthy carve-out in buildLayerStates would only make
    // this layer disagree with applyBorderToLayer's `!== undefined` reads.
    const schedule = vi.fn();
    const bare = {
      visibleMap: {},
      opacityMap: {},
      zoomRangeMap: {},
      fillColorMap: {},
      fillOpacityMap: {},
      borderColorMap: { kept: "#0000ff", blank: "" },
      borderWeightMap: { zero: 0 },
      intentProvenance: {
        kept: ["borderColor"],
        blank: ["borderColor"],
        zero: ["borderWeight"],
        missing: ["borderColor", "borderWeight"],
      },
      m: {
        persistence: { schedule },
        annotation: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    saveState(bare);

    const fields = schedule.mock.calls[0][0] as {
      layers: () => Record<string, unknown>;
    };
    expect(fields.layers()).toEqual({
      kept: { borderColor: "#0000ff", overrides: ["borderColor"] },
      blank: { borderColor: "", overrides: ["borderColor"] },
      zero: { borderWeight: 0, overrides: ["borderWeight"] },
    });
  });

  it("applyUserState(id) ignores an id with no registry entry", () => {
    expect(() => ui.applyUserState("ghost")).not.toThrow();
  });

  it("applyUserState(id) projects a hidden flag onto a single late layer", () => {
    ui.visibleMap = {overlay1: false};

    ui.applyUserState("overlay1");

    expect(manager.intentVisible("overlay1")).toBe(false);
  });

  it("applyUserState(id) re-applies a stored zoom range on late registration", () => {
    // A stored range has to come back with its layer: without this pass a layer
    // that was out of range on the previous load would join the map at its
    // author default instead of staying inside the range the user chose.
    // With Option A, the zoomRange resolves through the visible op — the
    // layer's options are never written.
    manager.registerLayer({ id: "grid1", name: "Grid", layer: new GridLayer() });
    const li = manager.layerRegistry.get("grid1")!;
    ui.authorVisible.set("grid1", true); // author default: visible
    ui.zoomRangeMap = { grid1: [4, 9] };
    ui.intentProvenance.grid1 = ["zoomRange"];

    ui.applyUserState("grid1");

    // The layer's options are untouched — zoomRange does not write them.
    const opts = (li.layer as { options: Record<string, unknown> }).options;
    expect("minZoom" in opts).toBe(false);
    expect("maxZoom" in opts).toBe(false);
  });

  it("applyUserState(id) leaves a native range alone when there is no layer", () => {
    // A canvas-only entry carries no Leaflet layer. A surface that reports the
    // range as native has nothing to dereference, so the pass has to bail
    // instead of writing into a layer that is not there.
    manager.registerLayer({ id: "ghostLayer", name: "Ghost" });
    const li = manager.layerRegistry.get("ghostLayer")!;
    manager.surfaceFor(li).capabilities.zoomRange = "native";
    ui.zoomRangeMap = { ghostLayer: [4, 9] };
    const mapWrites =
      map.addLayer.mock.calls.length + map.removeLayer.mock.calls.length;

    ui.applyUserState("ghostLayer");

    expect(li.layer).toBeNull();
    expect(map.addLayer.mock.calls.length + map.removeLayer.mock.calls.length).toBe(
      mapWrites,
    );
  });

  it("applyUserState renames the color basemap row without a registry entry", () => {
    // The color basemap has no LayerInfo in the registry —its rename goes
    // straight to the row label. Without the id guard at the top of the
    // sweep the color item would be skipped and the label would stay stale.
    ui.renamedNames = { [CONST.SOLID_BASEMAP_ID]: "Renamed Color" };

    ui.applyUserState();

    const colorItem = ui.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
    ) as HTMLElement | null;
    expect(colorItem).not.toBeNull();
    const label = colorItem!.querySelector("label") as HTMLElement | null;
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe("Renamed Color");
  });

  it("applyUserState renames a layer that is in the registry", () => {
    // Covers the regular layer path in the sweep (lines 196-203): a layer ID
    // that IS in the registry gets its name projected through the layerInfo.
    ui.renamedNames = { overlay1: "Renamed Overlay" };

    ui.applyUserState();

    const item = ui.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="overlay1"]`,
    ) as HTMLElement | null;
    expect(item).not.toBeNull();
    const label = item!.querySelector("label") as HTMLElement | null;
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe("Renamed Overlay");
  });

  it("applyUserState(id) renames a layer through the id path", () => {
    // Covers line 165: applyNameProjection in the `if (id)` branch.
    // The item is null in this path, so only layerInfo.name is updated.
    ui.renamedNames = { overlay1: "Renamed via id" };

    ui.applyUserState("overlay1");

    const li = manager.layerRegistry.get("overlay1");
    expect(li?.name).toBe("Renamed via id");
  });

  it("persists renamed names through the persistence scheduler", () => {
    // saveNamesState is the write half of the rename flow. Without a test
    // that reaches it, the function stays uncovered even though the read
    // path (applyUserState) is exercised.
    const schedule = vi.fn();
    const bare = {
      renamedNames: { overlay1: "Renamed" },
      m: {
        persistence: { schedule },
        annotation: { configEntries: () => [] },
      },
    } as unknown as LayerUI;

    saveNamesState(bare);

    const fields = schedule.mock.calls[0][0] as {
      renamedNames: () => Record<string, string>;
    };
    expect(fields.renamedNames()).toEqual({ overlay1: "Renamed" });
  });

  // ─────────────────── visibleMap single-source regressions ───────────────────

  it("hide → restore → reload lands on the same visible state each pass", () => {
    // The value and the provenance write in one call; a reload must derive the
    // same visibleMap back from the stored record so the choice survives the
    // round trip in both directions.
    const first = new LayerUI(manager);
    vi.useFakeTimers();
    first.setVisible("overlay1", false);
    vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
    vi.useRealTimers();

    // Reload pass 1: the hide comes back as intent, not as the author default.
    const u2 = new LayerUI(manager);
    u2.loadPersistedState();
    expect(u2.visibleMap).toEqual({ overlay1: false });
    expect(u2.intentVisible("overlay1")).toBe(false);
    expect(u2.intentProvenance.overlay1).toEqual(["visible"]);

    // Restore, then reload pass 2: the value flips to true, provenance stays.
    vi.useFakeTimers();
    u2.setVisible("overlay1", true);
    vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
    vi.useRealTimers();

    const u3 = new LayerUI(manager);
    u3.loadPersistedState();
    expect(u3.visibleMap).toEqual({ overlay1: true });
    expect(u3.intentVisible("overlay1")).toBe(true);
    expect(u3.intentProvenance.overlay1).toEqual(["visible"]);
  });

  it("toggle back and forth never leaves the value and provenance out of step", () => {
    // A toggle is a value write + a provenance marker in the same call. Rapid
    // toggles must end with the *last* choice in both halves — the record must
    // not drift to an intermediate state or drop the marker.
    vi.useFakeTimers();
    ui.setVisible("overlay1", false);
    ui.setVisible("overlay1", true);
    ui.setVisible("overlay1", false);
    vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
    vi.useRealTimers();

    expect(ui.visibleMap).toEqual({ overlay1: false });
    expect(ui.intentProvenance.overlay1).toEqual(["visible"]);

    const stored = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!);
    expect(stored.layers.overlay1).toEqual({
      visible: false,
      overrides: ["visible"],
    });

    // Un-hide once more: the last write wins in both halves.
    vi.useFakeTimers();
    ui.setVisible("overlay1", true);
    vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
    vi.useRealTimers();

    expect(ui.visibleMap).toEqual({ overlay1: true });
    expect(ui.intentProvenance.overlay1).toEqual(["visible"]);
  });

  it("a layer deleted then re-registered starts from a clean intent", () => {
    // dropPersistedLayerState erases the value and the provenance together; a
    // later re-registration must not see a stale hidden flag.
    ui.visibleMap = { overlay1: false };
    ui.intentProvenance = { overlay1: ["visible"] };

    dropPersistedLayerState(ui, "overlay1");

    expect(ui.visibleMap).toEqual({});
    expect(ui.intentProvenance).toEqual({});

    // Re-registration replays the now-empty state: author default wins.
    ui.applyUserState("overlay1");
    expect(ui.intentVisible("overlay1")).toBe(true);
  });

  it("a value written directly (no provenance) still projects as user intent", () => {
    // A restored record or a test fixture can write the value without the
    // marker. The projection reads either half as "the user chose this" — a
    // bare visibleMap entry must never fall back to the author default.
    const u = new LayerUI(manager);
    u.visibleMap = {};
    u.visibleMap["overlay1"] = false;
    delete u.intentProvenance.overlay1;

    expect(u.intentVisible("overlay1")).toBe(false);
  });
});
