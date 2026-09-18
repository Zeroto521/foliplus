import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  applyHiddenOne,
  applyOpacityStateOne,
  applyUserState,
  applyVisibleStateOne,
  reconcileHiddenIds,
  saveFoldState,
  saveOpacityMap,
} from "#foliplus/LayerControl/ui/state.js";
import { EVENTS, ensureEvents } from "#foliplus/core/event/index.js";
import type { LayerInfo } from "#foliplus/core/layer/index.js";
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
        getContainer: vi.fn(() => {
          const el = document.createElement("div");
          el.id = "map";
          return el;
        }),
        getPane: vi.fn(() => ({
          style: {},
          classList: { add: vi.fn(), remove: vi.fn() },
        })),
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
            getContainer: vi.fn(() => document.createElement("div")),
            getPane: vi.fn(() => ({
              style: {},
              classList: { add: vi.fn(), remove: vi.fn() },
            })),
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

describe("ui/state applyHiddenOne / applyVisibleStateOne", () => {
  const makeApplyUi = (hasLayer: boolean): LayerUI => {
    const layer = { on: vi.fn(), off: vi.fn() };
    const uiContainer = document.createElement("div");
    uiContainer.innerHTML = `
      <div class="foliplus-layer-item" data-layer-id="a">
        <input type="checkbox" checked />
      </div>
    `;
    return {
      uiContainer,
      T: vi.fn((k: string) => k),
      m: {
        findLayer: vi.fn(() => layer),
        map: {
          hasLayer: vi.fn(() => hasLayer),
          removeLayer: vi.fn(),
          addLayer: vi.fn(),
        },
      },
    } as unknown as LayerUI;
  };

  it("applyHiddenOne removes a present layer and unchecks the row", () => {
    const ui = makeApplyUi(true);
    const onToggle = vi.fn();
    const layerInfo = {
      id: "a",
      onToggle,
      isBase: false,
    } as unknown as LayerInfo;
    applyHiddenOne(ui, layerInfo, "a");
    expect(ui.m.map.removeLayer).toHaveBeenCalled();
    expect(layerInfo.visible).toBe(false);
    const box = ui.uiContainer.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    expect(box.checked).toBe(false);
  });

  it("applyHiddenOne fires onToggle(false) for a callback-only layer", () => {
    const ui = makeApplyUi(false);
    (ui.m.findLayer as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const onToggle = vi.fn();
    const layerInfo = { id: "a", onToggle } as unknown as LayerInfo;
    applyHiddenOne(ui, layerInfo, "a");
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("applyVisibleStateOne re-adds a layer that is off the map", () => {
    const ui = makeApplyUi(false);
    const onToggle = vi.fn();
    const layerInfo = {
      id: "a",
      onToggle,
      isBase: false,
    } as unknown as LayerInfo;
    applyVisibleStateOne(ui, layerInfo);
    expect(ui.m.map.addLayer).toHaveBeenCalled();
    expect(layerInfo.visible).toBe(true);
  });
});

describe("ui/state saveFoldState", () => {
  it("writes the folded set through persistence", () => {
    const save = vi.fn();
    const ui = {
      foldedGroups: new Set(["overlay"]),
      m: { persistence: { saveFoldedGroups: save } },
    } as unknown as LayerUI;
    saveFoldState(ui);
    expect(save).toHaveBeenCalledWith(ui.foldedGroups);
  });
});

// ─────────────────── opacity apply / restore / prune ───────────────────

describe("applyOpacityStateOne", () => {
  /** A UI whose layer owns no pane, so the call falls back to the
   *  per-feature walk. */
  const noPrivatePane = () =>
    ({
      m: { panes: { fallbackPaneOf: () => null } },
    }) as unknown as LayerUI;

  it("writes canvas.style.opacity for canvas layers and skips Leaflet", () => {
    const setStyle = vi.fn();
    const canvas = document.createElement("canvas");
    const li = {
      id: "heat",
      canvas,
      layer: { options: {}, setStyle } as unknown as L.Layer,
      opacity: 1,
    } as unknown as LayerInfo;

    applyOpacityStateOne(noPrivatePane(), li, 0.35);

    expect(canvas.style.opacity).toBe("0.35");
    expect(li.opacity).toBe(0.35);
    expect(setStyle).not.toHaveBeenCalled();
  });

  it("calls setStyle({opacity, fillOpacity}) on Path-like layers", () => {
    const setStyle = vi.fn();
    const li = {
      id: "poly",
      canvas: null,
      layer: { options: {}, setStyle } as unknown as L.Layer,
      opacity: 1,
    } as unknown as LayerInfo;

    applyOpacityStateOne(noPrivatePane(), li, 0.5);

    expect(setStyle).toHaveBeenCalledWith({ opacity: 0.5, fillOpacity: 0.5 });
    expect(li.opacity).toBe(0.5);
  });

  it("recurses through LayerGroup children (no setStyle on the group)", () => {
    const childSetStyle = vi.fn();
    const group = {
      options: {},
      eachLayer: vi.fn((fn: (l: unknown) => void) => {
        fn({ options: {}, setStyle: childSetStyle });
      }),
    };
    const li = {
      id: "group",
      canvas: null,
      layer: group as unknown as L.Layer,
      opacity: 1,
    } as unknown as LayerInfo;

    applyOpacityStateOne(noPrivatePane(), li, 0.2);

    expect(group.eachLayer).toHaveBeenCalled();
    expect(childSetStyle).toHaveBeenCalledWith({ opacity: 0.2, fillOpacity: 0.2 });
  });

  it("reaches Markers inside a GeoJSON instead of using its setStyle", () => {
    // Leaflet's GeoJSON.setStyle forwards only to Path children, so a point
    // layer built from markers (folium's default) ignored the opacity control
    // entirely. Walking eachLayer reaches the markers, which take setOpacity.
    const groupSetStyle = vi.fn();
    const markerSetOpacity = vi.fn();
    const geoJson = {
      options: {},
      setStyle: groupSetStyle,
      eachLayer: vi.fn((fn: (l: unknown) => void) => {
        fn({ options: {}, setOpacity: markerSetOpacity });
      }),
    };
    const li = {
      id: "points",
      canvas: null,
      layer: geoJson as unknown as L.Layer,
      opacity: 1,
    } as unknown as LayerInfo;

    applyOpacityStateOne(noPrivatePane(), li, 0.3);

    expect(markerSetOpacity).toHaveBeenCalledWith(0.3);
    // The group-level setStyle would have silently skipped the markers.
    expect(groupSetStyle).not.toHaveBeenCalled();
    expect(li.opacity).toBe(0.3);
  });

  it("falls back to setOpacity for Markers", () => {
    const setOpacity = vi.fn();
    const li = {
      id: "marker",
      canvas: null,
      layer: { options: {}, setOpacity } as unknown as L.Layer,
      opacity: 1,
    } as unknown as LayerInfo;

    applyOpacityStateOne(noPrivatePane(), li, 0.8);

    expect(setOpacity).toHaveBeenCalledWith(0.8);
  });

  it("no-ops safely when the layer is null", () => {
    const li = {
      id: "x",
      canvas: null,
      layer: null,
      opacity: 1,
    } as unknown as LayerInfo;
    expect(() => applyOpacityStateOne(noPrivatePane(), li, 0.4)).not.toThrow();
    expect(li.opacity).toBe(0.4);
  });

  it("no-ops on a layer with none of the three opacity APIs", () => {
    // A layer type foliplus does not know (no eachLayer, no setStyle, no
    // setOpacity) still records the value — the walk ends quietly instead of
    // throwing on the next redraw.
    const li = {
      id: "opaque",
      canvas: null,
      layer: { options: {} } as unknown as L.Layer,
      opacity: 1,
      subPanes: [],
    } as unknown as LayerInfo;

    expect(() => applyOpacityStateOne(noPrivatePane(), li, 0.6)).not.toThrow();
    expect(li.opacity).toBe(0.6);
  });

  it("multiplies each feature's own opacity instead of overwriting it", () => {
    // A hollow polygon carries fillOpacity: 0. Writing the layer opacity
    // straight in would make its fill appear (0.4) instead of staying hollow;
    // the walk writes base × layer, and reads the base once so a second pass
    // does not compound.
    const setStyle = vi.fn();
    const li = {
      id: "hollow",
      canvas: null,
      layer: {
        options: { opacity: 1, fillOpacity: 0 },
        setStyle,
      } as unknown as L.Layer,
      opacity: 1,
    } as unknown as LayerInfo;

    applyOpacityStateOne(noPrivatePane(), li, 0.5);
    expect(setStyle).toHaveBeenLastCalledWith({ opacity: 0.5, fillOpacity: 0 });

    applyOpacityStateOne(noPrivatePane(), li, 0.25);
    expect(setStyle).toHaveBeenLastCalledWith({ opacity: 0.25, fillOpacity: 0 });

    // Reset restores the feature's own values, hollow fill included.
    applyOpacityStateOne(noPrivatePane(), li, 1);
    expect(setStyle).toHaveBeenLastCalledWith({ opacity: 1, fillOpacity: 0 });
  });

  it("multiplies a Marker's own opacity too", () => {
    const setOpacity = vi.fn();
    const li = {
      id: "faded-marker",
      canvas: null,
      layer: {
        options: { opacity: 0.8 },
        setOpacity,
      } as unknown as L.Layer,
      opacity: 1,
    } as unknown as LayerInfo;

    applyOpacityStateOne(noPrivatePane(), li, 0.5);

    expect(setOpacity).toHaveBeenCalledWith(0.4);
  });

  it("fades a plain layer through its own fallback pane, not a walk", () => {
    // enforceOrder names a per-layer pane after the layer's stamp and migrates
    // the content into it, so the layer is faded with a single style write
    // instead of a sweep — the cost no longer grows with the feature count.
    const pane = document.createElement("div");
    const setStyle = vi.fn();
    const ui = {
      m: {
        panes: { fallbackPaneOf: () => "foliplus-pane-7" },
        map: { getPane: (n: string) => (n === "foliplus-pane-7" ? pane : null) },
      },
    } as unknown as LayerUI;
    const li = {
      id: "plain",
      canvas: null,
      layer: { options: {}, setStyle } as unknown as L.Layer,
      opacity: 1,
    } as unknown as LayerInfo;

    applyOpacityStateOne(ui, li, 0.4);

    expect(pane.style.opacity).toBe("0.4");
    expect(setStyle).not.toHaveBeenCalled();
  });

  it("walks the features before the layer has a pane of its own", () => {
    // Registered but not yet ordered: the content is still in Leaflet's shared
    // markerPane / overlayPane, so there is no pane of its own to fade.
    // Touching that shared pane would fade every other overlay layer, so the
    // walk carries the opacity instead and no pane is touched at all.
    const getPane = vi.fn();
    const setStyle = vi.fn();
    const ui = {
      m: { panes: { fallbackPaneOf: () => null }, map: { getPane } },
    } as unknown as LayerUI;
    const li = {
      id: "plain",
      canvas: null,
      layer: { options: {}, setStyle } as unknown as L.Layer,
      opacity: 1,
    } as unknown as LayerInfo;

    applyOpacityStateOne(ui, li, 0.4);

    expect(getPane).not.toHaveBeenCalled();
    expect(setStyle).toHaveBeenCalledWith({ opacity: 0.4, fillOpacity: 0.4 });
  });

  it("does not stack the walk and the pane when a layer acquires its own pane", () => {
    // enforceOrder migrates the content on a debounce, so a layer can be
    // walked first and resolve to its own pane afterwards. The walk's write
    // must be undone, or the two would multiply: asked for 0.4 twice over, the
    // layer would render at 0.16.
    const setStyle = vi.fn();
    const pane = document.createElement("div");
    const layer = {
      options: { opacity: 1, fillOpacity: 1 },
      setStyle,
    } as unknown as L.Layer;
    const li = {
      id: "plain",
      canvas: null,
      layer,
      opacity: 1,
    } as unknown as LayerInfo;

    const unordered = {
      m: { panes: { fallbackPaneOf: () => null } },
    } as unknown as LayerUI;
    applyOpacityStateOne(unordered, li, 0.4);
    expect(setStyle).toHaveBeenLastCalledWith({ opacity: 0.4, fillOpacity: 0.4 });

    const ordered = {
      m: {
        panes: { fallbackPaneOf: () => "foliplus-pane-9" },
        map: { getPane: (n: string) => (n === "foliplus-pane-9" ? pane : null) },
      },
    } as unknown as LayerUI;
    applyOpacityStateOne(ordered, li, 0.4);

    // The feature is handed back its own value, and the pane carries 0.4 once.
    expect(setStyle).toHaveBeenLastCalledWith({ opacity: 1, fillOpacity: 1 });
    expect(pane.style.opacity).toBe("0.4");
  });

  it("sets CSS opacity on each pane element for managed layers (subPanes)", () => {
    // Managed layers (createLayers: MeasureControl) own their panes. Setting
    // opacity on the pane element is multiplicative and covers every feature
    // type uniformly — paths, markers, divIcons — without clobbering the
    // individual style a feature carries (e.g. a hollow polygon's
    // fillOpacity: 0 must stay 0, not become 0.4).
    const graphPane = document.createElement("div");
    const nodePane = document.createElement("div");
    const labelPane = document.createElement("div");
    const panes = new Map([
      ["graph", graphPane],
      ["node", nodePane],
      ["label", labelPane],
    ]);
    const ui = {
      m: {
        panes: { fallbackPaneOf: () => null },
        map: { getPane: (n: string) => panes.get(n) ?? null },
      },
    } as unknown as LayerUI;
    const li = {
      id: "measure",
      canvas: null,
      layer: { options: {} } as unknown as L.Layer,
      subPanes: ["graph", "node", "label"],
      opacity: 1,
    } as unknown as LayerInfo;

    applyOpacityStateOne(ui, li, 0.4);

    expect(graphPane.style.opacity).toBe("0.4");
    expect(nodePane.style.opacity).toBe("0.4");
    expect(labelPane.style.opacity).toBe("0.4");
    expect(li.opacity).toBe(0.4);
  });

  it("pane opacity at 1 clears the pane (reset)", () => {
    const pane = document.createElement("div");
    pane.style.opacity = "0.4";
    const ui = {
      m: {
        panes: { fallbackPaneOf: () => null },
        map: { getPane: () => pane },
      },
    } as unknown as LayerUI;
    const li = {
      id: "measure",
      canvas: null,
      layer: { options: {} } as unknown as L.Layer,
      subPanes: ["graph"],
      opacity: 0.4,
    } as unknown as LayerInfo;

    applyOpacityStateOne(ui, li, 1);

    expect(pane.style.opacity).toBe("1");
  });
});

describe("LayerUI opacity restore / prune", () => {
  const makeMap = () => {
    const setStyle = vi.fn();
    const layer = { options: {}, setStyle } as unknown as L.Layer;
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
      getPane: vi.fn(() => ({
        style: {},
        classList: { add: vi.fn(), remove: vi.fn() },
      })),
      createPane: vi.fn(() => ({
        style: {},
        classList: { add: vi.fn(), remove: vi.fn() },
      })),
      foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
    };
    return { map, layer, setStyle };
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
    const { map, layer, setStyle } = makeMap();
    const m = new LayerManager(map, [{ id: "overlay1", name: "Poly", layer }]);
    const u = new LayerUI(m);
    u.opacityMap = { overlay1: 0.45 };

    u.applyUserState();

    expect(setStyle).toHaveBeenCalledWith({ opacity: 0.45, fillOpacity: 0.45 });
    expect(m.layerRegistry.get("overlay1")?.opacity).toBe(0.45);
  });

  it("applyUserState(id) applies opacity for a late-registered canvas layer", () => {
    const { map } = makeMap();
    const canvas = document.createElement("canvas");
    const m = new LayerManager(map, [
      { id: "heat", name: "Heat", canvas, layer: null, onToggle: vi.fn() },
    ]);
    const u = new LayerUI(m);
    u.opacityMap = { heat: 0.25 };

    u.applyUserState("heat");

    expect(canvas.style.opacity).toBe("0.25");
    expect(m.layerRegistry.get("heat")?.opacity).toBe(0.25);
  });

  it("prunes opacity entries whose layers are gone", () => {
    const { map, layer, setStyle } = makeMap();
    const m = new LayerManager(map, [{ id: "overlay1", name: "Poly", layer }]);
    const u = new LayerUI(m);
    u.opacityMap = { overlay1: 0.4, ghost: 0.1 };

    u.applyUserState();

    expect(u.opacityMap).toEqual({ overlay1: 0.4 });
    // Still applied the live entry before pruning the ghost.
    expect(setStyle).toHaveBeenCalledWith({ opacity: 0.4, fillOpacity: 0.4 });
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
        isBase: false,
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

  it("onLayerItemCountChange re-applies the layer opacity to finalized geometry", () => {
    // A measurement finalized at store.add fires LAYER_ITEM_COUNT_CHANGE. The
    // panes were painted at full opacity while the preview was live; this is
    // when the opacity "snaps in" to the real geometry.
    const events = ensureEvents(ui.m.map);
    const li = manager.layerRegistry.get("overlay1")!;
    li.subPanes = ["__test_opacity_pane__"];
    ui.opacityMap = { overlay1: 0.4 };
    li.opacity = 0.4;

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

// ─────────────────── reconcile + opacity persistence ───────────────────

describe("ui/state reconcileHiddenIds and opacity persistence", () => {
  let manager: LayerManager;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("adopts a row whose checkbox is off but which is not in hiddenIds", () => {
    // initLayerItem derives the checkbox from map.hasLayer(), so a stub map
    // that still reports membership renders an unchecked row whose id never
    // reached hiddenIds. Trusting the row is what keeps the saved set absolute.
    const item = findItem(ui, "overlay1");
    const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = false;
    ui.hiddenIds = new Set();
    ui.hiddenHasState = false;
    const save = vi
      .spyOn(manager.persistence, "saveHiddenIds")
      .mockImplementation(() => {});

    reconcileHiddenIds(ui);

    expect(ui.hiddenIds.has("overlay1")).toBe(true);
    expect(ui.hiddenHasState).toBe(true);
    expect(save).toHaveBeenCalled();
  });

  it("reconcileHiddenIds writes nothing without a container or a checked-off row", () => {
    const bare = { uiContainer: null, m: { layers: [] } } as unknown as LayerUI;
    expect(() => reconcileHiddenIds(bare)).not.toThrow();

    const save = vi
      .spyOn(manager.persistence, "saveHiddenIds")
      .mockImplementation(() => {});
    ui.hiddenIds = new Set();
    // Every fixture row reads as checked, so the sweep has nothing to adopt —
    // and the load must stay read-only rather than rewrite saved state.
    reconcileHiddenIds(ui);
    expect(save).not.toHaveBeenCalled();
  });

  it("applyUserState(id) ignores an id with no registry entry", () => {
    expect(() => ui.applyUserState("ghost")).not.toThrow();
  });

  it("applyUserState(id) projects a hidden flag onto a single late layer", () => {
    ui.hiddenIds = new Set(["overlay1"]);

    ui.applyUserState("overlay1");

    expect(manager.layerRegistry.get("overlay1")?.visible).toBe(false);
  });

  it("saveOpacityMap persists the live map through the debounced getter", () => {
    const save = vi
      .spyOn(manager.persistence, "saveOpacity")
      .mockImplementation(() => {});
    ui.opacityMap = { overlay1: 0.3 };

    saveOpacityMap(ui);

    // The write is debounced, so the getter must read the map at flush time —
    // a later edit has to win over the snapshot at call time.
    const getter = save.mock.calls[0][0] as () => Record<string, number>;
    ui.opacityMap = { overlay1: 0.7 };
    expect(getter()).toEqual({ overlay1: 0.7 });
  });
});
