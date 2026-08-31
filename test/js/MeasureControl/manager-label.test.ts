// MeasureManager label-collision lifecycle — end-to-end: registerLabel binds
// map-move events lazily, defers a placement plan to the next frame, and
// re-plans when the label set changes. The pure planner (placeLabels /
// segmentDir / perpCandidates) is tested directly in collision.test.ts; here we
// only exercise the manager as the real integration point. We mock the
// collision module (via vi.hoisted, so the spy is active at module import time)
// to capture what the manager feeds it without ever running the real (DOM-
// mutating) planner.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { MeasureManager } from "#foliplus/MeasureControl/manager.js";

type CollidableLabel = {
  marker: L.Marker;
  candidates: (p: unknown) => Array<[number, number]>;
  priority: number;
};

const { placeLabels, segmentDir, perpCandidates } = vi.hoisted(() => ({
  placeLabels: vi.fn(() => 0),
  segmentDir: vi.fn(() => [1, 0]),
  perpCandidates: (dir: [number, number]) => {
    const [dx, dy] = dir;
    const len = Math.hypot(dx, dy) || 1;
    return [
      [-dy / len, dx / len],
      [dy / len, -dx / len],
    ] as Array<[number, number]>;
  },
}));

vi.mock("#foliplus/MeasureControl/collision.js", () => ({
  placeLabels,
  segmentDir,
  perpCandidates,
  mapProjector: () => ({
    px: () => ({ x: 0, y: 0 }),
    box: () => ({ x: 0, y: 0, w: 64, h: 18 }),
  }),
}));

beforeEach(() => {
  // The real placeLabels calls each label's `candidates(projector)` thunk when
  // planning — that's where segmentDir runs. Invoke the thunk so the manager's
  // live-endpoint direction derivation is exercised. Re-set after mockReset().
  placeLabels.mockImplementation(
    (labels: Array<{ candidates?: (p: unknown) => unknown }>) =>
      labels.forEach(lb => lb.candidates?.({} as unknown as Projector)),
  );
});

function mockLayerAPI() {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    clearLayers: vi.fn(),
    addLayer: vi.fn(l => l),
    removeLayer: vi.fn(),
    mainLayer: { addLayer: vi.fn() },
  };
}

function makeManager(conf: Partial<typeof window.CONF> = {}) {
  window.CONF = { name: "MeasureControl", locale_code: "en", ...conf };

  const layers = mockLayerAPI();
  const container = document.createElement("div");
  container.id = "test-map";
  const map = {
    getContainer: () => container,
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
    foliplus: {
      showHint: vi.fn(),
      hideHint: vi.fn(),
      LayerAPI: { createLayers: vi.fn(() => layers) },
    },
  };

  return { manager: new MeasureManager(map), map, container, layers };
}

// A real DOM chip nested inside a mock L.Marker so chipOf(marker) —
// marker.getElement().querySelector(".foliplus-measure-label") — resolves.
function makeLabelMarker(): L.Marker {
  const chip = document.createElement("div");
  chip.className = "foliplus-measure-label";
  const icon = document.createElement("span");
  icon.appendChild(chip);
  const marker = {
    getElement: vi.fn(() => icon),
    on: vi.fn(),
    off: vi.fn(),
    setLatLng: vi.fn(),
  };
  return marker as unknown as L.Marker;
}

// requestAnimationFrame is unavailable in jsdom/node — defer each callback to
// the next microtask so it behaves like a real async paint frame. The manager's
// labelPlanFrame re-entrancy guard only works if the callback does NOT run
// synchronously on the same stack as the schedule call.
let rafQueue: Array<() => void> = [];
function flushRaf() {
  while (rafQueue.length) {
    const q = rafQueue;
    rafQueue = [];
    q.forEach(cb => cb());
  }
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.L.marker = vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    getElement: vi.fn(() => null),
    setLatLng: vi.fn(),
  }));
  window.CONF.collide_labels = undefined;
  window.CONF.show_labels = undefined;
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    rafQueue.push(cb);
    return 1;
  });
  placeLabels.mockReset();
  segmentDir.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  rafQueue = [];
  document.body.innerHTML = "";
});

