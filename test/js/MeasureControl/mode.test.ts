import * as CONST from "#foliplus/MeasureControl/const.js";
import {
  CircleMode,
  DistanceMode,
  MODE_MAP,
  MarkerMode,
  MeasureMode,
  PolygonMode,
  PreviewMode,
} from "#foliplus/MeasureControl/mode.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
  window.L.circleMarker = vi.fn(() => ({
    bringToFront: vi.fn(),
    on: vi.fn(),
    getLatLng: vi.fn(() => ({ lat: 31, lng: 121 })),
  }));
  window.L.polyline = vi.fn(() => ({
    addLatLng: vi.fn(),
    setLatLngs: vi.fn(),
    getElement: vi.fn(() => null),
    on: vi.fn(),
  }));
  window.L.polygon = vi.fn(() => ({
    setLatLngs: vi.fn(),
  }));
  window.L.circle = vi.fn(() => ({
    setRadius: vi.fn(),
  }));
  window.L.marker = vi.fn(() => ({
    setLatLng: vi.fn(),
    setIcon: vi.fn(),
    on: vi.fn(),
    bringToFront: vi.fn(),
    getElement: vi.fn(() => null),
  }));
  window.L.divIcon = vi.fn(opts => ({ _mockDivIconHtml: opts?.html }));
  window.L.latLng = vi.fn((lat, lng) => ({ lat, lng }));
  window.L.DomEvent = {
    ...window.L.DomEvent,
    // Mimic Leaflet's real stopPropagation: it sets `_stopped` on the
    // original event, which _fireDOMEvent checks before propagating the
    // click to the map.
    stopPropagation: vi.fn(event => {
      if (event?.originalEvent) event.originalEvent._stopped = true;
    }),
  };
  globalThis.turf = {
    point: coords => ({ coords }),
    distance: vi.fn(() => 100),
    bearing: vi.fn(() => 45),
    midpoint: vi.fn(() => ({ geometry: { coordinates: [0, 0] } })),
    area: vi.fn(() => 1000),
  };
});

function makeManagerMock(): any {
  return {
    map: {
      on: vi.fn(),
      off: vi.fn(),
      getContainer: () => document.createElement("div"),
    },
    layers: { addLayer: vi.fn(l => l), removeLayer: vi.fn() },
    nextMeasurementId: vi.fn(() => "test-id"),
    saveMeasurements: vi.fn(),
    clearActiveMode: vi.fn(),
    cleanMapEvents: vi.fn(),
    currentMode: null,
    measurements: [],
  };
}

describe("MeasureMode — base class", () => {
  it("m getter returns manager", () => {
    const manager = makeManagerMock();
    const mode = new MeasureMode(manager);
    expect(mode.m).toBe(manager);
  });

  it("cleanup calls _cleanup once and nulls it", () => {
    const manager = makeManagerMock();
    const mode = new MeasureMode(manager);
    const fn = vi.fn();
    mode._cleanup = fn;
    mode.cleanup();
    expect(fn).toHaveBeenCalledOnce();
    expect(mode._cleanup).toBeNull();
  });

  it("cleanup is safe when _cleanup is null", () => {
    const mode = new MeasureMode(makeManagerMock());
    expect(() => mode.cleanup()).not.toThrow();
  });

  it("nextMeasurementId delegates to manager", () => {
    const manager = makeManagerMock();
    const mode = new MeasureMode(manager);
    mode.cleanup = vi.fn(); // suppress start warning
    const id = mode.nextMeasurementId();
    expect(manager.nextMeasurementId).toHaveBeenCalled();
    expect(id).toBe("test-id");
  });
});

