// test/js/control/LayerControl/ui/style/index.keyboard — keyboard entry, auto-cancel and the bring-to-front paths.
import { attachedPanel, findItem, initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureModes } from "#core/lifecycle/index.js";
import { ensureInteraction } from "#foliplus/core/interaction/index.js";
import { type LayerInfo, ROLE, focusLayerZ } from "#foliplus/core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import {
  bringFocusedLayerToFront,
  computeLayerBounds,
  drawFocusMask,
  drawFocusRect,
  focusDisabledLocaleKey,
  focusDisabledReason,
  highlightFocusedRow,
  registerAutoCancel,
  showFocusDisabledHint,
  toggleFocusedLayer,
} from "#control/LayerControl/ui/focus/index.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";
import { getActiveLayerItem } from "#control/LayerControl/ui/listPanel/index.js";

// ── Interaction-manager teardown ─────────────────────────────────────
// Every fixture attaches a panel, so LayerControl registers its keyboard
// shortcuts through the per-map InteractionManager. That manager keeps a
// MutationObserver on document.body for as long as the map lives, and a
// fixture map never fires "unload" (its `on` is a spy), so the observer
// outlives the test file. jsdom then tears the document down, mutates it, and
// the queued mutation callbacks run after `HTMLElement` is gone — a wall of
// ReferenceError on stderr that never changes the exit code but buries real
// errors. Track every map a fixture creates and destroy its interaction
// manager with the file. `ensureInteraction` returns the cached manager when
// one exists, and creating-then-destroying one for a map that never registered
// is harmless.
const fixtureMaps: any[] = [];

const trackFixture = <T extends { map?: any }>(fixture: T): T => {
  if (fixture?.map) fixtureMaps.push(fixture.map);
  return fixture;
};

afterEach(() => {
  for (const fixtureMap of fixtureMaps.splice(0)) {
    ensureInteraction(fixtureMap).destroy();
  }
});

// ── Mocked core/mode — LayerControl.focusing ownership ──────
// core/mode owns guardBlocked() and ModeManager.setMode(); these tests cover
// focusLayer()'s registration of the exclusive "focusing" mode across its entry
// and release paths. core/mode is mocked (not patched) because focusLayer()
// reaches it through a free import, not a `map.foliplus` reference.

// ── Hoistable mock state ──────────────────────────────────────────────
// vi.hoisted() declares state that exists BEFORE the module body runs, so
// the hoisted vi.mock() factory can reference it without TDZ errors. The
// factory returns `get` accessors so tests can grab the SAME live spy
// objects the code under test (focusLayer / dismissFocus) calls, and call
// .mockReturnValue / vi.clearAllMocks on them.
const modeMocks = vi.hoisted(() => {
  const states = new Map<string, string | null>();
  const setMode = vi.fn((component: string, mode: string | null) => {
    if (mode === null) states.delete(component);
    else states.set(component, mode);
  });
  const getMode = vi.fn((component: string) => states.get(component) ?? null);
  const guardBlocked = vi.fn(() => false);
  const clear = vi.fn(() => states.clear());
  const ensureModes = vi.fn(() => ({
    setMode,
    getMode,
    isBlocked: vi.fn(() => false),
    clear,
  }));
  return {
    ensureModes,
    guardBlocked,
    ModeManager: vi.fn(),
    _setMode: setMode,
    _getMode: getMode,
    _reset: () => states.clear(),
  };
});

// Match the exact specifier LayerControl/ui.ts uses; both "#core/lifecycle/mode.js" and
// "#foliplus/core/lifecycle/mode.js" resolve to the same file, but mocking the alias
// specifier prevents future alias changes from silently breaking this test.
vi.mock("#core/lifecycle/mode.js", () => ({
  ensureModes: modeMocks.ensureModes,
  guardBlocked: modeMocks.guardBlocked,
  ModeManager: modeMocks.ModeManager,
}));

