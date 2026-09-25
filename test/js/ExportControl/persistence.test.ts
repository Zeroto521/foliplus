import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/ExportControl/const.js";
import { ExportManager } from "#foliplus/ExportControl/manager.js";
import * as Storage from "#common/storage.js";

vi.mock("#common/locale.js", async () => {
  const real = await vi.importActual("#common/locale.js");
  const TABLES: Record<string, string> = {
    hint_restore: "Restored saved crop area",
    hint_locked: "Locked: resize with the handles",
    hint_unlocked: "Resize the crop area",
    status_exporting: "Exporting map...",
    status_progress: "Exporting map... ({pct}%)",
    status_success: "Export successful",
  };
  return {
    ...real,
    createScopedTranslator: (_conf: { name: string }) => (key: string) =>
      TABLES[key] ?? key,
  };
});

vi.mock("#core/mode.js", async () => {
  const real = (await vi.importActual("#core/mode.js")) as Record<string, unknown>;
  return {
    ...real,
    guardBlocked: vi.fn(() => false),
  };
});

// Persistence tests drive restoreFromSavedBounds via nextFrame (requestAnimationFrame),
// which doesn't tick under jsdom by default. Replacing nextFrame with an identity
// function runs the callback synchronously so assertions are deterministic.
const throttleMocks = vi.hoisted(() => {
  const callbacks: Array<() => void> = [];
  return { callbacks };
});

vi.mock("#common/throttle.js", async () => {
  const real = await vi.importActual("#common/throttle.js");
  return {
    ...real,
    nextFrame: (fn: () => void) => {
      throttleMocks.callbacks.push(fn);
      return () => {};
    },
  };
});

// geotiff bundles web-worker which cannot initialize under vitest --pool=threads.
vi.mock("geotiff", () => ({
  writeArrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
}));
vi.mock("pako", async () => vi.importActual("pako"));

function makeMapMock() {
  const container = document.createElement("div");
  return {
    getContainer: () => container,
    getBounds: () => ({
      getSouth: () => -90,
      getNorth: () => 90,
      getEast: () => 180,
      getWest: () => -180,
    }),
    latLngToContainerPoint: vi.fn(({ lat, lng }) => ({ x: lng, y: lat })),
    dragging: { disable: vi.fn(), enable: vi.fn() },
    scrollWheelZoom: { disable: vi.fn(), enable: vi.fn() },
    doubleClickZoom: { disable: vi.fn(), enable: vi.fn() },
    boxZoom: { disable: vi.fn(), enable: vi.fn() },
    keyboard: { disable: vi.fn(), enable: vi.fn() },
    touchZoom: { disable: vi.fn(), enable: vi.fn() },
    foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
  };
}

function makeManager() {
  window.CONF = { ...window.CONF, name: "ExportControl", timeout: 7500 };
  const manager = new ExportManager(makeMapMock());
  // Stub UI delegation so tests can drive cropState.savedGeoBounds directly
  // without depending on the DOM crop-box renderers.
  manager.showCropBox = vi.fn();
  manager.lockCropBox = vi.fn();
  manager.unlockCropBox = vi.fn();
  manager.removeCropBox = vi.fn();
  manager.updateBoxStyle = vi.fn();
  manager.showHintWithInfo = vi.fn();
  manager.showGlobalHint = vi.fn();
  return manager;
}

