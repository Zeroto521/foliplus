import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { PolygonMode } from "#foliplus/MeasureControl/mode/index.js";
import { initMocks, makeManagerMock } from "./setup.js";

// Capture attachPolygonUI's opts so the start-path onDelete/onUpdate
// callbacks (store.update/remove by polyId) can be exercised directly.
const { attachPolygonUIMock } = vi.hoisted(() => ({
  attachPolygonUIMock: vi.fn((_mgr: unknown, opts: unknown) => {
    capturedPolygonOpts = opts;
    return () => {};
  }),
}));
let capturedPolygonOpts: any = null;

vi.mock("#foliplus/MeasureControl/ui.js", async importOriginal => {
  const actual =
    await importOriginal<typeof import("#foliplus/MeasureControl/ui.js")>();
  return { ...actual, attachPolygonUI: attachPolygonUIMock };
});

beforeEach(() => {
  initMocks();
  capturedPolygonOpts = null;
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

    // The preview cursor dot is the first circleMarker; confirmed nodes are
    // the rest.
    const confirmedMarkers = () =>
      window.L.circleMarker.mock.results.slice(1).map(r => r.value);
    const pt1 = { lat: 30, lng: 120 };
    const pt2 = { lat: 31, lng: 121 };
    clickHandler({ latlng: pt1 });
    clickHandler({ latlng: pt2 });
    expect(confirmedMarkers()).toHaveLength(2);

    const marker2 = confirmedMarkers()[1];
    const markerClickHandler = marker2.on.mock.calls.find(
      ([event]) => event === "click",
    )?.[1];
    expect(markerClickHandler).toBeDefined();

    const leafletEvent = { latlng: pt2, originalEvent: {} as { _stopped?: boolean } };
    markerClickHandler(leafletEvent);

    expect(window.L.DomEvent.stopPropagation).toHaveBeenCalledWith(leafletEvent);
    expect(leafletEvent.originalEvent._stopped).toBe(true);
    expect(confirmedMarkers()).toHaveLength(2);
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

describe("PolygonMode — finish saves centroid", () => {
  it("persists center when the polygon is finished", () => {
    const manager = makeManagerMock();
    const mode = new PolygonMode(manager);
    manager.currentMode = CONST.MODE.POLYGON;
    mode.start();

    const clickHandler = manager.map.on.mock.calls.find(
      ([event]) => event === "click",
    )?.[1];
    // Draw 3 points
    clickHandler({ latlng: { lat: 30, lng: 120 } });
    clickHandler({ latlng: { lat: 31, lng: 121 } });
    clickHandler({ latlng: { lat: 32, lng: 120 } });
    // Double-click to finish
    const dblHandler = manager.map.on.mock.calls.find(
      ([event]) => event === "dblclick",
    )?.[1];
    dblHandler({ latlng: { lat: 32, lng: 120 } });

    expect(manager.store.add).toHaveBeenCalled();
    const saved = manager.measurements[0] as MeasureData;
    expect(saved.center).toBeDefined();
    expect(typeof saved.center!.lng).toBe("number");
    expect(typeof saved.center!.lat).toBe("number");
    expect(saved.area).toBeGreaterThan(0); // Util.area computed at finish
    expect(saved.segments).toBeDefined();
    expect(saved.segments!.length).toBe(3); // 3 sides incl. closing
    expect(saved.segments![0].bearing).toBeDefined(); // bearing added

    // Exercise the start-path onDelete/onUpdate callbacks captured by the
    // attachPolygonUI mock so the store.update/remove lines are covered.
    expect(capturedPolygonOpts).toBeDefined();
    manager.store.update.mockClear();
    capturedPolygonOpts.onUpdate();
    expect(manager.store.update).toHaveBeenCalledWith(saved.id, expect.anything());
    manager.store.remove.mockClear();
    capturedPolygonOpts.onDelete();
    expect(manager.store.remove).toHaveBeenCalledWith(saved.id);
    expect(manager.measurements.length).toBe(0);
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

  it("includes persisted center in properties", () => {
    const feature = PolygonMode.toGeoFeature({
      id: "p2",
      type: "polygon",
      points: [
        { lng: 121, lat: 31 },
        { lng: 122, lat: 31 },
      ],
      center: { lng: 121.5, lat: 31.5 },
    });
    expect(feature.properties.center).toEqual({ lng: 121.5, lat: 31.5 });
  });

  it("leaves center undefined for legacy data without it", () => {
    const feature = PolygonMode.toGeoFeature({
      id: "p3",
      type: "polygon",
      points: [
        { lng: 121, lat: 31 },
        { lng: 122, lat: 31 },
      ],
    });
    expect(feature.properties.center).toBeUndefined();
  });
});

describe("PolygonMode — restore", () => {
  it("rebuilds a polygon with nodes and labels from persisted data", () => {
    const manager = makeManagerMock() as any;
    PolygonMode.restore(manager, {
      id: "p_r1",
      type: "polygon",
      points: [
        { lng: 121, lat: 31 },
        { lng: 122, lat: 31 },
        { lng: 121.5, lat: 32 },
      ],
      segments: [
        { lng: 122, lat: 31, distance: 1500, bearing: 90 },
        { lng: 121.5, lat: 32, distance: 1500, bearing: 45 },
      ],
      area: 50000,
    });

    expect(window.L.polygon).toHaveBeenCalled();
    expect(window.L.circleMarker).toHaveBeenCalled(); // nodes
    expect(window.L.marker).toHaveBeenCalled(); // labels + del icons
    expect(manager.layers.addLayer).toHaveBeenCalled();
  });

  it("restores polygon without segments", () => {
    const manager = makeManagerMock() as any;
    PolygonMode.restore(manager, {
      id: "p_r2",
      type: "polygon",
      points: [
        { lng: 121, lat: 31 },
        { lng: 122, lat: 31 },
        { lng: 121.5, lat: 32 },
      ],
    });
    expect(window.L.polygon).toHaveBeenCalled();
  });

  it("invokes restore's onDelete and onUpdate callbacks", () => {
    const manager = makeManagerMock() as any;
    const data: MeasureData = {
      id: "p_cb",
      type: "polygon",
      points: [
        { lng: 121, lat: 31 },
        { lng: 122, lat: 31 },
        { lng: 121.5, lat: 32 },
      ],
      segments: [],
      area: 0,
    };
    manager.measurements = [data];
    PolygonMode.restore(manager, data);

    expect(capturedPolygonOpts).toBeDefined();

    // onUpdate recomputes area/segments/center and persists via store.update.
    capturedPolygonOpts.onUpdate();
    expect(manager.store.update).toHaveBeenCalledWith(
      data.id,
      expect.objectContaining({
        area: expect.any(Number),
        segments: expect.any(Array),
      }),
    );

    // onDelete removes the measurement and persists.
    manager.store.remove.mockClear();
    capturedPolygonOpts.onDelete();
    expect(manager.store.remove).toHaveBeenCalledWith(data.id);
    expect(manager.measurements.length).toBe(0);
  });
});

describe("PolygonMode — preview cursor node", () => {
  it("creates a non-interactive hollow node after the preview polygon", () => {
    const manager = makeManagerMock();
    const mode = new PolygonMode(manager);
    manager.currentMode = CONST.MODE.POLYGON;
    mode.start();

    // addLayer is called with poly, confirmedPoly, previewPoly, cursorNode,
    // finalPoly — so the cursor node sits directly behind the finalized shape.
    const addLayerCalls = (manager.layers as any).addLayer.mock.calls;
    expect(addLayerCalls).toHaveLength(5);

    const cursor = (addLayerCalls[3] as [unknown])[0];
    expect(cursor).toBe(window.L.circleMarker.mock.results[0].value);
    // Rendered after the preview polygon, so it paints above the fill.
    expect(addLayerCalls[2][0]).not.toBe(cursor);

    const cursorCall = window.L.circleMarker.mock.calls[0] as [unknown, object];
    expect(cursorCall[1].interactive).toBe(false);
    expect(cursorCall[1].className).toBe(CONST.CLASSES.NODE_HOLLOW);
  });

  it("moves the node with the cursor and removes it when the shape is finished", () => {
    const manager = makeManagerMock() as any;
    const mode = new PolygonMode(manager);
    manager.currentMode = CONST.MODE.POLYGON;
    mode.start();

    const handlers = manager.map.on.mock.calls.find(
      ([event]) => event === "mousemove",
    )?.[1];
    const cursor = window.L.circleMarker.mock.results[0].value;

    // No movement before the first point is placed.
    handlers({ latlng: { lat: 29, lng: 118 } });
    expect(cursor.setLatLng).not.toHaveBeenCalled();

    const click = manager.map.on.mock.calls.find(([event]) => event === "click")?.[1];
    click({ latlng: { lat: 30, lng: 120 } });
    click({ latlng: { lat: 31, lng: 121 } });
    click({ latlng: { lat: 32, lng: 122 } });

    handlers({ latlng: { lat: 33, lng: 123 } });
    expect(cursor.setLatLng).toHaveBeenCalledWith({ lat: 33, lng: 123 });

    // Context-menu finishes: the node leaves the map with the other preview
    // artifacts, while the confirmed nodes stay.
    manager.map.on.mock.calls.find(([event]) => event === "contextmenu")?.[1]({
      latlng: { lat: 33, lng: 123 },
    });
    expect(manager.layers.removeLayer).toHaveBeenCalledWith(cursor);
  });
});
