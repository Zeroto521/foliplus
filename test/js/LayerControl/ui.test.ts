import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui.js";

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

// ===========================================================================
describe("LayerUI focusLayer / openMoreMenu / closeMoreMenu", () => {
  let manager: LayerManager, ui: LayerUI, map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
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
        fn({
          getBounds: () => ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 30, lng: 100 }),
            getNorthEast: () => ({ lat: 40, lng: 110 }),
          }),
        });
        fn({
          getBounds: () => ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 31, lng: 101 }),
            getNorthEast: () => ({ lat: 39, lng: 109 }),
          }),
        });
      };

      ui.focusLayer("overlay1");

      expect(map.fitBounds).toHaveBeenCalled();
      expect(L.rectangle).toHaveBeenCalled();
    });

    it("focuses a canvas layer via its getBounds provider", () => {
      // Canvas layers (e.g. HeatmapControl) have no Leaflet layer, only a
      // canvas element + a getBounds provider. Focus must use the provider
      // and boost the canvas element itself.
      const canvas = document.createElement("canvas");
      canvas.style.filter = "";
      manager.registerLayer({
        id: "heatmap1",
        name: "Heatmap",
        canvas,
        onToggle: () => {},
        getBounds: () =>
          ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 30, lng: 100 }),
            getNorthEast: () => ({ lat: 40, lng: 110 }),
          }) as unknown as L.LatLngBounds,
      });

      ui.focusLayer("heatmap1");

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
    it("base layer more button is hidden", () => {
      const baseItem = findItem(ui, "base1");
      const btn = baseItem.querySelector(`.${CONST.CLASSES.MORE_BTN}`);
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("hidden")).toBe("hidden");
    });

    it("overlay layer more button is visible", () => {
      const overlayItem = findItem(ui, "overlay1");
      const btn = overlayItem.querySelector(`.${CONST.CLASSES.MORE_BTN}`);
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("hidden")).toBeNull();
    });

    it("color layer has no more button", () => {
      const colorItem = ui.uiContainer.querySelector(`${CONST.SEL.COLOR_ITEM}`)!;
      const btn = colorItem.querySelector(`.${CONST.CLASSES.MORE_BTN}`);
      expect(btn).toBeNull();
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

  describe("loadHiddenIds / applyHiddenState", () => {
    it("restores a hidden overlay on attach and removes it from the map", () => {
      const { map, removeLayer } = makeTestMap();
      const m = new LayerManager(map, [
        { id: "overlay1", name: "Polygons", isBase: false, layer: testPolyLayer },
      ]);
      const u = new LayerUI(m);
      u.hiddenIds = new Set(["overlay1"]);

      u.applyHiddenState();

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
      u.applyHiddenState();

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
      u.applyHiddenState();
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

      u.applyHiddenState();

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

      // Both bases were removed from the map by applyHiddenState.
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

  // ─────────────────── applyHiddenState with multiple layers ───────────────────

  describe("applyHiddenState with multiple hidden layers", () => {
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

      u.applyHiddenState();

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
