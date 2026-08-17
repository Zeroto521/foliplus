import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { DistanceMode } from "#foliplus/MeasureControl/mode/index.js";
import { initMocks, makeManagerMock } from "./setup.js";

beforeEach(initMocks);

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

    clickHandler({ latlng: { lat: 30, lng: 120 } });
    const firstCall = window.L.circleMarker.mock.calls[0];
    expect(firstCall[1].className).toContain("foliplus-measure-node-solid");

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
    return window.L.marker.mock.calls.filter(([, opts]) => {
      const iconOpts = opts?.icon;
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
    clickHandler({ latlng: { lat: 31, lng: 121 } });
    expect(segLabelCount()).toBe(before);
  });
});

describe("DistanceMode — toGeoFeature", () => {
  it("returns a LineString with totalDistance in properties", () => {
    const feature = DistanceMode.toGeoFeature({
      id: "d1",
      type: "distance",
      points: [
        { lng: 121, lat: 31 },
        { lng: 122, lat: 32 },
      ],
      segments: [{ lng: 122, lat: 32, distance: 155000 }],
      totalDistance: 155000,
    });
    expect(feature.type).toBe("Feature");
    expect(feature.properties.type).toBe("distance");
    expect(feature.properties.totalDistance).toBe(155000);
    expect(feature.geometry.type).toBe("LineString");
    expect(feature.geometry.coordinates).toEqual([
      [121, 31],
      [122, 32],
    ]);
  });
});
