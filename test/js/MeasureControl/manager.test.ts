import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { MeasureManager } from "#foliplus/MeasureControl/manager.js";

// Label-collision lifecycle tests mock the collision module. It must be
// hoisted + mocked before MeasureManager is imported, because manager.ts
// imports collision.js synchronously at module load.
const placeLabels = vi.hoisted(() => vi.fn(() => 0));

vi.mock("#foliplus/MeasureControl/collision.js", () => ({
  placeLabels,
  mapProjector: () => ({
    box: () => ({ x: 0, y: 0, w: 64, h: 18 }),
  }),
}));

// Hoistable mock for guardBlocked — allows per-test override to exercise the
// blocked-path in setMode() without affecting the real ensureModes/ModeManager
// that the interaction-lock tests depend on.
const modeMocks = vi.hoisted(() => ({
  guardBlocked: vi.fn(() => false),
}));

vi.mock("#core/mode.js", async () => {
  const real = (await vi.importActual("#core/mode.js")) as Record<string, unknown>;
  return {
    ...real,
    guardBlocked: modeMocks.guardBlocked,
  };
});
// Shared mock LayerAPI factory — builds a CreateLayersAPI with spy methods.
function mockLayerAPI() {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    clearLayers: vi.fn(),
    addLayer: vi.fn(l => l),
    removeLayer: vi.fn(),
    mainLayer: { addLayer: vi.fn() },
  };
}

function makeManager(opts?: { id?: string }) {
  window.CONF = {
    ...window.CONF,
    name: "MeasureControl",
    locale_code: "en",
  };

  const layers = mockLayerAPI();

  // Mock L marker / circleMarker / divIcon for mode.ts side effects
  const mkMarker = () => {
    const m: any = {
      bindPopup: vi.fn(() => m),
      openPopup: vi.fn(),
      addTo: vi.fn(() => m),
      getPopup: () => null,
      setPopupContent: vi.fn(),
      closePopup: vi.fn(),
      getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
      setLatLng: vi.fn(),
      getElement: vi.fn(() => null),
    };
    m.on = vi.fn(() => m);
    m.off = vi.fn(() => m);
    return m;
  };
  window.L.marker = vi.fn(mkMarker);
  window.L.circleMarker = vi.fn(() => ({}));
  window.L.divIcon = vi.fn(() => ({}));
  window.L.polyline = vi.fn(() => ({ addTo: vi.fn(), on: vi.fn() }));
  window.L.polygon = vi.fn(() => ({ addTo: vi.fn(), on: vi.fn() }));
  window.L.latLng = vi.fn((lat, lng) => ({ lat, lng }));

  const container = document.createElement("div");
  const map = {
    getContainer: () => container,
    getCenter: () => ({ lat: 26.08, lng: 119.3 }),
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
    foliplus: {
      showHint: vi.fn(),
      hideHint: vi.fn(),
      LayerAPI: {
        createLayers: vi.fn(() => layers),
      },
    },
  };

  const manager = new MeasureManager(map, opts);
  return { manager, map, container, layers };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("MeasureManager — persistence", () => {
  it("restoreMeasurements emits LAYER_ITEM_COUNT_CHANGE so LayerControl refreshes count on load", () => {
    const { manager } = makeManager();
    const bus = ensureEvents(manager.map);
    const handler = vi.fn();
    bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);
    // Direct call (after constructor already emitted once).
    manager.restoreMeasurements();
    expect(handler).toHaveBeenCalledWith({ id: manager.layerId });
  });

  it("nextMeasurementId increments counter and includes type", () => {
    const { manager } = makeManager();
    const id1 = manager.nextMeasurementId("distance");
    const id2 = manager.nextMeasurementId("distance");
    expect(id1).toContain("distance");
    expect(id2).not.toBe(id1);
  });

  it("featureCountProvider reports the live measurement count to LayerControl", () => {
    const { manager, map } = makeManager();
    const opts = map.foliplus.LayerAPI.createLayers.mock.calls[0][0];
    manager.measurements = [{}, {}, {}] as any;
    expect(opts.featureCountProvider()).toBe(3);
    manager.measurements = [] as any;
    expect(opts.featureCountProvider()).toBe(0);
  });

  it("restoreMeasurements stabilizes persisted measurements missing an id", () => {
    const { manager } = makeManager();
    // Seed localStorage with a legacy measurement that predates the id field.
    // restoreMeasurements must assign one before rebuilding so later
    // onUpdate/onDelete paths (which match by id) resolve correctly.
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify([{ type: "marker", lng: 121, lat: 31 }]),
    );
    manager.restoreMeasurements();
    const m = manager.measurements[0];
    expect(m.id).toBeDefined();
    expect(typeof m.id).toBe("string");
    // The stabilized id is persisted back to localStorage.
    const persisted = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!);
    expect(persisted[0].id).toBe(m.id);
  });

  it("saveMeasurements persists to storage", () => {
    const { manager } = makeManager();
    manager.measurements = [{ id: 1, type: "marker" }];
    const spy = vi.spyOn(manager, "saveMeasurements");
    manager.saveMeasurements();
    expect(spy).toHaveBeenCalled();
  });
});

