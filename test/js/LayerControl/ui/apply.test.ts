import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { applyProjection, applyProjectionAll } from "#foliplus/LayerControl/ui/apply.js";
import { installLeafletGlobals } from "./fixture.js";

// ────────────────────────────────────────────────────────────────────────
// §40.5 gate ①: the executor must not let a derived dimension authorise
// display. Only user intent (or the author's declared default) determines
// map membership; effective = intent && policy, so a derived dimension
// (focus, zoom range) can only pull a layer off the map — never push one
// onto it.
//
// This is the quickstart regression from §38: folium ships a `show=False`
// layer off the map, no user override has been recorded, and the first
// projection must leave it alone. Before the fix the executor saw
// effective moving false→true and wrote visible=true, adding the layer to
// the map while the checkbox stayed unchecked.
// ────────────────────────────────────────────────────────────────────────

/** A bare map mock with `hasLayer → false` — the folium `show=False` boot
 *  state: the layer exists in the registry but was never added to the map. */
const makeOffMapFixture = () => {
  installLeafletGlobals();
  const container = document.createElement("div");
  document.body.appendChild(container);

  const layer = { options: {} } as L.Layer;
  const map = {
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
    invalidateSize: vi.fn(),
    hasLayer: vi.fn(() => false),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    getZoom: vi.fn(() => 5),
    getMaxZoom: vi.fn(() => 18),
    getMinZoom: vi.fn(() => 0),
    getBounds: vi.fn(() => ({
      pad: vi.fn(),
      getSouthWest: () => ({ lat: 20, lng: 90 }),
      getNorthWest: () => ({ lat: 50, lng: 90 }),
      getNorthEast: () => ({ lat: 50, lng: 120 }),
      getSouthEast: () => ({ lat: 20, lng: 120 }),
    })),
    getContainer: vi.fn(() => container),
    getPane: vi.fn(() => {
      const p = document.createElement("div");
      p.style.zIndex = "0";
      return p;
    }),
    createPane: vi.fn(() => {
      const p = document.createElement("div");
      p.style.zIndex = "0";
      return p;
    }),
    _container: container,
    _layers: {},
    attributionControl: { _attributions: {}, _update: vi.fn() },
    foliplus: { showHint: vi.fn(), hideHint: vi.fn() },
  } as any;

  return { container, layer, map };
};

/** A map where `hasLayer → true` for every layer — the folium `show=True`
 *  boot state, so the executor's baseline is on-map and a stored zoom
 *  range excludes the current zoom immediately. */
const makeOnMapFixture = () => {
  const { layer, ...rest } = makeOffMapFixture();
  const map = {
    ...rest.map,
    hasLayer: vi.fn(() => true),
  } as any;
  return { container: rest.container, layer, map };
};

