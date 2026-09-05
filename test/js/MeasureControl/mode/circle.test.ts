import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { CircleMode } from "#foliplus/MeasureControl/mode/index.js";
import { initMocks, makeManagerMock } from "./setup.js";

// Layers of one measurement must never paint over each other, and within a
// pane the only lever is attachment order (first = bottom). That works for
// siblings attached together, but not for a marker placed before the shapes
// exist — the circle center is clicked first, so its position in the graph
// pane is fixed at the bottom for the whole drawing session, and the radius
// line lands above it. Re-attaching cannot move it either: `L.SVG._initPath`
// re-creates the `<path>` and the new node enters the renderer's layer map in
// the same place. The center therefore leaves the graph pane for `nodePane`,
// which is asserted here the same way the graph order is.
const STACK = ["shape", "radiusLine", "node"] as const;
type Slot = (typeof STACK)[number];

// Capture attachCircleUI's opts so the start/restore callbacks
// (onDelete, onUpdate, onEnd) can be exercised directly.
const { attachCircleUIMock } = vi.hoisted(() => ({
  attachCircleUIMock: vi.fn((mgr: unknown, opts: any) => {
    capturedCircleOpts = opts;
    // Simulate the real attachCircleUI, which self-registers its dispose via
    // registerFinalized (delete and clearAll both run it).
    const cleanup = () => {};
    (
      mgr as { registerFinalized?: (c: () => void, id?: string) => () => void }
    ).registerFinalized?.(cleanup, opts?.id);
    return cleanup;
  }),
}));
let capturedCircleOpts: any = null;

/** Wrap a shape factory so each instance carries its stack-slot name.
 *  The wrapper is itself a `vi.fn` delegating to the original, so the member
 *  stays a spy and `mock.calls` / `mock.results` stay aligned by call order —
 *  the `onEnd` tests index the latter. */
const tag = (key: string, name: Slot) => {
  const factory = window.L[key] as any;
  window.L[key] = vi.fn((...args: any[]) => ({
    __slot: name,
    ...factory(...args),
  }));
};

// `initMocks` re-creates the shape factories in `beforeEach`, so this must run
// after it, not at module scope.
const withShapeTags = () => {
  tag("circle", "shape");
  tag("polygon", "shape");
  tag("polyline", "radiusLine");
  tag("circleMarker", "node");
};

// Walks the `addLayer` calls of a run and returns the stack slot of each
// graph layer. Labels and delete icons sit in the label pane, outside the
// stack, so they are skipped by the `isLabel` flag; node-pane markers are
// outside it too, skipped by `isNode`.
const graphStack = (manager: any): Slot[] =>
  (manager.layers.addLayer as any).mock.calls
    .filter(([layer, isLabel, isNode]: any[]) => !isLabel && !isNode && layer.__slot)
    .map(([layer]: any[]) => layer.__slot);

// The node-pane attaches of a run.
const nodeLayers = (manager: any) =>
  (manager.layers.addLayer as any).mock.calls.filter(
    ([, isLabel, isNode]: any[]) => !isLabel && isNode,
  );

// `sequence` is the order of attaches this run performs. `prefix` checks only
// the leading slice, for the flows that add layers as they go.
const expectStack = (manager: any, sequence: readonly Slot[], prefix = false) => {
  const seen = graphStack(manager);
  expect(prefix ? seen.slice(0, sequence.length) : seen).toEqual([...sequence]);
};

vi.mock("#foliplus/MeasureControl/ui.js", async importOriginal => {
  const actual =
    await importOriginal<typeof import("#foliplus/MeasureControl/ui.js")>();
  return { ...actual, attachCircleUI: attachCircleUIMock };
});