describe("PreviewMode — tracking preview layers", () => {
  it("addPreview tracks layer in previewLayers", () => {
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    const fakeLayer = {};
    mode.addPreview(fakeLayer);
    expect(mode.previewLayers).toContain(fakeLayer);
    expect(manager.layers.addLayer).toHaveBeenCalledWith(fakeLayer);
  });

  it("removePreview removes a tracked layer", () => {
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    const fakeLayer = {};
    mode.previewLayers = [fakeLayer];
    mode.removePreview(fakeLayer);
    expect(mode.previewLayers).not.toContain(fakeLayer);
    expect(manager.layers.removeLayer).toHaveBeenCalledWith(fakeLayer);
  });

  it("removePreview is safe for non-tracked layer", () => {
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    expect(() => mode.removePreview({})).not.toThrow();
  });

  it("clearPreviews removes all tracked layers", () => {
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    const a = {},
      b = {};
    mode.previewLayers = [a, b];
    mode.clearPreviews();
    expect(mode.previewLayers).toHaveLength(0);
    expect(manager.layers.removeLayer).toHaveBeenCalledWith(a);
    expect(manager.layers.removeLayer).toHaveBeenCalledWith(b);
  });

  it("isFinished starts as false", () => {
    const mode = new PreviewMode(makeManagerMock());
    expect(mode.isFinished).toBe(false);
  });

  it("addPreview returns the layer for chaining", () => {
    const manager = makeManagerMock();
    const mode = new PreviewMode(manager);
    const fakeLayer = {};
    const result = mode.addPreview(fakeLayer);
    expect(result).toBe(fakeLayer);
  });
});

describe("Mode — TYPE constants", () => {
  it("DistanceMode TYPE equals MODE.DISTANCE", () => {
    expect(MODE_MAP[CONST.MODE.DISTANCE].TYPE).toBe(CONST.MODE.DISTANCE);
  });

  it("PolygonMode TYPE equals MODE.POLYGON", () => {
    expect(MODE_MAP[CONST.MODE.POLYGON].TYPE).toBe(CONST.MODE.POLYGON);
  });

  it("CircleMode TYPE equals MODE.CIRCLE", () => {
    expect(MODE_MAP[CONST.MODE.CIRCLE].TYPE).toBe(CONST.MODE.CIRCLE);
  });
});

describe("MarkerMode — TYPE", () => {
  it("has correct TYPE constant", () => {
    expect(MarkerMode.TYPE).toBe(CONST.MODE.MARKER);
  });
});

describe("MODE_MAP", () => {
  it("maps all four mode types to their classes", () => {
    expect(MODE_MAP[CONST.MODE.MARKER]).toBe(MarkerMode);
    expect(MODE_MAP[CONST.MODE.DISTANCE]).toBeDefined();
    expect(MODE_MAP[CONST.MODE.POLYGON]).toBeDefined();
    expect(MODE_MAP[CONST.MODE.CIRCLE]).toBeDefined();
  });

  it("covers all CONST.MODE keys", () => {
    const modeKeys = Object.values(CONST.MODE).filter(k => k !== "clear");
    for (const key of modeKeys) {
      expect(MODE_MAP[key]).toBeDefined();
    }
  });
});

describe("DistanceMode — marker click stops map propagation", () => {
  it("does not add a duplicate point when re-clicking an existing node", () => {
    const manager = makeManagerMock();
    const mode = new DistanceMode(manager);
    manager.currentMode = CONST.MODE.DISTANCE;
    mode.start();

    const clickHandler = manager.map.on.mock.calls.find(
      ([event]) => event === "click",
    )?.[1];
    expect(clickHandler).toBeDefined();

    // Create 2 nodes: pt1, pt2
    const pt1 = { lat: 30, lng: 120 };
    const pt2 = { lat: 31, lng: 121 };
    clickHandler({ latlng: pt1 });
    clickHandler({ latlng: pt2 });
    expect(window.L.circleMarker).toHaveBeenCalledTimes(2);

    // Capture the second node's click handler (fires before the map handler)
    const markerOnCalls = window.L.circleMarker.mock.results;
    const marker2 = markerOnCalls[markerOnCalls.length - 1]?.value;
    const markerClickHandler = marker2.on.mock.calls.find(
      ([event]) => event === "click",
    )?.[1];
    expect(markerClickHandler).toBeDefined();

    // Simulate Leaflet's propagation: marker handler runs first. It must set
    // event.originalEvent._stopped so the map click handler is not invoked.
    const leafletEvent = { latlng: pt2, originalEvent: {} as { _stopped?: boolean } };
    markerClickHandler(leafletEvent);

    // The marker handler must stop propagation (Leaflet sets _stopped on the
    // original event, which _fireDOMEvent checks before firing the map click).
    expect(window.L.DomEvent.stopPropagation).toHaveBeenCalledWith(leafletEvent);
    expect(leafletEvent.originalEvent._stopped).toBe(true);

    // The map click handler must NOT fire again (no duplicate node added).
    expect(window.L.circleMarker).toHaveBeenCalledTimes(2);
  });
});

