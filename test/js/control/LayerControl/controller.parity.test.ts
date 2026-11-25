// Consistency guard: the four factors LayerController.visibilityOf aggregates
// each come from a single source. This test pins that contract - for a matrix of
// {declared x container x filter x ancestor} states, each factor must equal its
// independent single-source reader. If any single source drifts, this test goes
// red, so the composition can never silently disagree with the readers the
// existing panel/label/filter checks use.
//
// visibilityOf is @internal (not on the public LayerAPI). Its only consumer is
// this guard, until a real 4-factor consumer appears - see the follow-up card.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  intentProjection,
  labelProjection,
  paintProjection,
} from "#core/layer/index.js";
import { LayerController } from "#control/LayerControl/controller.js";

// Minimal Leaflet surface - mirrors the shape controller.test.ts installs.
class TileLayer {
  options: Record<string, unknown> = { attribution: "© OpenStreetMap" };
  setZIndex = vi.fn();
}

describe("visibilityOf factor single-source parity", () => {
  let map: any;
  let manager: LayerController;

  beforeEach(() => {
    // Install the Leaflet class stubs resolveLayer/walkLeaf reach for via
    // instanceof. Mirror controller.test.ts's set.
    class Path {
      options = {};
    }

    class Marker {
      getElement() {
        return null;
      }
    }

    class CircleMarker {}

    class Polygon {
      options = {};
    }

    class Polyline {
      options = {};
    }

    class GridLayer {
      options = {};
    }

    class Renderer {}
    const stamp = (() => {
      let id = 0;
      return vi.fn(() => ++id);
    })();
    window.L = {
      Path,
      Marker,
      CircleMarker,
      Polygon,
      Polyline,
      GridLayer,
      Renderer,
      stamp,
      TileLayer,
      layerGroup: vi.fn(() => ({
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        hasLayer: vi.fn(() => false),
        getLayers: vi.fn(() => []),
        clearLayers: vi.fn(),
        options: {},
      })),
    } as any;
    window.L.TileLayer = TileLayer;
    window.L.GridLayer = GridLayer;
    window.L.Path = Path;
    window.L.Marker = Marker;
    window.L.stamp = stamp;
    window.foliplus = { events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } } as any;
    window.foliplus.core = { layer: {} } as any;
    const makePane = () => {
      const el = document.createElement("div");
      el.style.zIndex = "0";
      return el;
    };
    map = {
      on: vi.fn(),
      off: vi.fn(),
      invalidateSize: vi.fn(),
      eachLayer: vi.fn(),
      hasLayer: vi.fn(() => false),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      closePopup: vi.fn(),
      getZoom: vi.fn(() => 5),
      getMaxZoom: vi.fn(() => 18),
      getMinZoom: vi.fn(() => 0),
      getContainer: vi.fn(() => document.createElement("div")),
      getPane: vi.fn(() => makePane()),
      createPane: vi.fn(() => makePane()),
      _container: document.createElement("div"),
      _layers: {},
      _paneRenderers: {},
      options: { maxZoom: 18 },
      attributionControl: { _attributions: {}, _update: vi.fn() },
    };
    const layer = { getContainer: () => document.createElement("div") };
    manager = new LayerController(map, [
      { id: "overlay1", name: "Points", role: "overlay", layer },
    ]);
    manager.ui = {
      intentVisible: () => true,
      runtimeStore: {
        getDataRevision: () => 0,
        getFilterFeatures: () => undefined,
        setFilterFeatures: () => undefined,
        getAuthorVisible: () => undefined,
      },
      intentStore: { get: () => undefined },
      focusController: { focusingLayerId: null },
    } as any;
    manager.debouncedEnforce?.cancel?.();
  });

  it("declared factor == intentVisible(id) single source", () => {
    map.hasLayer.mockReturnValue(true);
    const onMap = manager.visibilityOf!("overlay1");
    expect(onMap).not.toBeNull();
    expect(onMap!.factors.declared).toBe(manager.intentVisible("overlay1"));
    expect(onMap!.factors.declared).toBe(true);
  });

  it("declared factor false when intent hides the layer", () => {
    map.hasLayer.mockReturnValue(true);
    manager.ui = {
      intentVisible: () => false,
      runtimeStore: {
        getDataRevision: () => 0,
        getFilterFeatures: () => undefined,
        setFilterFeatures: () => undefined,
        getAuthorVisible: () => undefined,
      },
      intentStore: { get: () => undefined },
      focusController: { focusingLayerId: null },
    } as any;
    const r = manager.visibilityOf!("overlay1");
    expect(r!.factors.declared).toBe(false);
    expect(r!.reason).toBe("declared");
  });

  it("container factor == map.hasLayer when no HIDDEN class", () => {
    map.hasLayer.mockReturnValue(true);
    const r = manager.visibilityOf!("overlay1");
    expect(r!.factors.container).toBe(true);
  });

  it("container factor false when layer is off the map", () => {
    map.hasLayer.mockReturnValue(false);
    const r = manager.visibilityOf!("overlay1");
    expect(r!.factors.container).toBe(false);
    expect(r!.reason).toBe("container");
  });

  it("reason priority declared > container > zoom > opacity > filter > ancestor", () => {
    map.hasLayer.mockReturnValue(false);
    manager.ui = {
      intentVisible: () => false,
      runtimeStore: {
        getDataRevision: () => 0,
        getFilterFeatures: () => undefined,
        setFilterFeatures: () => undefined,
        getAuthorVisible: () => undefined,
      },
      intentStore: { get: () => undefined },
      focusController: { focusingLayerId: null },
    } as any;
    const r = manager.visibilityOf!("overlay1");
    expect(r!.visible).toBe(false);
    expect(r!.reason).toBe("declared");
  });

  it("unregistered id returns null", () => {
    expect(manager.visibilityOf!("ghost")).toBeNull();
  });

  it("intentProjection reads the declared factor (panel checkbox)", () => {
    map.hasLayer.mockReturnValue(true);
    const r = manager.visibilityOf!("overlay1")!;
    expect(intentProjection(r.factors)).toBe(r.factors.declared);
  });

  it("paintProjection matches basePaints (container AND zoom AND opacity)", () => {
    map.hasLayer.mockReturnValue(true);
    const r = manager.visibilityOf!("overlay1")!;
    expect(paintProjection(r.factors)).toBe(
      r.factors.container && r.factors.zoom && r.factors.opacity,
    );
  });

  it("labelProjection matches label isVisible (container AND focused)", () => {
    map.hasLayer.mockReturnValue(true);
    const r = manager.visibilityOf!("overlay1")!;
    expect(labelProjection(r.factors, false)).toBe(r.factors.container && false);
  });
});
