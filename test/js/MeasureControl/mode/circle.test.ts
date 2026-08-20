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