describe("PolygonMode — marker click stops map propagation", () => {
  it("does not add a duplicate point when re-clicking an existing node", () => {
    const manager = makeManagerMock();
    const mode = new PolygonMode(manager);
    manager.currentMode = CONST.MODE.POLYGON;
    mode.start();

    const clickHandler = manager.map.on.mock.calls.find(
      ([event]) => event === "click",
    )?.[1];
    expect(clickHandler).toBeDefined();

    const pt1 = { lat: 30, lng: 120 };
    const pt2 = { lat: 31, lng: 121 };
    clickHandler({ latlng: pt1 });
    clickHandler({ latlng: pt2 });
    expect(window.L.circleMarker).toHaveBeenCalledTimes(2);

    const markerOnCalls = window.L.circleMarker.mock.results;
    const marker2 = markerOnCalls[markerOnCalls.length - 1]?.value;
    const markerClickHandler = marker2.on.mock.calls.find(
      ([event]) => event === "click",
    )?.[1];
    expect(markerClickHandler).toBeDefined();

    const leafletEvent = { latlng: pt2, originalEvent: {} as { _stopped?: boolean } };
    markerClickHandler(leafletEvent);

    expect(window.L.DomEvent.stopPropagation).toHaveBeenCalledWith(leafletEvent);
    expect(leafletEvent.originalEvent._stopped).toBe(true);
    expect(window.L.circleMarker).toHaveBeenCalledTimes(2);
  });
});

describe("DistanceMode — first node uses NODE_SOLID", () => {
  it("creates the first node with NODE_SOLID class", () => {
    const manager = makeManagerMock();
    const mode = new DistanceMode(manager);
    manager.currentMode = CONST.MODE.DISTANCE;
    mode.start();

    const clickHandler = manager.map.on.mock.calls.find(
      ([event]) => event === "click",
    )?.[1];
    expect(clickHandler).toBeDefined();

    // First click — should use NODE_SOLID
    clickHandler({ latlng: { lat: 30, lng: 120 } });
    const firstCall = window.L.circleMarker.mock.calls[0];
    expect(firstCall[1].className).toContain("foliplus-measure-node-solid");

    // Second click — should use default NODE_HOLLOW
    clickHandler({ latlng: { lat: 31, lng: 121 } });
    const secondCall = window.L.circleMarker.mock.calls[1];
    expect(secondCall[1].className).toBe(CONST.CLASSES.NODE_HOLLOW);
  });
});

describe("DistanceMode — drawing polyline uses PATH_PREVIEW", () => {
  it("creates distance preview polylines with PATH_PREVIEW class", () => {
    const manager = makeManagerMock();
    const mode = new DistanceMode(manager);
    manager.currentMode = CONST.MODE.DISTANCE;
    mode.start();

    // First polyline created in start() should be PATH_PREVIEW
    const polylineCall = window.L.polyline.mock.calls.find(
      ([, opts]) => opts.className === CONST.CLASSES.PATH_PREVIEW,
    );
    expect(polylineCall).toBeDefined();
  });
});

