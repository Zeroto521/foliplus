import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { ensureModes } from "#foliplus/core/mode.js";
import {
  allFolded,
  attachWithGroup,
  findItem,
  initFixture,
  overlayFoldBtn,
  pressKey,
} from "./fixture.js";
import { TileLayer, installLeafletGlobals } from "./fixture.js";

describe("LayerUI visibility persistence (hiddenIds)", () => {
  // Reusable layer stubs at module scope so standalone test blocks don't
  // depend on initFixture()'s internal scope.
  const testPolyLayer = {
    options: {},
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => ({ isValid: () => true })),
  };

  const makeTestMap = () => {
    const removeLayer = vi.fn();
    return {
      map: {
        on: vi.fn(),
        off: vi.fn(),
        hasLayer: vi.fn(l => l === testPolyLayer),
        addLayer: vi.fn(),
        removeLayer,
        getContainer: vi.fn(() => ({ id: "map" })),
        getPane: vi.fn(() => ({ style: {} })),
        createPane: vi.fn(() => ({
          style: {},
          classList: { add: vi.fn(), remove: vi.fn() },
        })),
        foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
      },
      removeLayer,
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
          isBase: false,
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m);
      u.hiddenIds = new Set(["overlay1"]);

      u.applyUserState();

      expect(removeLayer).toHaveBeenCalledWith(testPolyLayer);
      expect(u.hiddenIds).toContain("overlay1");
      expect(m.layerRegistry.get("overlay1")?.visible).toBe(false);
    });

    it("re-adds a layer the user un-hid, once the visibility key exists", () => {
      // folium renders a show=False layer absent from the map and nothing else
      // puts it back, so the hide half of the round trip had no inverse: a
      // layer the user left visible was correctly absent from hiddenIds, and the
      // sweep left it off the map. That is what made a checked Commuting Routes
      // come back unchecked after a reload.
      const { map, removeLayer } = makeTestMap();
      const m = new LayerManager(map, [
        {
          id: "overlay1",
          name: "Polygons",
          isBase: false,
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m);
      // The user checked the layer ON, so it is absent from hiddenIds -- but the
      // key exists, so every registered layer must be on the map.
      u.hiddenIds = new Set(["other"]);
      u.hiddenHasState = true;
      // Simulate the layer being off the map (folium show=False).
      map.hasLayer = vi.fn(() => false);

      u.applyUserState();

      expect(map.addLayer).toHaveBeenCalledWith(testPolyLayer);
      expect(removeLayer).not.toHaveBeenCalled();
      expect(m.layerRegistry.get("overlay1")?.visible).toBe(true);
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
          isBase: false,
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m);
      u.hiddenIds = new Set();
      u.hiddenHasState = false;
      map.hasLayer = vi.fn(() => false);

      u.applyUserState();

      expect(map.addLayer).not.toHaveBeenCalled();
      expect(m.layerRegistry.get("overlay1")?.visible).toBe(true);
    });

    it("fires onToggle(true) for a callback-only layer the user un-hid", () => {
      // Canvas/heatmap layers have no Leaflet layer to addLayer, so the inverse
      // path must call the callback instead or they stay hidden after a reload.
      const { map } = makeTestMap();
      const onToggle = vi.fn();
      const m = new LayerManager(map, [
        {
          id: "canvas1",
          name: "Canvas",
          layer: null,
          onToggle,
        },
      ]);
      const u = new LayerUI(m);
      u.hiddenIds = new Set();
      u.hiddenHasState = true;

      u.applyUserState();

      expect(onToggle).toHaveBeenCalledWith(true);
    });

    it("drops unknown ids from the persisted hidden set", () => {
      const { map } = makeTestMap();
      const m = new LayerManager(map, [
        {
          id: "overlay1",
          name: "Polygons",
          isBase: false,
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m);
      u.hiddenIds = new Set(["overlay1", "ghost", "gone"]);

      u.applyUserState();

      expect(u.hiddenIds).toEqual(new Set(["overlay1"]));
    });

    it("keeps a hidden id for a pending registration", () => {
      // A component can register before the panel attaches, in which case the
      // layer is still queued in pendingRegistrations when this sweep runs
      // (attachUI drains the queue before calling applyUserState). Such an id
      // must not be read as "gone for good" — dropping it would lose the user's
      // hidden state and the layer would come back on the map after every
      // reload.
      const { map } = makeTestMap();
      const m = new LayerManager(map, [
        {
          id: "overlay1",
          name: "Polygons",
          isBase: false,
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m);
      u.hiddenIds = new Set(["overlay1", "later", "ghost"]);
      m.pendingRegistrations.push({
        id: "later",
        name: "Later",
        isBase: false,
        layer: testPolyLayer,
      } as any);

      u.applyUserState();

      expect(u.hiddenIds).toEqual(new Set(["overlay1", "later"]));
    });

    it("persists the pruned hidden set after dropping stale ids", () => {
      const { map } = makeTestMap();
      const m = new LayerManager(map, [
        {
          id: "overlay1",
          name: "Polygons",
          isBase: false,
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m);
      u.hiddenIds = new Set(["overlay1", "ghost", "gone"]);

      vi.useFakeTimers();
      u.applyUserState();

      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);
      vi.useRealTimers();

      const stored = JSON.parse(
        window.localStorage.getItem(CONST.STORAGE.VISIBILITY_KEY)!,
      );
      // Only the live id survives in storage — ghost/gone are gone for good.
      expect(stored).toEqual(expect.not.arrayContaining(["ghost", "gone"]));
      expect(stored).toContain("overlay1");
    });

    it("fires onToggle(false) for callback-only layers (canvas/heatmap)", () => {
      const { map } = makeTestMap();
      const onToggle = vi.fn();
      const m = new LayerManager(map, [
        {
          id: "canvas1",
          name: "Canvas",
          layer: null,
          onToggle,
        },
      ]);
      const u = new LayerUI(m);
      u.hiddenIds.add("canvas1");

      u.applyUserState();

      expect(onToggle).toHaveBeenCalledWith(false);
    });

    it("loads hidden ids from localStorage into hiddenIds", () => {
      const { map } = makeTestMap();
      window.localStorage.setItem(
        CONST.STORAGE.VISIBILITY_KEY,
        JSON.stringify(["overlay1", "base1"]),
      );
      const m = new LayerManager(map, [
        { id: "overlay1", name: "O", isBase: false, layer: testPolyLayer },
        { id: "base1", name: "B", isBase: true, layer: new TileLayer() },
      ]);
      const u = new LayerUI(m);

      u.loadPersistedState();

      expect(u.hiddenIds).toEqual(new Set(["overlay1", "base1"]));
    });

    it("ignores non-array/corrupt storage data", () => {
      const { map } = makeTestMap();
      window.localStorage.setItem(CONST.STORAGE.VISIBILITY_KEY, "not-json");
      const m = new LayerManager(map, [
        { id: "overlay1", name: "O", isBase: false, layer: testPolyLayer },
      ]);
      const u = new LayerUI(m);

      u.loadPersistedState();

      expect(u.hiddenIds).toEqual(new Set());
    });
  });

  // ─────────────────── save on toggle ───────────────────

  describe("saveHiddenIds on toggle", () => {
    it("persists a hidden overlay when the user unchecks it", () => {
      const { map, removeLayer } = makeTestMap();
      const m = new LayerManager(map, [
        {
          id: "overlay1",
          name: "Polygons",
          isBase: false,
          layer: testPolyLayer,
        },
      ]);
      map.hasLayer.mockReturnValue(true);
      const u = new LayerUI(m);
      u.hiddenIds = new Set();

      vi.useFakeTimers();
      u.syncHiddenId("overlay1", true);
      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);
      vi.useRealTimers();

      const stored = JSON.parse(
        window.localStorage.getItem(CONST.STORAGE.VISIBILITY_KEY)!,
      );
      expect(stored).toContain("overlay1");
    });

    it("removes an overlay from the persisted set when the user re-checks it", () => {
      const { map } = makeTestMap();
      const m = new LayerManager(map, [
        {
          id: "overlay1",
          name: "Polygons",
          isBase: false,
          layer: testPolyLayer,
        },
      ]);
      const u = new LayerUI(m);
      u.hiddenIds = new Set(["overlay1"]);

      vi.useFakeTimers();
      u.syncHiddenId("overlay1", false);
      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);
      vi.useRealTimers();

      const stored = JSON.parse(
        window.localStorage.getItem(CONST.STORAGE.VISIBILITY_KEY)!,
      );
      expect(stored).toEqual(expect.not.arrayContaining(["overlay1"]));
    });

    it("debounces rapid saves into one localStorage write", () => {
      const { map } = makeTestMap();
      const m = new LayerManager(map, [
        { id: "overlay1", name: "O", isBase: false, layer: testPolyLayer },
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
        u.syncHiddenId("overlay1", true);
        u.syncHiddenId("overlay1", false);
        u.syncHiddenId("overlay1", true);
        expect(setItem).not.toHaveBeenCalled();

        vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);
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
    it("does not pollute hiddenIds when color layer activates", () => {
      const { map } = makeTestMap();
      const m = new LayerManager(map, [
        { id: "overlay1", name: "O", isBase: false, layer: testPolyLayer },
        { id: "base1", name: "OSM", isBase: true, layer: new TileLayer() },
      ]);
      const u = new LayerUI(m);
      u.hiddenIds = new Set(["overlay1"]);
      // Simulate a container + rows so showColorLayer can iterate bases.
      const container = document.createElement("div");
      document.body.appendChild(container);
      m.uiContainer = container;
      map.getPane.mockReturnValue({
        classList: { add: vi.fn(), remove: vi.fn() },
      });

      u.showColorLayer("#000000");

      // overlay1 was hidden before the color activation and should stay hidden.
      expect(u.hiddenIds).toContain("overlay1");
      // No base-layer id was added even though showColorLayer deselects all bases.
      expect(u.hiddenIds).toEqual(new Set(["overlay1"]));
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
      data: Array<{ id: string; name: string; isBase?: boolean; layer?: any }>,
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
        getBounds: vi.fn(() => ({
          pad: vi.fn(() => ({})),
          getSouthWest: () => ({ lat: 20, lng: 90 }),
          getNorthWest: () => ({ lat: 50, lng: 90 }),
          getNorthEast: () => ({ lat: 50, lng: 120 }),
          getSouthEast: () => ({ lat: 20, lng: 120 }),
        })),
        getContainer: vi.fn(() => container),
        getPane: vi.fn(() => ({
          style: {},
          classList: { add: vi.fn(), remove: vi.fn() },
        })),
        createPane: vi.fn(() => ({
          style: {},
          classList: { add: vi.fn(), remove: vi.fn() },
        })),
        _container: container,
        _layers: {},
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
        CONST.STORAGE.VISIBILITY_KEY,
        JSON.stringify(["base1", "base2"]),
      );
      const { ui, map } = attachFixture([
        { id: "overlay1", name: "O", isBase: false, layer: poly },
        {
          id: "base1",
          name: "B1",
          isBase: true,
          layer: base1,
          paneName: "tilePane",
        },
        {
          id: "base2",
          name: "B2",
          isBase: true,
          layer: base2,
          paneName: "tilePane",
        },
      ]);

      // Both bases were removed from the map by applyUserState().
      expect(map.removeLayer).toHaveBeenCalledWith(base1);
      expect(map.removeLayer).toHaveBeenCalledWith(base2);
      // Color-layer fallback must NOT activate when the user intentionally hid every base.
      const colorItem = ui.uiContainer.querySelector(
        CONST.SEL.COLOR_ITEM,
      ) as HTMLElement | null;
      expect(colorItem?.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
      expect(ui.isColorActive).toBe(false);
      // The hidden set is preserved after the attach pass.
      expect(ui.hiddenIds).toEqual(new Set(["base1", "base2"]));
    });

    it("DOES show the color layer when no base layers are registered at all", () => {
      const poly = {
        options: {},
        eachLayer: vi.fn(),
        getBounds: vi.fn(() => ({ isValid: vi.fn(() => true) })),
      };
      const { ui, map } = attachFixture([
        { id: "overlay1", name: "O", isBase: false, layer: poly },
      ]);

      // No bases exist → fallback paints the map so it isn't blank.
      expect(ui.isColorActive).toBe(true);
      const colorItem = ui.uiContainer.querySelector(
        CONST.SEL.COLOR_ITEM,
      ) as HTMLElement | null;
      expect(colorItem?.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
      expect(map.removeLayer).not.toHaveBeenCalled();
      expect(ui.hiddenIds).toEqual(new Set());
    });

    it("keeps the color layer off when at least one base layer remains visible", () => {
      const poly = {
        options: {},
        eachLayer: vi.fn(),
        getBounds: vi.fn(() => ({ isValid: vi.fn(() => true) })),
      };
      const base1 = new TileLayer();
      window.localStorage.setItem(
        CONST.STORAGE.VISIBILITY_KEY,
        JSON.stringify(["base1"]),
      );
      const { ui, map } = attachFixture([
        { id: "overlay1", name: "O", isBase: false, layer: poly },
        {
          id: "base1",
          name: "B1",
          isBase: true,
          layer: base1,
          paneName: "tilePane",
        },
      ]);

      // base1 was hidden, but overlay1 is visible and there are no visible bases.
      // However, only base1 is hidden (not "all bases"), so the color fallback
      // must NOT activate — the user might re-show base1 at any time.
      expect(map.removeLayer).toHaveBeenCalledWith(base1);
      const colorItem = ui.uiContainer.querySelector(
        CONST.SEL.COLOR_ITEM,
      ) as HTMLElement | null;
      expect(colorItem?.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
      expect(ui.isColorActive).toBe(false);
    });
  });

  // ─────────────────── applyUserState with multiple layers ───────────────────

  describe("applyUserState with multiple hidden layers", () => {
    it("handles overlay, base, and callback-only layers in one pass", () => {
      const poly = {
        options: {},
        eachLayer: vi.fn(),
        getBounds: vi.fn(() => ({ isValid: vi.fn(() => true) })),
      };
      const baseLayer = new TileLayer();
      const onToggle = vi.fn();
      const { map, removeLayer } = (() => {
        const rl = vi.fn();
        return {
          map: {
            on: vi.fn(),
            off: vi.fn(),
            hasLayer: vi.fn(() => true),
            addLayer: vi.fn(),
            removeLayer: rl,
            getContainer: vi.fn(() => ({}) as HTMLElement),
            getPane: vi.fn(() => ({ style: {} })),
            createPane: vi.fn(() => ({
              style: {},
              classList: { add: vi.fn(), remove: vi.fn() },
            })),
            foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
          },
          removeLayer: rl,
        };
      })();
      const m = new LayerManager(map, [
        { id: "overlay1", name: "O", isBase: false, layer: poly },
        { id: "base1", name: "B1", isBase: true, layer: baseLayer },
        { id: "canvas1", name: "Canvas", layer: null, onToggle },
      ]);
      const u = new LayerUI(m);
      u.hiddenIds = new Set(["overlay1", "base1", "canvas1"]);

      u.applyUserState();

      expect(removeLayer).toHaveBeenCalledWith(poly);
      expect(removeLayer).toHaveBeenCalledWith(baseLayer);
      expect(onToggle).toHaveBeenCalledWith(false);
      expect(m.layerRegistry.get("overlay1")?.visible).toBe(false);
      expect(m.layerRegistry.get("base1")?.visible).toBe(false);
      expect(m.layerRegistry.get("canvas1")?.visible).toBe(false);
      expect(u.hiddenIds).toEqual(new Set(["overlay1", "base1", "canvas1"]));
    });
  });
});
