// test/js/control/LayerControl/ui/style/state — visibility persistence, label seed and folder state.
import {
  TEST_ENV,
  TileLayer,
  attachedPanel,
  initFixture,
  installLeafletGlobals,
} from "./fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import { LayerController } from "#control/LayerControl/controller.js";
import { LayerUI } from "#control/LayerControl/ui/index.js";
import {
  getIntent,
  seedIntentMap,
  setIntent,
} from "#control/LayerControl/ui/intent.js";
import {
  dropPersistedLayerState,
  loadPersistedState,
  saveFoldState,
} from "#control/LayerControl/ui/state.js";

describe("LayerUI visibility persistence (intents.visible)", () => {
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
        classList: {
          add: () => void;
          remove: () => void;
          contains: (cls: string) => boolean;
        };
      }
    >();
    const getPane = vi.fn((name: string) => {
      let p = panes.get(name);
      if (!p) {
        // `contains: true` — the stub reads as a pane that already carries the
        // foliplus-layer-pane class, so the adoption branch is a no-op.
        p = {
          style: {},
          classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => true) },
        };
        panes.set(name, p);
      }
      return p;
    });
    return {
      map: {
        on: vi.fn(),
        off: vi.fn(),
        hasLayer: vi.fn(l => l === testPolyLayer),
        getZoom: vi.fn(() => 12),
        getMinZoom: vi.fn(() => 0),
        getMaxZoom: vi.fn(() => 18),
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
        foliplus: { hint: { set: vi.fn(), clear: vi.fn(), registerIcon: vi.fn() } },
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
      const m = new LayerController(map, [
        {
          id: "overlay1",
          name: "Polygons",
          role: "overlay",
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m, TEST_ENV);
      seedIntentMap(u, "visible", { overlay1: false });
      u.intentStore.replaceProvenance({ overlay1: ["visible"] });

      u.applyUserState();

      expect(removeLayer).toHaveBeenCalledWith(testPolyLayer);
      expect(getIntent(u, "overlay1", "visible")).toBe(false);
      expect(u.intentVisible("overlay1")).toBe(false);
    });

    it("re-adds a layer the user un-hid, once the visibility key exists", () => {
      // folium renders a show=False layer absent from the map and nothing else
      // puts it back, so the hide half of the round trip had no inverse: a
      // layer the user left visible was correctly absent from intents.visible, and the
      // sweep left it off the map. That is what made a checked Commuting Routes
      // come back unchecked after a reload.
      const { map, removeLayer } = makeTestMap();
      const m = new LayerController(map, [
        {
          id: "overlay1",
          name: "Polygons",
          role: "overlay",
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m, TEST_ENV);
      // The user checked the layer ON, so it is absent from intents.visible -- but the
      // key exists, so every registered layer must be on the map.
      seedIntentMap(u, "visible", { other: false });
      // The user unhid overlay1 (a `show=False` folium layer), so it is absent
      // from intents.visible -- but a `visible` override says it must come back on.
      u.intentStore.replaceProvenance({ overlay1: ["visible"] });
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
      const m = new LayerController(map, [
        {
          id: "overlay1",
          name: "Polygons",
          role: "overlay",
          layer: testPolyLayer,
          show: false,
        },
      ]);
      const u = new LayerUI(m, TEST_ENV);
      seedIntentMap(u, "visible", {});
      // No user override — overlay1 keeps its author's declared state, which
      // is `show=False` (absent from the map). Nothing must force it on.
      u.intentStore.replaceProvenance({});
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
      const m = new LayerController(map, [
        {
          id: "canvas1",
          name: "Canvas",
          layer: null,
          canvas,
        },
      ]);
      const u = new LayerUI(m, TEST_ENV);
      seedIntentMap(u, "visible", {});
      // A canvas layer with a `visible` override clears `HIDDEN` instead of
      // `addLayer` -- it has no Leaflet layer to add.
      u.intentStore.replaceProvenance({ canvas1: ["visible"] });

      u.applyUserState();

      expect(canvas.classList.contains("hidden")).toBe(false);
    });

    it("keeps hidden ids that have no registry entry", () => {
      // A missing registry entry is not evidence that the stored state should
      // go: HeatmapControl and MeasureControl register in their own
      // constructor, after this UI has attached, so their ids are unresolvable
      // on the first sweep. A queued registration and an id never seen are
      // indistinguishable here, and either may still arrive — both are kept.
      const { map } = makeTestMap();
      const m = new LayerController(map, [
        {
          id: "overlay1",
          name: "Polygons",
          role: "overlay",
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m, TEST_ENV);
      seedIntentMap(u, "visible", {
        overlay1: false,
        later: false,
        ghost: false,
        gone: false,
      });
      m.pendingRegistrations.push({
        id: "later",
        name: "Later",
        role: "overlay",
        layer: testPolyLayer,
      } as any);

      u.applyUserState();

      expect(u.intentStore.dumpIntents()).toEqual({
        overlay1: { visible: false },
        later: { visible: false },
        ghost: { visible: false },
        gone: { visible: false },
      });
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
      const m = new LayerController(map, [
        {
          id: "overlay1",
          name: "Polygons",
          role: "overlay",
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m, TEST_ENV);
      u.loadPersistedState();
      const schedule = vi.spyOn(u.c.persistence, "schedule");

      u.applyUserState();

      expect(schedule).not.toHaveBeenCalled();
      expect(u.intentStore.dumpIntents()).toEqual({
        overlay1: { visible: false },
        ghost: { visible: false },
        gone: { visible: false },
      });
      // The test seeds a pre-envelope record and schedules no write, so the
      // flat shot is still what storage holds.
      const stored = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!) as {
        layers: Record<string, unknown>;
      };
      expect(Object.keys(stored.layers).sort()).toEqual(["ghost", "gone", "overlay1"]);
    });

    it("writes the canvas HIDDEN class for canvas-only layers (canvas/heatmap)", () => {
      const { map } = makeTestMap();
      const canvas = document.createElement("canvas");
      const m = new LayerController(map, [
        {
          id: "canvas1",
          name: "Canvas",
          layer: null,
          canvas,
        },
      ]);
      const u = new LayerUI(m, TEST_ENV);
      setIntent(u, "canvas1", "visible", false);

      u.applyUserState();

      expect(canvas.classList.contains("hidden")).toBe(true);
    });

    it("loads hidden ids from localStorage into intents.visible", () => {
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
      const m = new LayerController(map, [
        { id: "overlay1", name: "O", role: "overlay", layer: testPolyLayer },
        { id: "base1", name: "B", role: "base", layer: new TileLayer() },
      ]);
      const u = new LayerUI(m, TEST_ENV);

      u.loadPersistedState();

      expect(u.intentStore.dumpIntents()).toEqual({
        overlay1: { visible: false },
        base1: { visible: false },
      });
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
      const m = new LayerController(map, [
        { id: "overlay1", name: "O", role: "overlay", layer: testPolyLayer },
      ]);
      const u = new LayerUI(m, TEST_ENV);

      u.loadPersistedState();

      expect(getIntent(u, "overlay1", "fillColor")).toBe("#ff8800");
      expect(getIntent(u, "overlay1", "fillOpacity")).toBe(0.35);
      expect(u.intentStore.dumpProvenance()["overlay1"]).toEqual([
        "fillColor",
        "fillOpacity",
      ]);
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
      const m = new LayerController(map, [
        { id: "a", name: "A", role: "overlay", layer: testPolyLayer },
        { id: "b", name: "B", role: "overlay", layer: testPolyLayer },
        { id: "c", name: "C", role: "overlay", layer: testPolyLayer },
        { id: "d", name: "D", role: "overlay", layer: testPolyLayer },
      ]);
      const u = new LayerUI(m, TEST_ENV);

      u.loadPersistedState();

      expect(getIntent(u, "a", "fillColor")).toBeUndefined();
      expect(getIntent(u, "b", "fillColor")).toBeUndefined();
      expect(getIntent(u, "c", "fillOpacity")).toBeUndefined();
      expect(getIntent(u, "d", "fillColor")).toBe("#00ff00");
    });

    it("dropPersistedLayerState clears the fill maps and their provenance", () => {
      const { map } = makeTestMap();
      const m = new LayerController(map, [
        { id: "overlay1", name: "O", role: "overlay", layer: testPolyLayer },
      ]);
      const u = new LayerUI(m, TEST_ENV);
      setIntent(u, "overlay1", "visible", false);
      setIntent(u, "overlay1", "opacity", 0.5);
      setIntent(u, "overlay1", "zoomRange", [3, 12]);
      setIntent(u, "overlay1", "fillColor", "#ff0000");
      setIntent(u, "overlay1", "fillOpacity", 0.5);
      u.intentStore.seedProvenance("overlay1", [
        "visible",
        "opacity",
        "zoomRange",
        "fillColor",
        "fillOpacity",
      ]);

      dropPersistedLayerState(u, "overlay1");

      expect(getIntent(u, "overlay1", "visible")).not.toBe(false);
      expect(getIntent(u, "overlay1", "opacity")).toBeUndefined();
      expect(getIntent(u, "overlay1", "zoomRange")).toBeUndefined();
      expect(getIntent(u, "overlay1", "fillColor")).toBeUndefined();
      expect(getIntent(u, "overlay1", "fillOpacity")).toBeUndefined();
      expect(u.intentStore.dumpProvenance()["overlay1"]).toBeUndefined();
    });

    it("ignores non-array/corrupt storage data", () => {
      const { map } = makeTestMap();
      window.localStorage.setItem(CONST.STORAGE.KEY, "not-json");
      const m = new LayerController(map, [
        { id: "overlay1", name: "O", role: "overlay", layer: testPolyLayer },
      ]);
      const u = new LayerUI(m, TEST_ENV);

      u.loadPersistedState();

      expect(u.intentStore.dumpIntents()).toEqual({});
    });
  });

  // ─────────────────── save on toggle ───────────────────

  describe("saveState on toggle", () => {
    it("persists a hidden overlay when the user unchecks it", () => {
      const { map } = makeTestMap();
      const m = new LayerController(map, [
        {
          id: "overlay1",
          name: "Polygons",
          role: "overlay",
          layer: testPolyLayer,
        },
      ]);
      map.hasLayer.mockReturnValue(true);
      const u = new LayerUI(m, TEST_ENV);
      seedIntentMap(u, "visible", {});

      vi.useFakeTimers();
      u.setVisibleIntent("overlay1", false);
      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
      vi.useRealTimers();

      // The record carries both the value and the provenance: a hidden layer
      // shows up under `layers` with `visible: false` and a `visible` override.
      const stored = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!).data;
      expect(stored.layers.overlay1.visible).toBe(false);
      expect(stored.layers.overlay1.overrides).toContain("visible");
    });

    it("records a re-check as visible:true so the layer comes back on reload", () => {
      // The old test asserted the id was dropped from the hidden array; the new
      // model keeps the entry because it knows the user touched it, and reload
      // must restore `visible=true` rather than reverting to the author's
      // `show=False` default.
      const { map } = makeTestMap();
      const m = new LayerController(map, [
        {
          id: "overlay1",
          name: "Polygons",
          role: "overlay",
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m, TEST_ENV);
      seedIntentMap(u, "visible", { overlay1: false });
      u.intentStore.replaceProvenance({ overlay1: ["visible"] });

      vi.useFakeTimers();
      u.setVisibleIntent("overlay1", true);
      vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);
      vi.useRealTimers();

      const stored = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!).data;
      expect(stored.layers.overlay1.visible).toBe(true);
      expect(stored.layers.overlay1.overrides).toContain("visible");
    });

    it("debounces rapid saves into one localStorage write", () => {
      const { map } = makeTestMap();
      const m = new LayerController(map, [
        { id: "overlay1", name: "O", role: "overlay", layer: testPolyLayer },
      ]);
      const u = new LayerUI(m, TEST_ENV);

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
        u.setVisibleIntent("overlay1", false);
        u.setVisibleIntent("overlay1", true);
        u.setVisibleIntent("overlay1", false);
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
    it("does not pollute intents.visible when color layer activates", () => {
      const { map } = makeTestMap();
      const m = new LayerController(map, [
        { id: "overlay1", name: "O", role: "overlay", layer: testPolyLayer },
        { id: "base1", name: "OSM", role: "base", layer: new TileLayer() },
      ]);
      const u = new LayerUI(m, TEST_ENV);
      seedIntentMap(u, "visible", { overlay1: false });
      // Simulate a container + rows so showSolidBasemap can iterate bases.
      const container = document.createElement("div");
      document.body.appendChild(container);
      m.uiContainer = container;
      map.getPane.mockReturnValue({
        classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => true) },
        appendChild: vi.fn(),
        style: {},
      } as any);

      u.showSolidBasemap("#000000");

      // overlay1 was hidden before the color activation and should stay hidden.
      expect(getIntent(u, "overlay1", "visible")).toBe(false);
      // No base-layer id was added even though showSolidBasemap deselects all bases.
      expect(u.intentStore.dumpIntents()).toEqual({ overlay1: { visible: false } });
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
        role?: "base" | "overlay";
        layer?: any;
        paneName?: string;
      }>,
    ) => {
      window.CONFIG.name = "LayerControl";
      window.CONFIG.locale_code = "en";
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
        attributionControl: { _attributions: {}, _update: vi.fn() },
        foliplus: { hint: { set: vi.fn(), clear: vi.fn(), registerIcon: vi.fn() } },
      };
      const manager = new LayerController(map, data);
      manager.enforceOrder();
      manager.ui = new LayerUI(manager, TEST_ENV);
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
        { id: "overlay1", name: "O", role: "overlay", layer: poly },
        {
          id: "base1",
          name: "B1",
          role: "base",
          layer: base1,
          paneName: "tilePane",
        },
        {
          id: "base2",
          name: "B2",
          role: "base",
          layer: base2,
          paneName: "tilePane",
        },
      ]);

      // Both bases were removed from the map by applyUserState().
      expect(map.removeLayer).toHaveBeenCalledWith(base1);
      expect(map.removeLayer).toHaveBeenCalledWith(base2);
      // Color-layer fallback must NOT activate when the user intentionally hid every base.
      const colorItem = attachedPanel(ui).querySelector(
        `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
      ) as HTMLElement | null;
      expect(colorItem?.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
      // The hidden set is preserved after the attach pass.
      expect(ui.intentStore.dumpIntents()).toEqual({
        base1: { visible: false },
        base2: { visible: false },
      });
    });

    it("does not activate the color layer when no base layers are registered", () => {
      // Intent-only invariant: no code fallback when there are no basemaps.
      // First-load visibility is the author's `show=` — if the author wrote
      // no basemap, the map is empty (A-hatch) rather than the color being
      // silently drawn to fill the blank.
      const poly = {
        options: {},
        eachLayer: vi.fn(),
        getBounds: vi.fn(() => ({ isValid: vi.fn(() => true) })),
      };
      const { ui, map } = attachFixture([
        { id: "overlay1", name: "O", role: "overlay", layer: poly },
      ]);

      const colorItem = attachedPanel(ui).querySelector(
        `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
      ) as HTMLElement | null;
      expect(colorItem?.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
      expect(map.removeLayer).not.toHaveBeenCalled();
      expect(ui.intentStore.dumpIntents()).toEqual({});
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
        { id: "overlay1", name: "O", role: "overlay", layer: poly },
        {
          id: "base1",
          name: "B1",
          role: "base",
          layer: base1,
          paneName: "tilePane",
        },
      ]);

      // base1 was hidden, but overlay1 is visible and there are no visible bases.
      // However, only base1 is hidden (not "all bases"), so the color fallback
      // must NOT activate — the user might re-show base1 at any time.
      expect(map.removeLayer).toHaveBeenCalledWith(base1);
      const colorItem = attachedPanel(ui).querySelector(
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
            getZoom: vi.fn(() => 12),
            getMinZoom: vi.fn(() => 0),
            getMaxZoom: vi.fn(() => 18),
            addLayer: vi.fn(),
            removeLayer: rl,
            getContainer: vi.fn(() => document.createElement("div")),
            getPane: vi.fn(() => document.createElement("div")),
            getPanes: vi.fn(() => ({ mapPane: document.createElement("div") })),
            createPane: vi.fn(() => document.createElement("div")),
            options: { maxZoom: 18 },
            foliplus: { hint: { set: vi.fn(), clear: vi.fn(), registerIcon: vi.fn() } },
          },
          removeLayer: rl,
        };
      })();
      const m = new LayerController(map, [
        { id: "overlay1", name: "O", role: "overlay", layer: poly },
        { id: "base1", name: "B1", role: "base", layer: baseLayer },
        { id: "canvas1", name: "Canvas", layer: null, canvas },
      ]);
      const u = new LayerUI(m, TEST_ENV);
      seedIntentMap(u, "visible", { overlay1: false, base1: false, canvas1: false });
      u.intentStore.replaceProvenance({
        overlay1: ["visible"],
        base1: ["visible"],
        canvas1: ["visible"],
      });

      u.applyUserState();

      expect(removeLayer).toHaveBeenCalledWith(poly);
      expect(removeLayer).toHaveBeenCalledWith(baseLayer);
      expect(canvas.classList.contains("hidden")).toBe(true);
      expect(u.intentVisible("overlay1")).toBe(false);
      expect(u.intentVisible("base1")).toBe(false);
      expect(u.intentVisible("canvas1")).toBe(false);
      expect(u.intentStore.dumpIntents()).toEqual({
        overlay1: { visible: false },
        base1: { visible: false },
        canvas1: { visible: false },
      });
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

  it("reads the label config from layers[id].label only (dual-key removal)", () => {
    // The dual-key removal in one round trip: a record carrying BOTH keys
    // for the same id reads the current one, an id only the legacy top-level
    // `annotations` segment knows (a v2 record) no longer seeds — the legacy
    // segment is dropped as invalid, nothing is migrated.
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
            label: { show: true, field: "new", format: "comma" },
          },
          withOverride: {
            overrides: ["opacity"],
            opacity: 0.5,
            label: { show: true, field: "p" },
          },
        },
      }),
    );
    const { ui } = initFixture();
    loadPersistedState(ui);

    expect(getIntent(ui, "both", "label")).toEqual({
      show: true,
      field: "new",
      format: "comma",
    });
    expect(getIntent(ui, "legacyOnly", "label")).toBeUndefined();
    expect(getIntent(ui, "withOverride", "label")).toEqual({
      show: true,
      field: "p",
    });
  });
});

describe("ui/state saveFoldState", () => {
  it("schedules the folded-role opinion map through persistence", () => {
    const schedule = vi.fn();
    const ui = {
      foldedRoles: { overlay: true },
      c: {
        persistence: { schedule },
        label: { configEntries: () => [] },
      },
      listPanel: {
        foldedRoles: { overlay: true },
        checkedCount: {},
      },
    } as unknown as LayerUI;
    saveFoldState(ui);
    // schedule takes a getter map so a later write can read the live state
    // instead of a snapshot at schedule time.
    expect(schedule).toHaveBeenCalledTimes(1);
    const fields = schedule.mock.calls[0][0] as {
      foldedRoles: () => Record<string, boolean>;
    };
    expect(fields.foldedRoles()).toEqual({ overlay: true });
  });
});
