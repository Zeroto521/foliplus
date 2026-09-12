import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerManager } from "#foliplus/LayerControl/manager.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { ensureModes } from "#foliplus/core/mode.js";
import {
  allFolded,
  attachWithGroup,
  findItem,
  initFixture,
  makePane,
  overlayFoldBtn,
  pressKey,
} from "./fixture.js";

describe("LayerUI focus", () => {
  let manager: LayerManager;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
    // Fold tests need two overlay layers, so overlay1 isn't collapsed into the
    // single-child "no toggle-all" layout. Registered here (not in the tests)
    // because initFixture() flushes the 300ms initTypesAndVisibility timeout
    // AFTER any nested beforeEach, which would drop a layer added inside a test.
    if (!manager.layerRegistry.get("overlay2")) {
      manager.registerLayer({
        id: "overlay2",
        name: "Circles",
        isBase: false,
        layer: { options: {}, eachLayer: vi.fn() },
      });
    }
    ui.foldedGroups = new Set();
    ui.hiddenIds = new Set();
    // Folded-group state is persisted to localStorage, so a fold from one test
    // would be re-read by the next test's LayerUI constructor and present as
    // already-folded.
    window.localStorage.removeItem(CONST.STORAGE.FOLD_KEY);
  });

  afterEach(() => {
    // Drop the debounced enforceOrder before tearing down the DOM — a real
    // timer would otherwise fire after body.innerHTML = "" and hit a detached
    // container (PaneManager.ensurePane).
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
    // LayerControl holds "focusing" mode during an in-flight focus; clear it
    // on the FIXTURE map (not window.map) so a focus-holding test cannot leak.
    if (map) {
      const modes = ensureModes(map);
      if (modes.getMode("LayerControl") === "focusing") {
        modes.setMode("LayerControl", null);
      }
    }
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

  describe("row dblclick only focuses from dead space", () => {
    it("focuses the layer on a dblclick of the row's label area", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const label = findItem(ui, "overlay1").querySelector(
        `.${CONST.CLASSES.LAYER_LABEL}`,
      )!;
      ui.handleDblClick({ target: label, bubbles: true } as MouseEvent);
      expect(focusSpy).toHaveBeenCalledWith("overlay1");
      focusSpy.mockRestore();
    });

    it("does NOT focus the layer on a dblclick of the more button", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const more = findItem(ui, "overlay1").querySelector(
        `.${CONST.CLASSES.MORE_BTN}`,
      )!;
      ui.handleDblClick({ target: more, bubbles: true } as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("does NOT focus the layer on a dblclick of the checkbox", () => {
      // Two quick checkbox toggles fire a browser dblclick. That must not
      // zoom the map to the layer (focusLayer) — the user only meant to
      // show/hide it twice.
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      )!;
      ui.handleDblClick({ target: checkbox, bubbles: true } as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("double-click on a base basemap row shows a hint instead of focusLayer", () => {
      const hintSpy = vi.fn();
      map.foliplus.showHint = hintSpy;
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const item = findItem(ui, "base1");

      ui.handleDblClick({ target: item, bubbles: true } as MouseEvent);

      expect(focusSpy).not.toHaveBeenCalled();
      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "LayerControl.focus_layer_base",
        expect.any(Number),
      );
      focusSpy.mockRestore();
    });

    it("double-click on a hidden row still reaches focusLayer (hint path)", () => {
      // Hidden layers are NOT focusable via the menu, but double-click must
      // still run focusLayer so the user gets the "hidden" hint instead of
      // nothing.
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const item = findItem(ui, "overlay1");
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.checked = false;

      ui.handleDblClick({ target: item, bubbles: true } as MouseEvent);
      expect(focusSpy).toHaveBeenCalledWith("overlay1");
      focusSpy.mockRestore();
    });

    it("does NOT focus the layer on a dblclick of the fold button", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const { foldBtn } = attachWithGroup(ui);
      ui.handleDblClick({ target: foldBtn, bubbles: true } as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("does NOT focus the layer on a dblclick of the rename input", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      ui.renameLayer("overlay1");
      const input = ui.uiContainer.querySelector(
        `.${CONST.CLASSES.RENAME_INPUT}`,
      ) as HTMLElement;
      expect(input).not.toBeNull();
      ui.handleDblClick({ target: input, bubbles: true } as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("does NOT focus the layer on a dblclick of a more-menu item", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const overlay = findItem(ui, "overlay1");
      const menuBtn = overlay.querySelector(
        `.${CONST.CLASSES.MORE_BTN}`,
      ) as HTMLElement;
      menuBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const menuItem = overlay.querySelector(
        ".foliplus-layer-more-menu li",
      ) as HTMLElement;
      expect(menuItem).not.toBeNull();
      ui.handleDblClick({ target: menuItem, bubbles: true } as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("does NOT focus the layer on a dblclick of the drag handle", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const handle = findItem(ui, "overlay1").querySelector(
        ".drag-handle",
      ) as HTMLElement;
      ui.handleDblClick({ target: handle, bubbles: true } as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it("ignores a dblclick outside the layer panel", () => {
      const focusSpy = vi.spyOn(ui, "focusLayer");
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      ui.handleDblClick({ target: outside, bubbles: true } as MouseEvent);
      expect(focusSpy).not.toHaveBeenCalled();
      outside.remove();
      focusSpy.mockRestore();
    });
  });

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
});
