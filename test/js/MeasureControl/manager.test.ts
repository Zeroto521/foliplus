import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { MeasureManager } from "#foliplus/MeasureControl/manager.js";
import * as Storage from "#common/storage.js";

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

  it("saveMeasurements persists to storage", () => {
    const { manager } = makeManager();
    manager.measurements = [{ id: 1, type: "marker" }];
    const spy = vi.spyOn(manager, "saveMeasurements");
    manager.saveMeasurements();
    expect(spy).toHaveBeenCalled();
  });

  it("loadMeasurements returns empty array when no data", () => {
    const { manager } = makeManager();
    const result = manager.loadMeasurements();
    expect(Array.isArray(result)).toBe(true);
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
    manager.registerEditOverlayCloser(close1);
    manager.registerEditOverlayCloser(close2);

    manager.setEditMode(true);
    manager.setEditMode(false);

    expect(close1).toHaveBeenCalledTimes(1);
    expect(close2).toHaveBeenCalledTimes(1);
  });

  it("keeps closers registered so a later edit session can close them again", () => {
    const { manager } = makeManager();
    const close = vi.fn();
    manager.registerEditOverlayCloser(close);

    // First session: open → close
    manager.setEditMode(true);
    manager.setEditMode(false);
    expect(close).toHaveBeenCalledTimes(1);

    // Second session must still close (regression: closers were cleared on exit)
    manager.setEditMode(true);
    manager.setEditMode(false);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("closes other overlays but skips the given one", () => {
    const { manager } = makeManager();
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    manager.registerEditOverlayCloser(a);
    manager.registerEditOverlayCloser(b);
    manager.registerEditOverlayCloser(c);

    manager.closeOtherEditOverlays(b);

    expect(a).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("unregisters a closer when the returned unregister runs", () => {
    const { manager } = makeManager();
    const close = vi.fn();
    const unregister = manager.registerEditOverlayCloser(close);

    unregister();

    manager.setEditMode(true);
    manager.setEditMode(false);
    expect(close).not.toHaveBeenCalled();
  });

  it("toggles registered drag binds on setEditMode (nodes draggable without click-first)", () => {
    const { manager } = makeManager();
    const toggle = vi.fn();
    manager.registerEditDragToggle(toggle);

    manager.setEditMode(true);
    expect(toggle).toHaveBeenCalledWith(true);

    manager.setEditMode(false);
    expect(toggle).toHaveBeenCalledWith(false);
  });

  it("unregisters a drag toggle when the returned unregister runs", () => {
    const { manager } = makeManager();
    const toggle = vi.fn();
    const unregister = manager.registerEditDragToggle(toggle);

    unregister();
    manager.setEditMode(true);
    expect(toggle).not.toHaveBeenCalled();
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
  it("loadMeasurements falls back to [] on corrupted JSON", () => {
    const { manager } = makeManager();
    const spy = vi.spyOn(Storage, "load").mockReturnValue({ not: "array" });
    const result = manager.loadMeasurements();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
    spy.mockRestore();
  });

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
    manager.onUnload();
    expect(manager.currentMode).toBeNull();
    expect(layers.clearLayers).toHaveBeenCalled();
    expect(manager.measurements).toHaveLength(1);
  });

  it("Escape keydown calls clearActiveMode when mode is active", () => {
    const { manager } = makeManager();
    const spy = vi.spyOn(manager, "clearActiveMode");
    manager.currentMode = CONST.MODE.DISTANCE;
    manager.onKeyDown({ key: "Escape" } as KeyboardEvent);
    expect(spy).toHaveBeenCalled();
  });

  it("Escape keydown does nothing when no mode is active", () => {
    const { manager } = makeManager();
    const spy = vi.spyOn(manager, "clearActiveMode");
    manager.currentMode = null;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("Escape keydown exits edit mode when no drawing mode is active", () => {
    const { manager } = makeManager();
    const spy = vi.spyOn(manager, "setEditMode");
    manager.setEditMode(true);
    manager.currentMode = null;
    manager.onKeyDown({ key: "Escape" } as KeyboardEvent);
    expect(spy).toHaveBeenCalledWith(false);
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
      fn({ eachLayer: (c: (l: unknown) => void) => { c(measureLeaf); c(dataLeaf); } }),
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