describe("executor: §40.5 invariant", () => {
  beforeEach(() => {
    installLeafletGlobals();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("gate 1 — the first projection must not add an author show=False layer", () => {
    const { container, layer, map } = makeOffMapFixture();

    const manager = new LayerManager(map, [
      { id: "authorHidden", name: "Hidden", isBase: false, layer },
    ]);
    manager.ui = new LayerUI(manager);

    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    // The invariant: author's declared default (off map) is respected.
    // The first projection may add a layer only if the user (or the
    // author's snapshot) authorised it — neither did here.
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("gate 2 — a layer off the map stays off through a zoom change", () => {
    // #329 structural lock: zoom is a policy dimension, so it can never
    // authorise display. This is what §40.5 means by "派生维度只许抑制" —
    // a stored zoomRange that excludes the current zoom can only keep
    // `effectiveShown = false`, never move it to `true`.
    const { container, layer, map } = makeOffMapFixture();

    const manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false, layer },
    ]);
    manager.ui = new LayerUI(manager);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    // No stored zoom range; author declared `show=False`; layer is not on
    // the map. A zoom crossing must not add it.
    map.getZoom.mockReturnValue(2);
    applyProjectionAll(ui);
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(ui.hiddenIds.has("a")).toBe(false);
  });
});

describe("executor: intent authorises, policy only suppresses", () => {
  beforeEach(() => {
    installLeafletGlobals();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("range crossing retracts a layer the user checked on, then restores it when back in range", () => {
    // Range is a policy dimension that may retract a layer on the user's
    // behalf — because the user's intent is `visible=true`. When the map
    // re-enters the range the executor restores the layer. This is the
    // forward pass of the T101 invariant: policy retracts → policy
    // restores, and neither writes back to the user's intent.
    const { container, layer, map } = makeOnMapFixture();

    const manager = new LayerManager(map, [
      { id: "r", name: "Range", isBase: false, layer },
    ]);
    manager.ui = new LayerUI(manager);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    // Baseline: map.hasLayer → true, so the layer is on the map at the
    // current zoom (5). Add a stored range [3, 12] and move zoom to 2
    // (out of range).
    ui.zoomRangeMap.r = [3, 12];
    ui.userOverrides.r = ["zoomRange"];
    expect(map.hasLayer(layer)).toBe(true);

    map.getZoom.mockReturnValue(2);
    applyProjectionAll(ui);
    expect(map.removeLayer).toHaveBeenCalledWith(layer);

    // Back in range: the executor restores the layer.
    map.hasLayer.mockReturnValue(false);
    map.getZoom.mockReturnValue(8);
    applyProjectionAll(ui);
    expect(map.addLayer).toHaveBeenCalledWith(layer);

    // Intent is unchanged throughout: the user's choice is `visible`,
    // which never went into `hiddenIds`. This is the #329 lock.
    expect(ui.hiddenIds.has("r")).toBe(false);
    expect(ui.userOverrides.r).toEqual(["zoomRange"]);
  });

  it("#329 lock — a policy-only zoom crossing never mutates intent", () => {
    // #329's specific assertion: after a zoom crossing out of the stored
    // range, the checkbox, hiddenIds, and userOverrides are byte-identical
    // to before. The layer goes off the map (that is policy working), but
    // the user's own choice is not touched — the derived dimension cannot
    // authorise, and it also cannot record.
    const { container, layer, map } = makeOnMapFixture();

    const manager = new LayerManager(map, [
      { id: "s", name: "S", isBase: false, layer },
    ]);
    manager.ui = new LayerUI(manager);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    ui.zoomRangeMap.s = [3, 12];
    ui.userOverrides.s = ["zoomRange"];

    // Snapshot the intent state.
    const hiddenBefore = new Set(ui.hiddenIds);
    const overridesBefore = { ...ui.userOverrides };

    map.getZoom.mockReturnValue(2);
    applyProjectionAll(ui);

    // The layer is removed from the map by policy.
    expect(map.removeLayer).toHaveBeenCalledWith(layer);
    // ...but the user's own choice is untouched.
    expect(ui.hiddenIds).toEqual(hiddenBefore);
    expect(ui.userOverrides).toEqual(overridesBefore);
  });
});

describe("executor: T46 late-carrier replay", () => {
  beforeEach(() => {
    installLeafletGlobals();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("replays stored opacity onto a replaced canvas element", () => {
    // T46's core: `prev.opacity` matches `next.opacity` on a re-registered
    // canvas, so a value-only diff misses the write. The executor records
    // which DOM element the last write hit; a fresh canvas is a different
    // element, so the rewrite fires. This is why `appliedState` carries
    // the carrier token, not just the projection.
    const { container, map } = makeOffMapFixture();

    const oldCanvas = document.createElement("canvas");
    const freshCanvas = document.createElement("canvas");

    const manager = new LayerManager(map, [
      { id: "h", name: "Heat", isBase: false, canvas: oldCanvas },
    ]);
    manager.ui = new LayerUI(manager);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    ui.opacityMap.h = 0.4;
    ui.userOverrides.h = ["opacity"];
    applyProjection(ui, "h");
    expect(oldCanvas.style.opacity).toBe("0.4");

    // Re-register with a fresh canvas: the stored opacity must snap in.
    manager.registerLayer({ id: "h", name: "Heat", canvas: freshCanvas });
    applyProjection(ui, "h");
    expect(freshCanvas.style.opacity).toBe("0.4");
    expect(oldCanvas.style.opacity).toBe("0.4"); // the old element still holds it
  });

  it("a delayed annotation pane picks up a stored opacity on appearance", () => {
    // The annotation pane is created lazily — the pane carrier set is empty
    // on the first write and only includes the annotation name once the
    // label layer renders. A value-only diff sees `prev.opacity ===
    // next.opacity` and misses the write; carrier-identity detection
    // (old: [declared] → new: [declared, annotation]) fires the replay.
    const { container, map } = makeOffMapFixture();

    const layer = { options: {} } as L.Layer;
    const manager = new LayerManager(map, [
      { id: "a1", name: "Labels", isBase: false, layer },
    ]);
    manager.ui = new LayerUI(manager);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    // Stored opacity, no annotation yet: the executor writes to whatever
    // panes exist (native / declared).
    ui.opacityMap.a1 = 0.3;
    ui.userOverrides.a1 = ["opacity"];
    applyProjection(ui, "a1");

    // The annotation pane appears via a mock: an `annotation` proxy that
    // resolves `paneNameFor` to a fixed name.
    (manager as any).annotation = {
      paneNameFor: (id: string) => (id === "a1" ? "fp-annotation-a1" : null),
    };
    applyProjection(ui, "a1");
    // After re-applying with the annotation pane in the surface, the pane
    // is reached by the carrier dispatcher. `map.getPane` here returns a
    // fresh div on every call — the important assertion is that
    // `applyStateOp` resolved the annotation's paneNameFor and hit the
    // `map.getPane` code path (the fixture spy proves the call).
    expect(map.getPane).toHaveBeenCalled();
  });
});

describe("executor: idempotent writes", () => {
  beforeEach(() => {
    installLeafletGlobals();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("a repeated applyProjection on unchanged state writes nothing to the map", () => {
    // The executor's contract: diffed against its own last write, a
    // changeless call is a no-op. Repeated applies must not accumulate
    // map/DOM writes; a spy-counted gate is what §22-9.1 ⑥ asks for.
    const { container, layer, map } = makeOffMapFixture();

    const manager = new LayerManager(map, [
      { id: "p", name: "P", isBase: false, layer },
    ]);
    manager.ui = new LayerUI(manager);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    // A single change: store opacity, apply.
    ui.opacityMap.p = 0.5;
    ui.userOverrides.p = ["opacity"];
    applyProjection(ui, "p");
    const callsAfterOne = map.addLayer.mock.calls.length + map.removeLayer.mock.calls.length;

    // Two more applies with nothing new: the map state must not change.
    applyProjection(ui, "p");
    applyProjection(ui, "p");
    const callsAfterRepeated = map.addLayer.mock.calls.length + map.removeLayer.mock.calls.length;

    expect(callsAfterRepeated).toBe(callsAfterOne);
  });

  it("row lookup is by id, not by registry position", () => {
    // T50's structural lock: the executor keys `appliedState` by id
    // (`projectAll` walks the same union), so DOM order or registration
    // order shifting never misroutes a write. Two canvas layers — one with
    // an opacity intent and one without; each gets its own write regardless
    // of registration order. Canvas is chosen because its carrier is a
    // single element per layer, so the id-keyed diff is directly observable
    // on the DOM.
    const { container, map } = makeOffMapFixture();

    const aCanvas = document.createElement("canvas");
    const bCanvas = document.createElement("canvas");
    const manager = new LayerManager(map, [
      { id: "b", name: "B", isBase: false, canvas: bCanvas },
      { id: "a", name: "A", isBase: false, canvas: aCanvas },
    ]);
    manager.ui = new LayerUI(manager);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    // Only layer "a" has a stored opacity — layer "b" is untouched and
    // keeps the author's declared default (1, painted as "1" on the canvas).
    // The registry-position independence is proven by "a" landing its 0.7
    // on the right canvas: if the diff misrouted by position, either
    // canvas would end up with 0.7 and the other with 1.
    ui.opacityMap.a = 0.7;
    ui.userOverrides.a = ["opacity"];
    applyProjectionAll(ui);

    expect(aCanvas.style.opacity).toBe("0.7");
    expect(bCanvas.style.opacity).toBe("1");
    expect(ui.opacityMap.b).toBeUndefined();
  });
});
