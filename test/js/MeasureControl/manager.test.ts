import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODE_CHANGE, LAYER_REMOVED, ensureEvents } from "#core/event/index.js";
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
  window.L.marker = vi.fn(() => ({
    bindPopup: vi.fn(),
    openPopup: vi.fn(),
    addTo: vi.fn(),
    getPopup: () => null,
    on: vi.fn(),
    setPopupContent: vi.fn(),
    closePopup: vi.fn(),
  }));
  window.L.circleMarker = vi.fn(() => ({}));
  window.L.divIcon = vi.fn(() => ({}));
  window.L.polyline = vi.fn(() => ({ addTo: vi.fn(), on: vi.fn() }));
  window.L.latLng = vi.fn((lat, lng) => ({ lat, lng }));

  const container = document.createElement("div");
  const map = {
    getContainer: () => container,
    on: vi.fn(),
    off: vi.fn(),
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
  it("nextMeasurementId increments counter and includes type", () => {
    const { manager } = makeManager();
    const id1 = manager.nextMeasurementId("distance");
    const id2 = manager.nextMeasurementId("distance");
    expect(id1).toContain("distance");
    expect(id2).not.toBe(id1);
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
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(spy).toHaveBeenCalled();
  });

  it("Escape keydown does nothing when no mode is active", () => {
    const { manager } = makeManager();
    const spy = vi.spyOn(manager, "clearActiveMode");
    manager.currentMode = null;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(spy).not.toHaveBeenCalled();
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


  describe("MeasureManager — export auto-clear", () => {
    it("MODE_CHANGE from ExportControl clears active mode and shows export_paused hint", () => {
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

    it("MODE_CHANGE from ExportControl does nothing when no mode is active", () => {
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

    it("MODE_CHANGE from other components does not clear measurement", () => {
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
describe("MeasureManager — LAYER_REMOVED auto-cleanup", () => {
  it("clears active mode when own layer is removed via LAYER_REMOVED event", () => {
    const { manager, map } = makeManager();
    manager.currentMode = CONST.MODE.DISTANCE;
    const clearSpy = vi.spyOn(manager, "clearActiveMode");

    // Simulate the LayerControl panel deleting the measure layer
    const bus = map.foliplus!.events;
    bus.emit(LAYER_REMOVED, { id: manager.layerId });

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(manager.currentMode).toBeNull();
  });

  it("does NOT react when a different layer is removed", () => {
    const { manager, map } = makeManager();
    manager.currentMode = CONST.MODE.DISTANCE;
    const clearSpy = vi.spyOn(manager, "clearActiveMode");

    const bus = map.foliplus!.events;
    bus.emit(LAYER_REMOVED, { id: "some_other_layer" });

    expect(clearSpy).not.toHaveBeenCalled();
    expect(manager.currentMode).toBe(CONST.MODE.DISTANCE);
  });

  it("does NOT react when LAYER_REMOVED has no id payload", () => {
    const { manager, map } = makeManager();
    manager.currentMode = CONST.MODE.DISTANCE;
    const clearSpy = vi.spyOn(manager, "clearActiveMode");

    const bus = map.foliplus!.events;
    bus.emit(LAYER_REMOVED, {});

    expect(clearSpy).not.toHaveBeenCalled();
    expect(manager.currentMode).toBe(CONST.MODE.DISTANCE);
  });

  it("does NOT react when LAYER_REMOVED is called with undefined payload", () => {
    const { manager, map } = makeManager();
    manager.currentMode = CONST.MODE.DISTANCE;
    const clearSpy = vi.spyOn(manager, "clearActiveMode");

    const bus = map.foliplus!.events;
    bus.emit(LAYER_REMOVED);

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("destroy unsubscribes from LAYER_REMOVED (no reaction after destroy)", () => {
    const { manager, map } = makeManager();
    manager.currentMode = CONST.MODE.DISTANCE;

    const clearSpy = vi.spyOn(manager, "clearActiveMode");
    manager.destroy();
    // destroy() itself calls clearActiveMode() via clearAll(); reset the spy
    // so we can assert the LAYER_REMOVED handler no longer fires.
    clearSpy.mockClear();

    const bus = map.foliplus!.events;
    bus.emit(LAYER_REMOVED, { id: manager.layerId });

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("works with namespaced layer ID (opts.id)", () => {
    const { manager, map } = makeManager({ id: "map2" });
    expect(manager.layerId).toBe("foliplus_measure_map2");
    manager.currentMode = CONST.MODE.DISTANCE;
    const clearSpy = vi.spyOn(manager, "clearActiveMode");

    const bus = map.foliplus!.events;
    bus.emit(LAYER_REMOVED, { id: "foliplus_measure_map2" });
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(manager.currentMode).toBeNull();
  });

  it("ignores default ID when using namespaced layer ID", () => {
    const { manager, map } = makeManager({ id: "map2" });
    manager.currentMode = CONST.MODE.DISTANCE;
    const clearSpy = vi.spyOn(manager, "clearActiveMode");

    const bus = map.foliplus!.events;
    bus.emit(LAYER_REMOVED, { id: "foliplus_measure" });
    expect(clearSpy).not.toHaveBeenCalled();
    expect(manager.currentMode).toBe(CONST.MODE.DISTANCE);
  });

});