describe("LayerUI focus", () => {
  let manager: LayerController;

  let ui: LayerUI;

  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = trackFixture(initFixture()));
    // Fold tests need two overlay layers, so overlay1 isn't collapsed into the
    // single-child "no toggle-all" layout. Registered here (not in the tests)
    // because initFixture() flushes the 300ms initTypesAndVisibility timeout
    // AFTER any nested beforeEach, which would drop a layer added inside a test.
    if (!manager.layerRegistry.get("overlay2")) {
      manager.registerLayer({
        id: "overlay2",
        name: "Circles",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
      });
    }
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
    // Folded-role state is persisted to localStorage, so a fold from one test
    // would be re-read by the next test's LayerUI constructor and present as
    // already-folded.
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    // Cancel a focus the test left live. Its auto-dismiss timer stays armed
    // after the test ends and calls dismissFocus during the file teardown,
    // where the console output it produces races the worker's closing console
    // RPC. Cancelling first makes that stale callback a no-op: it only
    // dismisses while the rect it captured is still the live one.
    if (ui?.isFocusing()) ui.cancelFocus();
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

  // ─────────────────── helper edges ───────────────────
  // focusLayer() reaches every helper below along the "everything is in
  // place" path, so the early-outs and the canvas / stale-focus fallbacks
  // stayed uncovered. Each case is aimed at one of those branches.

  const layerBounds = () =>
    ({
      isValid: () => true,
      getSouthWest: () => ({ lat: 30, lng: 100 }),
      getNorthEast: () => ({ lat: 40, lng: 110 }),
      getCenter: () => ({ lat: 35, lng: 105 }),
    }) as any;

  // Mirror keyboard.getNavigableItems() exactly — including the color-row
  // filter, or the indices below drift and the cursor lands on the wrong row.
  const navigableItems = () =>
    Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM},${CONST.SEL.TOGGLE_ALL}`,
      ),
    );
  describe("focusLayer auto-cancel on map navigation", () => {
    // The label manager registers its own moveend/zoomend handlers at
    // construction (bindMapSync); the focus auto-cancel handlers are the last
    // ones registered.
    const lastHandler = (event: string) =>
      [...(map.on as any).mock.calls].reverse().find((c: any[]) => c[0] === event)?.[1];

    const getMoveendHandler = () => lastHandler("moveend");

    const getZoomendHandler = () => lastHandler("zoomend");

    it("registers moveend and zoomend handlers that auto-cancel after the grace window", () => {
      vi.useFakeTimers();

      ui.focusLayer("overlay1");
      const rect = ui.focusController.focusRect!;

      const moveHandler = getMoveendHandler();
      expect(typeof moveHandler).toBe("function");

      moveHandler(); // fires moveend → grace period starts

      // Immediately after: still within grace, rect should NOT be removed.
      expect(ui.focusController.focusRect).toBe(rect);
      vi.advanceTimersByTime(CONST.FOCUS.RECT_DURATION_MS * 0.29);
      expect(ui.focusController.focusRect).toBe(rect);

      // After grace window: rect is auto-removed.
      vi.advanceTimersByTime(CONST.FOCUS.RECT_DURATION_MS * 0.02);
      expect(map.removeLayer).toHaveBeenCalledWith(rect);
      expect(ui.focusController.focusRect).toBeNull();
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
      const rect = ui.focusController.focusRect!;

      const zoomHandler = getZoomendHandler();
      expect(typeof zoomHandler).toBe("function");

      zoomHandler(); // fires zoomend → grace period starts
      vi.advanceTimersByTime(CONST.FOCUS.RECT_DURATION_MS * 0.31);

      expect(map.removeLayer).toHaveBeenCalledWith(rect);
      expect(ui.focusController.focusRect).toBeNull();
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
      layer.getBounds.mockReturnValue(tinyBounds);

      ui.focusLayer("overlay1");
      const item = findItem(ui, "overlay1");
      expect(item.classList.contains("foliplus-is-focusing")).toBe(true);

      const hintSpy = vi.fn();
      map.foliplus.hint.set = hintSpy;

      ui.cancelFocus();

      expect(item.classList.contains("foliplus-is-focusing")).toBe(false);
      expect(ui.isFocusing()).toBe(false);
      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "",
        "LayerControl.focus_cancelled",
        { duration: expect.any(Number) },
      );
    });
  });

  // ─────────────────── destroy ───────────────────
  // ─────────────────── destroy() ───────────────────

  describe("destroy()", () => {
    it("removes the active focus rectangle", () => {
      vi.useFakeTimers();
      ui.focusLayer("overlay1");
      const rect = ui.focusController.focusRect!;

      manager.destroy();

      expect(map.removeLayer).toHaveBeenCalledWith(rect);
      expect(ui.focusController.focusRect).toBeNull();
    });

    it("removes the active overflow menu", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);

      manager.destroy();

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });

    it("destroy() clears the active overflow menu, not the focus the opener already tore down", () => {
      vi.useFakeTimers();

      const item = findItem(ui, "overlay1");
      ui.focusLayer("overlay1");
      const rect = ui.focusController.focusRect!;

      // Opening the menu tears the focus down — the surfaces are mutually
      // exclusive — so the rectangle is already gone when destroy() runs.
      ui.openMoreMenu(item);
      expect(ui.focusController.focusRect).toBeNull();
      expect(map.removeLayer).toHaveBeenCalledWith(rect);

      // The removal belongs to the opener boundary, so clear the spy before
      // destroy: destroy must not try to remove the stale rectangle again, only
      // the menu it found open.
      map.removeLayer.mockClear();
      manager.destroy();

      expect(map.removeLayer).not.toHaveBeenCalledWith(rect);
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });

    it("releases the focus SVG renderer so it does not leak", () => {
      ui.focusLayer("overlay1");
      const renderer = ui.focusController.focusRenderer!;
      expect(renderer).not.toBeNull();

      manager.destroy();

      expect(map.removeLayer).toHaveBeenCalledWith(renderer);
      expect(ui.focusController.focusRenderer).toBeNull();
    });
  });

  describe("focusDisabledReason()", () => {
    const row = (
      opts: {
        color?: boolean;
        type?: string;
        checked?: boolean;
        layerId?: string;
      } = {},
    ) => {
      const item = document.createElement("div");
      if (opts.color) item.dataset.layerType = ROLE.BASE;
      if (opts.type !== undefined) item.dataset.layerType = opts.type;
      if (opts.checked !== undefined) {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = opts.checked;
        item.appendChild(box);
      }
      if (opts.layerId) item.setAttribute(CONST.DATA.LAYER_ID, opts.layerId);
      return item;
    };

    it("returns undefined for a visible row, and for a row without a checkbox", () => {
      expect(focusDisabledReason(ui, row({ checked: true }))).toBeUndefined();
      expect(focusDisabledReason(ui, row())).toBeUndefined();
    });

    it("returns 'base' for a color-picker or basemap row", () => {
      expect(focusDisabledReason(ui, row({ color: true }))).toBe("base");
      expect(focusDisabledReason(ui, row({ type: ROLE.BASE }))).toBe("base");
    });

    it("returns 'hidden' for a hidden row", () => {
      expect(focusDisabledReason(ui, row({ checked: false }))).toBe("hidden");
    });

    it("returns 'hidden' for an unchecked basemap row — same rule as data rows", () => {
      // The basemap branches say "no useful extent", which is true whether or
      // not the row is on. Consulted first (as they once were) they would let
      // an off basemap keep an enabled Style entry, so the unchecked check has
      // to come ahead of them.
      expect(focusDisabledReason(ui, row({ type: ROLE.BASE, checked: false }))).toBe(
        "hidden",
      );
      expect(focusDisabledReason(ui, row({ color: true, checked: false }))).toBe(
        "hidden",
      );
      // A checked basemap keeps the basemap verdict: no extent to focus on.
      expect(focusDisabledReason(ui, row({ type: ROLE.BASE, checked: true }))).toBe(
        "base",
      );
      expect(focusDisabledReason(ui, row({ color: true, checked: true }))).toBe("base");
    });

    it("returns 'no_bounds' when the surface reports capabilities.bounds false", () => {
      const item = row({ checked: true, layerId: "nob" });
      const layerInfo = { id: "nob" } as LayerInfo;
      vi.spyOn(ui.c.layerRegistry, "get").mockReturnValue(layerInfo);
      vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
        capabilities: { bounds: false } as any,
      } as any);
      expect(focusDisabledReason(ui, item)).toBe("no_bounds");
    });

    it("returns undefined for a row whose surface has bounds", () => {
      const item = row({ checked: true, layerId: "with" });
      const layerInfo = { id: "with" } as LayerInfo;
      vi.spyOn(ui.c.layerRegistry, "get").mockReturnValue(layerInfo);
      vi.spyOn(ui.c, "surfaceFor").mockReturnValue({
        capabilities: { bounds: true } as any,
      } as any);
      expect(focusDisabledReason(ui, item)).toBeUndefined();
    });

    it("returns undefined when no layer is registered (first post-attach pass)", () => {
      const item = row({ checked: true, layerId: "unknown" });
      vi.spyOn(ui.c.layerRegistry, "get").mockReturnValue(undefined);
      expect(focusDisabledReason(ui, item)).toBeUndefined();
    });

    it("maps each reason to the locale key its tooltip and hint read", () => {
      expect(focusDisabledLocaleKey("base")).toBe("focus_base");
      expect(focusDisabledLocaleKey("hidden")).toBe("focus_hidden");
      expect(focusDisabledLocaleKey("no_bounds")).toBe("focus_no_bounds");
    });

    it("shows the localized hint for each disabled reason", () => {
      const hintSpy = vi.fn();
      map.foliplus.hint.set = hintSpy;

      showFocusDisabledHint(ui, "base");
      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "",
        "LayerControl.focus_base",
        { duration: expect.any(Number) },
      );

      showFocusDisabledHint(ui, "hidden");
      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "",
        "LayerControl.focus_hidden",
        { duration: expect.any(Number) },
      );

      showFocusDisabledHint(ui, "no_bounds");
      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "",
        "LayerControl.focus_no_bounds",
        { duration: expect.any(Number) },
      );
    });
  });

  describe("toggleFocusedLayer()", () => {
    it("no-ops when the keyboard cursor points at no row", () => {
      ui.listPanel.activeIdx = null;
      expect(() => toggleFocusedLayer(ui)).not.toThrow();
    });

    it("no-ops when the active row carries no checkbox", () => {
      // A third-party row can be navigable (LAYER_ITEM class) yet render no
      // checkbox at all; the guard must bail instead of throwing.
      const bare = document.createElement("div");
      bare.className = CONST.CLASSES.LAYER_ITEM;
      bare.setAttribute(CONST.DATA.LAYER_ID, "bare");
      attachedPanel(ui).appendChild(bare);
      ui.listPanel.activeIdx = navigableItems().indexOf(bare);
      expect(getActiveLayerItem(ui)).toBe(bare);
      const changes = vi.fn();
      document.addEventListener("change", changes);
      try {
        toggleFocusedLayer(ui);
        expect(changes).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener("change", changes);
      }
    });

    it("flips the active row's checkbox and dispatches change", () => {
      const item = findItem(ui, "overlay1");
      const box = item.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      ui.listPanel.activeIdx = navigableItems().indexOf(item);
      const changes = vi.fn();
      box.addEventListener("change", changes);

      box.checked = true;
      try {
        toggleFocusedLayer(ui);
        expect(box.checked).toBe(false);
        expect(changes).toHaveBeenCalledTimes(1);
      } finally {
        box.checked = true;
        box.removeEventListener("change", changes);
      }
    });
  });

  describe("computeLayerBounds()", () => {
    it("returns the layer's own bounds when they are valid", () => {
      const b = layerBounds();
      expect(computeLayerBounds({ getBounds: () => b } as any)).toBe(b);
    });

    it("sums the leaf bounds when the layer has no getBounds(), skipping invalid leaves", () => {
      const good = layerBounds();
      const layer = {
        eachLayer: vi.fn((cb: (leaf: any) => void) => {
          cb({ getBounds: () => ({ isValid: () => false }) });
          cb({ getBounds: () => good });
        }),
      };

      const out = computeLayerBounds(layer as any);
      expect(out).not.toBeNull();
      expect(out!.isValid()).toBe(true);
      expect(out!.getSouthWest()).toEqual({ lat: 30, lng: 100 });
    });

    it("returns null when no leaf yields valid bounds", () => {
      expect(computeLayerBounds({ eachLayer: vi.fn() } as any)).toBeNull();
    });
  });

  describe("focus overlay drawing", () => {
    it("creates the SVG renderer once and reuses it for the next mask", () => {
      drawFocusMask(ui, layerBounds());
      const renderer = ui.focusController.focusRenderer!;
      expect(renderer).not.toBeNull();

      drawFocusMask(ui, layerBounds());
      expect(ui.focusController.focusRenderer).toBe(renderer);
    });

    it("aborts the mask when the focus pane is not acquireable", () => {
      // Defensive: a focus pane held by someone else (or repainted with
      // foreign content) means the mask has nowhere to draw — the abort must
      // leave no renderer behind and not throw.
      const ensureSpy = vi
        .spyOn(ui.c.panes, "ensurePane")
        .mockReturnValue({ pane: null, renderer: null });
      try {
        expect(() => drawFocusMask(ui, layerBounds())).not.toThrow();
        expect(ui.focusController.focusRenderer).toBeNull();
        expect(ensureSpy).toHaveBeenCalled();
      } finally {
        ensureSpy.mockRestore();
      }
    });

    it("omits the renderer from the rect options when none is active", () => {
      expect(ui.focusController.focusRenderer).toBeNull();

      drawFocusRect(ui, layerBounds());

      // The rounded marquee is the polygon call with the focus-rect class.
      const rectCall = (window.L.polygon as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) =>
          (c[1] as { className?: string })?.className === "foliplus-focus-rect",
      );
      expect((rectCall?.[1] as { renderer?: unknown }).renderer).toBeUndefined();
    });
  });

  describe("registerAutoCancel() stale-focus guard", () => {
    const moveendHandler = () => {
      const hit = (map.on as any).mock.calls
        .filter((c: any[]) => c[0] === "moveend")
        .at(-1);
      return hit?.[1];
    };

    it("ignores map navigation once another focus has superseded this one", () => {
      vi.useFakeTimers();
      registerAutoCancel(ui, "overlay1");
      // Mark the focus as already discarded so the callback has nothing to clean.
      ui.focusController.focusMask = { _options: {} } as any;
      ui.focusController.focusingLayerId = "overlay2";

      moveendHandler()!();
      vi.advanceTimersByTime(CONST.FOCUS.RECT_DURATION_MS + 1);

      expect(ui.focusController.focusingLayerId).toBe("overlay2");
      expect(ui.focusController.focusMask).not.toBeNull();
    });

    it("does not dismiss a focus superseded during the grace window", () => {
      vi.useFakeTimers();
      registerAutoCancel(ui, "overlay1");
      ui.focusController.focusMask = { _options: {} } as any;
      moveendHandler()!();
      ui.focusController.focusingLayerId = "overlay2";

      vi.advanceTimersByTime(CONST.FOCUS.RECT_DURATION_MS + 1);

      expect(ui.focusController.focusingLayerId).toBe("overlay2");
      expect(ui.focusController.focusMask).not.toBeNull();
    });
  });

  describe("highlightFocusedRow()", () => {
    it("clears the previous highlight without adopting the new row when it is null", () => {
      const item = findItem(ui, "overlay1");
      highlightFocusedRow(ui, item, "overlay1");
      expect(item.classList.contains(CONST.CLASSES.FOCUSING)).toBe(true);

      highlightFocusedRow(ui, null, "overlay2");

      expect(item.classList.contains(CONST.CLASSES.FOCUSING)).toBe(false);
      expect(ui.focusController.focusingLayerId).toBe("overlay1");
    });
  });

  describe("bringFocusedLayerToFront() canvas fallback", () => {
    const heatInfo = (paneName?: string) => {
      const canvas = document.createElement("canvas");
      const info = {
        id: "heat1",
        name: "Heat",
        role: "overlay",
        canvas,
        ...(paneName ? { paneName } : {}),
      } as LayerInfo;
      return { info, canvas };
    };

    it("lifts the canvas directly when the layer has no pane of its own", () => {
      const { info, canvas } = heatInfo();
      bringFocusedLayerToFront(ui, info);

      expect(canvas.style.zIndex).toBe(String(focusLayerZ()));
      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(true);
      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_GLOW)).toBe(true);
    });

    it("falls back to the canvas when the declared pane is missing from the map", () => {
      const { info, canvas } = heatInfo("missing-pane");
      const realGetPane = map.getPane;
      map.getPane = vi.fn((name: string) =>
        name === "missing-pane" ? undefined : realGetPane(name),
      );

      bringFocusedLayerToFront(ui, info);

      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(true);
      expect(canvas.style.zIndex).toBe(String(focusLayerZ()));
    });

    // Both guards end in a no-op: the ladder panes are still lifted, but
    // nothing is restored for the layer itself. Three, not four — the label
    // pane used to be spot-lifted by name here too; it is a PaneHandle now,
    // declared only when the layer has labelable content (these guard shapes
    // have no layer at all), and it rides the surface's own restore.
    const LADDER_PANES = 3; // marker / tooltip / popup

    it("lifts nothing of the layer when the declared pane is absent and there is no canvas", () => {
      const realGetPane = map.getPane;
      map.getPane = vi.fn((name: string) =>
        name === "missing-pane" ? undefined : realGetPane(name),
      );
      bringFocusedLayerToFront(ui, {
        id: "none",
        name: "N",
        role: "overlay",
        paneName: "missing-pane",
      } as LayerInfo);
      expect(ui.focusController.focusedPaneRestores).toHaveLength(LADDER_PANES);
    });

    it("lifts nothing of the layer when it has neither pane nor canvas", () => {
      bringFocusedLayerToFront(ui, {
        id: "none",
        name: "N",
        role: "overlay",
      } as LayerInfo);
      expect(ui.focusController.focusedPaneRestores).toHaveLength(LADDER_PANES);
    });
  });

  describe("bringFocusedLayerToFront() pane-less surface discovery", () => {
    const paneLessSurface = (layerInfo: LayerInfo) => {
      const surface = manager.surfaceFor(layerInfo);
      return vi.spyOn(manager, "surfaceFor").mockReturnValue({
        ...surface,
        panes: [],
        setZOverride: () => false,
      } as never);
    };

    it("discovers and lifts non-default panes when the surface owns no pane", () => {
      const layerInfo = manager.layerRegistry.get("overlay1")!;
      paneLessSurface(layerInfo);
      vi.spyOn(manager, "getLayerPanes").mockReturnValue(["overlayPane", "customPane"]);
      const lifted: Record<string, HTMLElement> = {};
      const getPaneSpy = vi.spyOn(manager.map, "getPane").mockImplementation(((
        name: string,
      ) => {
        const el = document.createElement("div");
        lifted[name] = el;
        return el;
      }) as any);

      bringFocusedLayerToFront(ui, layerInfo);

      expect(getPaneSpy).toHaveBeenCalledWith("customPane");
      // overlayPane is a shared core pane — skipped via the continue, so it
      // is never resolved or lifted; only the layer-specific pane got the lift.
      expect(lifted["overlayPane"]).toBeUndefined();
      expect(lifted["customPane"].classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(
        true,
      );
    });

    it("falls back to an empty lift when pane discovery throws", () => {
      const layerInfo = manager.layerRegistry.get("overlay1")!;
      paneLessSurface(layerInfo);
      vi.spyOn(manager, "getLayerPanes").mockImplementation(() => {
        throw new Error("discovery failed");
      });

      expect(() => bringFocusedLayerToFront(ui, layerInfo)).not.toThrow();
    });

    it("skips a discovered pane that the map doesn't have", () => {
      // getLayerPanes names a pane whose DOM node was never created —
      // best-effort discovery: skip the missing one without breaking the lift.
      const layerInfo = manager.layerRegistry.get("overlay1")!;
      paneLessSurface(layerInfo);
      vi.spyOn(manager, "getLayerPanes").mockReturnValue([
        "overlayPane",
        "phantom_pane",
      ]);
      const getPaneSpy = vi.spyOn(manager.map, "getPane").mockImplementation(((
        name: string,
      ) => {
        if (name === "phantom_pane") return null;
        return document.createElement("div");
      }) as any);

      expect(() => bringFocusedLayerToFront(ui, layerInfo)).not.toThrow();
      expect(getPaneSpy).toHaveBeenCalledWith("phantom_pane");
    });
  });

  describe("bringFocusedLayerToFront() group child panes", () => {
    const makeGroup = (children: any[]) => {
      const c: any = {
        options: {},
        clearLayers: vi.fn(),
        getBounds: vi.fn(),
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        getLayers: vi.fn(() => children),
        _layers: {},
      };
      c.eachLayer = vi.fn((fn: (child: unknown) => void) => {
        for (const child of children) fn(child);
      });
      return c;
    };

    it("lifts a child pane the surface did not discover", () => {
      const childA = { options: {}, visible: true };
      const childB = { options: { pane: "grp_pane_b" }, visible: true };
      const group = makeGroup([childA, childB]);
      manager.registerLayer({
        id: "grp",
        name: "Group",
        role: "overlay",
        layer: group,
      });
      const layerInfo = manager.layerRegistry.get("grp")!;
      const surface = manager.surfaceFor(layerInfo);
      vi.spyOn(manager, "surfaceFor").mockReturnValue({
        ...surface,
        panes: [
          {
            name: "foliplus-pane-2",
            role: "base",
            element: document.createElement("div"),
          },
        ],
        paneNames: ["foliplus-pane-2"],
        setZOverride: () => true,
        restoreZ: vi.fn(),
      } as never);
      vi.spyOn(manager, "getLayerPanes").mockReturnValue([
        "foliplus-pane-2",
        "grp_pane_b",
      ]);
      const lifted: Record<string, HTMLElement> = {};
      vi.spyOn(manager.map, "getPane").mockImplementation(((name: string) => {
        const el = document.createElement("div");
        lifted[name] = el;
        return el;
      }) as any);

      bringFocusedLayerToFront(ui, layerInfo);

      expect(lifted["grp_pane_b"].classList.contains(CONST.CLASSES.FOCUS_PANE)).toBe(
        true,
      );
      expect(lifted["grp_pane_b"].style.zIndex).toBe(String(focusLayerZ()));
    });

    it("does not lift a child pane already owned by the surface", () => {
      const childA = { options: {}, visible: true };
      const childB = { options: { pane: "grp_pane_b" }, visible: true };
      const group = makeGroup([childA, childB]);
      manager.registerLayer({
        id: "grp",
        name: "Group",
        role: "overlay",
        layer: group,
      });
      const layerInfo = manager.layerRegistry.get("grp")!;
      const surface = manager.surfaceFor(layerInfo);
      vi.spyOn(manager, "surfaceFor").mockReturnValue({
        ...surface,
        panes: [
          {
            name: "grp_pane_b",
            role: "base",
            element: document.createElement("div"),
          },
          {
            name: "foliplus-pane-2",
            role: "base",
            element: document.createElement("div"),
          },
        ],
        paneNames: ["grp_pane_b", "foliplus-pane-2"],
        setZOverride: () => true,
        restoreZ: vi.fn(),
      } as never);
      vi.spyOn(manager, "getLayerPanes").mockReturnValue([
        "grp_pane_b",
        "foliplus-pane-2",
      ]);
      bringFocusedLayerToFront(ui, layerInfo);
      // Both panes are already owned by the surface, so the group
      // child-pane lift must NOT double-lift either one — the surface path
      // is the single owner of every pane it declared.
      const restores = ui.focusController.focusedPaneRestores;
      expect(restores.some(([label]) => label === "lift:pane:grp_pane_b")).toBe(false);
      expect(restores.some(([label]) => label === "lift:pane:foliplus-pane-2")).toBe(
        false,
      );
    });

    it("swallows a getLayerPanes failure instead of crashing the focus", () => {
      const childA = { options: {}, visible: true };
      const group = makeGroup([childA]);
      manager.registerLayer({
        id: "grp",
        name: "Group",
        role: "overlay",
        layer: group,
      });
      const layerInfo = manager.layerRegistry.get("grp")!;
      const surface = manager.surfaceFor(layerInfo);
      vi.spyOn(manager, "surfaceFor").mockReturnValue({
        ...surface,
        panes: [
          {
            name: "foliplus-pane-2",
            role: "base",
            element: document.createElement("div"),
          },
        ],
        paneNames: ["foliplus-pane-2"],
        setZOverride: () => true,
        restoreZ: vi.fn(),
      } as never);
      vi.spyOn(manager, "getLayerPanes").mockImplementation(() => {
        throw new Error("pane discovery exploded");
      });
      const lifted: Record<string, HTMLElement> = {};
      vi.spyOn(manager.map, "getPane").mockImplementation(((name: string) => {
        const el = document.createElement("div");
        lifted[name] = el;
        return el;
      }) as any);
      expect(() => bringFocusedLayerToFront(ui, layerInfo)).not.toThrow();
      const restores = ui.focusController.focusedPaneRestores;
      expect(restores.some(([label]) => label.startsWith("lift:pane:"))).toBe(false);
    });

    it("skips a child pane that is a shared default pane", () => {
      // A core pane (overlayPane, markerPane, ...) belongs to every layer, so
      // lifting it for one group would reorder unrelated layers.
      const childA = { options: {}, visible: true };
      const group = makeGroup([childA]);
      manager.registerLayer({
        id: "grp",
        name: "Group",
        role: "overlay",
        layer: group,
      });
      const layerInfo = manager.layerRegistry.get("grp")!;
      const surface = manager.surfaceFor(layerInfo);
      vi.spyOn(manager, "surfaceFor").mockReturnValue({
        ...surface,
        panes: [],
        paneNames: [],
        setZOverride: () => true,
        restoreZ: vi.fn(),
      } as never);
      vi.spyOn(manager, "getLayerPanes").mockReturnValue(["overlayPane"]);
      const getPaneSpy = vi
        .spyOn(manager.map, "getPane")
        .mockImplementation((() => document.createElement("div")) as any);

      bringFocusedLayerToFront(ui, layerInfo);

      expect(getPaneSpy).not.toHaveBeenCalledWith("overlayPane");
      const restores = ui.focusController.focusedPaneRestores;
      expect(restores.some(([label]) => label.startsWith("lift:pane:"))).toBe(false);
    });

    it("skips a child pane the map does not have", () => {
      // Best-effort: getLayerPanes can name a pane whose DOM node was never
      // created; the lift skips it instead of throwing.
      const childA = { options: {}, visible: true };
      const group = makeGroup([childA]);
      manager.registerLayer({
        id: "grp",
        name: "Group",
        role: "overlay",
        layer: group,
      });
      const layerInfo = manager.layerRegistry.get("grp")!;
      const surface = manager.surfaceFor(layerInfo);
      vi.spyOn(manager, "surfaceFor").mockReturnValue({
        ...surface,
        panes: [],
        paneNames: [],
        setZOverride: () => true,
        restoreZ: vi.fn(),
      } as never);
      vi.spyOn(manager, "getLayerPanes").mockReturnValue(["ghost_pane"]);
      vi.spyOn(manager.map, "getPane").mockReturnValue(null as never);

      expect(() => bringFocusedLayerToFront(ui, layerInfo)).not.toThrow();
      const restores = ui.focusController.focusedPaneRestores;
      expect(restores.some(([label]) => label.startsWith("lift:pane:"))).toBe(false);
    });
  });
});
