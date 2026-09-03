import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { DistanceMode } from "#foliplus/MeasureControl/mode/index.js";
import { initMocks, makeManagerMock } from "./setup.js";

// Capture attachDistanceUI's opts so restore's onDelete/onUpdate callbacks can
// be exercised directly (these are the lines codecov flags as missing).
const { attachDistanceUIMock } = vi.hoisted(() => ({
  attachDistanceUIMock: vi.fn((mgr: unknown, opts: unknown) => {
    capturedDistanceOpts = opts;
    // Simulate the real attachDistanceUI, which self-registers its dispose via
    // registerFinalized (delete and clearAll both run it).
    const cleanup = () => {};
    (mgr as { registerFinalized?: (c: () => void) => void }).registerFinalized?.(
      cleanup,
    );
    return cleanup;
  }),
}));

let capturedDistanceOpts: any = null;

vi.mock("#foliplus/MeasureControl/ui.js", async importOriginal => {
  const actual =
    await importOriginal<typeof import("#foliplus/MeasureControl/ui.js")>();
  return { ...actual, attachDistanceUI: attachDistanceUIMock };
});

beforeEach(() => {
  initMocks();
  capturedDistanceOpts = null;
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

describe("DistanceMode — restore registers overlay cleanup", () => {
  it("pushes the overlay cleanup into finalizedClickHandlers", () => {
    const manager = makeManagerMock() as any;
    DistanceMode.restore(manager, {
      id: "d_reg",
      type: "distance",
      points: [
        { lng: 121, lat: 30 },
        { lng: 122, lat: 31 },
      ],
      segments: [],
      totalDistance: 0,
    });

    // Regression: restored distances leaked their overlay map-click listener
    // because attachDistanceUI's return value was discarded.
    expect(manager.finalizedClickHandlers.length).toBe(1);
    expect(typeof manager.finalizedClickHandlers[0]).toBe("function");
  });

  it("invokes restore's onDelete and onUpdate callbacks", () => {
    const manager = makeManagerMock() as any;
    const data: MeasureData = {
      id: "d_cb",
      type: "distance",
      points: [
        { lng: 121, lat: 30 },
        { lng: 122, lat: 31 },
      ],
      segments: [],
      totalDistance: 0,
    };
    manager.measurements = [data];
    DistanceMode.restore(manager, data);

    expect(capturedDistanceOpts).toBeDefined();

    // onUpdate recomputes segments/totalDistance and persists back to `data`.
    // (Run before onDelete so the measurement is still in the store — onUpdate
    // looks it up by id via store.update.)
    capturedDistanceOpts.onUpdate();
    expect(data.segments!.length).toBeGreaterThan(0);
    expect(data.totalDistance).toBeGreaterThan(0);
    expect(data.points).toHaveLength(2);
    expect(manager.store.update).toHaveBeenCalled();

    // onDelete removes the measurement and persists.
    manager.store.remove.mockClear();
    capturedDistanceOpts.onDelete();
    expect(manager.measurements.length).toBe(0);
    expect(manager.store.remove).toHaveBeenCalled();
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

  it("has NAME_LABEL and TYPE static properties", async () => {
    const { DistanceMode } = await import("#foliplus/MeasureControl/mode/index.js");
    expect(DistanceMode.NAME_LABEL).toBe("Distance Measurement");
    expect(DistanceMode.NAME_LABEL_KEY).toContain("name_distance");
  });
});

describe("DistanceMode — finish saves measurement", () => {
  it("persists a distance measurement on double-click finish", () => {
    const manager = makeManagerMock() as any;
    const mode = new DistanceMode(manager);
    manager.currentMode = CONST.MODE.DISTANCE;
    mode.start();

    const clickHandler = manager.map.on.mock.calls.find(([ev]) => ev === "click")?.[1];
    const dblHandler = manager.map.on.mock.calls.find(([ev]) => ev === "dblclick")?.[1];

    clickHandler({ latlng: { lat: 30, lng: 120 } });
    clickHandler({ latlng: { lat: 31, lng: 121 } });
    clickHandler({ latlng: { lat: 32, lng: 122 } });
    // double-click finishes
    dblHandler({ latlng: { lat: 32, lng: 122 } });

    expect(manager.store.add).toHaveBeenCalled();
    const saved = manager.measurements[0] as MeasureData;
    expect(saved.type).toBe("distance");
    expect(saved.points).toHaveLength(3);
    expect(saved.totalDistance).toBeGreaterThan(0);
    expect(saved.segments).toBeDefined();
    expect(saved.segments![0].bearing).toBeDefined();
  });

  it("registers the overlay cleanup and leaves _cleanup as a no-op", () => {
    const manager = makeManagerMock() as any;
    const mode = new DistanceMode(manager);
    manager.currentMode = CONST.MODE.DISTANCE;
    mode.start();

    const clickHandler = manager.map.on.mock.calls.find(([ev]) => ev === "click")?.[1];
    const dblHandler = manager.map.on.mock.calls.find(([ev]) => ev === "dblclick")?.[1];

    clickHandler({ latlng: { lat: 30, lng: 120 } });
    clickHandler({ latlng: { lat: 31, lng: 121 } });
    dblHandler({ latlng: { lat: 31, lng: 121 } });

    // Regression: finishing overwrote _cleanup with a broken map.off(...) that
    // never unbound the overlay, and never registered the cleanup anywhere.
    expect(manager.finalizedClickHandlers.length).toBe(1);
    expect(typeof manager.finalizedClickHandlers[0]).toBe("function");
    expect(() => manager.finalizedClickHandlers[0]()).not.toThrow();
  });
});

describe("DistanceMode — cleanup", () => {
  it("runs the registered cleanup callback", () => {
    const manager = makeManagerMock() as any;
    const mode = new DistanceMode(manager);
    manager.currentMode = CONST.MODE.DISTANCE;
    mode.start();
    mode.cleanup();

    // start() binds map events; cleanup() unbinds via _cleanup
    expect(mode._cleanup).toBeNull(); // cleanup consumed the callback
    // next cleanup is a safe no-op
    expect(() => mode.cleanup()).not.toThrow();
  });
});
