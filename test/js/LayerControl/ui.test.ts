import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui.js";
import { ensureModes } from "#foliplus/core/mode.js";

class TileLayer {
  options = { attribution: "© OpenStreetMap" };
  setZIndex = vi.fn();
}

class GridLayer {
  options = {};
}

const makePane = () => {
  const el = document.createElement("div");
  el.style.zIndex = "0";
  return el;
};

const initFixture = (
  options: {
    initialZoom?: number;
    maxZoom?: number;
  } = {},
): { manager: LayerManager; ui: LayerUI; map: any } => {
  // Mutate window.CONF in place: createScopedTranslator captures the CONF
  // object reference at module import time and reads conf.name lazily, so a
  // fresh stub object would leave the module's T() scoped to the wrong name.
  window.CONF.name = "LayerControl";
  window.CONF.locale_code = "en";

  class Renderer {}
  class Path {
    options = {};
  }
  class Polygon {
    options = {};
  }
  class Polyline {
    options = {};
  }
  class Marker {}
  class CircleMarker {
    constructor(_latlng: any, _opts: any) {}
    addTo(_map: any) {
      return this;
    }
  }
  const stamp = (() => {
    let id = 0;
    return vi.fn(() => ++id);
  })();

  window.L.TileLayer = TileLayer;
  window.L.GridLayer = GridLayer;
  window.L.Renderer = Renderer;
  window.L.layerGroup = vi.fn(() => ({
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    hasLayer: vi.fn(() => false),
    getLayers: vi.fn(() => []),
    clearLayers: vi.fn(),
    options: {},
  }));
  window.L.Path = Path;
  window.L.Polygon = Polygon;
  window.L.Polyline = Polyline;
  window.L.Marker = Marker;
  window.L.CircleMarker = CircleMarker;
  window.L.stamp = stamp;
  window.L.svg = vi.fn(() => ({ addTo: vi.fn() }));
  window.L.polygon = vi.fn(
    (rings: any, opts: any) => ({ options: opts, _rings: rings }) as any,
  );
  window.L.rectangle = vi.fn(
    (_bounds: any, opts: any) =>
      ({
        _options: opts,
        getClassName: () => opts?.className ?? "",
        on: vi.fn(),
        eachLayer: vi.fn(),
      }) as any,
  );
  // Minimal LatLngBounds accumulator for computeLayerBounds' leaf fallback.
  window.L.latLngBounds = vi.fn((a?: unknown, b?: unknown) => {
    const sw = { lat: Infinity, lng: Infinity };
    const ne = { lat: -Infinity, lng: -Infinity };
    const include = (x: unknown): void => {
      const item = x as {
        lat?: number;
        lng?: number;
        getSouthWest?: () => { lat: number; lng: number };
        getNorthEast?: () => { lat: number; lng: number };
      };
      if (
        typeof item.getSouthWest === "function" &&
        typeof item.getNorthEast === "function"
      ) {
        const s = item.getSouthWest();
        const n = item.getNorthEast();
        sw.lat = Math.min(sw.lat, s.lat);
        sw.lng = Math.min(sw.lng, s.lng);
        ne.lat = Math.max(ne.lat, n.lat);
        ne.lng = Math.max(ne.lng, n.lng);
      } else if (typeof item.lat === "number" && typeof item.lng === "number") {
        sw.lat = Math.min(sw.lat, item.lat);
        sw.lng = Math.min(sw.lng, item.lng);
        ne.lat = Math.max(ne.lat, item.lat);
        ne.lng = Math.max(ne.lng, item.lng);
      }
    };
    const acc = {
      isValid: () => sw.lat !== Infinity,
      extend: (x: unknown) => {
        include(x);
        return acc;
      },
      getSouthWest: () => sw,
      getNorthEast: () => ne,
    };
    if (Array.isArray(a)) for (const x of a) include(x);
    else if (a != null) {
      include(a);
      if (b != null) include(b);
    }
    return acc;
  }) as unknown as typeof L.latLngBounds;

  const container = document.createElement("div");
  document.body.appendChild(container);

  const sw = { lat: 30, lng: 100 };
  const ne = { lat: 40, lng: 110 };
  const bounds = {
    isValid: vi.fn(() => true),
    getSouthWest: () => sw,
    getNorthEast: () => ne,
  };

  const polygonLayer = {
    options: {},
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => bounds),
  };

  const map: any = {
    on: vi.fn(),
    off: vi.fn(),
    // suspendMapInteractions (called by core/mode syncInteractionLock when
    // LayerControl registers "focusing") iterates layers; the ui.test mock
    // has no real layer tree, so a no-op is sufficient.
    eachLayer: vi.fn(),
    invalidateSize: vi.fn(),
    hasLayer: vi.fn(() => true),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    getZoom: vi.fn(() => options.initialZoom ?? 5),
    getMaxZoom: vi.fn(() => options.maxZoom ?? 18),
    getBounds: vi.fn(() => {
      const view = {
        pad: vi.fn(() => view),
        getSouthWest: () => ({ lat: 20, lng: 90 }),
        getNorthWest: () => ({ lat: 50, lng: 90 }),
        getNorthEast: () => ({ lat: 50, lng: 120 }),
        getSouthEast: () => ({ lat: 20, lng: 120 }),
      };
      return view;
    }),
    getContainer: vi.fn(() => container),
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
    _container: container,
    _layers: {},
    attributionControl: { _attributions: {}, _update: vi.fn() },
    foliplus: {
      showHint: vi.fn(),
      hideHint: vi.fn(),
    },
  };

  const manager = new LayerManager(map, [
    { id: "overlay1", name: "Polygons", isBase: false, layer: polygonLayer },
    {
      id: "base1",
      name: "OSM",
      isBase: true,
      layer: new TileLayer(),
      paneName: "tilePane",
    },
  ]);
  manager.enforceOrder();
  manager.ui = new LayerUI(manager);

  // Switch to fake timers BEFORE attachUI so the 300ms initTypesAndVisibility
  // timeout from attachUI is controllable. If the timer were REAL and
  // advanceTimersByTime didn't flush it, the callback would fire after
  // afterEach clears the DOM and throw on the detached container.
  vi.useFakeTimers();

  manager.attachUI(container);
  const ui = manager.ui!;

  vi.advanceTimersByTime(350);
  vi.useRealTimers();

  return { manager, ui, map };
};

const findItem = (ui: LayerUI, id: string): HTMLElement =>
  ui.uiContainer.querySelector(`[${CONST.DATA.LAYER_ID}="${id}"]`) as HTMLElement;

/** Resolve the overlay group's toggle-all row and its chevron, plus a live
 *  read of its child rows. */
const attachWithGroup = (ui: LayerUI) => {
  const row = ui.uiContainer.querySelector(
    `.${CONST.CLASSES.TOGGLE_ALL}[data-group="${CONST.GROUP.OVERLAY}"]`,
  ) as HTMLElement;
  const children = () =>
    Array.from(
      ui.uiContainer.querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${CONST.GROUP.OVERLAY}"]`,
      ),
    );

  return {
    ui,
    row,
    foldBtn: row.querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement,
    children,
  };
};

/** True when every group child row carries the folded class, i.e. the group is
 *  folded. The toggle-all row itself never gets this class — only its
 *  children do — so the fold assertion goes on them. */
const allFolded = (rows: HTMLElement[]) =>
  rows.length > 0 &&
  rows.every(el => el.classList.contains(CONST.CLASSES.GROUP_FOLDED));

/** Fire a keydown on `el`, leaving DOM focus there. handleKeyDown() resolves
 *  the cursor from `document.activeElement` only, so focus must already be
 *  pinned on `el` before the dispatch. */
const pressKey = (el: HTMLElement, key: string) => {
  el.focus();
  el.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
  );
};

/** Re-resolve the overlay group's chevron — the panel rebuilds on every fold,
 *  so a chevron captured before a fold is detached. */
const overlayFoldBtn = (root: ParentNode) =>
  root
    .querySelector(`.${CONST.CLASSES.TOGGLE_ALL}[data-group="${CONST.GROUP.OVERLAY}"]`)!
    .querySelector(`.${CONST.CLASSES.FOLD_BTN}`) as HTMLElement;

