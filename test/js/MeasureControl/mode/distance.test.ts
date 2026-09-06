import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { DistanceMode } from "#foliplus/MeasureControl/mode/index.js";
import { initMocks, makeManagerMock } from "./setup.js";

// Capture attachDistanceUI's opts so restore's onDelete/onUpdate callbacks can
// be exercised directly (these are the lines codecov flags as missing).
const { attachDistanceUIMock } = vi.hoisted(() => ({
  attachDistanceUIMock: vi.fn((mgr: unknown, opts: any) => {
    capturedDistanceOpts = opts;
    // Simulate the real attachDistanceUI, which self-registers its dispose via
    // registerFinalized (delete and clearAll both run it).
    const cleanup = () => {};

    (
      mgr as { registerFinalized?: (c: () => void, id?: string) => void }
    ).registerFinalized?.(cleanup, opts?.id);
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

    // Confirmed nodes are the only circleMarkers here — the preview cursor
    // dot is not created until the cursor moves.
    const confirmedMarkers = () => window.L.circleMarker.mock.results.map(r => r.value);
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

    clickHandler({ latlng: { lat: 31, lng: 121 } });

    // No cursor moves, so these are the confirmed nodes only.
    const calls = window.L.circleMarker.mock.calls;

    expect(calls[0][1].className).toContain("foliplus-measure-node-solid");

    expect(calls[1][1].className).toBe(CONST.CLASSES.NODE_HOLLOW);
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
  it("registers the overlay cleanup via registerFinalized", () => {
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
    expect(manager.editHandles.size).toBe(1);

    expect(typeof manager.editHandles.get("d_reg").dispose).toBe("function");
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

    // The start path's attachDistanceUI also captured onDelete/onUpdate
    // callbacks (the restore-path variants are covered above). Exercise the
    // start-path callbacks so the store.update/remove lines are covered.
    expect(capturedDistanceOpts).toBeDefined();

    manager.store.update.mockClear();

    capturedDistanceOpts.onUpdate();

    expect(manager.store.update).toHaveBeenCalledWith(saved.id, expect.anything());

    manager.store.remove.mockClear();

    capturedDistanceOpts.onDelete();

    expect(manager.store.remove).toHaveBeenCalledWith(saved.id);

    expect(manager.measurements.length).toBe(0);
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
    expect(manager.editHandles.size).toBe(1);

    expect(() => manager.clearAll()).not.toThrow();
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

  it("removes the preview cursor node when the mode is aborted", () => {
    const manager = makeManagerMock() as any;
    const mode = new DistanceMode(manager);

    manager.currentMode = CONST.MODE.DISTANCE;

    mode.start();

    const handlers = manager.map.on.mock.calls.find(
      ([event]) => event === "mousemove",
    )?.[1];
    const click = manager.map.on.mock.calls.find(([event]) => event === "click")?.[1];

    // Place one point and move, so a live cursor node exists when the mode
    // is aborted. This is the path the finish handler never takes: cleanup
    // runs while the node is still mounted.
    click({ latlng: { lat: 30, lng: 120 } });

    handlers({ latlng: { lat: 31, lng: 121 } });
    const cursor = window.L.circleMarker.mock.results.at(-1).value;

    mode.cleanup();

    expect(manager.layers.removeLayer).toHaveBeenCalledWith(cursor);
  });
});

describe("DistanceMode — preview cursor node", () => {
  it("mounts a non-interactive hollow node only after the first point", () => {
    const manager = makeManagerMock() as any;
    const mode = new DistanceMode(manager);

    manager.currentMode = CONST.MODE.DISTANCE;

    mode.start();

    // Entering the mode adds only the drawing scaffolding — poly, previewLine,
    // finalPoly. A floating dot would have no meaning with no points placed,
    // so nothing is created until the cursor actually moves.
    const addLayerCalls = manager.layers.addLayer.mock.calls;

    expect(addLayerCalls).toHaveLength(3);

    window.L.circleMarker.mockClear();

    const handlers = manager.map.on.mock.calls.find(
      ([event]) => event === "mousemove",
    )?.[1];

    // Before the first point the move handler bails out entirely.
    handlers({ latlng: { lat: 29, lng: 118 } });

    expect(window.L.circleMarker.mock.calls).toHaveLength(0);

    const click = manager.map.on.mock.calls.find(([event]) => event === "click")?.[1];

    click({ latlng: { lat: 30, lng: 120 } });

    handlers({ latlng: { lat: 31, lng: 121 } });

    // Two circleMarkers now exist: the confirmed node for the first point,
    // and this cursor dot. No third one was created.
    expect(window.L.circleMarker.mock.calls).toHaveLength(2);
    const cursorCall = window.L.circleMarker.mock.calls.at(-1) as [unknown, object];

    expect(cursorCall[0]).toEqual({ lat: 31, lng: 121 });

    expect(cursorCall[1].interactive).toBe(false);

    expect(cursorCall[1].className).toBe(CONST.CLASSES.NODE_HOLLOW);

    // Mounted through addPreview, so it lands in the same layer group as the
    // preview line and paints above the preview stroke.
    const cursor = window.L.circleMarker.mock.results.at(-1).value;

    expect(manager.layers.addLayer).toHaveBeenCalledWith(cursor);
  });

  it("moves the node with the cursor and removes it when the shape is finished", () => {
    const manager = makeManagerMock() as any;
    const mode = new DistanceMode(manager);

    manager.currentMode = CONST.MODE.DISTANCE;

    mode.start();

    const handlers = manager.map.on.mock.calls.find(
      ([event]) => event === "mousemove",
    )?.[1];
    const click = manager.map.on.mock.calls.find(([event]) => event === "click")?.[1];

    const contextmenu = manager.map.on.mock.calls.find(
      ([event]) => event === "contextmenu",
    )?.[1];

    click({ latlng: { lat: 30, lng: 120 } });

    click({ latlng: { lat: 31, lng: 121 } });

    handlers({ latlng: { lat: 32, lng: 122 } });
    const cursor = window.L.circleMarker.mock.results.at(-1).value;
    const created = window.L.circleMarker.mock.calls.length;

    // Subsequent moves reuse the same node instead of stacking new ones.
    handlers({ latlng: { lat: 33, lng: 123 } });

    expect(window.L.circleMarker).toHaveBeenCalledTimes(created);

    expect(cursor.setLatLng).toHaveBeenCalledWith({ lat: 33, lng: 123 });

    // Context-menu finishes: the node leaves the map with the other preview
    // artifacts, while the confirmed nodes stay.
    contextmenu({ latlng: { lat: 33, lng: 123 }, originalEvent: {} });

    expect(manager.layers.removeLayer).toHaveBeenCalledWith(cursor);
  });

  it("removes the node when the draw is aborted mid-way", () => {
    const manager = makeManagerMock() as any;
    const mode = new DistanceMode(manager);

    manager.currentMode = CONST.MODE.DISTANCE;

    mode.start();

    const handlers = manager.map.on.mock.calls.find(
      ([event]) => event === "mousemove",
    )?.[1];
    const click = manager.map.on.mock.calls.find(([event]) => event === "click")?.[1];

    const dblclick = manager.map.on.mock.calls.find(
      ([event]) => event === "dblclick",
    )?.[1];

    click({ latlng: { lat: 30, lng: 120 } });

    handlers({ latlng: { lat: 31, lng: 121 } });
    const cursor = window.L.circleMarker.mock.results.at(-1).value;

    // Placing the second point retires the segment preview label — it is
    // replaced by a permanent segment label, so it must leave the map.
    const previewLabel = manager.layers.addLayer.mock.calls.at(-1)[0];

    click({ latlng: { lat: 32, lng: 122 } });

    expect(manager.layers.removeLayer).toHaveBeenCalledWith(previewLabel);

    // Double-clicking with a single point is not a valid distance, so the
    // mode aborts and cleans up instead of finalizing. The cursor node must
    // leave the map with the other drawing scaffolding.
    manager.clearActiveMode = vi.fn();

    dblclick({ latlng: { lat: 31, lng: 121 }, originalEvent: {} });

    expect(manager.layers.removeLayer).toHaveBeenCalledWith(cursor);

    expect(manager.clearActiveMode).toHaveBeenCalled();
  });
});