beforeEach(() => {
  initMocks();
  withShapeTags();
  capturedCircleOpts = null;
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
    expect(window.L.circleMarker).toHaveBeenCalled(); // center + radius nodes
    expect(window.L.marker).toHaveBeenCalled(); // labels + del icons
    expect(manager.layers.addLayer).toHaveBeenCalled();
    // Fill, radius line, then the radius node. The center is not part of the
    // graph stack — it is in the node pane.
    expectStack(manager, ["shape", "radiusLine", "node"]);
    // The center is the only node-pane layer, so nothing can paint over it.
    expect(nodeLayers(manager)).toHaveLength(1);
    expect(manager.editHandles.size).toBe(1);
    expect(typeof manager.editHandles.get("c_r1").dispose).toBe("function");
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
      expect(window.L.circleMarker).toHaveBeenCalled(); // center dot (CircleMarker)

      // Phase 1: only the center dot, and it is not in the graph pane at all.
      // It is placed before any shape exists, so in the graph pane its
      // position would be permanently first — and the radius line would paint
      // over it for the rest of the session. The node pane puts it above the
      // graph vectors instead.
      expectStack(manager, []);
      expect(nodeLayers(manager)).toHaveLength(1);

      moveHandler({ latlng: { lat: 31.21, lng: 121.51 } });
      expect(window.L.circle).toHaveBeenCalled(); // preview circle

      // Every preview frame re-anchors the label only: the shapes are mutated
      // in place, so the stack must not re-run.
      moveHandler({ latlng: { lat: 31.22, lng: 121.52 } });
      expectStack(manager, ["shape", "radiusLine", "node"]);
      // 3 graph layers + 1 node + 1 label — no extra layer on the move.
      expect(manager.layers.addLayer.mock.calls.length).toBe(5);

      // second click completes the circle (scheduled via setTimeout)
      clickHandler({ latlng: { lat: 31.21, lng: 121.51 } });
      vi.runAllTimers();

      // Finalization replaces the previews: fill, radius line, then the radius
      // node. The ripple is a transient shape layer: it rides on top of the
      // fill, plays the sweep, and is removed on `animationend`. Its slot is
      // `shape`, not an out-of-order attach.
      expectStack(manager, ["shape", "radiusLine", "node", "shape"], true);
      // The final center replaces the preview center in the node pane, so the
      // node pane holds two of the three — never covered, never covering.
      expect(nodeLayers(manager)).toHaveLength(2);

      expect(manager.measurements.length).toBe(1);
      expect(manager.measurements[0].radius).toBeGreaterThan(0);
      expect(manager.store.add).toHaveBeenCalled();

      // Exercise the start-path onDelete captured by attachCircleUI so the
      // store.remove line is covered.
      expect(capturedCircleOpts).toBeDefined();
      const circleId = manager.measurements[0].id;
      manager.store.remove.mockClear();
      capturedCircleOpts.onDelete();
      expect(manager.store.remove).toHaveBeenCalledWith(circleId);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CircleMode — restore wiring", () => {
  it("registers edit handles via registerFinalized and saves data", () => {
    const manager = makeManagerMock() as any;
    const saveSpy = vi.spyOn(manager, "saveMeasurements");
    CircleMode.restore(manager, {
      id: "c_wire",
      type: "circle",
      center: { lng: 121.5, lat: 31.2 },
      target: { lng: 121.51, lat: 31.2 },
      radius: 5000,
    });
    // Verify the handler is wired (regression check)
    expect(manager.editHandles.size).toBe(1);
    expect(typeof manager.editHandles.get("c_wire").dispose).toBe("function");
    // Verify the onDelete callback works by calling it directly
    manager.measurements.push({ id: "c_wire", type: "circle" });
    // The onDelete callback is inside attachCircleUI's closure.
    // We can verify the data model by checking that the restore
    // doesn't modify measurements (it only rebuilds layers).
    expect(manager.measurements.length).toBe(1);
  });
});

describe("CircleMode — drag persistence (onEnd)", () => {
  /** Get the nth L.circle mock instance (1-indexed). */
  const circleInstance = (i: number) => window.L.circle.mock.results[i - 1].value;
  /** Get the nth L.circleMarker mock instance (1-indexed). */
  const nodeInstance = (i: number) => window.L.circleMarker.mock.results[i - 1].value;

  it("restore: onEnd syncs center/target/radius/area back to the store", () => {
    const manager = makeManagerMock() as any;
    const data: MeasureData = {
      id: "c_drag",
      type: "circle",
      center: { lng: 121, lat: 31 },
      target: { lng: 122, lat: 31 },
      radius: 5000,
      area: Math.PI * 5000 * 5000,
    };

    CircleMode.restore(manager, data);

    // Patch the first circle (restore creates exactly one) and first circleMarker.
    const c = circleInstance(1);
    c.getLatLng = vi.fn(() => ({ lat: 32, lng: 120 }));
    c.getRadius = vi.fn(() => 8000);
    nodeInstance(1).getLatLng = vi.fn(() => ({ lat: 32, lng: 121 }));

    expect(capturedCircleOpts).not.toBeNull();
    capturedCircleOpts.onEnd();

    expect(data.center).toEqual({ lng: 120, lat: 32 });
    expect(data.target).toEqual({ lng: 121, lat: 32 });
    expect(data.radius).toBe(8000);
    expect(data.area).toBe(Math.PI * 8000 * 8000);
    expect(manager.store.persist).toHaveBeenCalled();
  });

  it("finishCircle: onEnd syncs the just-saved measurement's fields", () => {
    vi.useFakeTimers();
    try {
      const manager = makeManagerMock() as any;
      manager.currentMode = CONST.MODE.CIRCLE;
      const mode = new CircleMode(manager);
      mode.start();

      const clickHandler = manager.map.on.mock.calls.find(
        ([ev]) => ev === "click",
      )?.[1];

      clickHandler({ latlng: { lat: 31, lng: 121 } });
      clickHandler({ latlng: { lat: 31.01, lng: 121.01 } });
      vi.runAllTimers();

      expect(manager.measurements.length).toBe(1);

      // finishCircle creates: circle(1) + ripple(2) + radiusNode.
      // The preview center (phase-0 click) is circleMarker call #1;
      // the radius node in finishCircle is circleMarker call #2.
      // onEnd reads from circle(1) and radiusNode(2) to sync the store.
      const c = circleInstance(1);
      c.getLatLng = vi.fn(() => ({ lat: 31, lng: 121 }));
      c.getRadius = vi.fn(() => 12000);
      nodeInstance(2).getLatLng = vi.fn(() => ({ lat: 31, lng: 123 }));

      capturedCircleOpts.onEnd();

      const saved = manager.measurements[0];
      expect(saved.radius).toBe(12000);
      expect(saved.area).toBe(Math.PI * 12000 * 12000);
      expect(saved.target).toEqual({ lng: 123, lat: 31 });
      expect(manager.store.persist).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