describe("persistenceMethods — loadSavedBounds guards", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("loadSavedBounds returns early when storage is empty", () => {
    const manager = makeManager();
    manager.savedBounds = {
      nw: { lat: 50, lng: 50 },
      se: { lat: 40, lng: 60 },
    };
    vi.spyOn(Storage, "loadRecord").mockReturnValue(null);
    manager.loadSavedBounds();
    expect(manager.savedBounds!.nw.lat).toBe(50);
  });

  it("loadSavedBounds returns early when saved record has no nw", () => {
    const manager = makeManager();
    manager.savedBounds = {
      nw: { lat: 50, lng: 50 },
      se: { lat: 40, lng: 60 },
    };
    vi.spyOn(Storage, "loadRecord").mockReturnValue({ se: { lat: 40, lng: 60 } });
    manager.loadSavedBounds();
    expect(manager.savedBounds!.nw.lat).toBe(50);
  });

  it("loadSavedBounds returns early when saved record has no se", () => {
    const manager = makeManager();
    manager.savedBounds = {
      nw: { lat: 50, lng: 50 },
      se: { lat: 40, lng: 60 },
    };
    vi.spyOn(Storage, "loadRecord").mockReturnValue({ nw: { lat: 50, lng: 50 } });
    manager.loadSavedBounds();
    expect(manager.savedBounds!.nw.lat).toBe(50);
  });

  it("loadSavedBounds rejects a saved record whose lat is out of bounds", () => {
    const manager = makeManager();
    manager.savedBounds = {
      nw: { lat: 50, lng: 50 },
      se: { lat: 40, lng: 60 },
    };
    // 120 exceeds ±90 lat cap; lat check trips.
    vi.spyOn(Storage, "loadRecord").mockReturnValue({
      nw: { lat: 120, lng: 100 },
      se: { lat: 100, lng: 110 },
    });
    manager.loadSavedBounds();
    expect(manager.savedBounds!.nw.lat).toBe(50);
  });

  it("loadSavedBounds rejects a saved record whose lng is out of bounds", () => {
    const manager = makeManager();
    manager.savedBounds = {
      nw: { lat: 50, lng: 50 },
      se: { lat: 40, lng: 60 },
    };
    // -200 exceeds ±180 lng cap; lng check trips while lat passes.
    vi.spyOn(Storage, "loadRecord").mockReturnValue({
      nw: { lat: 20, lng: -200 },
      se: { lat: 10, lng: -190 },
    });
    manager.loadSavedBounds();
    expect(manager.savedBounds!.nw.lat).toBe(50);
  });

  it("loadSavedBounds skips records that do not overlap the current map view", () => {
    const manager = makeManager();
    manager.savedBounds = {
      nw: { lat: 50, lng: 50 },
      se: { lat: 40, lng: 60 },
    };
    // Shift the mocked map's viewport to the southern hemisphere; the saved
    // northern bounds now fail the overlap check while still passing lat/lng.
    (manager.map as any).getBounds = () => ({
      getSouth: () => -90,
      getNorth: () => -50,
      getEast: () => 180,
      getWest: () => -180,
    });
    vi.spyOn(Storage, "loadRecord").mockReturnValue({
      nw: { lat: 20, lng: 100 },
      se: { lat: 10, lng: 110 },
    });
    manager.loadSavedBounds();
    expect(manager.savedBounds!.nw.lat).toBe(50);
  });

  it("loadSavedBounds accepts a record with valid lat/lng overlapping the map", () => {
    const manager = makeManager();
    manager.savedBounds = null;
    vi.spyOn(Storage, "loadRecord").mockReturnValue({
      nw: { lat: 20, lng: 100 },
      se: { lat: 10, lng: 110 },
    });
    manager.loadSavedBounds();
    expect(manager.savedBounds).toEqual({
      nw: { lat: 20, lng: 100 },
      se: { lat: 10, lng: 110 },
    });
  });
});

describe("persistenceMethods — saveBounds", () => {
  it("saveBounds persists the geo bounds under the component's storage key", () => {
    const manager = makeManager();
    const saveSpy = vi.spyOn(Storage, "saveRecord");
    manager.saveBounds({
      nw: { lat: 26.1, lng: 119.2 },
      se: { lat: 26.0, lng: 119.4 },
    });
    expect(saveSpy).toHaveBeenCalledWith(
      CONST.STORAGE.KEY,
      {
        nw: { lat: 26.1, lng: 119.2 },
        se: { lat: 26.0, lng: 119.4 },
      },
      "ExportControl",
    );
  });
});

describe("persistenceMethods — restoreFromSavedBounds", () => {
  let manager;

  beforeEach(() => {
    manager = makeManager();
    throttleMocks.callbacks.length = 0;
  });

  it("shows the crop box and schedules the saved-geo apply for the next frame", () => {
    manager.cropState = {
      rect: { left: 10, top: 10, width: 100, height: 100 },
      locked: false,
      box: document.createElement("div"),
      geoBounds: null,
    };
    manager.savedBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    manager.restoreFromSavedBounds();
    expect(manager.showCropBox).toHaveBeenCalledTimes(1);
    expect(throttleMocks.callbacks.length).toBe(1);
  });

  it("skips applying saved geo bounds when the crop state is missing", () => {
    manager.cropState = null;
    manager.savedBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    manager.restoreFromSavedBounds();
    // No-op: locked-crop branch fires but there's nothing to lock.
    expect(manager.lockCropBox).not.toHaveBeenCalled();
  });

  it("skips applying saved geo bounds when the crop state is already locked", () => {
    manager.cropState = {
      rect: { left: 10, top: 10, width: 100, height: 100 },
      locked: true,
      box: document.createElement("div"),
      geoBounds: null,
    };
    manager.savedBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    manager.restoreFromSavedBounds();
    expect(manager.lockCropBox).not.toHaveBeenCalled();
  });

  it("skips applying saved geo bounds when no saved bounds are present", () => {
    manager.cropState = {
      rect: { left: 10, top: 10, width: 100, height: 100 },
      locked: false,
      box: document.createElement("div"),
      geoBounds: null,
    };
    manager.savedBounds = null;
    manager.restoreFromSavedBounds();
    expect(manager.lockCropBox).not.toHaveBeenCalled();
  });

  it("locks the crop box, records saved geo bounds, and shows the restore hint on the happy path", () => {
    manager.cropState = {
      rect: { left: 10, top: 10, width: 100, height: 100 },
      locked: false,
      box: document.createElement("div"),
      geoBounds: null,
    };
    manager.savedBounds = {
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    };
    manager.restoreFromSavedBounds();
    expect(throttleMocks.callbacks.length).toBe(1);
    expect(manager.cropState!.savedGeoBounds).toBeUndefined();

    throttleMocks.callbacks[0]();

    expect(manager.cropState!.savedGeoBounds).toEqual({
      nw: { lat: 41.0, lng: -75.0 },
      se: { lat: 40.0, lng: -74.0 },
    });
    expect(manager.lockCropBox).toHaveBeenCalledWith(true);
    // restoreFromSavedBounds reads the IIFE free variable `map` (window.map in
    // tests), not the manager instance's map — the hint routes through the
    // per-map HintManager attached there, not this.map.foliplus.
    expect(window.map.foliplus!.showHint).toHaveBeenCalledWith(
      "ExportControl",
      expect.any(String),
      expect.any(Number),
      true,
    );
  });
});

