import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { PolygonMode } from "#foliplus/MeasureControl/mode/index.js";
import { initMocks, makeManagerMock } from "./setup.js";

beforeEach(initMocks);

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
    return window.L.marker.mock.calls.filter(([, opts]) => {
      const iconOpts = opts?.icon;
      if (!iconOpts || !iconOpts._mockDivIconHtml) return false;
      return iconOpts._mockDivIconHtml.includes("foliplus-measure-label-mid");
    }).length;
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
    clickHandler({ latlng: { lat: 31, lng: 121 } });
    expect(segLabelCount()).toBe(before);
  });
});

describe("PolygonMode — toGeoFeature", () => {
  it("returns a Polygon with area in properties", () => {
    const feature = PolygonMode.toGeoFeature({
      id: "p1",
      type: "polygon",
      points: [
        { lng: 121, lat: 31 },
        { lng: 122, lat: 31 },
        { lng: 122, lat: 32 },
        { lng: 121, lat: 32 },
      ],
      area: 50000,
    });
    expect(feature.type).toBe("Feature");
    expect(feature.properties.type).toBe("polygon");
    expect(feature.properties.area).toBe(50000);
    expect(feature.geometry.type).toBe("Polygon");
    expect(feature.geometry.coordinates[0]).toHaveLength(5);
    expect(feature.geometry.coordinates[0][0]).toEqual(
      feature.geometry.coordinates[0][4],
    );
  });

  it("has NAME_LABEL and TYPE static properties", async () => {
    const { PolygonMode } = await import("#foliplus/MeasureControl/mode/index.js");
    expect(PolygonMode.NAME_LABEL).toBe("Area Measurement");
    expect(PolygonMode.NAME_LABEL_KEY).toContain("name_polygon");
  });
});