// ===========================================================================
describe("LayerUI focusLayer / openMoreMenu / closeMoreMenu", () => {
  let manager: LayerManager, ui: LayerUI, map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
    // Fold tests need two overlay layers, so overlay1 isn't collapsed into the
    // single-child "no toggle-all" layout. Registered here (not in the tests)
    // because initFixture() flushes the 300ms initTypesAndVisibility timeout
    // AFTER any nested beforeEach, which would drop a layer added inside a test.
    if (!manager.layerRegistry.get("overlay2"))
      manager.registerLayer({
        id: "overlay2",
        name: "Circles",
        isBase: false,
        layer: { options: {}, eachLayer: vi.fn() },
      });
    ui.foldedGroups = new Set();
    ui.hiddenIds = new Set();
    // Folded-group state is persisted to localStorage, so a fold from one test
    // would be re-read by the next test's LayerUI constructor and present as
    // already-folded.
    window.localStorage.removeItem(CONST.STORAGE.FOLD_KEY);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
    // LayerControl holds "focusing" mode during an in-flight focus; clear it
    // on the FIXTURE map (not window.map) so a focus-holding test cannot leak.
    const modes = ensureModes(map);
    if (modes.getMode("LayerControl") === "focusing")
      modes.setMode("LayerControl", null);
  });

  // ─────────────────── focusLayer() ───────────────────

  describe("focusLayer()", () => {
    it("draws a border-only dashed rectangle on the layer bounds", () => {
      ui.focusLayer("overlay1");

      expect(L.rectangle).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          className: "foliplus-focus-rect",
          fill: false,
          interactive: false,
        }),
      );
      expect(map.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          _options: expect.objectContaining({
            className: "foliplus-focus-rect",
          }),
        }),
      );
    });

    it("passes the correct bounds object to L.rectangle", () => {
      ui.focusLayer("overlay1");

      expect(L.rectangle).toHaveBeenCalledWith(
        expect.objectContaining({
          getSouthWest: expect.any(Function),
          getNorthEast: expect.any(Function),
          isValid: expect.any(Function),
        }),
        expect.anything(),
      );
    });

    it("calls fitBounds with smooth animation options", () => {
      ui.focusLayer("overlay1");

      expect(map.fitBounds).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          animate: true,
          duration: CONST.FOCUS.FIT_DURATION,
          padding: CONST.FOCUS.PADDING,
        }),
      );
    });

    it("caps maxZoom at current zoom + FOCUS.MAX_ZOOM_STEP", () => {
      ui.focusLayer("overlay1");

      expect(map.fitBounds).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxZoom: 11 }), // zoom(5) + FOCUS.MAX_ZOOM_STEP(6)
      );
    });

    it("caps maxZoom at map.getMaxZoom() when current + step exceeds it", () => {
      ({ manager, ui, map } = initFixture({ initialZoom: 17, maxZoom: 18 }));

      ui.focusLayer("overlay1");

      expect(map.fitBounds).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxZoom: 18 }), // min(18, 17 + 6)
      );
    });

    it("adds the layer to the map if checkbox is checked but layer is off map", () => {
      map.hasLayer.mockReturnValue(false);

      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = true;

      ui.focusLayer("overlay1");

      expect(map.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ getBounds: expect.any(Function) }),
      );
    });

    it("does not re-add the layer when it is already on the map", () => {
      map.hasLayer.mockReturnValue(true);
      map.addLayer.mockReset();

      ui.focusLayer("overlay1");

      // addLayer may be called for the rectangle overlay, but NOT for the
      // layer itself (already on the map).
      const layerArgs = map.addLayer.mock.calls
        .map(c => c[0])
        .filter((arg: any) => arg && typeof arg.getBounds === "function");
      expect(layerArgs.length).toBe(0);
    });

    it("bails out when bounds are invalid", () => {
      const layer = manager.findLayer(manager.layerRegistry.get("overlay1")!);
      // @ts-expect-error — override mocked getBounds
      layer.getBounds.mockImplementationOnce(() => ({ isValid: () => false }));

      ui.focusLayer("overlay1");

      expect(L.rectangle).not.toHaveBeenCalled();
      expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it("computes bounds from leaf nodes when the layer has no getBounds (third-party)", () => {
      // A third-party layer without getBounds() — focus must fall back to
      // summing its children's bounds instead of throwing.
      const layer = manager.findLayer(manager.layerRegistry.get("overlay1")!);
      // @ts-expect-error — strip getBounds to simulate a custom L.Layer subclass
      layer.getBounds = undefined;
      // @ts-expect-error — eachLayer iterates two leaf children
      layer.eachLayer = (fn: (c: unknown) => void) => {
        for (const b of [
          { sw: { lat: 30, lng: 100 }, ne: { lat: 40, lng: 110 } },
          { sw: { lat: 31, lng: 101 }, ne: { lat: 39, lng: 109 } },
        ]) {
          fn({
            options: {}, // every Leaflet layer has options; missing it breaks discoverChildPanes
            getBounds: () => ({
              isValid: () => true,
              getSouthWest: () => b.sw,
              getNorthEast: () => b.ne,
            }),
          });
        }
      };

      ui.focusLayer("overlay1");

      expect(map.fitBounds).toHaveBeenCalled();
      expect(L.rectangle).toHaveBeenCalled();
    });

    it("focuses a canvas layer via its getBounds provider", () => {
      const canvas = document.createElement("canvas");
      canvas.style.filter = "";
      manager.registerLayer({
        id: "heat1",
        name: "Heat",
        canvas,
        onToggle: () => {},
        getBounds: () => ({
          isValid: () => true,
          getSouthWest: () => ({ lat: 30, lng: 100 }),
          getNorthEast: () => ({ lat: 40, lng: 110 }),
        }),
      });
      // A never-touched late registration must not be force-hidden by the
      // targeted applyUserState(id) drain — that is what keeps this focusable.
      ui.focusLayer("heat1");

      expect(map.fitBounds).toHaveBeenCalled();
      expect(L.rectangle).toHaveBeenCalled();
      // Glow applied via class (CSS-owned), not an inline filter — keeps it
      // at pane/element level so dense layers stay cheap.
      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_GLOW)).toBe(true);
    });

    it("bails out when the layer is not found on the map", () => {
      vi.spyOn(manager, "findLayer").mockReturnValue(null);

      ui.focusLayer("overlay1");

      expect(L.rectangle).not.toHaveBeenCalled();
      expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it("bails out for a non-existent layer id without error", () => {
      expect(() => ui.focusLayer("nonexistent")).not.toThrow();
      expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it("shows a hint when the layer is hidden (checkbox unchecked)", () => {
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = false;

      // ensureEvents() wipes map.foliplus.showHint; re-attach a spy.
      const hintSpy = vi.fn();
      map.foliplus.showHint = hintSpy;

      ui.focusLayer("overlay1");

      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "LayerControl.focus_layer_hidden",
        expect.any(Number),
      );
      expect(map.fitBounds).not.toHaveBeenCalled();
      expect(L.rectangle).not.toHaveBeenCalled();
    });

    it("removes the previous focus rectangle before drawing a new one", () => {
      vi.useFakeTimers();

      ui.focusLayer("overlay1");
      const firstRect = ui.focusRect!;

      ui.focusLayer("overlay1");

      expect(map.removeLayer).toHaveBeenCalledWith(firstRect);
      expect(ui.focusRect).not.toBeNull();
      expect(ui.focusRect).not.toBe(firstRect);
    });

    it("removes the focus rectangle after FOCUS.RECT_DURATION_MS", () => {
      vi.useFakeTimers();

      ui.focusLayer("overlay1");
      const rect = ui.focusRect!;
      const duration = CONST.FOCUS.RECT_DURATION_MS;

      vi.advanceTimersByTime(duration - 1);
      expect(map.removeLayer).not.toHaveBeenCalledWith(rect);

      vi.advanceTimersByTime(1);
      expect(map.removeLayer).toHaveBeenCalledWith(rect);
      expect(ui.focusRect).toBeNull();
    });

    it("does not remove a replaced focus rectangle at the 5s timeout", () => {
      vi.useFakeTimers();

      ui.focusLayer("overlay1");
      ui.focusLayer("overlay1");
      const finalRect = ui.focusRect!;
      // The first rect was removed synchronously; the second's 5s timer
      // should only remove `finalRect`.
      vi.advanceTimersByTime(CONST.FOCUS.RECT_DURATION_MS + 1);

      expect(map.removeLayer).toHaveBeenCalledWith(finalRect);
    });

    it("uses flyTo (not fitBounds) when bounds area is below MIN_BOUNDS_AREA", () => {
      const layer = manager.findLayer(manager.layerRegistry.get("overlay1")!);
      const tinyBounds = {
        isValid: () => true,
        getSouthWest: () => ({ lat: 30, lng: 100 }),
        getNorthEast: () => ({ lat: 30.000001, lng: 100.000001 }),
        getCenter: () => ({ lat: 30, lng: 100 }),
      };
      // @ts-expect-error — override mocked getBounds
      layer.getBounds.mockReturnValue(tinyBounds);

      ui.focusLayer("overlay1");

      expect(map.fitBounds).not.toHaveBeenCalled();
      expect(map.flyTo).toHaveBeenCalledWith(
        { lat: 30, lng: 100 },
        11, // zoom(5) + FOCUS.MAX_ZOOM_STEP(6)
        expect.objectContaining({ duration: CONST.FOCUS.FIT_DURATION }),
      );
    });

    it("adds foliplus-layer-focusing class to the focused row", () => {
      ui.focusLayer("overlay1");

      const item = findItem(ui, "overlay1");
      expect(item.classList.contains("foliplus-layer-focusing")).toBe(true);
    });

    it("isFocusing() returns true while focus is in flight", () => {
      vi.useFakeTimers();

      expect(ui.isFocusing()).toBe(false);
      ui.focusLayer("overlay1");
      expect(ui.isFocusing()).toBe(true);
    });

    it("cancelFocus() removes rect, row highlight, and map handlers", () => {
      vi.useFakeTimers();

      ui.focusLayer("overlay1");
      const rect = ui.focusRect!;
      const item = findItem(ui, "overlay1");
      expect(item.classList.contains("foliplus-layer-focusing")).toBe(true);

      // Cancel hint — re-attach spy after ensureEvents().
      const hintSpy = vi.fn();
      map.foliplus.showHint = hintSpy;

      ui.cancelFocus();

      expect(map.removeLayer).toHaveBeenCalledWith(rect);
      expect(ui.focusRect).toBeNull();
      expect(item.classList.contains("foliplus-layer-focusing")).toBe(false);
      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "LayerControl.focus_cancelled",
        expect.any(Number),
      );
      expect(ui.isFocusing()).toBe(false);
    });

    it("dblclick on a layer row triggers focusLayer", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");

      const item = findItem(ui, "overlay1");
      item.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

      expect(focusSpy).toHaveBeenCalledWith("overlay1");

      focusSpy.mockRestore();
    });
  });

  // ─────────────────── inverse mask (dim outside) ───────────────────

  describe("focusLayer inverse mask", () => {
    it("draws a polygon with the view bounds as outer ring and layer bounds as hole", () => {
      const polygonSpy = vi.spyOn(window.L, "polygon");

      ui.focusLayer("overlay1");

      expect(polygonSpy).toHaveBeenCalledTimes(1);
      const rings = polygonSpy.mock.calls[0][0];
      expect(rings).toHaveLength(2);
      // Hole ring = overlay1 bounds: SW(30,100) → NE(40,110).
      const hole = rings[1];
      expect(hole[0]).toEqual({ lat: 30, lng: 100 });
      expect(hole[2]).toEqual({ lat: 40, lng: 110 });

      polygonSpy.mockRestore();
    });

    it("dims with MASK_OPACITY and renders above layer panes", () => {
      const polygonSpy = vi.spyOn(window.L, "polygon");

      ui.focusLayer("overlay1");

      const opts = polygonSpy.mock.calls[0][1];
      expect(opts.fillOpacity).toBe(CONST.FOCUS.MASK_OPACITY);
      expect(opts.fillColor).toBe("#000000");
      expect(opts.stroke).toBe(false);
      expect(opts.interactive).toBe(false);
      // The mask renders in the shared focus renderer, not the default pane.
      expect(opts.renderer).toBeTruthy();

      polygonSpy.mockRestore();
    });

    it("cancelFocus removes the mask and the shared renderer", () => {
      ui.focusLayer("overlay1");
      const mask = ui.focusMask!;
      const renderer = ui.focusRenderer!;

      ui.cancelFocus();

      expect(map.removeLayer).toHaveBeenCalledWith(mask);
      // The SVG renderer is torn down too: reusing it across focuses left the
      // previous focus's mask/rect paths in the SVG even after removeLayer, so
      // focusing A then B showed two boxes (stale A mask + new B mask). A fresh
      // renderer per focus guarantees a clean slate.
      expect(map.removeLayer).toHaveBeenCalledWith(renderer);
      expect(ui.focusMask).toBeNull();
      expect(ui.focusRenderer).toBeNull();
    });

    it("focusing A then B removes A's mask and rect (no stale box)", () => {
      // Regression: reusing the SVG renderer across focuses left the previous
      // focus's mask/rect paths in the SVG even after removeLayer, so focusing
      // A then B showed two boxes (stale A mask + new B mask). Each focus must
      // tear down the prior mask/rect + renderer.
      ui.focusLayer("overlay1");
      const firstMask = ui.focusMask!;
      const firstRect = ui.focusRect!;

      ui.focusLayer("overlay1"); // same layer — dismissFocus runs first

      expect(map.removeLayer).toHaveBeenCalledWith(firstMask);
      expect(map.removeLayer).toHaveBeenCalledWith(firstRect);
      expect(ui.focusMask).not.toBe(firstMask);
      expect(ui.focusRect).not.toBe(firstRect);
    });

    it("rapid clicks across different layers leave only the last mask + rect", () => {
      // Register a second overlay with distinct bounds so the two focuses
      // produce different mask holes.
      manager.registerLayer({
        id: "overlay2",
        name: "Shapes",
        layer: {
          options: { pane: "custom_pane" },
          eachLayer: vi.fn(),
          getBounds: () => ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 35, lng: 105 }),
            getNorthEast: () => ({ lat: 45, lng: 115 }),
          }),
        } as unknown as L.Layer,
      });

      ui.focusLayer("overlay1");
      const firstMask = ui.focusMask!;
      ui.focusLayer("overlay2"); // immediate second focus on a different layer

      // The first mask is removed and the hole is now overlay2's bounds.
      expect(map.removeLayer).toHaveBeenCalledWith(firstMask);
      expect(ui.focusMask).not.toBe(firstMask);
      expect(ui.focusingLayerId).toBe("overlay2");
      // A single mask exists (fresh renderer each focus), hole = overlay2 SW.
      const hole = (window.L.polygon as ReturnType<typeof vi.fn>).mock.calls.at(
        -1,
      )?.[0][1];
      expect(hole[0]).toEqual({ lat: 35, lng: 105 });

      // And it still tears down cleanly.
      ui.cancelFocus();
      expect(ui.focusMask).toBeNull();
      expect(ui.focusRect).toBeNull();
      expect(ui.focusRenderer).toBeNull();
    });

    it("does not draw a mask for single-point (flyTo) layers", () => {
      const polygonSpy = vi.spyOn(window.L, "polygon");

      const layer = manager.findLayer(manager.layerRegistry.get("overlay1")!);
      const tinyBounds = {
        isValid: () => true,
        getSouthWest: () => ({ lat: 30, lng: 100 }),
        getNorthEast: () => ({ lat: 30.000001, lng: 100.000001 }),
        getCenter: () => ({ lat: 30, lng: 100 }),
      };
      // @ts-expect-error — override mocked getBounds
      layer.getBounds.mockReturnValue(tinyBounds);

      ui.focusLayer("overlay1");

      expect(polygonSpy).not.toHaveBeenCalled();

      polygonSpy.mockRestore();
    });
  });

  // ─────────────────── hide other layers (declarative CSS class) ───────────────────

  describe("focusLayer hides other layers", () => {
    const container = () => ui.m.map.getContainer() as HTMLElement;

    it("adds the focus-active class to the map container on focus", () => {
      ui.focusLayer("overlay1");

      expect(container().classList.contains(CONST.CLASSES.FOCUS_ACTIVE)).toBe(true);
    });

    it("marks the focused layer's pane with focus-pane so CSS keeps it visible", () => {
      const panes = new Map<string, HTMLElement>();
      map.getPane.mockImplementation((name: string) => {
        if (!panes.has(name)) panes.set(name, makePane());
        return panes.get(name)!;
      });
      manager.registerLayer({
        id: "overlay2",
        name: "Shapes",
        layer: {
          options: { pane: "custom_pane" },
          eachLayer: vi.fn(),
          getBounds: () => ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 30, lng: 100 }),
            getNorthEast: () => ({ lat: 40, lng: 110 }),
          }),
        } as unknown as L.Layer,
      });

      ui.focusLayer("overlay2");

      expect(
        panes.get("custom_pane")?.classList.contains(CONST.CLASSES.FOCUS_PANE),
      ).toBe(true);
    });

    it("marks a canvas (heatmap) focused layer with focus-pane", () => {
      const canvas = document.createElement("canvas");
      manager.registerLayer({
        id: "heat1",
        name: "Heat",
        canvas,
        onToggle: () => {},
        getBounds: () => ({
          isValid: () => true,
          getSouthWest: () => ({ lat: 30, lng: 100 }),
          getNorthEast: () => ({ lat: 40, lng: 110 }),
        }),
      });

      ui.focusLayer("heat1");

      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(true);
    });

    it("does not mark shared default panes (overlayPane/markerPane)", () => {
      // overlay1's mock layer has no custom pane, so getLayerPanes falls back
      // to overlayPane/markerPane — those are shared and must not be touched.
      const panes = new Map<string, HTMLElement>();
      map.getPane.mockImplementation((name: string) => {
        if (!panes.has(name)) panes.set(name, makePane());
        return panes.get(name)!;
      });

      ui.focusLayer("overlay1");

      const marked = Array.from(panes.values()).filter(p =>
        p.classList.contains(CONST.CLASSES.FOCUS_PANE),
      );
      expect(marked).toHaveLength(0);
    });

    it("applies the glow class to the focused pane (not per leaf element)", () => {
      const panes = new Map<string, HTMLElement>();
      map.getPane.mockImplementation((name: string) => {
        if (!panes.has(name)) panes.set(name, makePane());
        return panes.get(name)!;
      });
      manager.registerLayer({
        id: "overlay2",
        name: "Shapes",
        layer: {
          options: { pane: "custom_pane" },
          eachLayer: vi.fn(),
          getBounds: () => ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 30, lng: 100 }),
            getNorthEast: () => ({ lat: 40, lng: 110 }),
          }),
        } as unknown as L.Layer,
      });

      ui.focusLayer("overlay2");

      expect(
        panes.get("custom_pane")?.classList.contains(CONST.CLASSES.FOCUS_PANE),
      ).toBe(true);
      expect(
        panes.get("custom_pane")?.classList.contains(CONST.CLASSES.FOCUS_GLOW),
      ).toBe(true);

      ui.cancelFocus();

      expect(
        panes.get("custom_pane")?.classList.contains(CONST.CLASSES.FOCUS_GLOW),
      ).toBe(false);
    });

    it("applies the glow class to a focused canvas (heatmap) layer", () => {
      const canvas = document.createElement("canvas");
      manager.registerLayer({
        id: "heat1",
        name: "Heat",
        canvas,
        onToggle: () => {},
        getBounds: () => ({
          isValid: () => true,
          getSouthWest: () => ({ lat: 30, lng: 100 }),
          getNorthEast: () => ({ lat: 40, lng: 110 }),
        }),
      });

      ui.focusLayer("heat1");

      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_GLOW)).toBe(true);

      ui.cancelFocus();

      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_GLOW)).toBe(false);
    });

    it("cancelFocus removes the focus-active class and the focus-pane markers", () => {
      const canvas = document.createElement("canvas");
      manager.registerLayer({
        id: "heat1",
        name: "Heat",
        canvas,
        onToggle: () => {},
        getBounds: () => ({
          isValid: () => true,
          getSouthWest: () => ({ lat: 30, lng: 100 }),
          getNorthEast: () => ({ lat: 40, lng: 110 }),
        }),
      });

      ui.focusLayer("heat1");
      expect(container().classList.contains(CONST.CLASSES.FOCUS_ACTIVE)).toBe(true);
      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(true);

      ui.cancelFocus();

      expect(container().classList.contains(CONST.CLASSES.FOCUS_ACTIVE)).toBe(false);
      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(false);
    });

    it("lifts the focused layer's pane above others and restores it on cancel", () => {
      const panes = new Map<string, HTMLElement>();
      map.getPane.mockImplementation((name: string) => {
        if (!panes.has(name)) panes.set(name, makePane());
        return panes.get(name)!;
      });
      manager.registerLayer({
        id: "overlay2",
        name: "Shapes",
        layer: {
          options: { pane: "custom_pane" },
          eachLayer: vi.fn(),
          getBounds: () => ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 30, lng: 100 }),
            getNorthEast: () => ({ lat: 40, lng: 110 }),
          }),
        } as unknown as L.Layer,
      });

      ui.focusLayer("overlay2");

      expect(panes.get("custom_pane")?.style.zIndex).toBe(
        String(CONST.FOCUS.PANE_Z - 10),
      );

      ui.cancelFocus();

      expect(panes.get("custom_pane")?.style.zIndex).toBe("0");
    });

    it("lifts a canvas (heatmap) focused layer above others and restores it", () => {
      const canvas = document.createElement("canvas");
      canvas.style.zIndex = "5";
      manager.registerLayer({
        id: "heat1",
        name: "Heat",
        canvas,
        onToggle: () => {},
        getBounds: () => ({
          isValid: () => true,
          getSouthWest: () => ({ lat: 30, lng: 100 }),
          getNorthEast: () => ({ lat: 40, lng: 110 }),
        }),
      });

      ui.focusLayer("heat1");
      expect(canvas.style.zIndex).toBe(String(CONST.FOCUS.PANE_Z - 10));

      ui.cancelFocus();
      expect(canvas.style.zIndex).toBe("5");
    });
  });

  // ─────────────────── overflow menu ───────────────────

  describe("openMoreMenu() / closeMoreMenu()", () => {
    it("creates a menu with the focus-layer action", () => {
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      );
      expect(li).not.toBeNull();
      expect(li?.getAttribute("role")).toBe("menuitem");
      expect(li?.getAttribute("tabindex")).toBe("0");
      expect(li?.getAttribute("title")).toBeDefined();
    });

    it("places the menu inside the layer row element", () => {
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });

    it("sets position:relative on the layer row", () => {
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);

      expect(item.style.position).toBe("relative");
    });

    it("closes the previously open menu before opening a new one", () => {
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);
      ui.openMoreMenu(item);

      // Only one menu at a time — the new one replaced the old.
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
      expect(ui.activeMenu).not.toBeNull();
    });

    it("closeMoreMenu(setFocus=true) returns focus to the layer row", () => {
      const item = findItem(ui, "overlay1");
      const focusSpy = vi.fn();
      item.focus = focusSpy;

      ui.openMoreMenu(item);
      ui.closeMoreMenu(true);

      expect(focusSpy).toHaveBeenCalled();
    });

    it("closeMoreMenu(setFocus=false) does not focus the layer row", () => {
      const item = findItem(ui, "overlay1");
      const focusSpy = vi.fn();
      item.focus = focusSpy;

      ui.openMoreMenu(item);
      ui.closeMoreMenu(false);

      expect(focusSpy).not.toHaveBeenCalled();
    });

    it("closeMoreMenu() is a no-op when no menu is open", () => {
      expect(() => ui.closeMoreMenu(false)).not.toThrow();
    });
  });

  // ─────────────────── more button visibility ───────────────────

  describe("more button visibility", () => {
    // All layers (data + base) expose the "more" button: data layers can
    // focus + rename, base maps can rename. The ⋮ button is never hidden.
    it("base layer more button is visible (rename is available)", () => {
      const baseItem = findItem(ui, "base1");
      const btn = baseItem.querySelector(`.${CONST.CLASSES.MORE_BTN}`);
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("hidden")).toBeNull();
    });

    it("overlay layer more button is visible", () => {
      const overlayItem = findItem(ui, "overlay1");
      const btn = overlayItem.querySelector(`.${CONST.CLASSES.MORE_BTN}`);
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("hidden")).toBeNull();
    });

    it("color layer has more button (rename entry point)", () => {
      const colorItem = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM}`)!;
      const btn = colorItem.querySelector(`.${CONST.CLASSES.MORE_BTN}`);
      expect(btn).not.toBeNull();
    });
  });

  // ─────────────────── hidden layer disables focus menu item ───────────────────

  describe("focus-layer menu item when layer is hidden", () => {
    it("marks the menu item disabled when checkbox is unchecked", () => {
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = false;

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement | null;
      expect(li).not.toBeNull();
      expect(li?.getAttribute("disabled")).toBe("disabled");
      expect(li?.getAttribute("title")).toBeDefined();
    });

    it("clicking the disabled menu item does not call focusLayer", () => {
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = false;

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const focusSpy = vi.fn();
      ui.focusLayer = focusSpy;

      const li = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement;
      li.click();

      expect(focusSpy).not.toHaveBeenCalled();
      // Menu stays open — user sees the disabled state and tooltip.
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });

    it("menu item is not disabled when layer is visible", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement | null;
      expect(li?.getAttribute("disabled")).toBeNull();
    });

    it("Enter on a visible menu item triggers focusLayer and closes the menu", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement;
      li.focus();
      expect(document.activeElement).toBe(li);

      const focusSpy = vi.fn();
      ui.focusLayer = focusSpy;

      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(focusSpy).toHaveBeenCalledWith("overlay1");
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });

    it("Enter on a disabled menu item shows a hint and does not call focusLayer", () => {
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = false;

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement;
      li.focus();

      const focusSpy = vi.fn();
      ui.focusLayer = focusSpy;

      const hintSpy = vi.fn();
      map.foliplus.showHint = hintSpy;

      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(focusSpy).not.toHaveBeenCalled();
      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "LayerControl.focus_layer_hidden",
        expect.any(Number),
      );
      // Menu stays open — user sees why focus is unavailable.
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });
  });

  // ─────────────────── rename ───────────────────

  describe("rename menu item / renameLayer()", () => {
    it("openMoreMenu includes a rename-layer menu item for an overlay layer", () => {
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);

      const li = item.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.RENAME_LAYER}"]`,
      ) as HTMLElement | null;
      expect(li).not.toBeNull();
      expect(li?.getAttribute("role")).toBe("menuitem");
      expect(li?.getAttribute("disabled")).toBeNull();
    });

    it("openMoreMenu includes a rename-layer item for a base layer too", () => {
      const item = findItem(ui, "base1");

      ui.openMoreMenu(item);

      const li = item.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.RENAME_LAYER}"]`,
      );
      expect(li).not.toBeNull();
    });

    it("rename-layer item is not disabled even when the layer is hidden", () => {
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = false;

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const renameLi = item.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.RENAME_LAYER}"]`,
      ) as HTMLElement | null;
      expect(renameLi?.getAttribute("disabled")).toBeNull();
      // (focus-layer item in the same menu IS disabled.)
      const focusLi = item.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.FOCUS_LAYER}"]`,
      );
      expect(focusLi?.getAttribute("disabled")).toBe("disabled");
    });

    it("clicking rename-layer opens an inline input inside the label", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.RENAME_LAYER}"]`,
      ) as HTMLElement;
      li.click();

      expect(ui.activeMenu).toBeNull();
      expect(ui.activeRenameId).toBe("overlay1");
      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input?.classList.contains(CONST.CLASSES.RENAME_INPUT)).toBe(true);
      expect(input?.value).toBe("Polygons");
    });

    it("Enter commits a new name and restores the label text", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");
      expect(item.classList.contains(CONST.CLASSES.RENAMING)).toBe(true);

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      input.value = "New Name";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(ui.activeRenameId).toBeNull();
      expect(label.textContent).toBe("New Name");
      expect(ui.renamedNames.overlay1).toBe("New Name");
      expect(item.classList.contains(CONST.CLASSES.RENAMING)).toBe(false);
    });

    it("blur commits the current value", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      input.value = "Via Blur";
      input.dispatchEvent(new Event("blur"));

      expect(label.textContent).toBe("Via Blur");
      expect(ui.renamedNames.overlay1).toBe("Via Blur");
    });

    it("Escape cancels and restores the original label text", () => {
      // map.foliplus.showHint may be bound to the real HintManager on init;
      // spy on it to observe calls.
      const showHint = vi.spyOn(map.foliplus!, "showHint");
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      input.value = "abandon";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

      expect(ui.activeRenameId).toBeNull();
      expect(label.textContent).toBe("Polygons");
      expect(manager.layerRegistry.get("overlay1")!.name).toBe("Polygons");
      // Escape is an intentional abandon — no empty-name hint.
      expect(showHint).not.toHaveBeenCalled();
      showHint.mockRestore();
    });

    it("blur after the input is torn down does not re-commit", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      // Escape tears the input down (finishRename removes it → triggers blur).
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      // Simulate the blur that removing the focused element fires.
      input.dispatchEvent(new Event("blur"));

      expect(ui.activeRenameId).toBeNull();
      expect(label.textContent).toBe("Polygons");
      expect(manager.layerRegistry.get("overlay1")!.name).toBe("Polygons");
    });

    it("committing an empty name is a no-op (label reverts, registry unchanged)", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      input.value = "   ";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(label.textContent).toBe("Polygons");
      expect(manager.layerRegistry.get("overlay1")!.name).toBe("Polygons");
    });

    it("committing whitespace-only trims and updates the label", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      input.value = "  Trimmed  ";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(label.textContent).toBe("Trimmed");
      expect(ui.renamedNames.overlay1).toBe("Trimmed");
    });

    it("committing an unchanged name does not write to renamedNames", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      input.value = "Polygons"; // unchanged
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(ui.renamedNames["overlay1"]).toBeUndefined();
    });

    it("committing a changed name records it in renamedNames", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;

      input.value = "Changed";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(ui.renamedNames["overlay1"]).toBe("Changed");
    });

    it("committing a rename updates the checkbox aria-label, not its tooltip", () => {
      const item = findItem(ui, "overlay1");
      ui.renameLayer("overlay1");

      const label = item.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      // The tooltip is the Select/Deselect affordance; a rename must not
      // occupy that slot.
      const tooltip = checkbox.title;
      expect(tooltip).not.toBe("");
      expect(tooltip).not.toBe("Renamed");

      input.value = "Renamed";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(checkbox.getAttribute("aria-label")).toBe("Renamed");
      expect(checkbox.title).toBe(tooltip);
    });

    it("renaming the color basemap updates the color input's aria-label too", () => {
      // The color row has no checkbox — its toggle is the type="color" input.
      // Both the label cell and the input must announce the rename, otherwise
      // assistive tech keeps reading the locale default after a rename.
      const item = findItem(ui, CONST.COLOR.MAP_ID);
      const colorInput = item.querySelector(`input[type="color"]`) as HTMLInputElement;
      // Capture the pre-rename value from the source of truth, not the DOM:
      // the aria-label and the label cell are both projections of
      // displayName(), so comparing them against each other would pass either
      // way — vacuously if neither propagated, and without ever observing a
      // rename at all.
      const before = ui.displayName(CONST.COLOR.MAP_ID);

      expect(colorInput.getAttribute("aria-label")).toBe(before);

      ui.renameLayer(CONST.COLOR.MAP_ID);
      const input = (item.querySelector("label") as HTMLLabelElement).querySelector(
        "input",
      ) as HTMLInputElement;
      input.value = "My Colour";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(item.querySelector("label")!.textContent).toBe("My Colour");
      expect(colorInput.getAttribute("aria-label")).toBe("My Colour");
      // The row tooltip is the TYPE label, a different slot from the name —
      // a rename must not move into it.
      const tooltip = item.getAttribute("title");
      expect(tooltip).not.toBe("My Colour");
      expect(tooltip).not.toBe("");
    });

    it("renameLayer(no-op) for an unknown layer id does nothing", () => {
      ui.renameLayer("no-such-layer");

      expect(ui.activeRenameId).toBeNull();
    });

    it("Enter on the rename-layer menu item calls renameLayer (not focusLayer)", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.RENAME_LAYER}"]`,
      ) as HTMLElement;
      li.focus();
      expect(document.activeElement).toBe(li);

      const focusSpy = vi.fn();
      const renameSpy = vi.fn();
      ui.focusLayer = focusSpy;
      ui.renameLayer = renameSpy;

      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(renameSpy).toHaveBeenCalledWith("overlay1");
      expect(focusSpy).not.toHaveBeenCalled();
      // Menu stays open — renameLayer opens an inline input, not a menu close.
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });

    it("Enter in the rename input does not bubble to the container handler (no toggle)", () => {
      // Ensure checkbox is checked so toggleFocusedLayer would flip it off.
      const item = findItem(ui, "overlay1");
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);

      ui.renameLayer("overlay1");

      const input = item.querySelector(
        `label input.${CONST.CLASSES.RENAME_INPUT}`,
      ) as HTMLInputElement;
      input.value = "New Name";

      const toggleSpy = vi.fn();
      ui.toggleFocusedLayer = toggleSpy;

      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(ui.renamedNames["overlay1"]).toBe("New Name");
      expect(toggleSpy).not.toHaveBeenCalled();
      expect(checkbox.checked).toBe(true);
    });

    // ─────────── color basemap (outside layerRegistry) ───────────

    it("color layer more menu contains only rename-layer (no focus-layer)", () => {
      const colorItem = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM}`)!;
      ui.openMoreMenu(colorItem);

      const focusLi = colorItem.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.FOCUS_LAYER}"]`,
      );
      const renameLi = colorItem.querySelector(
        `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.RENAME_LAYER}"]`,
      );
      expect(focusLi).toBeNull();
      expect(renameLi).not.toBeNull();
    });

    it("renameLayer(COLOR.MAP_ID) opens an inline input seeded with the displayed name", () => {
      const colorItem = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM}`)!;
      // Capture the label the UI already shows (locale "Solid Color") BEFORE
      // renaming — createInlineEditInput clears the label's text node.
      const displayed = colorItem.querySelector("label")!.textContent;
      ui.renameLayer(CONST.COLOR.MAP_ID);

      expect(ui.activeRenameId).toBe(CONST.COLOR.MAP_ID);
      const label = colorItem.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input?.classList.contains(CONST.CLASSES.RENAME_INPUT)).toBe(true);
      // Default is the locale label, NOT the color hex (regression guard).
      expect(input?.value).toBe(displayed);
      expect(input?.value).not.toBe(ui.currentColor);
    });

    it("committing a color-layer rename persists to renamedNames (not the registry)", () => {
      const colorItem = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM}`)!;
      ui.renameLayer(CONST.COLOR.MAP_ID);

      const label = colorItem.querySelector("label") as HTMLLabelElement;
      const input = label.querySelector("input") as HTMLInputElement;
      input.value = "My Base";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(ui.activeRenameId).toBeNull();
      expect(label.textContent).toBe("My Base");
      expect(ui.renamedNames[CONST.COLOR.MAP_ID]).toBe("My Base");
      // The color basemap is not in the registry, so the registry should be
      // untouched.
      expect(manager.layerRegistry.get(CONST.COLOR.MAP_ID)).toBeUndefined();
    });

    it("applying a persisted rename restores the color-layer label text", () => {
      window.localStorage.setItem(
        CONST.STORAGE.NAMES_KEY,
        JSON.stringify({ [CONST.COLOR.MAP_ID]: "Custom Color" }),
      );
      ui.loadNamesState();
      ui.applyUserState();

      const colorItem = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM}`)!;
      expect(colorItem.querySelector("label")!.textContent).toBe("Custom Color");
      // The color input's aria-label and tooltip belong to the row builder:
      // the tooltip is the palette type label, and the aria-label stays the
      // color_map_label so the swatch is still announced as the basemap.
      const colorInput = colorItem.querySelector(
        'input[type="color"]',
      ) as HTMLInputElement;
      expect(colorInput.title).not.toBe("Custom Color");
    });

    it("keeps a renamed color basemap through a re-render (fold/reorder)", () => {
      ui.renameLayer(CONST.COLOR.MAP_ID);
      const firstLabel = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM} label`)!;
      // The rename input lives inside the label; the first bare `input` in the
      // item is the color swatch, so scope to the label.
      const firstInput = firstLabel.querySelector("input") as HTMLInputElement;
      firstInput.value = "My Base";
      firstInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      expect(firstLabel.textContent).toBe("My Base");

      // Fold toggle / reorder rebuild the list via renderInitialList.
      ui.renderInitialList();

      const colorItem = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM}`)!;
      expect(colorItem.querySelector("label")!.textContent).toBe("My Base");
      // The tooltip is the TYPE label, not the layer name — a rename must not
      // change it, and it survives a re-render.
      const tooltip = colorItem.getAttribute("title");
      expect(tooltip).not.toBe("My Base");
      expect(tooltip).not.toBeNull();
    });
  });

  // ─────────────────── rename persistence ───────────────────

  describe("rename persistence (loadNames / saveNames / applyNames)", () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it("loadNamesState reads renamed names from localStorage", () => {
      window.localStorage.setItem(
        CONST.STORAGE.NAMES_KEY,
        JSON.stringify({ overlay1: "Over1", base1: "Over2" }),
      );

      ui.loadNamesState();

      expect(ui.renamedNames).toEqual({ overlay1: "Over1", base1: "Over2" });
    });

    it("applyUserState overwrites the registry name and the label text", () => {
      window.localStorage.setItem(
        CONST.STORAGE.NAMES_KEY,
        JSON.stringify({ overlay1: "Persisted Name" }),
      );

      ui.loadNamesState();
      ui.applyUserState();

      const item = findItem(ui, "overlay1");
      expect(ui.renamedNames.overlay1).toBe("Persisted Name");
      // The sweep pushes the rename into the registry projection as well.
      expect(manager.layerRegistry.get("overlay1")?.name).toBe("Persisted Name");
      expect(item.querySelector("label")!.textContent).toBe("Persisted Name");
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.getAttribute("aria-label")).toBe("Persisted Name");
      // The tooltip stays the Select/Deselect affordance, not the layer name.
      expect(checkbox.title).not.toBe("Persisted Name");
    });

    it("does not re-write a row that already holds the stored name", () => {
      window.localStorage.setItem(
        CONST.STORAGE.NAMES_KEY,
        JSON.stringify({ overlay1: "Persisted Name" }),
      );
      ui.loadNamesState();
      ui.applyUserState();

      const item = findItem(ui, "overlay1");
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const setAttr = HTMLInputElement.prototype.setAttribute;
      let attrWrites = 0;
      vi.spyOn(checkbox, "setAttribute").mockImplementation(function (
        this: HTMLInputElement,
        ...args
      ) {
        attrWrites++;
        return setAttr.call(this, ...args);
      });

      try {
        ui.applyUserState();

        // Everything already matches, so nothing is re-written.
        expect(attrWrites).toBe(0);
        expect(manager.layerRegistry.get("overlay1")!.name).toBe("Persisted Name");
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("a targeted apply updates only that layer's registry entry", () => {
      window.localStorage.setItem(
        CONST.STORAGE.NAMES_KEY,
        JSON.stringify({ overlay1: "Renamed", base1: "Also Renamed" }),
      );
      ui.loadNamesState();

      manager.layerRegistry.get("overlay1")!.name = "Renamed";
      ui.applyUserState("overlay1");

      expect(manager.layerRegistry.get("overlay1")!.name).toBe("Renamed");
      // The other layer was left alone — the targeted call must not sweep the
      // whole panel on every late registration.
      expect(manager.layerRegistry.get("base1")!.name).not.toBe("Also Renamed");
    });

    it("a targeted apply for an un-renamed id leaves the registry untouched", () => {
      // insertLayerItem calls applyUserState(id) for every late registration,
      // including layers the user never renamed. A missing rename must be a
      // no-op, not a write of undefined over the registry's own name.
      ui.renamedNames = {};

      const before = manager.layerRegistry.get("base1")!.name;
      const label = findItem(ui, "base1")!.querySelector("label")!;
      const labelBefore = label.textContent;

      ui.applyUserState("base1");

      expect(manager.layerRegistry.get("base1")!.name).toBe(before);
      expect(label.textContent).toBe(labelBefore);
    });

    it("tolerates corrupt / non-object / empty names storage", () => {
      // Reset the fixture label/registry to the pristine name — sibling tests
      // may have renamed this layer before this case runs.
      const label = findItem(ui, "overlay1").querySelector(
        "label",
      )! as HTMLLabelElement;
      const layerInfo = manager.layerRegistry.get("overlay1")!;
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      layerInfo.name = "Polygons";
      label.textContent = "Polygons";
      checkbox.setAttribute("aria-label", "Polygons");
      checkbox.title = "Polygons";
      ui.renamedNames = {};

      window.localStorage.setItem(CONST.STORAGE.NAMES_KEY, "not-json");
      ui.loadNamesState();
      expect(ui.renamedNames).toEqual({});

      window.localStorage.setItem(CONST.STORAGE.NAMES_KEY, "[]");
      ui.loadNamesState();
      expect(ui.renamedNames).toEqual({});

      window.localStorage.setItem(CONST.STORAGE.NAMES_KEY, "null");
      ui.loadNamesState();
      expect(ui.renamedNames).toEqual({});

      // The label must stay at the pristine name — no crash, no empty text.
      expect(label.textContent).toBe("Polygons");
      expect(layerInfo.name).toBe("Polygons");
    });

    it("saveNamesState persists a committed rename into localStorage", () => {
      const label = findItem(ui, "overlay1").querySelector("label") as HTMLLabelElement;
      ui.renameLayer("overlay1");
      const input = label.querySelector("input") as HTMLInputElement;

      vi.useFakeTimers();
      input.value = "Persisted";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);
      vi.useRealTimers();

      const stored = JSON.parse(window.localStorage.getItem(CONST.STORAGE.NAMES_KEY)!);
      expect(stored).toEqual({ overlay1: "Persisted" });
    });

    it("debounces rapid renames into a single localStorage write", () => {
      const originalStorage = window.localStorage;
      const setItem = vi.fn();
      Object.defineProperty(window, "localStorage", {
        value: {
          getItem: () => null,
          setItem,
          removeItem: vi.fn(),
          clear: () => setItem.mockReset(),
        },
        writable: true,
        configurable: true,
      });

      vi.useFakeTimers();
      const label = findItem(ui, "overlay1").querySelector("label") as HTMLLabelElement;

      ui.renameLayer("overlay1");
      let input = label.querySelector("input") as HTMLInputElement;
      input.value = "First";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      ui.renameLayer("overlay1");
      input = label.querySelector("input") as HTMLInputElement;
      input.value = "Second";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      ui.renameLayer("overlay1");
      input = label.querySelector("input") as HTMLInputElement;
      input.value = "Third";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      expect(setItem).not.toHaveBeenCalled();
      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);

      const namesCall = setItem.mock.calls.find(
        (c: string[]) => c[0] === CONST.STORAGE.NAMES_KEY,
      );
      expect(namesCall).toBeDefined();
      expect(JSON.parse(namesCall![1])).toEqual({ overlay1: "Third" });

      vi.useRealTimers();
      Object.defineProperty(window, "localStorage", {
        value: originalStorage,
        writable: true,
        configurable: true,
      });
    });

    it("does NOT write to localStorage when the committed name is unchanged", () => {
      const originalStorage = window.localStorage;
      const setItem = vi.fn();
      Object.defineProperty(window, "localStorage", {
        value: {
          getItem: () => null,
          setItem,
          removeItem: vi.fn(),
          clear: () => setItem.mockReset(),
        },
        writable: true,
        configurable: true,
      });

      vi.useFakeTimers();
      const label = findItem(ui, "overlay1").querySelector("label") as HTMLLabelElement;

      ui.renameLayer("overlay1");
      const input = label.querySelector("input") as HTMLInputElement;
      input.value = "Polygons"; // unchanged
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      vi.advanceTimersByTime(CONST.SAVE_ORDER_DEBOUNCE_MS + 50);

      const namesCall = setItem.mock.calls.find(
        (c: string[]) => c[0] === CONST.STORAGE.NAMES_KEY,
      );
      expect(namesCall).toBeUndefined();

      vi.useRealTimers();
      Object.defineProperty(window, "localStorage", {
        value: originalStorage,
        writable: true,
        configurable: true,
      });
    });
  });

  // ─────────────────── keyboard on more button ───────────────────

  describe("more button keyboard shortcut", () => {
    it("Enter on more button opens the menu instead of toggling the checkbox", () => {
      const btn = findItem(ui, "overlay1").querySelector(`.${CONST.CLASSES.MORE_BTN}`)!;
      const item = findItem(ui, "overlay1");

      // Spy on checkbox dispatchEvent to prove toggle wasn't triggered.
      const origDispatchEvent = HTMLInputElement.prototype.dispatchEvent;
      const toggleSpy = vi.fn();
      HTMLInputElement.prototype.dispatchEvent = function (...args: any[]) {
        const ev = args[0] as Event;
        if (ev.type === "change") toggleSpy();
        return origDispatchEvent.apply(this, args);
      };

      // Focus the more button so document.activeElement is inside the
      // uiContainer and the Enter/Space shortcut fires. `handleKeyDown`
      // short-circuits on MORE_BTN without calling toggleFocusedLayer.
      btn.focus();
      expect(document.activeElement).toBe(btn);

      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
      expect(toggleSpy).not.toHaveBeenCalled();

      HTMLInputElement.prototype.dispatchEvent = origDispatchEvent;
    });
  });

  // ─────────────────── Alt+Enter keyboard shortcut ───────────────────

  describe("focusLayer via Alt+Enter keyboard shortcut", () => {
    it("Alt+Enter on a navigated layer row triggers focusLayer", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");

      // navigate to overlay1 by name so activeIdx matches getNavigableItems().
      ui.setActiveItem(1); // overlay1 is index 1 (base1 is 0).
      expect(ui.activeIdx).toBe(1);

      // handleKeyDown requires the active element to be inside uiContainer.
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      checkbox.focus();
      expect(document.activeElement).toBe(checkbox);

      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        altKey: true,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(focusSpy).toHaveBeenCalledWith("overlay1");

      focusSpy.mockRestore();
    });

    it("Enter (without Alt) does NOT trigger focusLayer", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");

      ui.activeIdx = 0;
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      checkbox.focus();

      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        altKey: false,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(focusSpy).not.toHaveBeenCalled();

      focusSpy.mockRestore();
    });

    it("Alt+Enter auto-resolves activeIdx from the focused element, then focuses that layer", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      ui.activeIdx = null;

      // Focus overlay1's checkbox — handleKeyDown resolves activeIdx
      // from the focused element before checking Alt+Enter, so even starting
      // with activeIdx=null it still triggers focus on overlay1.
      const overlayCheckbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      overlayCheckbox.focus();

      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        altKey: true,
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(focusSpy).toHaveBeenCalledWith("overlay1");

      focusSpy.mockRestore();
    });
  });

  // ─────────────────── keyboard focus cursor visual class ───────────────────

  describe("keyboard focus cursor class (.foliplus-layer-focused)", () => {
    // getNavigableItems() enumerates row elements in DOM order: the "Toggle
    // All" row is index 0, then enforceOrder-sorted base/overlay layers. Look
    // up indices dynamically so a re-order doesn't silently break these tests.
    const indexFor = (id: string) => ui.getNavigableItems().indexOf(findItem(ui, id));

    it("setActiveItem adds the FOCUSED class to the target row", () => {
      const overlay = findItem(ui, "overlay1");
      const base = findItem(ui, "base1");

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(base.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        0,
      );

      ui.setActiveItem(indexFor("overlay1"));

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      expect(base.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        1,
      );
      expect(ui.activeIdx).toBe(indexFor("overlay1"));
    });

    it("moving the cursor removes FOCUSED from the previous row (mutual exclusivity)", () => {
      const overlay = findItem(ui, "overlay1");
      const base = findItem(ui, "base1");

      ui.setActiveItem(indexFor("overlay1"));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      expect(base.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);

      ui.setActiveItem(indexFor("base1"));
      expect(base.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      // Only ONE row carries the class at any time.
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        1,
      );
      expect(ui.activeIdx).toBe(indexFor("base1"));
    });

    it("blurActiveItem removes the FOCUSED class from the current row", () => {
      const overlay = findItem(ui, "overlay1");

      ui.setActiveItem(indexFor("overlay1"));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);

      ui.blurActiveItem();

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        0,
      );
      // activeIdx is preserved by blurActiveItem — only the marker is lifted.
      expect(ui.activeIdx).toBe(indexFor("overlay1"));
    });

    it("clearActiveItem removes the FOCUSED class and resets activeIdx/clickedRow", () => {
      const overlay = findItem(ui, "overlay1");

      ui.setActiveItem(indexFor("overlay1"));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
      expect(ui.activeIdx).toBe(indexFor("overlay1"));

      ui.clearActiveItem();

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        0,
      );
      expect(ui.activeIdx).toBeNull();
      expect((ui as any).clickedRow).toBeNull();
    });

    it("Escape keydown clears the FOCUSED class", () => {
      const overlay = findItem(ui, "overlay1");

      ui.setActiveItem(indexFor("overlay1"));
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);

      const checkbox = overlay.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      checkbox.focus();

      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
      expect(ui.uiContainer.querySelectorAll(`.${CONST.CLASSES.FOCUSED}`)).toHaveLength(
        0,
      );
      expect(ui.activeIdx).toBeNull();
    });

    it("FOCUSED class coexists with .active (checkbox-checked) without conflict", () => {
      const overlay = findItem(ui, "overlay1");

      // Check the checkbox (adds .active via the toggle path) then set cursor
      // onto the same row — both classes must be present simultaneously so the
      // visual distinction between "checked" (5% wash) and "cursor-on" (8%
      // wash + accent bar) is preserved.
      const checkbox = overlay.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      checkbox.checked = true;
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(overlay.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);

      ui.setActiveItem(indexFor("overlay1"));

      expect(overlay.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
      expect(overlay.classList.contains(CONST.CLASSES.FOCUSED)).toBe(true);
    });
  });

  // ─────────────────── fold group via keyboard ───────────────────

  describe("fold group via keyboard (chevron button)", () => {
    // The chevron button lives inside the toggle-all row, so focus on it
    // resolves up to that row. Enter/Space over it must fold the group —
    // not flip the row's select-all checkbox.
    //
    // The group needs two overlay layers so overlay1 isn't collapsed into the
    // single-child "no toggle-all" layout of initFixture(), and hiddenIds must
    // be empty so a visibility collapse can't read as a fold (the outer
    // beforeEach owns both).

    it("Enter on the chevron folds the group and hides its children", () => {
      const { foldBtn, children } = attachWithGroup(ui);
      expect(children()).toHaveLength(2);
      expect(allFolded(children())).toBe(false);

      pressKey(foldBtn, "Enter");

      expect(ui.foldedGroups.has(CONST.GROUP.OVERLAY)).toBe(true);
      expect(allFolded(children())).toBe(true);
    });

    it("Space folds too, and Enter again unfolds", () => {
      const { children } = attachWithGroup(ui);
      // The chevron is a real focusable button, so dispatch the key there.
      pressKey(overlayFoldBtn(ui.uiContainer), " ");
      expect(ui.foldedGroups.has(CONST.GROUP.OVERLAY)).toBe(true);
      expect(allFolded(children())).toBe(true);
      // Fold rebuilds the panel, so re-fetch the button on the rebuilt row.
      pressKey(overlayFoldBtn(ui.uiContainer), "Enter");

      expect(ui.foldedGroups.has(CONST.GROUP.OVERLAY)).toBe(false);
      expect(allFolded(children())).toBe(false);
    });

    it("Enter on the chevron does NOT flip the select-all checkbox", () => {
      const { foldBtn, children } = attachWithGroup(ui);
      const childBoxes = () =>
        children()
          .map(el => el.querySelector('input[type="checkbox"]'))
          .filter(Boolean) as HTMLInputElement[];

      const allChecked = () => childBoxes().every(cb => cb.checked);
      expect(allChecked()).toBe(true);

      pressKey(foldBtn, "Enter");
      expect(allFolded(children())).toBe(true);

      // Unfold again and confirm nothing was deselected.
      pressKey(overlayFoldBtn(ui.uiContainer), "Enter");
      expect(children()).toHaveLength(2);
      expect(allChecked()).toBe(true);
    });

    it("Enter on the toggle-all row itself still selects/deselects the group", () => {
      const { row, children } = attachWithGroup(ui);
      const childBoxes = () =>
        children()
          .map(el => el.querySelector('input[type="checkbox"]'))
          .filter(Boolean) as HTMLInputElement[];

      pressKey(row, "Enter");

      // Enter on the row itself toggles visibility, not the fold.
      expect(row.classList.contains(CONST.CLASSES.GROUP_FOLDED)).toBe(false);
      expect(allFolded(children())).toBe(false);
      expect(children()).toHaveLength(2);
      expect(childBoxes().some(cb => !cb.checked)).toBe(true);
    });

    it("getNavigableItems lists rows by class, so a checkbox-less row is reachable", () => {
      const colorRow = ui.uiContainer.querySelector(
        `.${CONST.CLASSES.COLOR_ITEM}`,
      ) as HTMLElement | null;

      const items = ui.getNavigableItems();
      // The color row is a picker, not a layer, so it stays out of the list.
      if (colorRow) expect(items).not.toContain(colorRow);
      // Rows are enumerated by class, never filtered by checkbox presence.
      const isRow = (el: HTMLElement) =>
        el.classList.contains(CONST.CLASSES.LAYER_ITEM) ||
        el.classList.contains(CONST.CLASSES.TOGGLE_ALL);
      expect(items.every(isRow)).toBe(true);
      expect(items.filter(isRow)).toHaveLength(items.length);

      // Simulate the divergence that made Tab and arrow keys disagree: a row
      // the old checkbox-first enumeration silently dropped.
      const bareRow = document.createElement("div");
      bareRow.className = CONST.CLASSES.LAYER_ITEM;
      bareRow.setAttribute(CONST.DATA.LAYER_ID, "no-checkbox");
      ui.uiContainer.appendChild(bareRow);

      expect(ui.getNavigableItems()).toContain(bareRow);
    });
  });

  // ─────────────────── auto-cancel on map move/zoom ───────────────────

  describe("focusLayer auto-cancel on map navigation", () => {
    // Helper: grab the moveend handler that focusLayer registered via map.on.
    const getMoveendHandler = () =>
      (map.on as any).mock.calls.find((c: any[]) => c[0] === "moveend")?.[1];

    const getZoomendHandler = () =>
      (map.on as any).mock.calls.find((c: any[]) => c[0] === "zoomend")?.[1];

    it("registers moveend and zoomend handlers that auto-cancel after the grace window", () => {
      vi.useFakeTimers();

      ui.focusLayer("overlay1");
      const rect = ui.focusRect!;

      const moveHandler = getMoveendHandler();
      expect(typeof moveHandler).toBe("function");

      moveHandler(); // fires moveend → grace period starts

      // Immediately after: still within grace, rect should NOT be removed.
      expect(ui.focusRect).toBe(rect);
      vi.advanceTimersByTime(CONST.FOCUS.RECT_DURATION_MS * 0.29);
      expect(ui.focusRect).toBe(rect);

      // After grace window: rect is auto-removed.
      vi.advanceTimersByTime(CONST.FOCUS.RECT_DURATION_MS * 0.02);
      expect(map.removeLayer).toHaveBeenCalledWith(rect);
      expect(ui.focusRect).toBeNull();
    });

    it("does NOT auto-cancel when focusingLayerId changes (new focus started)", () => {
      vi.useFakeTimers();

      ui.focusLayer("overlay1");

      // Start a new focus on overlay1 again (simulates user pressing focus
      // twice quickly) — the new focus's focusRect and focusingLayerId
      // replace the old ones synchronously.
      ui.focusLayer("overlay1");

      // Advance past the grace window.
      vi.advanceTimersByTime(CONST.FOCUS.RECT_DURATION_MS + 1);

      // Verify no crash and the focusRect lifecycle is well-behaved.
      expect(() => ui.focusLayer("overlay1")).not.toThrow();
    });

    it("zoomend triggers the same auto-cancel path as moveend", () => {
      vi.useFakeTimers();

      ui.focusLayer("overlay1");
      const rect = ui.focusRect!;

      const zoomHandler = getZoomendHandler();
      expect(typeof zoomHandler).toBe("function");

      zoomHandler(); // fires zoomend → grace period starts
      vi.advanceTimersByTime(CONST.FOCUS.RECT_DURATION_MS * 0.31);

      expect(map.removeLayer).toHaveBeenCalledWith(rect);
      expect(ui.focusRect).toBeNull();
    });
  });

  // ─────────────────── flyTo path teardown ───────────────────

  describe("focusLayer flyTo path", () => {
    it("cancelFocus() after a flyTo focus removes row highlight and map handlers", () => {
      vi.useFakeTimers();

      const layer = manager.findLayer(manager.layerRegistry.get("overlay1")!);
      const tinyBounds = {
        isValid: () => true,
        getSouthWest: () => ({ lat: 30, lng: 100 }),
        getNorthEast: () => ({ lat: 30.000001, lng: 100.000001 }),
        getCenter: () => ({ lat: 30, lng: 100 }),
      };
      // @ts-expect-error — override mocked getBounds
      layer.getBounds.mockReturnValue(tinyBounds);

      ui.focusLayer("overlay1");
      const item = findItem(ui, "overlay1");
      expect(item.classList.contains("foliplus-layer-focusing")).toBe(true);

      const hintSpy = vi.fn();
      map.foliplus.showHint = hintSpy;

      ui.cancelFocus();

      expect(item.classList.contains("foliplus-layer-focusing")).toBe(false);
      expect(ui.isFocusing()).toBe(false);
      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "LayerControl.focus_cancelled",
        expect.any(Number),
      );
    });
  });

  // ─────────────────── destroy ───────────────────

  describe("destroy()", () => {
    it("removes the active focus rectangle", () => {
      vi.useFakeTimers();
      ui.focusLayer("overlay1");
      const rect = ui.focusRect!;

      manager.destroy();

      expect(map.removeLayer).toHaveBeenCalledWith(rect);
      expect(ui.focusRect).toBeNull();
    });

    it("removes the active overflow menu", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);

      manager.destroy();

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });

    it("removes both focus rectangle and active menu simultaneously", () => {
      vi.useFakeTimers();

      const item = findItem(ui, "overlay1");
      ui.focusLayer("overlay1");
      ui.openMoreMenu(item);

      const rect = ui.focusRect!;

      manager.destroy();

      expect(map.removeLayer).toHaveBeenCalledWith(rect);
      expect(ui.focusRect).toBeNull();
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });

    it("releases the focus SVG renderer so it does not leak", () => {
      ui.focusLayer("overlay1");
      const renderer = ui.focusRenderer!;
      expect(renderer).not.toBeNull();

      manager.destroy();

      expect(map.removeLayer).toHaveBeenCalledWith(renderer);
      expect(ui.focusRenderer).toBeNull();
    });
  });
});

// ===========================================================================
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

  describe("loadHiddenIds / applyUserState", () => {
    it("restores a hidden overlay on attach and removes it from the map", () => {
      const { map, removeLayer } = makeTestMap();
      const m = new LayerManager(map, [
        { id: "overlay1", name: "Polygons", isBase: false, layer: testPolyLayer },
      ]);
      const u = new LayerUI(m);
      u.hiddenIds = new Set(["overlay1"]);

      u.applyUserState();

      expect(removeLayer).toHaveBeenCalledWith(testPolyLayer);
      expect(u.hiddenIds).toContain("overlay1");
      expect(m.layerRegistry.get("overlay1")?.visible).toBe(false);
    });

    it("drops unknown ids from the persisted hidden set and warns", () => {
      const { map } = makeTestMap();
      const m = new LayerManager(map, [
        { id: "overlay1", name: "Polygons", isBase: false, layer: testPolyLayer },
      ]);
      const u = new LayerUI(m);
      u.hiddenIds = new Set(["overlay1", "ghost", "gone"]);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      u.applyUserState();

      expect(u.hiddenIds).toEqual(new Set(["overlay1"]));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(
        /Dropped stale hidden-layer ids.*ghost.*gone/,
      );
      warnSpy.mockRestore();
    });

    it("persists the pruned hidden set after dropping stale ids", () => {
      const { map } = makeTestMap();
      const m = new LayerManager(map, [
        { id: "overlay1", name: "Polygons", isBase: false, layer: testPolyLayer },
      ]);
      const u = new LayerUI(m);
      u.hiddenIds = new Set(["overlay1", "ghost", "gone"]);

      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      u.applyUserState();
      warnSpy.mockRestore();

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

      u.loadHiddenIds();

      expect(u.hiddenIds).toEqual(new Set(["overlay1", "base1"]));
    });

    it("ignores non-array/corrupt storage data", () => {
      const { map } = makeTestMap();
      window.localStorage.setItem(CONST.STORAGE.VISIBILITY_KEY, "not-json");
      const m = new LayerManager(map, [
        { id: "overlay1", name: "O", isBase: false, layer: testPolyLayer },
      ]);
      const u = new LayerUI(m);

      u.loadHiddenIds();

      expect(u.hiddenIds).toEqual(new Set());
    });
  });

  // ─────────────────── save on toggle ───────────────────

  describe("saveHiddenIds on toggle", () => {
    it("persists a hidden overlay when the user unchecks it", () => {
      const { map, removeLayer } = makeTestMap();
      const m = new LayerManager(map, [
        { id: "overlay1", name: "Polygons", isBase: false, layer: testPolyLayer },
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
        { id: "overlay1", name: "Polygons", isBase: false, layer: testPolyLayer },
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
        { id: "base1", name: "B1", isBase: true, layer: base1, paneName: "tilePane" },
        { id: "base2", name: "B2", isBase: true, layer: base2, paneName: "tilePane" },
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
        { id: "base1", name: "B1", isBase: true, layer: base1, paneName: "tilePane" },
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
