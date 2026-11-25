// test/js/control/LayerControl/ui/style/index — focus layer, mask and the interaction lock.
import {
  findItem,
  initFixture,
  oneOverlay,
  polygonLayerWith,
  polygonLayerWithoutBounds,
} from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureModes } from "#core/lifecycle/index.js";
import { EVENTS } from "#foliplus/core/event/index.js";
import { ensureInteraction } from "#foliplus/core/interaction/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { dismissFocus } from "#control/LayerControl/ui/focus/index.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  getIntent,
  seedIntentMap,
  setIntent,
} from "#control/LayerControl/ui/intent.js";
import { projectLayer } from "#control/LayerControl/ui/projection.js";

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

describe("LayerUI focusLayer — interaction lock", () => {
  // Shorthands for the live mock spies. These are the SAME function objects
  // the code under test (focusLayer / dismissFocus) calls.
  const setModeSpy = modeMocks._setMode as any;
  const getModeSpy = modeMocks._getMode as any;
  const guardBlockedSpy = modeMocks.guardBlocked as any;

  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    // initFixture() toggles fake timers internally to flush the deferred
    // attachUI work, so it must run first: installing fake timers after it
    // would be undone by the fixture's useRealTimers() and runAllTimers()
    // below would hit the real clock.
    vi.clearAllMocks();
    modeMocks._reset();
    const fixture = trackFixture(initFixture());
    vi.useFakeTimers();
    ui = fixture.ui;
    map = fixture.map;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("guardBlocked rejects focus when another component holds the map", () => {
    it("shows a hint and returns early when blocked", () => {
      guardBlockedSpy.mockReturnValue(true);

      ui.focusLayer("overlay1");

      expect(guardBlockedSpy).toHaveBeenCalledWith(
        map,
        "LayerControl",
        expect.any(String),
      );
      expect(map.fitBounds).not.toHaveBeenCalled();
      expect(ui.focusController.focusRect).toBeNull();
      expect(setModeSpy).not.toHaveBeenCalled();
    });

    it("does NOT short-circuit when guard passes (control path)", () => {
      guardBlockedSpy.mockReturnValue(false);

      ui.focusLayer("overlay1");

      expect(guardBlockedSpy).toHaveBeenCalledWith(
        map,
        "LayerControl",
        expect.any(String),
      );
      expect(map.fitBounds).toHaveBeenCalled();
      expect(setModeSpy).toHaveBeenCalledWith("LayerControl", "focusing");
    });
  });

  it("registers LayerControl.focusing mode for the duration of the focus", () => {
    expect(getModeSpy("LayerControl")).toBeNull();

    ui.focusLayer("overlay1");

    expect(setModeSpy).toHaveBeenCalledWith("LayerControl", "focusing");
  });

  it("clears the focusing mode in dismissFocus()", () => {
    ui.focusLayer("overlay1");

    vi.runAllTimers(); // fires the 3500ms auto-dismiss

    expect(setModeSpy).toHaveBeenCalledWith("LayerControl", null);
    expect(getModeSpy("LayerControl")).toBeNull();
  });

  it("cancelFocus() releases the focusing mode (manual cancel path)", () => {
    ui.focusLayer("overlay1");
    expect(getModeSpy("LayerControl")).toBe("focusing");

    ui.cancelFocus();

    expect(setModeSpy).toHaveBeenCalledWith("LayerControl", null);
    expect(getModeSpy("LayerControl")).toBeNull();
  });

  it("destroy() releases the focusing mode through unbindEvents → dismissFocus", () => {
    const { manager, ui } = trackFixture(initFixture());

    ui.focusLayer("overlay1");
    expect(getModeSpy("LayerControl")).toBe("focusing");

    manager.destroy();

    expect(setModeSpy).toHaveBeenCalledWith("LayerControl", null);
    expect(getModeSpy("LayerControl")).toBeNull();
  });

  it("keeps the focusing mode active throughout the focus window", () => {
    ui.focusLayer("overlay1");
    expect(getModeSpy("LayerControl")).toBe("focusing");

    // Advance to well inside the 3500ms window; mode must still be held.
    vi.advanceTimersByTime(CONST.FOCUS.RECT_DURATION_MS - 1000);
    expect(getModeSpy("LayerControl")).toBe("focusing");
  });

  it("passes LayerControl as the component key in setMode calls", () => {
    ui.focusLayer("overlay1");
    vi.runAllTimers();

    // Every setMode call must identify itself as LayerControl — the mode
    // system keys modes per-component, so the wrong key would mean focus
    // never clears or never blocks.
    for (const call of setModeSpy.mock.calls as Array<[string, string | null]>) {
      expect(call[0]).toBe("LayerControl");
    }
    expect(setModeSpy).toHaveBeenCalledWith("LayerControl", "focusing");
    expect(setModeSpy).toHaveBeenCalledWith("LayerControl", null);
  });

  it("re-registers the mode on a successive focus", () => {
    ui.focusLayer("overlay1");
    vi.runAllTimers();

    ui.focusLayer("overlay1");

    const focusingCalls = setModeSpy.mock.calls.filter(
      (c: [string, string | null]) => c[1] === "focusing",
    );
    expect(focusingCalls).toHaveLength(2);
  });

  it("registers focusing mode on the flyTo path (tiny-bounds focus)", () => {
    // The overlay1 leaf is a Polygon-style layer; spy on its getBounds to
    // force a tiny area so focusLayer takes the flyTo branch. Regression
    // test for the missing setMode on this path.
    const tinyBounds = {
      isValid: () => true,
      getSouthWest: () => ({ lat: 30, lng: 100 }),
      getNorthEast: () => ({ lat: 30.00001, lng: 100.00001 }),
      getCenter: () => ({ lat: 30, lng: 100 }),
    };
    const layer = ui.c.findLayer(ui.c.layerRegistry.get("overlay1")!);
    vi.spyOn(layer, "getBounds").mockReturnValue(tinyBounds);

    ui.focusLayer("overlay1");

    expect(map.flyTo).toHaveBeenCalled();
    expect(setModeSpy).toHaveBeenCalledWith("LayerControl", "focusing");
    expect(getModeSpy("LayerControl")).toBe("focusing");
  });
});

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
  // ─────────────────── focusLayer() ───────────────────

  describe("focusLayer()", () => {
    it("tolerates a pane missing from the map while lifting the focus ladder", () => {
      // The ladder lifts the label pane and the interaction panes into the
      // focus band; a map without some of them must not break the focus.
      const realGetPane = map.getPane;
      map.getPane = vi.fn((name: string) =>
        ["markerPane", "tooltipPane", "popupPane"].includes(name)
          ? undefined
          : realGetPane(name),
      );

      expect(() => ui.focusLayer("overlay1")).not.toThrow();
    });

    it("draws a border-only rounded marquee on the layer bounds", () => {
      ui.focusLayer("overlay1");

      expect(L.polygon).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          className: "foliplus-focus-rect",
          fill: false,
          interactive: false,
        }),
      );
      expect(map.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            className: "foliplus-focus-rect",
          }),
        }),
      );
    });

    it("passes the layer bounds to the rounded-marquee polygon", () => {
      ui.focusLayer("overlay1");

      // 4 corners x (2 tangents + 2 bezier mids) = 16 points, closed loop.
      const rings = (L.polygon as unknown as ReturnType<typeof vi.fn>).mock.calls.at(
        -1,
      )![0] as L.LatLng[];
      expect(rings.length).toBe(16);
      expect(map.addLayer).toHaveBeenCalled();
    });

    it("caps maxZoom at current zoom + FOCUS.MAX_ZOOM_STEP", () => {
      ui.focusLayer("overlay1");

      expect(map.fitBounds).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxZoom: 11 }), // zoom(5) + FOCUS.MAX_ZOOM_STEP(6)
      );
    });

    it("caps maxZoom at map.getMaxZoom() when current + step exceeds it", () => {
      ({ manager, ui, map } = trackFixture(
        initFixture({ initialZoom: 17, maxZoom: 18 }),
      ));

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
        .map((c: any) => c[0])
        .filter((arg: any) => arg && typeof arg.getBounds === "function");
      expect(layerArgs.length).toBe(0);
    });

    it("bails out when bounds are invalid", () => {
      const layer = manager.findLayer(manager.layerRegistry.get("overlay1")!);
      layer.getBounds.mockImplementationOnce(() => ({ isValid: () => false }));

      ui.focusLayer("overlay1");

      expect(ui.focusController.focusRect).toBeNull();
      expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it("computes bounds from leaf nodes when the layer has no getBounds (third-party)", () => {
      // A third-party layer without getBounds() — focus must fall back to
      // summing its children's bounds instead of throwing.
      const layer = manager.findLayer(manager.layerRegistry.get("overlay1")!);
      layer.getBounds = undefined;
      // eachLayer iterates two leaf children
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
      expect(ui.focusController.focusRect).not.toBeNull();
    });

    it("focuses a canvas layer via its getBounds provider", () => {
      const canvas = document.createElement("canvas");
      canvas.style.filter = "";
      manager.registerLayer({
        id: "heat1",
        name: "Heat",
        canvas,
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
      expect(ui.focusController.focusRect).not.toBeNull();
      // Glow applied via class (CSS-owned), not an inline filter — keeps it
      // at pane/element level so dense layers stay cheap.
      expect(canvas.classList.contains(CONST.CLASSES.FOCUS_GLOW)).toBe(true);
    });

    it("bails out when the layer is not found on the map", () => {
      vi.spyOn(manager, "findLayer").mockReturnValue(null);

      ui.focusLayer("overlay1");

      expect(ui.focusController.focusRect).toBeNull();
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

      // ensureEvents() wipes map.foliplus.hint.set; re-attach a spy.
      const hintSpy = vi.fn();
      map.foliplus.hint.set = hintSpy;

      ui.focusLayer("overlay1");

      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "",
        "LayerControl.focus_hidden",
        { duration: expect.any(Number) },
      );
      expect(map.fitBounds).not.toHaveBeenCalled();
      expect(ui.focusController.focusRect).toBeNull();
    });

    it("removes the previous focus rectangle before drawing a new one", () => {
      vi.useFakeTimers();

      ui.focusLayer("overlay1");
      const firstRect = ui.focusController.focusRect!;

      ui.focusLayer("overlay1");

      expect(map.removeLayer).toHaveBeenCalledWith(firstRect);
      expect(ui.focusController.focusRect).not.toBeNull();
      expect(ui.focusController.focusRect).not.toBe(firstRect);
    });

    it("removes the focus rectangle after FOCUS.RECT_DURATION_MS", () => {
      vi.useFakeTimers();

      ui.focusLayer("overlay1");
      const rect = ui.focusController.focusRect!;
      const duration = CONST.FOCUS.RECT_DURATION_MS;

      vi.advanceTimersByTime(duration - 1);
      expect(map.removeLayer).not.toHaveBeenCalledWith(rect);

      vi.advanceTimersByTime(1);
      expect(map.removeLayer).toHaveBeenCalledWith(rect);
      expect(ui.focusController.focusRect).toBeNull();
    });

    it("does not remove a replaced focus rectangle at the 5s timeout", () => {
      vi.useFakeTimers();

      ui.focusLayer("overlay1");
      ui.focusLayer("overlay1");
      const finalRect = ui.focusController.focusRect!;
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
      layer.getBounds.mockReturnValue(tinyBounds);

      ui.focusLayer("overlay1");

      expect(map.fitBounds).not.toHaveBeenCalled();
      expect(map.flyTo).toHaveBeenCalledWith(
        { lat: 30, lng: 100 },
        11, // zoom(5) + FOCUS.MAX_ZOOM_STEP(6)
        expect.objectContaining({ duration: CONST.FOCUS.FIT_DURATION }),
      );
    });

    it("adds foliplus-is-focusing class to the focused row", () => {
      ui.focusLayer("overlay1");

      const item = findItem(ui, "overlay1");
      expect(item.classList.contains("foliplus-is-focusing")).toBe(true);
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
      const rect = ui.focusController.focusRect!;
      const item = findItem(ui, "overlay1");
      expect(item.classList.contains("foliplus-is-focusing")).toBe(true);

      // Cancel hint — re-attach spy after ensureEvents().
      const hintSpy = vi.fn();
      map.foliplus.hint.set = hintSpy;

      ui.cancelFocus();

      expect(map.removeLayer).toHaveBeenCalledWith(rect);
      expect(ui.focusController.focusRect).toBeNull();
      expect(item.classList.contains("foliplus-is-focusing")).toBe(false);
      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "",
        "LayerControl.focus_cancelled",
        { duration: expect.any(Number) },
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

  // ─────────────────── focus-driven opacity override ───────────────────
  // Focus forces the focused layer's opacity to 1 in the projection so a
  // half-transparent target still reads as fully opaque while the spotlight
  // is up. The user's stored intent is left untouched — dismissFocus's
  // sweep lands the author's value back. Zoom-range policy is separate and
  // pinned elsewhere (zoomRange.test.ts / projection.test.ts).

  describe("focusLayer opacity override", () => {
    const infoOf = (id: string) => manager.layerRegistry.get(id)!;

    it("leaves the stored opacity intent untouched and reports 1 during focus", () => {
      setIntent(ui, "overlay1", "opacity", 0.4);
      ui.intentStore.seedProvenance("overlay1", ["opacity"]);

      ui.focusLayer("overlay1");

      // The intent store is not written by the projection — this is what
      // dismissFocus relies on to restore the author's value.
      expect(getIntent(ui, "overlay1", "opacity")).toBe(0.4);
      expect(projectLayer(ui, infoOf("overlay1")).opacity).toBe(1);
    });

    it("restores the stored opacity on cancelFocus", () => {
      setIntent(ui, "overlay1", "opacity", 0.4);
      ui.intentStore.seedProvenance("overlay1", ["opacity"]);

      ui.focusLayer("overlay1");
      expect(projectLayer(ui, infoOf("overlay1")).opacity).toBe(1);

      ui.cancelFocus();
      expect(projectLayer(ui, infoOf("overlay1")).opacity).toBe(0.4);
    });

    it("covers a fully-opaque focused layer (no intent stored) to 1", () => {
      ui.focusLayer("overlay1");

      // No intent entry: the projection reads 1 both before and during
      // focus — the executor's diff is a no-op there.
      expect(getIntent(ui, "overlay1", "opacity")).toBeUndefined();
      expect(projectLayer(ui, infoOf("overlay1")).opacity).toBe(1);
    });

    it("does not lift the opacity of a non-focused layer", () => {
      setIntent(ui, "overlay1", "opacity", 0.4);
      ui.intentStore.seedProvenance("overlay1", ["opacity"]);

      manager.registerLayer({
        id: "overlay2",
        name: "Shapes",
        layer: {
          options: {},
          eachLayer: vi.fn(),
          getBounds: () => ({
            isValid: () => true,
            getSouthWest: () => ({ lat: 30, lng: 100 }),
            getNorthEast: () => ({ lat: 40, lng: 110 }),
          }),
        } as unknown as L.Layer,
      });
      setIntent(ui, "overlay2", "opacity", 0.7);
      ui.intentStore.seedProvenance("overlay2", ["opacity"]);

      ui.focusLayer("overlay1");

      // Focused layer is forced to 1; the sibling keeps its own intent —
      // the override is single-layer, not a blanket policy like zoom-range.
      expect(projectLayer(ui, infoOf("overlay1")).opacity).toBe(1);
      expect(projectLayer(ui, infoOf("overlay2")).opacity).toBe(0.7);
    });

    it("focusLayer applies the opacity override through the executor (not just the projection)", () => {
      // The projection-level assertions above catch `projectLayer` returning
      // 1, but they pass even if focusLayer never calls applyProjectionAll:
      // `focusingLayerId` is also set by `highlightFocusedRow` /
      // `registerAutoCancel` later in the same call, so the pure projection
      // already reads 1 by the time focusLayer returns. This case pins the
      // apply step itself — the override must reach the executor's written
      // state, which is what lands on the carrier (pane style / layer
      // options) the user actually sees. Without `applyProjectionAll(ui)`
      // inside focusLayer, `runtimeStore.getApplied().opacity` stays at the
      // last sweep's value and the carrier never updates.
      setIntent(ui, "overlay1", "opacity", 0.4);
      ui.intentStore.seedProvenance("overlay1", ["opacity"]);

      // Baseline: no sweep has run since setIntent, so the applied state
      // still holds the author's default (1) from the init pass.
      expect(infoOf("overlay1").opacity).toBe(1);

      ui.focusLayer("overlay1");

      // The focus-driven 1 must be the value the executor last wrote —
      // visible on both the runtime record and the LayerInfo field the
      // carrier write stamps.
      expect(ui.runtimeStore.getApplied("overlay1")?.opacity).toBe(1);
      expect(infoOf("overlay1").opacity).toBe(1);

      ui.cancelFocus();

      // dismissFocus's sweep lands the author's stored intent back.
      expect(ui.runtimeStore.getApplied("overlay1")?.opacity).toBe(0.4);
      expect(infoOf("overlay1").opacity).toBe(0.4);
    });
  });

  // ─────────────────── inverse mask (dim outside) ───────────────────

  describe("focusLayer inverse mask", () => {
    it("draws a polygon with the Web-Mercator world as outer ring and layer bounds as hole", () => {
      const polygonSpy = vi.spyOn(window.L, "polygon");

      ui.focusLayer("overlay1");

      // Focus draws mask + rounded rect; pick the mask by its class.
      const maskCall = polygonSpy.mock.calls.find(
        c => (c[1] as { className?: string })?.className === "foliplus-focus-mask",
      );
      expect(maskCall).toBeTruthy();
      const rings = maskCall![0] as any;
      expect(rings).toHaveLength(2);
      // Outer ring = the Web-Mercator world envelope: ±85.05° latitude
      // (just inside the Mercator poles) and ±180° longitude. Chosen so the
      // dim always covers the viewport after fitBounds zooms — the SVG
      // renderer clips the off-screen excess.
      const outer = rings[0];
      expect(outer).toEqual([
        { lat: -85.05, lng: -180 },
        { lat: 85.05, lng: -180 },
        { lat: 85.05, lng: 180 },
        { lat: -85.05, lng: 180 },
      ]);
      // Hole ring = overlay1 bounds: SW(30,100) → NE(40,110).
      const hole = rings[1];
      expect(hole[0]).toEqual({ lat: 30, lng: 100 });
      expect(hole[2]).toEqual({ lat: 40, lng: 110 });

      polygonSpy.mockRestore();
    });

    it("dims with MASK_OPACITY and renders above layer panes", () => {
      const polygonSpy = vi.spyOn(window.L, "polygon");

      ui.focusLayer("overlay1");

      const opts = polygonSpy.mock.calls[0][1] as any;
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
      const mask = ui.focusController.focusMask!;
      const renderer = ui.focusController.focusRenderer!;

      ui.cancelFocus();

      expect(map.removeLayer).toHaveBeenCalledWith(mask);
      // The SVG renderer is torn down too: reusing it across focuses left the
      // previous focus's mask/rect paths in the SVG even after removeLayer, so
      // focusing A then B showed two boxes (stale A mask + new B mask). A fresh
      // renderer per focus guarantees a clean slate.
      expect(map.removeLayer).toHaveBeenCalledWith(renderer);
      expect(ui.focusController.focusMask).toBeNull();
      expect(ui.focusController.focusRenderer).toBeNull();
    });

    it("focusing A then B removes A's mask and rect (no stale box)", () => {
      // Regression: reusing the SVG renderer across focuses left the previous
      // focus's mask/rect paths in the SVG even after removeLayer, so focusing
      // A then B showed two boxes (stale A mask + new B mask). Each focus must
      // tear down the prior mask/rect + renderer.
      ui.focusLayer("overlay1");
      const firstMask = ui.focusController.focusMask!;
      const firstRect = ui.focusController.focusRect!;

      ui.focusLayer("overlay1"); // same layer — dismissFocus runs first

      expect(map.removeLayer).toHaveBeenCalledWith(firstMask);
      expect(map.removeLayer).toHaveBeenCalledWith(firstRect);
      expect(ui.focusController.focusMask).not.toBe(firstMask);
      expect(ui.focusController.focusRect).not.toBe(firstRect);
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
      const firstMask = ui.focusController.focusMask!;
      ui.focusLayer("overlay2"); // immediate second focus on a different layer

      // The first mask is removed and the hole is now overlay2's bounds.
      expect(map.removeLayer).toHaveBeenCalledWith(firstMask);
      expect(ui.focusController.focusMask).not.toBe(firstMask);
      expect(ui.focusController.focusingLayerId).toBe("overlay2");
      // A single mask exists (fresh renderer each focus), hole = overlay2 SW.
      // The mask is the polygon call whose rings carry the hole (2 rings);
      // the latest one is overlay2's.
      const maskCalls = (
        window.L.polygon as ReturnType<typeof vi.fn>
      ).mock.calls.filter(
        (c: unknown[]) =>
          Array.isArray((c[0] as unknown[])?.[0]) && (c[0] as unknown[]).length === 2,
      );
      const hole = (maskCalls.at(-1)![0] as unknown[])[1] as any;
      expect(hole[0]).toEqual({ lat: 35, lng: 105 });

      // And it still tears down cleanly.
      ui.cancelFocus();
      expect(ui.focusController.focusMask).toBeNull();
      expect(ui.focusController.focusRect).toBeNull();
      expect(ui.focusController.focusRenderer).toBeNull();
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
      layer.getBounds.mockReturnValue(tinyBounds);

      ui.focusLayer("overlay1");

      expect(polygonSpy).not.toHaveBeenCalled();

      polygonSpy.mockRestore();
    });
  });
});

// ── Notification-contract cases, moved from the former
// ── notifyContract.test.ts so they live with the script they drive. ──
it("a focus cancel inside the rectangle announce is not undone", () => {
  // The rectangle branch draws the mask, the rect, the row highlight and the
  // auto-cancel, and only then announces. A subscriber that cancels inside
  // that notify wins: nothing after the announce re-arms the focus, so a
  // focus kicked off by focusLayer cannot still be live when it returns.
  const { ui, map, layer, onMap } = trackFixture(oneOverlay());
  onMap.set(layer, false);

  let deliveries = 0;
  ui.events.on(EVENTS.LAYER_CHANGE, () => {
    deliveries += 1;
    ui.cancelFocus();
  });

  expect(() => ui.focusLayer("overlay1")).not.toThrow();
  expect(map.fitBounds).toHaveBeenCalled();
  expect(deliveries).toBeGreaterThan(0);
  expect(ui.isFocusing()).toBe(false);
});

it("a focus cancel inside the flyTo announce is not undone", () => {
  // The flyTo branch takes the same ordering: fly to the center, highlight
  // the row, register the auto-cancel, and only then announce.
  const { ui, map, layer, onMap } = trackFixture(
    oneOverlay(() => polygonLayerWith([30, 100], [30.0001, 100.0001])),
  );
  onMap.set(layer, false);

  let deliveries = 0;
  ui.events.on(EVENTS.LAYER_CHANGE, () => {
    deliveries += 1;
    ui.cancelFocus();
  });

  expect(() => ui.focusLayer("overlay1")).not.toThrow();
  expect(map.flyTo).toHaveBeenCalled();
  expect(deliveries).toBeGreaterThan(0);
  expect(ui.isFocusing()).toBe(false);
});

it("a rejected focus leaves no membership change behind", () => {
  // A layer the policy had pulled off rejoins the map so its bounds can be
  // read. When those bounds turn out unusable the re-add goes back, so the
  // call announces nothing and leaves the map as it found it.
  const { ui, layer, onMap } = trackFixture(oneOverlay(polygonLayerWithoutBounds));
  onMap.set(layer, false);

  const seen: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    seen.push(payload.id);
  });

  expect(() => ui.focusLayer("overlay1")).not.toThrow();

  expect(onMap.get(layer)).toBe(false);
  expect(seen).toEqual([]);
  expect(ui.isFocusing()).toBe(false);
});

it("dismissFocus releases a stuck focusing mode when the focus UI state is gone", () => {
  const { ui, map } = trackFixture(initFixture());
  // This suite mocks core/mode, whose fake ensureModes does not wire
  // map.foliplus.modes the way the real one does; emulate that wiring so the
  // production recovery path can read the live mode without installing.
  const modes = ensureModes(map) as {
    setMode: (component: string, mode: string | null) => void;
    getMode: (component: string) => string | null;
  };
  (map as any).foliplus = { ...(map as any).foliplus, modes };
  // Simulate a past half-commit: mode registered, focus UI state never landed
  // (isFocusing is driven by the focus state, not by the mode).
  modes.setMode(ui.config.name, "focusing");
  expect(ui.isFocusing()).toBe(false);

  dismissFocus(ui);

  expect(modes.getMode(ui.config.name)).toBeNull();
  expect(ui.isFocusing()).toBe(false);
});

describe("dismissFocus finalization", () => {
  it("removes focus visuals even when a pane restore throws", () => {
    window.localStorage.clear();
    const { ui } = trackFixture(initFixture());
    const warn = vi.spyOn(ui.log, "warn");
    const removeLayer = vi.spyOn(ui.c.map, "removeLayer");

    ui.focusController.focusedPaneRestores = [
      ["restore-z:markerPane", () => undefined],
      [
        "surface:overlay1",
        () => {
          throw new Error("pane gone");
        },
      ],
    ];
    const rect = {} as L.Layer;
    const mask = {} as L.Polygon;
    const renderer = {} as L.SVG;
    ui.focusController.focusRect = rect;
    ui.focusController.focusMask = mask;
    ui.focusController.focusRenderer = renderer;

    expect(() => dismissFocus(ui)).not.toThrow();

    expect(removeLayer).toHaveBeenCalledWith(rect);
    expect(removeLayer).toHaveBeenCalledWith(mask);
    expect(removeLayer).toHaveBeenCalledWith(renderer);
    expect(ui.focusController.focusRect).toBeNull();
    expect(ui.focusController.focusMask).toBeNull();
    expect(ui.focusController.focusRenderer).toBeNull();
    expect(ui.focusController.focusedPaneRestores).toEqual([]);
    expect(
      warn.mock.calls.some(call => String(call[0]).includes("surface:overlay1")),
    ).toBe(true);
  });

  it("still tears down the mask when a step before the restores throws", () => {
    window.localStorage.clear();
    const { ui } = trackFixture(initFixture());
    const removeLayer = vi.spyOn(ui.c.map, "removeLayer");
    // Step 5 of the teardown, before the pane restores: this is the failure that
    // used to skip every visual removal and leave the map dimmed.
    vi.spyOn(ui.c.label, "setFocusFilter").mockImplementation(() => {
      throw new Error("label teardown failed");
    });
    const mask = {} as L.Polygon;
    ui.focusController.focusMask = mask;
    ui.focusController.focusingLayerId = "overlay1";

    expect(() => dismissFocus(ui)).not.toThrow();

    expect(removeLayer).toHaveBeenCalledWith(mask);
    expect(ui.focusController.focusMask).toBeNull();
    expect(ui.focusController.focusingLayerId).toBeNull();
  });
});

describe("rowNoun group branch (focusLayer hidden path)", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = trackFixture(initFixture()));
    // A container layer (group row): eachLayer + _layers registry, no
    // featureCountProvider, not a GeoJSON shape. isGroupRow() is true.
    const groupLayer = {
      options: {},
      eachLayer: vi.fn(),
      _layers: {},
      getBounds: () => ({ isValid: () => true }),
    };
    manager.registerLayer({
      id: "grp1",
      name: "Grouped",
      role: "overlay",
      layer: groupLayer as never,
    });
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("uses the group noun in the hidden hint for a container row", () => {
    const hintSpy = vi.fn();
    map.foliplus.hint.set = hintSpy;
    const checkbox = findItem(ui, "grp1").querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    if (checkbox) checkbox.checked = false;

    ui.focusLayer("grp1");

    const expected = "LayerControl.focus_hidden".replace(
      "{noun}",
      "LayerControl.noun_group",
    );
    expect(hintSpy).toHaveBeenCalledWith("LayerControl", "", expected, {
      duration: expect.any(Number),
    });
  });
});
