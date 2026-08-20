import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { CircleMode } from "#foliplus/MeasureControl/mode/index.js";
import { initMocks, makeManagerMock } from "./setup.js";

beforeEach(initMocks);

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

describe("CircleMode — toGeoFeature", () => {
  it("returns a Polygon from turf.circle", () => {
    const mockCircle = {
      geometry: {
        coordinates: [
          [
            [121, 31],
            [121.001, 31],
            [121.002, 31],
            [121.001, 31.001],
            [121, 31.002],
            [120.999, 31.001],
            [120.998, 31],
            [120.999, 31],
            [121, 31],
          ],
        ],
      },
    };
    globalThis.turf.circle = vi.fn(() => mockCircle);

    const feature = CircleMode.toGeoFeature({
      id: "c1",
      type: "circle",
      center: { lng: 121, lat: 31 },
      target: { lng: 122, lat: 31 },
      radius: 5000,
      area: Math.PI * 5000 * 5000,
    });

    expect(globalThis.turf.circle).toHaveBeenCalledWith([121, 31], 5, {
      steps: 64,
      units: "kilometers",
    });
    expect(feature.type).toBe("Feature");
    expect(feature.properties.type).toBe("circle");
    expect(feature.properties.radius).toBe(5000);
    expect(feature.properties.area).toBe(Math.PI * 5000 * 5000);
    expect(feature.geometry.type).toBe("Polygon");
    expect(feature.geometry.coordinates[0]).toHaveLength(9);
  });

  it("returns a Point when center or radius is missing", () => {
    const feature = CircleMode.toGeoFeature({
      id: "c2",
      type: "circle",
      radius: 0,
    });
    expect(feature.geometry.type).toBe("Point");
  });

  it("uses NAME_LABEL and TYPE from static properties", () => {
    expect(CircleMode.NAME_LABEL).toBe("Circle Measurement");
    expect(CircleMode.NAME_LABEL_KEY).toContain("name_circle");
  });
});

describe("CircleMode — restore", () => {
  it("rebuilds a circle and its radius line from persisted data", () => {
    const manager = makeManagerMock() as any;
    manager.currentMode = null;
    CircleMode.restore(manager, {
      id: "c_r1",
      type: "circle",
      center: { lng: 121.5, lat: 31.2 },
      target: { lng: 121.51, lat: 31.2 },
      radius: 5000,
    });

    expect(window.L.circle).toHaveBeenCalled();
    expect(window.L.polyline).toHaveBeenCalled();
    expect(window.L.marker).toHaveBeenCalled(); // center dot + labels + del icons
    expect(manager.layers.addLayer).toHaveBeenCalled();
  });

  it("does not throw when center is missing", () => {
    const manager = makeManagerMock() as any;
    expect(() =>
      CircleMode.restore(manager, {
        id: "c_r2",
        type: "circle",
        radius: 0,
      } as any),
    ).not.toThrow();
  });
});

describe("CircleMode — start drawing flow", () => {
  it("places center on first click, finishes on second click", () => {
    vi.useFakeTimers();
    try {
      const manager = makeManagerMock() as any;
      manager.currentMode = CONST.MODE.CIRCLE;
      const mode = new CircleMode(manager);
      mode.start();

      const clickHandler = manager.map.on.mock.calls.find(
        ([ev]) => ev === "click",
      )?.[1];
      const moveHandler = manager.map.on.mock.calls.find(
        ([ev]) => ev === "mousemove",
      )?.[1];

      clickHandler({ latlng: { lat: 31.2, lng: 121.5 } });
      expect(window.L.marker).toHaveBeenCalled(); // center dot

      moveHandler({ latlng: { lat: 31.21, lng: 121.51 } });
      expect(window.L.circle).toHaveBeenCalled(); // preview circle

      // second click completes the circle (scheduled via setTimeout)
      clickHandler({ latlng: { lat: 31.21, lng: 121.51 } });
      vi.runAllTimers();

      expect(manager.measurements.length).toBe(1);
      expect(manager.measurements[0].radius).toBeGreaterThan(0);
      expect(manager.saveMeasurements).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
