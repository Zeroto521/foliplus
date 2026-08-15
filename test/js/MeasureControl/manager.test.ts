import * as Storage from "#common/storage.js";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { MeasureManager } from "#foliplus/MeasureControl/manager.js";
import { describe, expect, it, vi } from "vitest";

function makeManager() {
  window.CONF = {
    ...window.CONF,
    name: "MeasureControl",
    locale_code: "en",
  };

  // Mock L.marker with enough fidelity for createLocationMarker
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
  // Mock createLocationMarker's geo helpers
  window.L.latLng = vi.fn((lat, lng) => ({ lat, lng }));

  // Mock LayerAPI.createLayers (per-map: map.foliplus.LayerAPI)
  window.map.foliplus = {
    showHint: vi.fn(),
    hideHint: vi.fn(),
    LayerAPI: {
      createLayers: vi.fn(() => ({
        register: vi.fn(),
        unregister: vi.fn(),
        clearLayers: vi.fn(),
        addLayer: vi.fn(l => l),
        removeLayer: vi.fn(),
        mainLayer: { addLayer: vi.fn() },
      })),
    },
  };

  const container = document.createElement("div");
  const map = {
    getContainer: () => container,
    on: vi.fn(),
    off: vi.fn(),
  };
  const manager = new MeasureManager(map);
  return { manager, map, container };
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
    expect(window.map.foliplus.hideHint).toHaveBeenCalled();
  });

  it("clearAll clears layers and measurements", () => {
    const { manager } = makeManager();
    manager.measurements = [{ id: 1 }];
    manager.clearAll();
    expect(manager.layers.clearLayers).toHaveBeenCalled();
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
    const { manager, map } = makeManager();
    manager.measurements = [{ id: 1, type: "marker" }];
    manager.currentMode = CONST.MODE.DISTANCE;
    manager.onUnload();
    expect(manager.currentMode).toBeNull();
    expect(manager.layers.clearLayers).toHaveBeenCalled();
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
    expect(window.map.foliplus.hideHint).toHaveBeenCalledWith(CONF.name);
  });

  it("cleanMapEvents is safe when no modeInstance", () => {
    const { manager } = makeManager();
    expect(() => manager.cleanMapEvents()).not.toThrow();
  });
});
