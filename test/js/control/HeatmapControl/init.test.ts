// Unit tests for HeatmapControl/init — the init mixin methods.
import {
  makeCtrl,
  makeManager,
} from "./fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { HeatmapManager } from "#control/HeatmapControl/manager.js";
import { rebuildLayerDropdown } from "#control/HeatmapControl/ui.js";
import * as CONST from "#control/HeatmapControl/const.js";

afterEach(() => {
  delete globalThis.h3;
  delete globalThis.chroma;
});

describe("rebuildLayerDropdown — single-layer auto-select gating", () => {
  // buildLayerListItems calls scanMapLayers internally; stub it so the
  // pre-seeded pointLayers state used by these tests survives the rebuild.
  beforeEach(() => {
    vi.spyOn(HeatmapManager.prototype, "scanMapLayers").mockImplementation(function () {
      // no-op: keep the manually seeded pointLayers
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("auto-selects the only point layer on the first scan", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "lonely", name: "Lonely", layer: {}, count: 1 }];
    const ctrl = makeCtrl(m);
    const renderSpy = vi.spyOn(m, "renderHexagons");

    rebuildLayerDropdown(ctrl);

    expect(m.selectedLayerId).toBe("lonely");
    expect(renderSpy).toHaveBeenCalled();
  });

  it("does not re-auto-select after a user clears the selection", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "lonely", name: "Lonely", layer: {}, count: 1 }];
    m.hasScanned = true;
    // Simulate the post-init state: the single layer was auto-selected
    // during initScan, then the user cleared the heatmap.
    m.selectedLayerId = null;
    const ctrl = makeCtrl(m);
    const renderSpy = vi.spyOn(m, "renderHexagons");

    // Subsequent rebuilds (zoomend, layeradd/layerremove) must not re-fire
    // the auto-select and must not draw the heatmap again.
    rebuildLayerDropdown(ctrl);

    expect(m.selectedLayerId).toBeNull();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("keeps a user-selected layer stable across rebuilds", () => {
    const m = makeManager();
    m.pointLayers = [
      { id: "a", name: "A", layer: {}, count: 2 },
      { id: "b", name: "B", layer: {}, count: 3 },
    ];
    const ctrl = makeCtrl(m);
    m.selectedLayerId = "b";

    rebuildLayerDropdown(ctrl);

    expect(m.selectedLayerId).toBe("b");
  });

  it("stays cleared across repeated rebuilds (zoom + layer-churn)", () => {
    const m = makeManager();
    m.pointLayers = [{ id: "lonely", name: "Lonely", layer: {}, count: 1 }];
    m.hasScanned = true;
    m.selectedLayerId = null;
    const ctrl = makeCtrl(m);
    const renderSpy = vi.spyOn(m, "renderHexagons");

    // Simulate a session of zoom + layer-add/remove rebuilds after the clear.
    for (let i = 0; i < 5; i++) rebuildLayerDropdown(ctrl);

    expect(m.selectedLayerId).toBeNull();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("zoomend re-render does not resurrect a cleared single layer", () => {
    const m = makeManager();
    m.selectedLayerId = null;
    m.pointLayers = [{ id: "lonely", name: "Lonely", layer: {}, count: 1 }];
    m.map = { _container: {}, getZoom: () => 6 } as any;
    const renderSpy = vi.spyOn(m, "renderHexagons");

    // Zoomend debounced handler: with nothing selected it must stay cleared.
    m.renderHexagons();

    expect(m.selectedLayerId).toBeNull();
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });
});

describe("initScan — single-layer auto-select on first scan only", () => {
  beforeEach(() => {
    window.map.foliplus.LayerAPI = {
      ...window.map.foliplus.LayerAPI,
      getLayersByType: vi.fn(() => []),
      extractPoints: vi.fn(() => []),
      createCanvas: vi.fn(() => {
        const canvas = document.createElement("canvas");
        return {
          register: vi.fn(),
          unregister: vi.fn(),
          setVisible: vi.fn(),
          hooks: { before: [], after: [] },
          canvas,
          ctx: canvas.getContext("2d"),
        };
      }),
    };
  });

  it("auto-selects and renders a single layer on first initScan", async () => {
    const { initScan } = await import("#control/HeatmapControl/ui.js");
    const m = makeManager();
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "lonely", name: "Lonely", layer: {} },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: {} },
    ]);
    const ctrl = makeCtrl(m);
    const renderSpy = vi.spyOn(m, "renderHexagons");

    initScan(ctrl);

    expect(m.hasScanned).toBe(true);
    expect(m.selectedLayerId).toBe("lonely");
    expect(renderSpy).toHaveBeenCalled();
  });

  it("auto-selects a single layer that appears when a control attaches", async () => {
    const { initScan } = await import("#control/HeatmapControl/ui.js");
    const m = makeManager();
    // First scan finds nothing; a layer appears once LayerControl finishes
    // attaching (CONTROL_ATTACHED). This is still the initial scan phase
    // (hasScanned not yet set), so it auto-selects.
    window.map.foliplus.LayerAPI.isLayerControl = true;
    let calls = 0;
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => {
      calls++;
      return calls === 1 ? [] : [{ id: "late", name: "Late", layer: {} }];
    });
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: {} },
    ]);
    const ctrl = makeCtrl(m);

    initScan(ctrl);
    expect(m.hasScanned).toBe(false);

    // LayerControl (or any control) finishing attach re-triggers the scan.
    ensureEvents(m.map).publish(EVENTS.CONTROL_ATTACHED, {
      component: "LayerControl",
    });

    expect(m.hasScanned).toBe(true);
    expect(m.selectedLayerId).toBe("late");
  });

  it("settles the no-layer hint after the synchronous attach sequence", async () => {
    const { initScan } = await import("#control/HeatmapControl/ui.js");
    const m = makeManager();
    window.map.foliplus.hint = {
      set: vi.fn(),
      clear: vi.fn(),
      registerIcon: vi.fn(),
    };
    window.map.foliplus.LayerAPI.isLayerControl = false;
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => []);
    const ctrl = makeCtrl(m);

    vi.useFakeTimers();
    initScan(ctrl);
    // The final pass fires one macrotask later — after the synchronous
    // attach sequence, when the layer set is final.
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    expect(m.hasScanned).toBe(true);
    expect(m.selectedLayerId).toBeNull();
  });

  it("cleanup unsubscribes CONTROL_ATTACHED and is idempotent", async () => {
    const { initScan } = await import("#control/HeatmapControl/ui.js");
    const m = makeManager();
    window.map.foliplus.LayerAPI.isLayerControl = true;
    let calls = 0;
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => {
      calls++;
      return [];
    });
    const ctrl = makeCtrl(m);

    vi.useFakeTimers();
    const cleanup = initScan(ctrl);
    expect(calls).toBe(1); // immediate first pass only

    cleanup();
    cleanup(); // second call is a no-op

    ensureEvents(m.map).publish(EVENTS.CONTROL_ATTACHED, {
      component: "LayerControl",
    });
    // Unsubscribed — no further scan ran, and no late settle.
    expect(calls).toBe(1);
    expect(m.hasScanned).toBe(false);

    await vi.runOnlyPendingTimersAsync();
    expect(calls).toBe(1); // settled pass also skipped (done)
    vi.useRealTimers();
  });

  it("restores a previously saved layer selection on reload", async () => {
    // Reload path: the manager restored a saved layerId from localStorage,
    // so initScan must redraw that layer without re-auto-selecting.
    const { initScan } = await import("#control/HeatmapControl/ui.js");
    const m = makeManager();
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "p1", name: "P1", layer: {} },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: {} },
    ]);
    m.selectedLayerId = "p1";
    // A non-count agg exercises the full field-selector refresh path.
    m.agg = CONST.AGG.SUM;
    const ctrl = makeCtrl(m);
    const renderSpy = vi.spyOn(m, "renderHexagons");
    const fieldSpy = vi.spyOn(m, "collectFields");

    initScan(ctrl);

    expect(m.hasScanned).toBe(true);
    expect(m.selectedLayerId).toBe("p1");
    expect(fieldSpy).toHaveBeenCalled(); // field selector refreshed for the layer
    expect(renderSpy).toHaveBeenCalled(); // saved layer drawn without interaction
    expect(ctrl.ctrl.getAttribute("data-ready")).toBe("true");
  });

  // Gates below drive the reload path as it happens in production:
  // a new manager against the same localStorage — same instance would
  // not surface the bug this round is fixing, since the guard state
  // never leaves the object. makeManager replaces window.map.foliplus
  // wholesale, so LayerAPI mocks must be re-applied after each call.
  const seedLonely = () => {
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "lonely", name: "Lonely", layer: {} },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: {} },
    ]);
  };

  it("suppresses auto-select across a reload after the user cleared it explicitly", async () => {
    // Pre-fix, hasScanned is runtime-only; a persisted record with
    // layerId: null was restored by applySavedConfig without closing the
    // guard, so the reload looked like a first open and re-fired.
    const { initScan } = await import("#control/HeatmapControl/ui.js");
    window.localStorage.clear();

    // Session 1: user opens the heatmap (single-layer auto-select fires),
    // then clears the dropdown.  The clear is user-initiated so it
    // persists — the record carries layerId: null on disk.
    const m1 = makeManager();
    seedLonely();
    const c1 = makeCtrl(m1);
    initScan(c1);
    expect(m1.selectedLayerId).toBe("lonely");
    m1.selectedLayerId = null;
    m1.saveConfig();
    m1.flush();

    // Session 2: fresh manager on the same localStorage — the recorded
    // clear must survive the reload, not be overridden by auto-select.
    const m2 = makeManager();
    seedLonely();
    const saved = m2.loadSavedConfig();
    expect(saved).not.toBeNull();
    expect(saved!.layerId).toBeNull();
    m2.applySavedConfig(saved!);
    const c2 = makeCtrl(m2);
    const renderSpy = vi.spyOn(m2, "renderHexagons");
    initScan(c2);

    expect(m2.selectedLayerId).toBeNull();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("never auto-selects with two point layers, with or without a saved record", async () => {
    const { initScan } = await import("#control/HeatmapControl/ui.js");
    window.localStorage.clear();

    // No persisted record here — the guard is open on first open, so
    // this case is the pure test of the length rule itself.  If the
    // length === 1 check regresses, the first layer would be picked.
    const m = makeManager();
    window.map.foliplus.LayerAPI.getLayersByType = vi.fn(() => [
      { id: "a", name: "A", layer: {} },
      { id: "b", name: "B", layer: {} },
    ]);
    window.map.foliplus.LayerAPI.extractPoints = vi.fn(() => [
      { lat: 1, lng: 2, marker: {} },
    ]);
    expect(m.loadSavedConfig()).toBeNull();
    const ctrl = makeCtrl(m);
    const renderSpy = vi.spyOn(m, "renderHexagons");
    initScan(ctrl);

    expect(m.selectedLayerId).toBeNull();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("allows auto-select again after Reset deleted the record", async () => {
    // Reset (clearSavedConfig) deletes the record entirely — this is the
    // deliberate back-to-declared-state path. Gate 3 proves the fix does
    // not conflate explicit-clear with Reset.
    const { initScan } = await import("#control/HeatmapControl/ui.js");
    window.localStorage.clear();

    const m1 = makeManager();
    seedLonely();
    m1.selectedLayerId = "lonely";
    m1.saveConfig();
    m1.flush();
    m1.clearSavedConfig();
    expect(window.localStorage.getItem(CONST.STORAGE.KEY)).toBeNull();

    // Fresh manager, no record → applySavedConfig never runs → guard stays
    // open → the first open's single-layer auto-select fires.
    const m2 = makeManager();
    seedLonely();
    expect(m2.loadSavedConfig()).toBeNull();
    const c2 = makeCtrl(m2);
    const renderSpy = vi.spyOn(m2, "renderHexagons");
    initScan(c2);

    expect(m2.selectedLayerId).toBe("lonely");
    expect(renderSpy).toHaveBeenCalled();
  });
});
