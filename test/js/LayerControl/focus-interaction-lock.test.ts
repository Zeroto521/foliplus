import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui.js";

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

// Match the exact specifier LayerControl/ui.ts uses; both "#core/mode.js" and
// "#foliplus/core/mode.js" resolve to the same file, but mocking the alias
// specifier prevents future alias changes from silently breaking this test.
vi.mock("#core/mode.js", () => ({
  ensureModes: modeMocks.ensureModes,
  guardBlocked: modeMocks.guardBlocked,
  ModeManager: modeMocks.ModeManager,
}));

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

const initFixture = (): { manager: LayerManager; ui: LayerUI; map: any } => {
  window.CONF.name = "LayerControl";
  window.CONF.locale_code = "en";

  window.L.TileLayer = TileLayer;
  window.L.GridLayer = GridLayer;
  window.L.Renderer = class {};
  window.L.Path = class {
    options = {};
  };
  window.L.Polygon = class {
    options = {};
  };
  window.L.Polyline = class {
    options = {};
  };
  window.L.Marker = class {};
  window.L.CircleMarker = class CircleMarker {
    constructor(_latlng: any, _opts: any) {}
    addTo(_map: any) {
      return this;
    }
  };
  window.L.stamp = vi.fn(() => 1);
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
  window.L.latLngBounds = vi.fn(() => ({
    isValid: () => true,
    extend: () => ({ isValid: () => true }),
    getSouthWest: () => ({ lat: 30, lng: 100 }),
    getNorthEast: () => ({ lat: 40, lng: 110 }),
  })) as unknown as typeof L.latLngBounds;

  const container = document.createElement("div");
  document.body.appendChild(container);

  const bounds = {
    isValid: vi.fn(() => true),
    getSouthWest: () => ({ lat: 30, lng: 100 }),
    getNorthEast: () => ({ lat: 40, lng: 110 }),
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
    eachLayer: vi.fn(),
    hasLayer: vi.fn(() => true),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    getZoom: vi.fn(() => 5),
    getMaxZoom: vi.fn(() => 18),
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
  const container2 = document.createElement("div");
  document.body.appendChild(container2);
  manager.attachUI(container2);
  const ui = manager.ui!;

  return { manager, ui, map };
};

// ===========================================================================
describe("LayerUI focusLayer() — interaction lock", () => {
  // Shorthands for the live mock spies. These are the SAME function objects
  // the code under test (focusLayer / dismissFocus) calls.
  const setModeSpy = modeMocks._setMode as ReturnType<typeof vi.fn>;
  const getModeSpy = modeMocks._getMode as ReturnType<typeof vi.fn>;
  const guardBlockedSpy = modeMocks.guardBlocked as ReturnType<typeof vi.fn>;

  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    modeMocks._reset();
    const fixture = initFixture();
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
      expect(window.L.rectangle).not.toHaveBeenCalled();
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
    let { manager, ui, map } = initFixture();

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
    const layer = ui.m.findLayer(ui.m.layerRegistry.get("overlay1")!);
    vi.spyOn(layer, "getBounds").mockReturnValue(tinyBounds);

    ui.focusLayer("overlay1");

    expect(map.flyTo).toHaveBeenCalled();
    expect(setModeSpy).toHaveBeenCalledWith("LayerControl", "focusing");
    expect(getModeSpy("LayerControl")).toBe("focusing");
  });
});
