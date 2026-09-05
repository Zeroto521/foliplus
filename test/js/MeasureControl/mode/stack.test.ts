// Asserts each mode attaches its graph layers in the `LAYER_STACK` order.
// The stack is the z-order (first = bottom, last = top), so the only way to
// keep a later sibling from covering an earlier one is to attach once, in that
// order — there is no `bringToFront()` left to re-order after the fact. The
// preview stack breaks in the same way, so the circle preview flow is checked
// through the same helper.
//
// `LAYER_STACK` itself is not imported: it is an inline declaration in
// MeasureControl/const.ts that esbuild tree-shakes out of the bundle because
// nothing at runtime reads it. So the order is asserted against `STACK` here —
// the test's copy of the declaration — and what a reorder costs is this test
// failing, which keeps the constant honest.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { CircleMode } from "#foliplus/MeasureControl/mode/circle.js";
import { DistanceMode } from "#foliplus/MeasureControl/mode/distance.js";
import { PolygonMode } from "#foliplus/MeasureControl/mode/polygon.js";
import { initMocks, makeManagerMock } from "./setup.js";

// The declaration under test. Keep in step with `LAYER_STACK` in
// MeasureControl/const.ts.
const STACK = ["shape", "radiusLine", "node"] as const;
type Slot = (typeof STACK)[number];

const { noopUI } = vi.hoisted(() => ({ noopUI: vi.fn() }));
vi.mock("#foliplus/MeasureControl/ui.js", async importOriginal => {
  const mod = await importOriginal<typeof import("#foliplus/MeasureControl/ui.js")>();
  return {
    ...mod,
    attachCircleUI: noopUI,
    attachDistanceUI: noopUI,
    attachPolygonUI: noopUI,
  };
});

/** Attach a shape factory so its instances carry a stack-slot tag. */
const tag =
  (name: Slot) =>
  (factory: any) =>
  (...args: any[]) => ({
    __slot: name,
    ...factory(...args),
  });

// Tag the three shape factories. `initMocks` re-creates all of them in
// `beforeEach`, so this must run after it, not at module scope.
const withShapeTags = () => {
  window.L.circle = tag("shape")(window.L.circle);
  window.L.polygon = tag("shape")(window.L.polygon);
  window.L.polyline = tag("radiusLine")(window.L.polyline);
  window.L.circleMarker = tag("node")(window.L.circleMarker);
};

const makeManager = () => makeManagerMock() as any;

// Walks the `addLayer` calls of a run and returns the stack slot of each graph
// layer. Labels and delete icons are markers in the label pane, outside the
// stack, so they are skipped — by the `isLabel` flag and by the absence of a
// slot tag.
const graphStack = (manager: any): Slot[] =>
  (manager.layers.addLayer as any).mock.calls
    .filter(([layer, isLabel]: any[]) => !isLabel && layer.__slot)
    .map(([layer]: any[]) => layer.__slot);

// `sequence` = the slots this measurement draws, in the order it attaches
// them. `atLeast(i)` = the prefix assertion, for the flows that add layers as
// they go. The order is the only thing asserted; the count is a consequence.
const expectStack = (manager: any, sequence: readonly Slot[], atLeast = false) => {
  const seen = graphStack(manager);
  expect(atLeast ? seen.slice(0, sequence.length) : seen).toEqual([...sequence]);
};

beforeEach(() => {
  initMocks();
  withShapeTags();
});

describe("MeasureControl — LAYER_STACK attachment order", () => {
  it("restored circle: fill, radius line, then nodes", () => {
    const manager = makeManager();
    manager.currentMode = null;
    CircleMode.restore(manager, {
      id: "c_stack",
      type: "circle",
      center: { lng: 121.5, lat: 31.2 },
      target: { lng: 121.51, lat: 31.2 },
      radius: 5000,
    });
    expectStack(manager, ["shape", "radiusLine", "node", "node"]);
  });

  it("restored distance: line, then nodes", () => {
    const manager = makeManager();
    DistanceMode.restore(manager, {
      id: "d_stack",
      type: "distance",
      points: [
        { lng: 121, lat: 30 },
        { lng: 122, lat: 31 },
      ],
      segments: [],
      totalDistance: 0,
    });
    expectStack(manager, ["radiusLine", "node", "node"]);
  });

  it("restored polygon: fill, then nodes", () => {
    const manager = makeManager();
    PolygonMode.restore(manager, {
      id: "p_stack",
      type: "polygon",
      points: [
        { lng: 121, lat: 31 },
        { lng: 122, lat: 31 },
        { lng: 121.5, lat: 32 },
      ],
      segments: [],
      area: 50000,
    });
    expectStack(manager, ["shape", "node", "node", "node"]);
  });

  it("circle preview + finalize: stack order holds, no re-attach", () => {
    vi.useFakeTimers();
    try {
      const manager = makeManager();
      manager.currentMode = CONST.MODE.CIRCLE;
      new CircleMode(manager).start();

      const click = manager.map.on.mock.calls.find(([ev]) => ev === "click")?.[1];
      const move = manager.map.on.mock.calls.find(([ev]) => ev === "mousemove")?.[1];

      // Phase 1: only the center dot, the final stack entry.
      click({ latlng: { lat: 31.2, lng: 121.5 } });
      expectStack(manager, ["node"]);

      // Every preview frame re-anchors the label only — the shapes are
      // mutated in place, so the stack must not re-run.
      move({ latlng: { lat: 31.21, lng: 121.51 } });
      move({ latlng: { lat: 31.22, lng: 121.52 } });
      expectStack(manager, ["node", "shape", "radiusLine", "node"]);
      // 4 graph layers + 1 label — no fifth graph layer on the move.
      expect(manager.layers.addLayer.mock.calls.length).toBe(5);

      click({ latlng: { lat: 31.22, lng: 121.52 } });
      vi.runAllTimers();
      // Finalization replaces the previews: fill, radius line, then the nodes.
      // The ripple is a transient shape layer: it rides on top of the fill,
      // plays the sweep, and is removed on `animationend`. Its slot is
      // `shape`, not an out-of-order attach.
      expectStack(
        manager,
        [
          "node",
          "shape",
          "radiusLine",
          "node",
          "shape",
          "shape",
          "radiusLine",
          "node",
          "node",
        ],
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