describe("persistenceMethods — onMapChange", () => {
  let manager;

  beforeEach(() => {
    manager = makeManager();
  });

  it("onMapChange returns early when the crop state is missing", () => {
    manager.cropState = null;
    expect(() => manager.onMapChange()).not.toThrow();
    expect(manager.updateBoxStyle).not.toHaveBeenCalled();
  });

  it("onMapChange returns early when the crop is unlocked", () => {
    manager.cropState = {
      rect: { left: 10, top: 10, width: 100, height: 100 },
      locked: false,
      box: document.createElement("div"),
      geoBounds: null,
    };
    manager.onMapChange();
    expect(manager.updateBoxStyle).not.toHaveBeenCalled();
  });

  it("onMapChange recomputes the rect from geo bounds and re-checks the pixel limit", () => {
    manager.cropState = {
      rect: { left: 10, top: 10, width: 100, height: 100 },
      locked: true,
      box: document.createElement("div"),
      geoBounds: {
        nw: { lat: 41.0, lng: -75.0 },
        se: { lat: 40.0, lng: -74.0 },
      },
    };
    const checkPixelLimit = vi.spyOn(manager, "checkPixelLimit");
    manager.onMapChange();
    expect(manager.updateBoxStyle).toHaveBeenCalled();
    expect(manager.cropState!.rect.width).toBeGreaterThan(0);
    expect(checkPixelLimit).toHaveBeenCalledWith(manager.cropState!.rect);
    expect(manager.showHintWithInfo).toHaveBeenCalled();
  });

  it("onMapChange with skipHint=true suppresses the size hint update", () => {
    manager.cropState = {
      rect: { left: 10, top: 10, width: 100, height: 100 },
      locked: true,
      box: document.createElement("div"),
      geoBounds: {
        nw: { lat: 41.0, lng: -75.0 },
        se: { lat: 40.0, lng: -74.0 },
      },
    };
    manager.onMapChange(true);
    expect(manager.showHintWithInfo).not.toHaveBeenCalled();
  });
});

describe("persistenceMethods — lockMap / unlockMap", () => {
  let manager;

  beforeEach(() => {
    manager = makeManager();
  });

  it("lockMap disables every interaction mode on the map", () => {
    manager.lockMap();
    expect(manager.map.dragging.disable).toHaveBeenCalled();
    expect(manager.map.scrollWheelZoom.disable).toHaveBeenCalled();
    expect(manager.map.doubleClickZoom.disable).toHaveBeenCalled();
    expect(manager.map.boxZoom.disable).toHaveBeenCalled();
    expect(manager.map.keyboard.disable).toHaveBeenCalled();
    expect(manager.map.touchZoom.disable).toHaveBeenCalled();
  });

  it("unlockMap re-enables every interaction mode on the map", () => {
    manager.unlockMap();
    expect(manager.map.dragging.enable).toHaveBeenCalled();
    expect(manager.map.scrollWheelZoom.enable).toHaveBeenCalled();
    expect(manager.map.doubleClickZoom.enable).toHaveBeenCalled();
    expect(manager.map.boxZoom.enable).toHaveBeenCalled();
    expect(manager.map.keyboard.enable).toHaveBeenCalled();
    expect(manager.map.touchZoom.enable).toHaveBeenCalled();
  });

  it("lockMap returns early when the map reference is missing", () => {
    (manager as any).map = null;
    expect(() => manager.lockMap()).not.toThrow();
  });

  it("unlockMap returns early when the map reference is missing", () => {
    (manager as any).map = null;
    expect(() => manager.unlockMap()).not.toThrow();
  });
});