describe("MeasureManager — mode switching", () => {
  it("setMode CLEAR clears all measurements", () => {
    const { manager } = makeManager();
    const clearSpy = vi.spyOn(manager, "clearAll");
    manager.setMode(CONST.MODE.CLEAR);
    expect(clearSpy).toHaveBeenCalled();
  });

  it("setMode to same active mode clears it", () => {
    const { manager } = makeManager();
    manager.currentMode = CONST.MODE.MARKER;
    const clearSpy = vi.spyOn(manager, "clearActiveMode");
    manager.setMode(CONST.MODE.MARKER);
    expect(clearSpy).toHaveBeenCalled();
  });

  it("clearActiveMode resets currentMode and hides hints", () => {
    const { manager } = makeManager();
    manager.currentMode = CONST.MODE.DISTANCE;
    manager.clearActiveMode();
    expect(manager.currentMode).toBeNull();
    expect(manager.map.foliplus!.hideHint).toHaveBeenCalled();
  });

  it("clearAll clears layers and measurements", () => {
    const { manager, layers } = makeManager();
    manager.measurements = [{ id: 1 }];
    manager.clearAll();
    expect(layers.clearLayers).toHaveBeenCalled();
    expect(manager.measurements).toHaveLength(0);
  });

  it("setMode toggles active class on matching tool button", () => {
    const { manager } = makeManager();
    const btn = document.createElement("button");
    btn.dataset.mode = CONST.MODE.MARKER;
    manager.toolBtns = [btn];
    manager.setMode(CONST.MODE.MARKER);
    expect(btn.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
  });

  it("keeps the mode hint visible after entering a drawing mode (regression)", () => {
    const { manager } = makeManager();
    manager.setMode(CONST.MODE.DISTANCE);
    // The start hint must persist until the mode is cleared. setMode shows it
    // AFTER cleanMapEvents hides any previous hint, so showHint must be the
    // last hint operation (previously a trailing hideHint swallowed it).
    expect(manager.map.foliplus!.showHint).toHaveBeenCalledWith(
      "MeasureControl",
      expect.any(String),
      expect.anything(),
    );
    const showOrder = manager.map.foliplus!.showHint.mock.invocationCallOrder[0];
    const hideOrder = manager.map.foliplus!.hideHint.mock.invocationCallOrder[0];
    expect(showOrder).toBeGreaterThan(hideOrder);
  });

  it("leaves modeInstance null when setMode is given an unknown mode name", () => {
    // An unknown mode string passes the guard but has no entry in MODE_MAP, so
    // setMode must not throw and modeInstance stays null instead of a runtime
    // error on modeInstance.start().
    const { manager } = makeManager();
    expect(() => manager.setMode("nonexistent-mode")).not.toThrow();
    expect(manager.modeInstance).toBeNull();
  });

  it("clears an active drawing mode when leaving edit mode via clearActiveMode", () => {
    // Regression surface: clearActiveMode (called by the LAYER_REMOVED handler)
    // must exit edit mode before clearing the drawing mode, otherwise edit
    // handles linger while the drawing mode is deactivated.
    // Note: setMode(DISTANCE) exits edit mode on its own (line 232) before
    // entering the drawing mode, so that normal flow never leaves us in the
    // (isEditMode=true, currentMode=distance) state; we synthesize that state
    // here to exercise the clearActiveMode branch.
    const { manager } = makeManager();
    manager.setEditMode(true);
    manager.currentMode = CONST.MODE.DISTANCE;

    const spy = vi.spyOn(manager, "setEditMode");

    manager.clearActiveMode();

    expect(spy).toHaveBeenCalledWith(false);
    expect(manager.currentMode).toBeNull();
    expect(manager.isEditMode).toBe(false);
  });
});

describe("MeasureManager — setEditMode", () => {
  it("shows the edit hint and activates the edit button when enabled", () => {
    const { manager } = makeManager();
    const editBtn = document.createElement("button");
    editBtn.dataset.mode = CONST.MODE.EDIT;
    const otherBtn = document.createElement("button");
    otherBtn.dataset.mode = CONST.MODE.DISTANCE;
    manager.toolBtns = [editBtn, otherBtn];

    manager.setEditMode(true);

    expect(manager.isEditMode).toBe(true);
    expect(editBtn.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
    expect(otherBtn.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
    expect(manager.map.foliplus!.showHint).toHaveBeenCalledWith(
      "MeasureControl",
      expect.any(String),
      expect.anything(),
    );
  });

  it("toggles the EDITING class on the map container for cursor styling", () => {
    const { manager, container } = makeManager();
    expect(container.classList.contains(CONST.CLASSES.EDITING)).toBe(false);

    manager.setEditMode(true);
    expect(container.classList.contains(CONST.CLASSES.EDITING)).toBe(true);

    manager.setEditMode(false);
    expect(container.classList.contains(CONST.CLASSES.EDITING)).toBe(false);
  });

  it("hides the hint and deactivates the edit button when disabled", () => {
    const { manager } = makeManager();
    const editBtn = document.createElement("button");
    editBtn.dataset.mode = CONST.MODE.EDIT;
    manager.toolBtns = [editBtn];
    manager.setEditMode(true);
    manager.map.foliplus!.showHint.mockClear();

    manager.setEditMode(false);

    expect(manager.isEditMode).toBe(false);
    expect(editBtn.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
    expect(manager.map.foliplus!.hideHint).toHaveBeenCalled();
    expect(manager.map.foliplus!.showHint).not.toHaveBeenCalled();
  });

  it("is idempotent for the same state", () => {
    const { manager } = makeManager();
    manager.setEditMode(true);
    manager.map.foliplus!.showHint.mockClear();
    manager.setEditMode(true); // no-op
    expect(manager.map.foliplus!.showHint).not.toHaveBeenCalled();
  });

  it("closes registered overlays when disabled", () => {
    const { manager } = makeManager();
    const close1 = vi.fn();
    const close2 = vi.fn();
    manager.registerEditOverlayCloser(close1, "m1");
    manager.registerEditOverlayCloser(close2, "m2");

    manager.setEditMode(true);
    manager.setEditMode(false);

    expect(close1).toHaveBeenCalledTimes(1);
    expect(close2).toHaveBeenCalledTimes(1);
  });

  it("keeps closers registered so a later edit session can close them again", () => {
    const { manager } = makeManager();
    const close = vi.fn();
    manager.registerEditOverlayCloser(close, "m1");

    // First session: open → close
    manager.setEditMode(true);
    manager.setEditMode(false);
    expect(close).toHaveBeenCalledTimes(1);

    // Second session must still close (regression: closers were cleared on exit)
    manager.setEditMode(true);
    manager.setEditMode(false);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("closes other overlays but skips the one keyed by the given id", () => {
    const { manager } = makeManager();
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    manager.registerEditOverlayCloser(a, "m1");
    manager.registerEditOverlayCloser(b, "m2");
    manager.registerEditOverlayCloser(c, "m3");

    manager.closeOtherEditOverlays("m2");

    expect(a).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("unregisters a closer when the returned unregister runs", () => {
    const { manager } = makeManager();
    const close = vi.fn();
    const unregister = manager.registerEditOverlayCloser(close, "m1");

    unregister();

    manager.setEditMode(true);
    manager.setEditMode(false);
    expect(close).not.toHaveBeenCalled();
  });

  it("toggles registered drag binds on setEditMode (nodes draggable without click-first)", () => {
    const { manager } = makeManager();
    const toggle = vi.fn();
    manager.registerEditDragToggle(toggle, "m1");

    manager.setEditMode(true);
    expect(toggle).toHaveBeenCalledWith(true);

    manager.setEditMode(false);
    expect(toggle).toHaveBeenCalledWith(false);
  });

  it("unregisters a drag toggle when the returned unregister runs", () => {
    const { manager } = makeManager();
    const toggle = vi.fn();
    const unregister = manager.registerEditDragToggle(toggle, "m1");

    unregister();
    manager.setEditMode(true);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("merges three registrations for one id into a single handle", () => {
    const { manager } = makeManager();
    manager.registerFinalized(vi.fn(), "m1");
    manager.registerEditOverlayCloser(vi.fn(), "m1");
    manager.registerEditDragToggle(vi.fn(), "m1");

    expect((manager as any).editHandles.size).toBe(1);
    expect((manager as any).editHandles.has("m1")).toBe(true);
  });

  it("keeps separate handles for different ids", () => {
    const { manager } = makeManager();
    manager.registerFinalized(vi.fn(), "m1");
    manager.registerEditOverlayCloser(vi.fn(), "m2");
    manager.registerEditDragToggle(vi.fn(), "m3");

    expect((manager as any).editHandles.size).toBe(3);
  });

  it("clearAll drops all handles and runs each dispose once", () => {
    const { manager } = makeManager();
    const d1 = vi.fn();
    const d2 = vi.fn();
    manager.registerFinalized(d1, "m1");
    manager.registerFinalized(d2, "m2");

    manager.clearAll();

    expect(d1).toHaveBeenCalledTimes(1);
    expect(d2).toHaveBeenCalledTimes(1);
    expect((manager as any).editHandles.size).toBe(0);
  });

  it("unregisterFinalized removes the handle (delete drops one entry)", () => {
    const { manager } = makeManager();
    manager.registerFinalized(vi.fn(), "m1");
    manager.registerEditOverlayCloser(vi.fn(), "m1");
    manager.registerEditDragToggle(vi.fn(), "m1");

    const unregister = manager.registerFinalized(vi.fn(), "m1");
    expect((manager as any).editHandles.size).toBe(1);

    unregister();
    expect((manager as any).editHandles.size).toBe(0);
  });

  it("registers under ANON_HANDLE when no id is given (fallback)", () => {
    const { manager } = makeManager();
    manager.registerFinalized(vi.fn());

    const handles = (manager as any).editHandles;
    expect(handles.size).toBe(1);
    expect(handles.has(" anon-edit-handle")).toBe(true);
  });

  it("clearAll runs dispose but NOT closeOverlay or toggleDrag", () => {
    const { manager } = makeManager();
    const dispose = vi.fn();
    const closeOverlay = vi.fn();
    const toggleDrag = vi.fn();
    manager.registerFinalized(dispose, "m1");
    manager.registerEditOverlayCloser(closeOverlay, "m1");
    manager.registerEditDragToggle(toggleDrag, "m1");

    manager.clearAll();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(closeOverlay).not.toHaveBeenCalled();
    expect(toggleDrag).not.toHaveBeenCalled();
  });

  it("setMode EDIT enters edit mode when off", () => {
    const { manager } = makeManager();
    manager.measurements = [{ id: "m1", type: "marker" }];
    manager.setMode(CONST.MODE.EDIT);
    expect(manager.isEditMode).toBe(true);
  });

  it("setMode EDIT exits edit mode when already on (toggle)", () => {
    const { manager } = makeManager();
    manager.isEditMode = true;
    manager.setMode(CONST.MODE.EDIT);
    expect(manager.isEditMode).toBe(false);
  });

  it("setMode EDIT cancels an active drawing mode (mutual exclusivity)", () => {
    const { manager } = makeManager();
    manager.measurements = [{ id: "m1", type: "marker" }];
    manager.currentMode = CONST.MODE.DISTANCE;
    const clearSpy = vi.spyOn(manager, "clearActiveMode");

    manager.setMode(CONST.MODE.EDIT);

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(manager.isEditMode).toBe(true);
  });

  it("setMode EDIT does not enter edit mode when there is nothing to edit", () => {
    const { manager } = makeManager();
    manager.measurements = [];

    manager.setMode(CONST.MODE.EDIT);

    expect(manager.isEditMode).toBe(false);
    expect(manager.map.foliplus!.showHint).toHaveBeenCalledWith(
      "MeasureControl",
      expect.any(String),
      expect.anything(),
    );
  });

  it("setMode drawing cancels edit mode (mutual exclusivity)", () => {
    const { manager } = makeManager();
    manager.setEditMode(true);

    manager.setMode(CONST.MODE.DISTANCE);

    expect(manager.isEditMode).toBe(false);
    expect(manager.currentMode).toBe(CONST.MODE.DISTANCE);
  });

  it("setMode drawing returns early when another component holds the map (blocked)", () => {
    const { manager } = makeManager();
    modeMocks.guardBlocked.mockReturnValue(true);

    manager.setMode(CONST.MODE.DISTANCE);

    expect(modeMocks.guardBlocked).toHaveBeenCalledWith(
      manager.map,
      "MeasureControl",
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ blockedBy: "ExportControl" })]),
    );
    expect(manager.currentMode).toBeNull();
    modeMocks.guardBlocked.mockReturnValue(false);
  });
});

describe("MeasureManager — lifecycle", () => {
  it("destroy unbinds map events", () => {
    const { manager, map } = makeManager();
    manager.destroy();
    expect(map.off).toHaveBeenCalled();
  });

  it("destroy is idempotent", () => {
    const { manager, map } = makeManager();
    manager.destroy();
    const calls = map.off.mock.calls.length;
    manager.destroy();
    expect(map.off.mock.calls.length).toBeGreaterThanOrEqual(calls);
  });
});

describe("MeasureManager — persistence edge cases", () => {
  it("clearAll collapses expanded panel when ctrl exists", () => {
    const { manager } = makeManager();
    const ctrl = document.createElement("div");
    ctrl.classList.add(CONST.CLASSES.EXPANDED);
    manager.ctrl = ctrl;
    manager.clearAll();
    expect(ctrl.classList.contains(CONST.CLASSES.COLLAPSED)).toBe(true);
  });

  it("clearAll is safe when ctrl is null", () => {
    const { manager } = makeManager();
    manager.ctrl = null;
    expect(() => manager.clearAll()).not.toThrow();
  });
});

describe("MeasureManager — global events", () => {
  it("onUnload clears active mode and layers without wiping measurements", () => {
    const { manager, map, layers } = makeManager();
    manager.measurements = [{ id: 1, type: "marker" }];
    manager.currentMode = CONST.MODE.DISTANCE;
    // onUnload is bound via this.map.on("unload", ...). Leaflet fires all
    // bound handlers on unload, so invoke every "unload" handler the manager
    // registered (InteractionManager's own unload cleanup runs first).
    const unloadHandlers = (map as any).on.mock.calls
      .filter(([ev]: [string]) => ev === "unload")
      .map((c: any[]) => c[1]);
    expect(unloadHandlers.length).toBeGreaterThanOrEqual(1);
    unloadHandlers.forEach((h: () => void) => h());
    expect(manager.currentMode).toBeNull();
    expect(layers.clearLayers).toHaveBeenCalled();
    expect(layers.unregister).toHaveBeenCalled();
    expect(layers.removeLayer).not.toHaveBeenCalled();
    expect(manager.measurements).toHaveLength(1);
  });

  it("Escape keydown calls clearActiveMode when mode is active", () => {
    const { manager } = makeManager();
    const spy = vi.spyOn(manager, "clearActiveMode");
    manager.currentMode = CONST.MODE.DISTANCE;
    // The Escape shortcut is registered via registerInteractions →
    // InteractionManager, which listens on document. Dispatch a real keydown
    // so the handler reaches onKeyDown through the real routing path.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(spy).toHaveBeenCalled();
  });

  it("Escape keydown does nothing when no mode is active", () => {
    const { manager } = makeManager();
    const spy = vi.spyOn(manager, "clearActiveMode");
    manager.currentMode = null;
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("Escape keydown exits edit mode when no drawing mode is active", () => {
    const { manager } = makeManager();
    const spy = vi.spyOn(manager, "setEditMode");
    manager.setEditMode(true);
    manager.currentMode = null;
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(spy).toHaveBeenCalledWith(false);
  });

  it("non-Escape keydown is ignored by the manager's keydown handler", () => {
    // The manager's onKeyDown only acts on Escape; every other key returns
    // early and must not clear mode or edit state.
    const { manager } = makeManager();
    const clearSpy = vi.spyOn(manager, "clearActiveMode");
    const editSpy = vi.spyOn(manager, "setEditMode");
    manager.currentMode = CONST.MODE.DISTANCE;
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(clearSpy).not.toHaveBeenCalled();
    expect(editSpy).not.toHaveBeenCalled();
  });
});

describe("MeasureManager — cleanMapEvents", () => {
  it("cleans up modeInstance and hides hints", () => {
    const { manager } = makeManager();
    const mode = { cleanup: vi.fn() } as any;
    manager.modeInstance = mode;
    manager.cleanMapEvents();
    expect(mode.cleanup).toHaveBeenCalled();
    expect(manager.modeInstance).toBeNull();
  });

  it("cleanMapEvents is safe when no modeInstance", () => {
    const { manager } = makeManager();
    expect(() => manager.cleanMapEvents()).not.toThrow();
  });
});

describe("MeasureManager — active Escape shortcut lifecycle", () => {
  it("setMode registers high-priority active-escape shortcut", () => {
    const { manager, map } = makeManager();
    manager.setMode(CONST.MODE.DISTANCE);

    const im = map.foliplus.interaction;
    // After setMode, the interaction manager has an active-escape registration
    const activeReg = im.shortcuts.find(
      (s: any) => s.component === "MeasureControl-escape-active",
    );
    expect(activeReg).toBeDefined();
    expect(activeReg.priority).toBe(1);
    expect(activeReg.key).toBe("Escape");
  });

  it("clearActiveMode unregisters active-escape shortcut", () => {
    const { manager, map } = makeManager();
    manager.setMode(CONST.MODE.DISTANCE);
    manager.clearActiveMode();

    const im = map.foliplus.interaction;
    const activeReg = im.shortcuts.find(
      (s: any) => s.component === "MeasureControl-escape-active",
    );
    expect(activeReg).toBeUndefined();
  });

  it("re-entering mode re-registers active-escape shortcut", () => {
    const { manager, map } = makeManager();
    manager.setMode(CONST.MODE.MARKER);
    manager.clearActiveMode();
    manager.setMode(CONST.MODE.POLYGON);

    const im = map.foliplus.interaction;
    const activeRegs = im.shortcuts.filter(
      (s: any) => s.component === "MeasureControl-escape-active",
    );
    expect(activeRegs).toHaveLength(1);
    expect(activeRegs[0].priority).toBe(1);
  });
});

describe("MeasureManager — export auto-clear", () => {
  it("EVENTS.MODE_CHANGE from ExportControl clears active mode and shows export_paused hint", () => {
    const { manager } = makeManager();
    manager.setMode("distance");
    expect(manager.currentMode).toBe("distance");
    const events = ensureEvents(manager.map);
    window.map.foliplus.showHint.mockClear();
    events.emit("foliplus:mode:change", {
      component: "ExportControl",
      mode: "selecting",
    });
    expect(manager.currentMode).toBeNull();
    expect(window.map.foliplus.showHint).toHaveBeenCalledWith(
      "MeasureControl",
      expect.stringContaining("export_paused"),
      expect.any(Number),
    );
  });

  it("EVENTS.MODE_CHANGE from ExportControl does nothing when no mode is active", () => {
    const { manager } = makeManager();
    expect(manager.currentMode).toBeNull();
    const events = ensureEvents(manager.map);
    expect(() =>
      events.emit("foliplus:mode:change", {
        component: "ExportControl",
        mode: "selecting",
      }),
    ).not.toThrow();
    expect(manager.currentMode).toBeNull();
  });

  it("EVENTS.MODE_CHANGE from other components does not clear measurement", () => {
    const { manager } = makeManager();
    manager.setMode("distance");
    const events = ensureEvents(manager.map);
    events.emit("foliplus:mode:change", {
      component: "FullscreenControl",
      mode: "fullscreen",
    });
    expect(manager.currentMode).toBe("distance");
  });
});

// ==================== Layer lifecycle cleanup ====================
describe("MeasureManager — EVENTS.LAYER_REMOVED auto-cleanup", () => {
  it("clears active mode when own layer is removed via EVENTS.LAYER_REMOVED event", () => {
    const { manager, map } = makeManager();
    manager.currentMode = CONST.MODE.DISTANCE;
    const clearSpy = vi.spyOn(manager, "clearActiveMode");

    // Simulate the LayerControl panel deleting the measure layer
    const bus = map.foliplus!.events;
    bus.emit(EVENTS.LAYER_REMOVED, { id: manager.layerId });

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(manager.currentMode).toBeNull();
  });

  it("does NOT react when a different layer is removed", () => {
    const { manager, map } = makeManager();
    manager.currentMode = CONST.MODE.DISTANCE;
    const clearSpy = vi.spyOn(manager, "clearActiveMode");

    const bus = map.foliplus!.events;
    bus.emit(EVENTS.LAYER_REMOVED, { id: "some_other_layer" });

    expect(clearSpy).not.toHaveBeenCalled();
    expect(manager.currentMode).toBe(CONST.MODE.DISTANCE);
  });

  it("does NOT react when EVENTS.LAYER_REMOVED has no id payload", () => {
    const { manager, map } = makeManager();
    manager.currentMode = CONST.MODE.DISTANCE;
    const clearSpy = vi.spyOn(manager, "clearActiveMode");

    const bus = map.foliplus!.events;
    bus.emit(EVENTS.LAYER_REMOVED, {});

    expect(clearSpy).not.toHaveBeenCalled();
    expect(manager.currentMode).toBe(CONST.MODE.DISTANCE);
  });

  it("does NOT react when EVENTS.LAYER_REMOVED is called with undefined payload", () => {
    const { manager, map } = makeManager();
    manager.currentMode = CONST.MODE.DISTANCE;
    const clearSpy = vi.spyOn(manager, "clearActiveMode");

    const bus = map.foliplus!.events;
    bus.emit(EVENTS.LAYER_REMOVED);

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("destroy unsubscribes from EVENTS.LAYER_REMOVED (no reaction after destroy)", () => {
    const { manager, map } = makeManager();
    manager.currentMode = CONST.MODE.DISTANCE;

    const clearSpy = vi.spyOn(manager, "clearActiveMode");
    manager.destroy();
    // destroy() itself calls clearActiveMode() via clearAll(); reset the spy
    // so we can assert the EVENTS.LAYER_REMOVED handler no longer fires.
    clearSpy.mockClear();

    const bus = map.foliplus!.events;
    bus.emit(EVENTS.LAYER_REMOVED, { id: manager.layerId });

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("works with namespaced layer ID (opts.id)", () => {
    const { manager, map } = makeManager({ id: "map2" });
    expect(manager.layerId).toBe("foliplus_measure_map2");
    manager.currentMode = CONST.MODE.DISTANCE;
    const clearSpy = vi.spyOn(manager, "clearActiveMode");

    const bus = map.foliplus!.events;
    bus.emit(EVENTS.LAYER_REMOVED, { id: "foliplus_measure_map2" });
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(manager.currentMode).toBeNull();
  });

  it("ignores default ID when using namespaced layer ID", () => {
    const { manager, map } = makeManager({ id: "map2" });
    manager.currentMode = CONST.MODE.DISTANCE;
    const clearSpy = vi.spyOn(manager, "clearActiveMode");

    const bus = map.foliplus!.events;
    bus.emit(EVENTS.LAYER_REMOVED, { id: "foliplus_measure" });
    expect(clearSpy).not.toHaveBeenCalled();
    expect(manager.currentMode).toBe(CONST.MODE.DISTANCE);
  });
});

describe("MeasureManager — export click", () => {
  it("bindExportClick registers the click handler", () => {
    const { manager } = makeManager();
    const btn = document.createElement("button");
    expect(() => manager.bindExportClick(btn)).not.toThrow();
  });
});

// ==================== Measure-mode layer interaction lock (mode-driven) ====================
// The lock lives in core/mode ModeManager; these tests pin the MeasureManager
// integration: setMode/clearActiveMode flow through the centralized lock.
describe("MeasureManager — mode-driven layer interaction lock", () => {
  const makeTop = (leaf: unknown) => ({
    eachLayer: (fn: (l: unknown) => void) => fn(leaf),
  });

  const makeLeaf = (map: unknown, interactive = true) => {
    const el = document.createElement("path");
    if (interactive) el.classList.add("leaflet-interactive");
    return {
      leaf: {
        options: { interactive },
        _map: map,
        _path: el,
        _icon: undefined,
        _container: undefined,
        addInteractiveTarget: vi.fn(),
        removeInteractiveTarget: vi.fn(),
      },
      el,
    };
  };

  it("setMode suspends layer interaction and clearActiveMode restores it", () => {
    const { manager, map } = makeManager();
    const { leaf } = makeLeaf(map);
    map.eachLayer.mockImplementation((fn: (l: unknown) => void) => fn(makeTop(leaf)));

    manager.setMode(CONST.MODE.MARKER);
    expect(leaf.options.interactive).toBe(false);
    expect(leaf.removeInteractiveTarget).toHaveBeenCalled();

    manager.clearActiveMode();
    expect(leaf.options.interactive).toBe(true);
    expect(leaf.addInteractiveTarget).toHaveBeenCalled();
  });

  it("switching measure modes keeps the existing suspension (no double walk)", () => {
    const { manager, map } = makeManager();
    const { leaf } = makeLeaf(map);
    map.eachLayer.mockImplementation((fn: (l: unknown) => void) => fn(makeTop(leaf)));

    manager.setMode(CONST.MODE.MARKER);
    const callsAfterFirst = map.eachLayer.mock.calls.length;
    expect(callsAfterFirst).toBe(1);

    manager.setMode(CONST.MODE.DISTANCE);
    // Already suspended by ModeManager → no second walk.
    expect(map.eachLayer.mock.calls.length).toBe(callsAfterFirst);
    expect(leaf.options.interactive).toBe(false);
  });

  it("a non-interactive layer is left untouched", () => {
    const { manager, map } = makeManager();
    const { leaf } = makeLeaf(map, false);
    map.eachLayer.mockImplementation((fn: (l: unknown) => void) => fn(makeTop(leaf)));

    manager.setMode(CONST.MODE.MARKER);
    expect(leaf.removeInteractiveTarget).not.toHaveBeenCalled();
    expect(() => manager.clearActiveMode()).not.toThrow();
  });

  it("edit mode suspends data layers but keeps measurement layers interactive", () => {
    const { manager, map } = makeManager();
    const { leaf: measureLeaf } = makeLeaf(map);
    measureLeaf.options.pane = "measure_graph";
    const { leaf: dataLeaf } = makeLeaf(map);
    dataLeaf.options.pane = "overlayPane";
    map.eachLayer.mockImplementation((fn: (l: unknown) => void) =>
      fn({
        eachLayer: (c: (l: unknown) => void) => {
          c(measureLeaf);
          c(dataLeaf);
        },
      }),
    );

    manager.setEditMode(true);
    expect(dataLeaf.options.interactive).toBe(false);
    expect(dataLeaf.removeInteractiveTarget).toHaveBeenCalled();
    expect(measureLeaf.options.interactive).toBe(true); // kept draggable/clickable

    manager.setEditMode(false);
    expect(dataLeaf.options.interactive).toBe(true);
    expect(dataLeaf.addInteractiveTarget).toHaveBeenCalled();
  });
});

it("onExportClick triggers the export flow", () => {
  const { manager } = makeManager();
  // mock handleExportClick to avoid full export DOM
  const event = { stopPropagation: vi.fn() } as any;
  expect(() => manager.onExportClick(event)).not.toThrow();
  expect(event.stopPropagation).toHaveBeenCalled();
});

describe("MeasureManager — onMapClick handler", () => {
  it("hides del icons when clicking empty map space", () => {
    const { manager } = makeManager();
    // the onMapClick handler is bound during bindGlobalEvents
    // find the click handler on the map
    const clickHandler = manager.map.on.mock.calls.find(
      ([ev]: [string]) => ev === "click",
    )?.[1];
    expect(clickHandler).toBeDefined();
    // Simulate a click with a non-del-icon target
    const event = { originalEvent: { target: document.createElement("div") } } as any;
    expect(() => clickHandler(event)).not.toThrow();
  });

  it("does NOT exit edit mode when clicking empty space", () => {
    const { manager } = makeManager();
    manager.setEditMode(true);
    expect(manager.isEditMode).toBe(true);

    const handler = manager.map.on.mock.calls.find(
      ([ev]: [string]) => ev === "click",
    )?.[1];

    // Empty-space click with a plain target
    const event = {
      originalEvent: { target: document.createElement("div") },
    } as any;
    handler(event);

    // Edit mode stays on; the click is handled by each overlay's own
    // map-click handler, not the manager.
    expect(manager.isEditMode).toBe(true);
  });

  it("ignores a del-icon click in edit mode", () => {
    const { manager } = makeManager();
    manager.setEditMode(true);

    const clickHandler = manager.map.on.mock.calls.find(
      ([ev]: [string]) => ev === "click",
    )?.[1];

    const delBtn = document.createElement("button");
    delBtn.classList.add("foliplus-measure-delete");
    const event = {
      originalEvent: { target: delBtn },
    } as any;
    clickHandler(event);

    // A del-icon click must not reach the empty-space path.
    expect(manager.isEditMode).toBe(true);
  });
});

// ==================== Label-collision lifecycle ====================
// End-to-end registerLabel flow: lazy map-event binding, next-frame placement
// plan, re-plan on label-set changes. The pure planner is tested in
// collision.test.ts; here we mock the collision module (hoisted at the top of
// this file) and only exercise the manager.
type CollidableLabel = {
  marker: L.Marker;
  priority: number;
};

// A real DOM chip nested inside a mock L.Marker so chipOf(marker) resolves.
function makeLabelMarker(): L.Marker {
  const chip = document.createElement("div");
  chip.className = "foliplus-measure-label";
  const icon = document.createElement("span");
  icon.appendChild(chip);
  const marker = {
    getElement: vi.fn(() => icon),
    on: vi.fn(),
    off: vi.fn(),
    setLatLng: vi.fn(),
  };
  return marker as unknown as L.Marker;
}

// requestAnimationFrame is unavailable in jsdom/node — defer each callback to
// the next microtask so it behaves like a real async paint frame. The
// manager's labelPlanFrame re-entrancy guard only works if the callback does
// NOT run synchronously on the same stack as the schedule call.
let labelRafQueue: Array<() => void> = [];
function flushRaf() {
  while (labelRafQueue.length) {
    const q = labelRafQueue;
    labelRafQueue = [];
    q.forEach(cb => cb());
  }
}

function makeLabelManager(conf: Partial<typeof window.CONF> = {}) {
  window.CONF = { name: "MeasureControl", locale_code: "en", ...conf };

  const layers = mockLayerAPI();
  const container = document.createElement("div");
  container.id = "test-map";
  const map = {
    getContainer: () => container,
    getCenter: () => ({ lat: 26.08, lng: 119.3 }),
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
    foliplus: {
      showHint: vi.fn(),
      hideHint: vi.fn(),
      LayerAPI: { createLayers: vi.fn(() => layers) },
    },
  };

  return { manager: new MeasureManager(map), map, container, layers };
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.L.marker = vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    getElement: vi.fn(() => null),
    setLatLng: vi.fn(),
  }));
  window.CONF.collide_labels = undefined;
  labelRafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    labelRafQueue.push(cb);
    return 1;
  });
  placeLabels.mockReset();
});

describe("MeasureManager — registerLabel lifecycle", () => {
  it("runs a placement plan on the next frame after registering a label", () => {
    const { manager } = makeLabelManager();
    const marker = makeLabelMarker();

    manager.registerLabel(marker, 60);

    flushRaf();
    expect(placeLabels).toHaveBeenCalledTimes(1);
    expect((placeLabels.mock.calls[0][0] as CollidableLabel[]).length).toBe(1);
  });

  it("passes the collide flag through to placeLabels", () => {
    const { manager } = makeLabelManager({ collide_labels: true });
    const marker = makeLabelMarker();
    manager.registerLabel(marker, 60);

    flushRaf();
    expect(placeLabels.mock.calls[0][2] as boolean).toBe(true);
  });

  it("passes collide=false through when detection is off", () => {
    const { manager } = makeLabelManager({ collide_labels: false });
    const marker = makeLabelMarker();
    manager.registerLabel(marker, 60);

    flushRaf();
    expect(placeLabels.mock.calls[0][2] as boolean).toBe(false);
  });

  it("labelsCollide reads collide_labels from CONF and defaults to true", () => {
    const { manager } = makeLabelManager();
    expect(manager.labelsCollide).toBe(true);

    window.CONF.collide_labels = false;
    expect(manager.labelsCollide).toBe(false);
  });

  it("forwards the marker and priority to the label passed into placeLabels", () => {
    const { manager } = makeLabelManager();
    const marker = makeLabelMarker();

    manager.registerLabel(marker, 60);

    flushRaf();
    const label = (placeLabels.mock.calls[0][0] as CollidableLabel[])[0]!;
    expect(label.marker).toBe(marker);
    expect(label.priority).toBe(60);
  });

  it("re-plans the live label set when a map-move event fires", () => {
    const { manager, map } = makeLabelManager();
    const marker = makeLabelMarker();

    manager.registerLabel(marker, 60);
    flushRaf();
    const initialCalls = placeLabels.mock.calls.length;

    const moveendCall = map.on.mock.calls.find(
      ([ev]: [string]) => ev === "moveend",
    )![1];

    moveendCall();
    flushRaf();
    expect(placeLabels.mock.calls.length).toBe(initialCalls + 1);
  });

  it("coalesces multiple same-frame registerLabel calls into one plan", () => {
    const { manager } = makeLabelManager();

    manager.registerLabel(makeLabelMarker(), 60);
    manager.registerLabel(makeLabelMarker(), 60);
    manager.registerLabel(makeLabelMarker(), 60);

    // Two rAF callbacks may be queued (the coalescing guard skips the
    // schedule work, but requestAnimationFrame is still called), so drain
    // them; placeLabels must run exactly once with all three labels.
    flushRaf();
    expect(placeLabels).toHaveBeenCalledTimes(1);
    expect((placeLabels.mock.calls[0][0] as CollidableLabel[]).length).toBe(3);
  });

  it("passes a runtime collide_labels flip through to the next plan", () => {
    const { manager, map } = makeLabelManager({ collide_labels: true });
    const marker = makeLabelMarker();
    manager.registerLabel(marker, 60);
    flushRaf();
    expect(placeLabels.mock.calls[0][2] as boolean).toBe(true);

    const moveendCall = map.on.mock.calls.find(
      ([ev]: [string]) => ev === "moveend",
    )![1];

    window.CONF.collide_labels = false;
    moveendCall();
    flushRaf();
    expect(placeLabels.mock.calls[1][2] as boolean).toBe(false);
  });

  it("re-plans a smaller set when a label is removed mid-measurement", () => {
    const { manager } = makeLabelManager();
    const a = makeLabelMarker();
    const b = makeLabelMarker();

    const unregisterA = manager.registerLabel(a, 60);
    flushRaf();
    expect((placeLabels.mock.calls[0][0] as CollidableLabel[]).length).toBe(1);

    manager.registerLabel(b, 60);
    flushRaf();
    expect((placeLabels.mock.calls[1][0] as CollidableLabel[]).length).toBe(2);

    unregisterA();
    flushRaf();

    expect(placeLabels).toHaveBeenCalledTimes(3);
    const last = placeLabels.mock.calls[2] as [CollidableLabel[]];
    expect(last[0].length).toBe(1);
    expect(last[0][0]!.marker).toBe(b);
  });

  it("skips the planner when the label set is empty after unregistering the last label", () => {
    // planLabels returns early when collidableLabels is empty; unregistering
    // the final label must not pass an empty array into the planner.
    const { manager } = makeLabelManager();
    const marker = makeLabelMarker();

    const unregister = manager.registerLabel(marker, 60);
    flushRaf();
    expect(placeLabels).toHaveBeenCalledTimes(1);

    unregister();
    flushRaf();

    expect(placeLabels).toHaveBeenCalledTimes(1);
  });
});

describe("MeasureManager — map event binding", () => {
  it("binds move/zoom/resize events lazily on the first label", () => {
    const { manager, map } = makeLabelManager();

    expect(map.on).not.toHaveBeenCalledWith("moveend", expect.any(Function));

    manager.registerLabel(makeLabelMarker(), 60);

    expect(map.on).toHaveBeenCalledWith("moveend", expect.any(Function));
    expect(map.on).toHaveBeenCalledWith("zoomend", expect.any(Function));
    expect(map.on).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("unbinds all map events when the last label is removed", () => {
    const { manager, map } = makeLabelManager();
    const marker = makeLabelMarker();

    const unregister = manager.registerLabel(marker, 60);
    flushRaf();

    unregister();
    flushRaf();

    expect(map.off).toHaveBeenCalledWith("moveend", expect.any(Function));
    expect(map.off).toHaveBeenCalledWith("zoomend", expect.any(Function));
    expect(map.off).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("keeps map events bound while a second label is still registered", () => {
    const { manager } = makeLabelManager();
    const a = makeLabelMarker();
    const b = makeLabelMarker();

    const unregisterA = manager.registerLabel(a, 60);
    flushRaf();
    manager.registerLabel(b, 60);
    flushRaf();

    unregisterA();
    flushRaf();

    expect(placeLabels).toHaveBeenCalledTimes(3);
    expect(manager.map.off).not.toHaveBeenCalledWith("moveend", expect.any(Function));
  });

  it("rebinds map events after a fresh register following a full unbind", () => {
    const { manager, map } = makeLabelManager();
    const marker = makeLabelMarker();

    const unregister = manager.registerLabel(marker, 60);
    flushRaf();
    unregister();
    flushRaf();

    const offBefore = map.off.mock.calls.length;

    manager.registerLabel(marker, 60);
    flushRaf();

    expect(map.on).toHaveBeenCalledWith("moveend", expect.any(Function));
    expect(map.on).toHaveBeenCalledWith("zoomend", expect.any(Function));
    expect(map.on).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(map.off.mock.calls.length).toBe(offBefore);
  });
});

describe("MeasureManager — label cleanup", () => {
  it("destroy clears the label set and unbinds map events", () => {
    const { manager, map } = makeLabelManager();
    const marker = makeLabelMarker();

    manager.registerLabel(marker, 60);
    flushRaf();

    manager.destroy();

    expect(map.off).toHaveBeenCalledWith("moveend", expect.any(Function));
    expect(map.off).toHaveBeenCalledWith("zoomend", expect.any(Function));
    expect(map.off).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("destroy tolerates an unflushed rAF — the pending plan runs against an empty set", () => {
    const { manager, map } = makeLabelManager();
    const marker = makeLabelMarker();
    placeLabels.mockClear();

    manager.registerLabel(marker, 60);
    // Do not flush rAF — leave a plan in flight.
    manager.destroy();

    // Now drain the pending rAF; it must not throw even though the manager
    // has cleared collidableLabels. planLabels() returns early (empty set) so
    // placeLabels is never reached.
    expect(() => flushRaf()).not.toThrow();
    expect(placeLabels).not.toHaveBeenCalled();
  });

  it("destroy unbinds map events safely even when no label was ever registered", () => {
    const { manager, map } = makeLabelManager();

    expect(() => manager.destroy()).not.toThrow();
    expect(map.off).not.toHaveBeenCalledWith("moveend", expect.any(Function));
  });
});