describe("MeasureManager — registerLabel lifecycle", () => {
  it("runs a placement plan on the next frame after registering a label", () => {
    const { manager } = makeManager();
    const marker = makeLabelMarker();

    manager.registerLabel(
      marker,
      () => [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
      60,
    );

    flushRaf();
    expect(placeLabels).toHaveBeenCalledTimes(1);
    expect((placeLabels.mock.calls[0][0] as CollidableLabel[]).length).toBe(1);
  });

  it("passes the collide flag through to placeLabels", () => {
    const { manager } = makeManager({ collide_labels: true });
    const marker = makeLabelMarker();
    manager.registerLabel(
      marker,
      () => [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
      60,
    );

    flushRaf();
    expect(placeLabels.mock.calls[0][2] as boolean).toBe(true);
  });

  it("passes collide=false through when detection is off", () => {
    const { manager } = makeManager({ collide_labels: false });
    const marker = makeLabelMarker();
    manager.registerLabel(
      marker,
      () => [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
      60,
    );

    flushRaf();
    expect(placeLabels.mock.calls[0][2] as boolean).toBe(false);
  });

  it("labelsCollide reads collide_labels from CONF and defaults to true", () => {
    const { manager } = makeManager();
    expect(manager.labelsCollide).toBe(true);

    window.CONF.collide_labels = false;
    expect(manager.labelsCollide).toBe(false);
  });

  it("carries the endpoint closure as a callable on the label and re-evaluates it on each plan", () => {
    const { manager } = makeManager();
    const marker = makeLabelMarker();
    const endpointSpy = vi.fn(() => [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
    ]);

    manager.registerLabel(marker, endpointSpy, 60);

    flushRaf();
    const label = (placeLabels.mock.calls[0][0] as CollidableLabel[])[0]!;
    expect(label.marker).toBe(marker);
    expect(label.priority).toBe(60);
    expect(typeof label.candidates).toBe("function");

    // The candidates() call re-derives directions from the live endpoint
    // closure — verifying it is actually evaluated (not a stale constant) by
    // confirming the endpoint closure is invoked each time the planner asks
    // for candidates.
    const dirs = label.candidates({
      px: (ll: L.LatLng) => ({ x: ll.lng, y: ll.lat }) as L.Point,
      box: () => ({ x: 0, y: 0, w: 64, h: 18 }),
    });
    expect(endpointSpy).toHaveBeenCalledTimes(1);
    const dirs2 = label.candidates({
      px: (ll: L.LatLng) => ({ x: ll.lng, y: ll.lat }) as L.Point,
      box: () => ({ x: 0, y: 0, w: 64, h: 18 }),
    });
    expect(endpointSpy).toHaveBeenCalledTimes(2);
    expect(dirs.length).toBeGreaterThanOrEqual(2);
    expect(dirs2.length).toBeGreaterThanOrEqual(2);
  });

  it("re-plans the live label set when a map-move event fires", () => {
    const { manager, map } = makeManager();
    const marker = makeLabelMarker();

    manager.registerLabel(
      marker,
      () => [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
      60,
    );
    flushRaf();
    const initialCalls = placeLabels.mock.calls.length;

    const moveendCall = map.on.mock.calls.find(
      ([ev]: [string]) => ev === "moveend",
    )![1];

    moveendCall();
    flushRaf();
    expect(placeLabels.mock.calls.length).toBe(initialCalls + 1);
  });

  it("re-plans a smaller set when a label is removed mid-measurement", () => {
    const { manager } = makeManager();
    const a = makeLabelMarker();
    const b = makeLabelMarker();

    const unregisterA = manager.registerLabel(
      a,
      () => [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
      60,
    );
    flushRaf();
    expect((placeLabels.mock.calls[0][0] as CollidableLabel[]).length).toBe(1);

    manager.registerLabel(
      b,
      () => [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
      60,
    );
    flushRaf();
    expect((placeLabels.mock.calls[1][0] as CollidableLabel[]).length).toBe(2);

    unregisterA();
    flushRaf();

    expect(placeLabels).toHaveBeenCalledTimes(3); // reg a, reg b, unreg a
    const last = placeLabels.mock.calls[2] as [CollidableLabel[]];
    expect(last[0].length).toBe(1);
    expect(last[0][0]!.marker).toBe(b);
  });
});

describe("MeasureManager — map event binding", () => {
  it("binds move/zoom/resize events lazily on the first label", () => {
    const { manager, map } = makeManager();

    expect(map.on).not.toHaveBeenCalledWith("moveend", expect.any(Function));

    manager.registerLabel(
      makeLabelMarker(),
      () => [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
      60,
    );

    expect(map.on).toHaveBeenCalledWith("moveend", expect.any(Function));
    expect(map.on).toHaveBeenCalledWith("zoomend", expect.any(Function));
    expect(map.on).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("unbinds all map events when the last label is removed", () => {
    const { manager, map } = makeManager();
    const marker = makeLabelMarker();

    const unregister = manager.registerLabel(
      marker,
      () => [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
      60,
    );
    flushRaf();

    unregister();
    flushRaf();

    expect(map.off).toHaveBeenCalledWith("moveend", expect.any(Function));
    expect(map.off).toHaveBeenCalledWith("zoomend", expect.any(Function));
    expect(map.off).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("keeps map events bound while a second label is still registered", () => {
    const { manager } = makeManager();
    const a = makeLabelMarker();
    const b = makeLabelMarker();

    const unregisterA = manager.registerLabel(
      a,
      () => [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
      60,
    );
    flushRaf();
    manager.registerLabel(
      b,
      () => [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
      60,
    );
    flushRaf();

    unregisterA();
    flushRaf();

    // reg a → reg b → unreg a = 3 plans total, all while the events stay bound.
    expect(placeLabels).toHaveBeenCalledTimes(3);
    expect(manager.map.off).not.toHaveBeenCalledWith("moveend", expect.any(Function));
  });

  it("rebinds map events after a fresh register following a full unbind", () => {
    const { manager, map } = makeManager();
    const marker = makeLabelMarker();

    const unregister = manager.registerLabel(
      marker,
      () => [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
      60,
    );
    flushRaf();
    unregister();
    flushRaf();

    const offBefore = map.off.mock.calls.length;

    manager.registerLabel(
      marker,
      () => [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
      60,
    );
    flushRaf();

    expect(map.on).toHaveBeenCalledWith("moveend", expect.any(Function));
    expect(map.on).toHaveBeenCalledWith("zoomend", expect.any(Function));
    expect(map.on).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(map.off.mock.calls.length).toBe(offBefore);
  });
});

describe("MeasureManager — show_labels gate", () => {
  it("registerLabel is a no-op when show_labels is off (no plan, no map events)", () => {
    const { manager, map } = makeManager({ show_labels: false });
    const marker = makeLabelMarker();

    const unregister = manager.registerLabel(
      marker,
      () => [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
      60,
    );

    expect(placeLabels).not.toHaveBeenCalled();
    expect(map.on).not.toHaveBeenCalledWith("moveend", expect.any(Function));
    expect(() => unregister()).not.toThrow();
  });

  it("adds the labels-hidden class on construction when show_labels is false", () => {
    const { container } = makeManager({ show_labels: false });
    expect(container.classList.contains(CONST.CLASSES.LABELS_HIDDEN)).toBe(true);
  });

  it("leaves the labels-hidden class absent when show_labels is true", () => {
    const { container } = makeManager({ show_labels: true });
    expect(container.classList.contains(CONST.CLASSES.LABELS_HIDDEN)).toBe(false);
  });
});

describe("MeasureManager — label cleanup", () => {
  it("destroy clears the label set and unbinds map events", () => {
    const { manager, map } = makeManager();
    const marker = makeLabelMarker();

    manager.registerLabel(
      marker,
      () => [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
      60,
    );
    flushRaf();

    manager.destroy();

    expect(map.off).toHaveBeenCalledWith("moveend", expect.any(Function));
    expect(map.off).toHaveBeenCalledWith("zoomend", expect.any(Function));
    expect(map.off).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("destroy unbinds map events safely even when no label was ever registered", () => {
    const { manager, map } = makeManager();

    expect(() => manager.destroy()).not.toThrow();
    expect(map.off).not.toHaveBeenCalledWith("moveend", expect.any(Function));
  });
});