describe("PolygonMode — drawing polyline uses PATH_PREVIEW", () => {
  it("creates polygon preview lines with PATH_PREVIEW class", () => {
    const manager = makeManagerMock();
    const mode = new PolygonMode(manager);
    manager.currentMode = CONST.MODE.POLYGON;
    mode.start();

    const polylineCall = window.L.polyline.mock.calls.find(
      ([, opts]) => opts.className === CONST.CLASSES.PATH_PREVIEW,
    );
    expect(polylineCall).toBeDefined();
  });
});

describe("DistanceMode — restore first node uses NODE_SOLID", () => {
  it("creates first restored node with NODE_SOLID class", () => {
    const manager = makeManagerMock();
    DistanceMode.restore(manager, {
      id: "test",
      type: "distance",
      points: [
        { lng: 120, lat: 30 },
        { lng: 121, lat: 31 },
      ],
      segments: [{ lng: 121, lat: 31, distance: 100 }],
      totalDistance: 100,
    });

    const firstCall = window.L.circleMarker.mock.calls[0];
    expect(firstCall[1].className).toContain("foliplus-measure-node-solid");

    const secondCall = window.L.circleMarker.mock.calls[1];
    expect(secondCall[1].className).toBe(CONST.CLASSES.NODE_HOLLOW);
  });
});

describe("DistanceMode — click stops propagation to data layers", () => {
  it("calls L.DomEvent.stopPropagation when placing a point", () => {
    const manager = makeManagerMock();
    const mode = new DistanceMode(manager);
    manager.currentMode = CONST.MODE.DISTANCE;
    mode.start();

    const clickHandler = manager.map.on.mock.calls.find(
      ([event]) => event === "click",
    )?.[1];
    expect(clickHandler).toBeDefined();

    const leafletEvent = {
      latlng: { lat: 30, lng: 120 },
      originalEvent: {} as { _stopped?: boolean },
    };
    clickHandler(leafletEvent);

    expect(window.L.DomEvent.stopPropagation).toHaveBeenCalledWith(leafletEvent);
    expect(leafletEvent.originalEvent._stopped).toBe(true);
  });
});

describe("PolygonMode — click stops propagation to data layers", () => {
  it("calls L.DomEvent.stopPropagation when placing a point", () => {
    const manager = makeManagerMock();
    const mode = new PolygonMode(manager);
    manager.currentMode = CONST.MODE.POLYGON;
    mode.start();

    const clickHandler = manager.map.on.mock.calls.find(
      ([event]) => event === "click",
    )?.[1];
    expect(clickHandler).toBeDefined();

    const leafletEvent = {
      latlng: { lat: 30, lng: 120 },
      originalEvent: {} as { _stopped?: boolean },
    };
    clickHandler(leafletEvent);

    expect(window.L.DomEvent.stopPropagation).toHaveBeenCalledWith(leafletEvent);
    expect(leafletEvent.originalEvent._stopped).toBe(true);
  });
});

describe("PolygonMode — confirmedPoly uses PATH_DASHED", () => {
  it("creates a polyline with PATH_DASHED class for confirmed segments", () => {
    const manager = makeManagerMock();
    const mode = new PolygonMode(manager);
    manager.currentMode = CONST.MODE.POLYGON;
    mode.start();

    const polylineCall = window.L.polyline.mock.calls.find(
      ([, opts]) => opts.className === CONST.CLASSES.PATH_DASHED,
    );
    expect(polylineCall).toBeDefined();
  });
});

describe("CircleMode — click stops propagation to data layers", () => {
  it("calls L.DomEvent.stopPropagation when placing center", () => {
    const manager = makeManagerMock();
    const mode = new CircleMode(manager);
    manager.currentMode = CONST.MODE.CIRCLE;
    mode.start();

    const clickHandler = manager.map.on.mock.calls.find(
      ([event]) => event === "click",
    )?.[1];
    expect(clickHandler).toBeDefined();

    const leafletEvent = {
      latlng: { lat: 30, lng: 120 },
      originalEvent: {} as { _stopped?: boolean },
    };
    clickHandler(leafletEvent);

    expect(window.L.DomEvent.stopPropagation).toHaveBeenCalledWith(leafletEvent);
    expect(leafletEvent.originalEvent._stopped).toBe(true);
  });
});

describe("DistanceMode — label count equals n-1", () => {
  function run(manager, mode) {
    manager.currentMode = CONST.MODE.DISTANCE;
    mode.start();
    const clickHandler = manager.map.on.mock.calls.find(
      ([event]) => event === "click",
    )?.[1];
    return clickHandler;
  }

  function segLabelCount() {
    // segLabels are L.marker instances created by makeMidLabelDivIcon;
    // count L.marker calls where the icon option has the mid-label class.
    return window.L.marker.mock.calls.filter(([, opts]) => {
      const iconOpts = opts?.icon;
      // icon is a divIcon mock — inspect its first-call argument
      if (!iconOpts || !iconOpts._mockDivIconHtml) return false;
      return iconOpts._mockDivIconHtml.includes("foliplus-measure-label-mid");
    }).length;
  }

  it("creates 1 segLabel for 2 points", () => {
    const manager = makeManagerMock();
    const mode = new DistanceMode(manager);
    const clickHandler = run(manager, mode);
    clickHandler({ latlng: { lat: 30, lng: 120 } });
    clickHandler({ latlng: { lat: 31, lng: 121 } });
    expect(segLabelCount()).toBe(1);
  });

  it("creates 2 segLabels for 3 points", () => {
    const manager = makeManagerMock();
    const mode = new DistanceMode(manager);
    const clickHandler = run(manager, mode);
    clickHandler({ latlng: { lat: 30, lng: 120 } });
    clickHandler({ latlng: { lat: 31, lng: 121 } });
    clickHandler({ latlng: { lat: 32, lng: 122 } });
    expect(segLabelCount()).toBe(2);
  });

  it("does not create extra label when re-clicking last node", () => {
    const manager = makeManagerMock();
    const mode = new DistanceMode(manager);
    const clickHandler = run(manager, mode);
    clickHandler({ latlng: { lat: 30, lng: 120 } });
    clickHandler({ latlng: { lat: 31, lng: 121 } });
    const before = segLabelCount();
    // Re-click at same position — should NOT add another segLabel
    clickHandler({ latlng: { lat: 31, lng: 121 } });
    expect(segLabelCount()).toBe(before);
  });
});

describe("PolygonMode — label count equals n-1", () => {
  function run(manager, mode) {
    manager.currentMode = CONST.MODE.POLYGON;
    mode.start();
    const clickHandler = manager.map.on.mock.calls.find(
      ([event]) => event === "click",
    )?.[1];
    return clickHandler;
  }

  function segLabelCount() {
    const calls = window.L.marker.mock.calls.filter(([, opts]) => {
      const iconOpts = opts?.icon;
      if (!iconOpts || !iconOpts._mockDivIconHtml) return false;
      return iconOpts._mockDivIconHtml.includes("foliplus-measure-label-mid");
    }).length;
    return calls;
  }

  it("creates 2 segLabels for 3 points", () => {
    const manager = makeManagerMock();
    const mode = new PolygonMode(manager);
    const clickHandler = run(manager, mode);
    clickHandler({ latlng: { lat: 30, lng: 120 } });
    clickHandler({ latlng: { lat: 31, lng: 121 } });
    clickHandler({ latlng: { lat: 32, lng: 122 } });
    expect(segLabelCount()).toBe(2);
  });

  it("does not create extra label when re-clicking a node", () => {
    const manager = makeManagerMock();
    const mode = new PolygonMode(manager);
    const clickHandler = run(manager, mode);
    clickHandler({ latlng: { lat: 30, lng: 120 } });
    clickHandler({ latlng: { lat: 31, lng: 121 } });
    const before = segLabelCount();
    // Re-click at same position — should NOT add another segLabel
    clickHandler({ latlng: { lat: 31, lng: 121 } });
    expect(segLabelCount()).toBe(before);
  });
});
