import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import {
  GROUP,
  HIDDEN,
  LayerRuntimeStore,
  PANE_ROLE,
  carrierTargetOf,
  contentPanesOf,
} from "#core/layer/index.js";
import { LayerController } from "#foliplus/LayerControl/controller.js";
import { LayerIntentStore } from "#foliplus/LayerControl/domain/index.js";
import {
  applyProjection,
  applyProjectionAll,
  authorZoomBoundsForLayer,
  dispatchStateOp,
  notifyDelta,
} from "#foliplus/LayerControl/ui/apply.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { clearIntent, getIntent, setIntent } from "#foliplus/LayerControl/ui/intent.js";
import { intentVisibleOf, projectLayer } from "#foliplus/LayerControl/ui/projection.js";
import { getLayerAlpha } from "#common/canvasAlpha.js";
import {
  TEST_ENV,
  findItem,
  initFixture,
  installLeafletGlobals,
  polygonLayer,
  trackMembership,
} from "./fixture.js";

// The carrier contract promises pane coverage only for layers whose leaves
// the migrator can relocate (Path / Marker / GridLayer / ImageOverlay). These
// executor tests exercise the pane write, so their stand-in layers declare
// the Path family identity instead of staying anonymous objects.
const paneCapableLayer = (extra: Record<string, unknown> = {}): L.Layer => {
  const layer = { options: {}, ...extra } as unknown as L.Layer;
  Object.setPrototypeOf(layer, new window.L.Path());
  return layer;
};

// ────────────────────────────────────────────────────────────────────────
// Gate: the executor must not let a derived dimension authorize
// display. Only user intent (or the author's declared default) determines
// map membership; effective = intent && policy, so a derived dimension
// (focus, zoom range) can only pull a layer off the map — never push one
// onto it.
//
// This is the quickstart regression: folium ships a `show=False`
// layer off the map, no user override has been recorded, and the first
// projection must leave it alone. Before the fix the executor saw
// effective moving false → true and wrote visible=true, adding the layer to
// the map while the checkbox stayed unchecked.
// ────────────────────────────────────────────────────────────────────────

/** A bare map mock with `hasLayer → false` — the folium `show=False` boot
 *  state: the layer exists in the registry but was never added to the map. */
const makeOffMapFixture = () => {
  installLeafletGlobals();
  const container = document.createElement("div");
  document.body.appendChild(container);

  const layer = paneCapableLayer();
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
    options: { maxZoom: 18 },
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
    getPanes: vi.fn(() => ({ mapPane: null })),
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

describe("executor: only intent authorises display", () => {
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

    const manager = new LayerController(map, [
      { id: "authorHidden", name: "Hidden", group: "overlay", layer, show: false },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);

    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    // The invariant: author's declared default (off map) is respected.
    // The first projection may add a layer only if the user (or the
    // author's snapshot) authorized it — neither did here.
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("gate 2 — a layer off the map stays off through a zoom change", () => {
    // #329 structural lock: zoom is a policy dimension, so it can never
    // authorize display. A derived dimension may only suppress, never
    // a stored zoomRange that excludes the current zoom can only keep
    // `effectiveShown = false`, never move it to `true`.
    const { container, layer, map } = makeOffMapFixture();

    const manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay", layer, show: false },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
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
    expect(getIntent(ui, "a", "visible")).not.toBe(false);
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
    // forward pass of the invariant: policy retracts -> policy
    // restores, and neither writes back to the user's intent.
    const { container, layer, map } = makeOnMapFixture();

    const manager = new LayerController(map, [
      { id: "r", name: "Range", group: "overlay", layer },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    // Baseline: map.hasLayer → true, so the layer is on the map at the
    // current zoom (5). Add a stored range [3, 12] and move zoom to 2
    // (out of range).
    setIntent(ui, "r", "zoomRange", [3, 12]);
    ui.intentStore.seedProvenance("r", ["zoomRange"]);
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
    // which never went into `intents.visible`. This is the #329 lock.
    expect(getIntent(ui, "r", "visible")).not.toBe(false);
    expect(ui.intentStore.dumpProvenance().r).toEqual(["zoomRange"]);
  });

  it("#329 lock — a policy-only zoom crossing never mutates intent", () => {
    // #329's specific assertion: after a zoom crossing out of the stored
    // range, the checkbox, intent values, and provenance are byte-identical
    // to before. The layer goes off the map (that is policy working), but
    // the user's own choice is not touched — the derived dimension cannot
    // authorize, and it also cannot record.
    const { container, layer, map } = makeOnMapFixture();

    const manager = new LayerController(map, [
      { id: "s", name: "S", group: "overlay", layer },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    setIntent(ui, "s", "zoomRange", [3, 12]);
    ui.intentStore.seedProvenance("s", ["zoomRange"]);

    // Snapshot the intent state.
    const hiddenBefore = ui.intentStore.dumpIntents();
    const overridesBefore = ui.intentStore.dumpProvenance();

    map.getZoom.mockReturnValue(2);
    applyProjectionAll(ui);

    // The layer is removed from the map by policy.
    expect(map.removeLayer).toHaveBeenCalledWith(layer);
    // ...but the user's own choice is untouched.
    expect(ui.intentStore.dumpIntents()).toEqual(hiddenBefore);
    expect(ui.intentStore.dumpProvenance()).toEqual(overridesBefore);
  });
});

describe("executor: late-carrier replay", () => {
  beforeEach(() => {
    installLeafletGlobals();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("replays stored opacity onto a replaced canvas element", () => {
    // The core case: `prev.opacity` matches `next.opacity` on a re-registered
    // canvas, so a value-only diff misses the write. The executor records
    // which DOM element the last write hit; a fresh canvas is a different
    // element, so the rewrite fires. This is why the runtime `applied` row carries
    // the carrier token, not just the projection.
    const { container, map } = makeOffMapFixture();

    const oldCanvas = document.createElement("canvas");
    const freshCanvas = document.createElement("canvas");

    const manager = new LayerController(map, [
      { id: "h", name: "Heat", group: "overlay", canvas: oldCanvas },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    setIntent(ui, "h", "opacity", 0.4);
    ui.intentStore.seedProvenance("h", ["opacity"]);
    applyProjection(ui, "h");
    // Default "redraw" arm: CSS live + layerAlpha stored for the next paint.
    expect(oldCanvas.style.opacity).toBe("0.4");
    expect(getLayerAlpha(oldCanvas)).toBeCloseTo(0.4);

    // Re-register with a fresh canvas: the stored opacity must snap in.
    manager.registerLayer({ id: "h", name: "Heat", canvas: freshCanvas });
    applyProjection(ui, "h");
    expect(freshCanvas.style.opacity).toBe("0.4");
    expect(getLayerAlpha(freshCanvas)).toBeCloseTo(0.4);
    expect(oldCanvas.style.opacity).toBe("0.4"); // the old element still holds it
    expect(getLayerAlpha(oldCanvas)).toBeCloseTo(0.4);
  });

  it("the label pane rides the surface's pane set — the first write covers it", () => {
    // Third cut of the dimension-registry series: the label pane is a
    // DECLARED `role: "annotation"`
    // PaneSpec of the layer's surface — the registration edge appends it
    // iff the layer's features expose a labelable field, and `carrierOf` /
    // the pane write read `surface.paneNames` alone. No side channel, no
    // late-carrier replay: the pane exists from surface construction, so
    // the stored value lands on it with the very first write. Settled
    // state rewrites nothing.
    const { container, map } = makeOffMapFixture();

    // Stable panes per name, so a write and a later read can meet.
    const panes = new Map<string, HTMLDivElement>();
    const paneFor = (name: string) => {
      let pane = panes.get(name);
      if (!pane) {
        pane = document.createElement("div");
        panes.set(name, pane);
      }
      return pane;
    };
    map.getPane = vi.fn((name: string) => paneFor(name));
    map.createPane = vi.fn((name: string) => paneFor(name));

    // A layer whose features carry a labelable field — the declaration
    // edge's probe (`hasLabelField`) hits, so the annotation spec rides
    // the surface's pane list.
    const layer = paneCapableLayer({ feature: { properties: { name: "Depot" } } });

    const manager = new LayerController(map, [
      { id: "a1", name: "Labels", group: "overlay", layer },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;

    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    // The structural claim of this cut: the declared pane is part of the
    // face — the old `annotation.paneNameFor` side channel could never
    // satisfy this, which is what makes the test red without the fix.
    const li = manager.layerRegistry.get("a1")!;
    expect(manager.surfaceFor(li).paneNames).toContain("foliplus-annotation-a1");

    // Stored opacity: the first write covers every declared non-annotation
    // pane. The label pane is excluded from CSS (R11 bakes layerAlpha into
    // AnnotationCanvas draws) so the two carriers never double-compound.
    const applyAlpha = vi.spyOn(ui.c.annotation, "applyLayerAlpha");
    setIntent(ui, "a1", "opacity", 0.3);
    ui.intentStore.seedProvenance("a1", ["opacity"]);
    applyProjection(ui, "a1");
    expect(paneFor("foliplus-annotation-a1").style.opacity).toBe("");
    // The annotation manager received the bake write for this layer.
    expect(applyAlpha).toHaveBeenCalledWith("a1", 0.3);

    // Settled: value and carrier unchanged, so nothing is written again.
    (map.getPane as ReturnType<typeof vi.fn>).mockClear();
    applyProjection(ui, "a1");
    applyProjection(ui, "a1");
    expect(map.getPane).not.toHaveBeenCalled();
  });

  it("the write token and the export walk resolve one pane set", () => {
    // The executor keys its rewrite decision on `carrierTargetOf`; the exporter
    // walks `contentPanesOf` over the same declaration. Both read one carrier
    // per layer, so the panes a rewrite targets must be the panes an export
    // draws — asserted here against a real surface rather than a stub.
    const { container, map } = makeOffMapFixture();
    const panes = new Map<string, HTMLDivElement>();
    const paneFor = (name: string) => {
      let pane = panes.get(name);
      if (!pane) {
        pane = document.createElement("div");
        panes.set(name, pane);
      }
      return pane;
    };
    map.getPane = vi.fn((name: string) => paneFor(name));
    map.createPane = vi.fn((name: string) => paneFor(name));

    const layer = paneCapableLayer();
    const manager = new LayerController(map, [
      { id: "t1", name: "Token", group: "overlay", layer },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);

    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    const li = manager.layerRegistry.get("t1")!;
    const surface = manager.surfaceFor(li);
    expect(surface.capabilities.opacity).toBe("pane");
    expect(surface.paneNames.length).toBeGreaterThan(0);

    const token = carrierTargetOf({
      canvas: li.canvas,
      layer: li.layer,
      panes: surface.paneNames,
      opacityTier: surface.capabilities.opacity,
    });
    const shadowPanes = new Set(
      surface.panes
        .filter(pane => pane.role === PANE_ROLE.SHADOW)
        .map(pane => pane.name),
    );
    const exported = contentPanesOf(surface.paneNames, shadowPanes);

    expect(typeof token).toBe("string");
    expect((token as string).split("|")).toEqual([...exported].sort());
  });
});

describe("executor: coalesced redraw-arm repaint", () => {
  beforeEach(() => {
    installLeafletGlobals();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("drags write CSS synchronously; one repaint lands 60ms after the last commit", () => {
    vi.useFakeTimers();

    const { container, map } = makeOffMapFixture();
    const canvas = document.createElement("canvas");
    const onOpacity = vi.fn();

    const manager = new LayerController(map, [
      { id: "h", name: "Heat", group: "overlay", canvas, onOpacity },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    ui.attachUI(container);

    // attachUI triggers an initial projection (repaintMode="none"), so
    // onOpacity is NOT called (no repaint). CSS opacity is set to the
    // default (1), but the canvas is not repainted.
    expect(onOpacity).not.toHaveBeenCalled();
    const initialCalls = onOpacity.mock.calls.length;

    const commit = (value: number) => {
      setIntent(ui, "h", "opacity", value);
      ui.intentStore.seedProvenance("h", ["opacity"]);
      applyProjection(ui, "h", "debounce");
    };

    // First commit: CSS + WeakMap written synchronously. The repaint is
    // deferred via the 60ms debounce, so onOpacity count is unchanged.
    commit(0.8);
    expect(canvas.style.opacity).toBe("0.8");
    expect(getLayerAlpha(canvas)).toBeCloseTo(0.8);
    expect(onOpacity.mock.calls.length).toBe(initialCalls);

    // Three rapid commits within 20ms each. CSS + WeakMap track the drag
    // synchronously on every commit; the debounce timer resets on each
    // one so no repaint fires yet.
    vi.advanceTimersByTime(20);
    commit(0.5);
    expect(canvas.style.opacity).toBe("0.5");
    expect(getLayerAlpha(canvas)).toBeCloseTo(0.5);
    expect(onOpacity.mock.calls.length).toBe(initialCalls);

    vi.advanceTimersByTime(20);
    commit(0.3);
    expect(canvas.style.opacity).toBe("0.3");
    expect(getLayerAlpha(canvas)).toBeCloseTo(0.3);
    expect(onOpacity.mock.calls.length).toBe(initialCalls);

    vi.advanceTimersByTime(20);
    commit(0.1);
    expect(canvas.style.opacity).toBe("0.1");
    expect(getLayerAlpha(canvas)).toBeCloseTo(0.1);
    expect(onOpacity.mock.calls.length).toBe(initialCalls);

    // 30ms of the 60ms window has elapsed since the 0.1 commit -- still
    // too early for the debounce to fire.
    vi.advanceTimersByTime(30);
    expect(onOpacity.mock.calls.length).toBe(initialCalls);

    // 60ms of quiet from the 0.1 commit. The debounced repaint fires
    // exactly once with the LATEST WeakMap value (0.1), converging the
    // pixel state to the slider's terminal position without any
    // pan/zoom event.
    vi.advanceTimersByTime(30);
    expect(onOpacity.mock.calls.length).toBe(initialCalls + 1);
    expect(onOpacity).toHaveBeenCalledWith(0.1);

    // No trailing repaint queued: advancing further does not fire again.
    vi.advanceTimersByTime(500);
    expect(onOpacity.mock.calls.length).toBe(initialCalls + 1);

    manager.destroy();
    vi.useRealTimers();
  });

  it("commit arm paints synchronously and schedules no timer", () => {
    vi.useFakeTimers();

    const { container, map } = makeOffMapFixture();
    const canvas = document.createElement("canvas");
    const onOpacity = vi.fn();

    const manager = new LayerController(map, [
      {
        id: "c",
        name: "Color",
        group: "overlay",
        canvas,
        onOpacity,
        opacityBake: "commit" as const,
      },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    ui.attachUI(container);

    // The commit arm bakes immediately on every commit: onOpacity fires
    // synchronously with the new value and no timer is scheduled.
    setIntent(ui, "c", "opacity", 0.4);
    ui.intentStore.seedProvenance("c", ["opacity"]);
    applyProjection(ui, "c");

    expect(onOpacity).toHaveBeenCalledWith(0.4);
    expect(canvas.style.opacity).toBe("");

    // No pending timer: advancing time never triggers another repaint.
    const callsAfterCommit = onOpacity.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(onOpacity.mock.calls.length).toBe(callsAfterCommit);

    manager.destroy();
    vi.useRealTimers();
  });

  it("replay path sets CSS opacity without scheduling a repaint", () => {
    vi.useFakeTimers();

    const { container, map } = makeOffMapFixture();
    const canvas = document.createElement("canvas");
    const onOpacity = vi.fn();

    const manager = new LayerController(map, [
      { id: "r", name: "Replay", group: "overlay", canvas, onOpacity },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    ui.attachUI(container);

    // attachUI triggers an initial projection (repaintMode="none"), so
    // onOpacity is NOT called (no repaint). CSS opacity is set to the
    // default (1), but the canvas is not repainted.
    expect(onOpacity).not.toHaveBeenCalled();
    const initialCalls = onOpacity.mock.calls.length;

    // Replay path: applyProjection with repaintMode="none" sets CSS opacity
    // and layerAlpha, but does NOT schedule a repaint (the canvas will be
    // repainted on the next pan/zoom).
    setIntent(ui, "r", "opacity", 0.5);
    ui.intentStore.seedProvenance("r", ["opacity"]);
    applyProjection(ui, "r", "none");

    // CSS opacity is set, but onOpacity is NOT called (no repaint).
    expect(canvas.style.opacity).toBe("0.5");
    expect(getLayerAlpha(canvas)).toBeCloseTo(0.5);
    expect(onOpacity.mock.calls.length).toBe(initialCalls);

    // No pending timer: advancing time never triggers another repaint.
    vi.advanceTimersByTime(1000);
    expect(onOpacity.mock.calls.length).toBe(initialCalls);

    manager.destroy();
    vi.useRealTimers();
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
    // map/DOM writes; a spy-counted gate is what this refactor asks for.
    const { container, layer, map } = makeOffMapFixture();

    const manager = new LayerController(map, [
      { id: "p", name: "P", group: "overlay", layer, show: false },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    // A single change: store opacity, apply.
    setIntent(ui, "p", "opacity", 0.5);
    ui.intentStore.seedProvenance("p", ["opacity"]);
    applyProjection(ui, "p");
    const callsAfterOne =
      map.addLayer.mock.calls.length + map.removeLayer.mock.calls.length;

    // Two more applies with nothing new: the map state must not change.
    applyProjection(ui, "p");
    applyProjection(ui, "p");
    const callsAfterRepeated =
      map.addLayer.mock.calls.length + map.removeLayer.mock.calls.length;

    expect(callsAfterRepeated).toBe(callsAfterOne);
  });

  it("row lookup is by id, not by registry position", () => {
    // Structural lock: the executor keys the runtime `applied` row by id
    // (the sweep walks registry ids for the same reason), so DOM order or
    // registration order shifting never misroutes a write. Two canvas layers — one with
    // an opacity intent and one without; each gets its own write regardless
    // of registration order. Canvas is chosen because its carrier is a
    // single element per layer, so the id-keyed diff is directly observable
    // on the DOM.
    const { container, map } = makeOffMapFixture();

    const aCanvas = document.createElement("canvas");
    const bCanvas = document.createElement("canvas");
    const manager = new LayerController(map, [
      { id: "b", name: "B", group: "overlay", canvas: bCanvas },
      { id: "a", name: "A", group: "overlay", canvas: aCanvas },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    // Only layer "a" has a stored opacity — layer "b" is untouched and
    // keeps the author's declared default (1). Default "redraw" arm writes
    // CSS; layerAlpha is stored for the next bake paint.
    // The registry-position independence is proven by "a" landing its 0.7
    // on the right canvas: if the diff misrouted by position, either
    // canvas would end up with 0.7 and the other with 1.
    setIntent(ui, "a", "opacity", 0.7);
    ui.intentStore.seedProvenance("a", ["opacity"]);
    applyProjectionAll(ui);

    expect(aCanvas.style.opacity).toBe("0.7");
    expect(bCanvas.style.opacity).toBe("1");
    expect(getLayerAlpha(aCanvas)).toBeCloseTo(0.7);
    expect(getLayerAlpha(bCanvas)).toBe(1);
    expect(getIntent(ui, "b", "opacity")).toBeUndefined();
  });
});

// The carrier dispatcher is where the branches live: one write target per
// dimension per layer shape, and each shape has its own "no honest write"
// corner. These exercise the shapes the gates above do not touch.
describe("executor: carrier dispatch", () => {
  beforeEach(() => {
    installLeafletGlobals();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const boot = (layers: ConstructorParameters<typeof LayerController>[1]) => {
    const { container, map } = makeOffMapFixture();
    const manager = new LayerController(map, layers);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();
    return { container, map, manager, ui };
  };

  it("an id with no registry entry is a no-op", () => {
    const { ui, map } = boot([{ id: "a", name: "A", group: "overlay" }]);
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();
    expect(() => applyProjection(ui, "ghost")).not.toThrow();
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("a pane-carrier visible write toggles the canvas HIDDEN class", () => {
    // The canvas-only branch of the visibility dispatch: no Leaflet layer
    // exists to add/remove, so the class on the canvas IS the carrier.
    const canvas = document.createElement("canvas");
    const { ui } = boot([{ id: "cv", name: "CV", group: "overlay", canvas }]);
    const li = () => ui.c.layerRegistry.get("cv")!;

    dispatchStateOp(ui, li(), { type: "visible", value: false });
    expect(canvas.classList.contains("hidden")).toBe(true);

    dispatchStateOp(ui, li(), { type: "visible", value: true });
    expect(canvas.classList.contains("hidden")).toBe(false);
  });

  describe("LAYER_CHANGE — emitted once the operation has settled", () => {
    // The executor does not emit; the operation layer does, after its own
    // side effects (carrier write, row paint, tri-state count, hatch) have
    // landed. Both map-membership and canvas-HIDDEN-class writes are
    // visibility flips, so both ride the same `LAYER_CHANGE` notification.
    // The dispatcher returns `wrote` so a projection that finds the carrier
    // already matched never manufactures a change event.

    it("a canvas hide emits LAYER_CHANGE and the callback reads the new class", () => {
      const canvas = document.createElement("canvas");
      const { ui, manager } = boot([
        { id: "cv-e", name: "CV-E", group: "overlay", canvas },
      ]);
      ui.runtimeStore.setAuthorVisible("cv-e", true);
      const seen: Array<{ id: string; kind: string } | undefined> = [];
      const observedHidden: Array<boolean | undefined> = [];
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        seen.push(payload as { id: string; kind: string } | undefined);
        // The event is delivered after the class flip, so a subscriber
        // reading the canvas sees the post-write state.
        observedHidden.push(canvas.classList.contains(HIDDEN));
      });

      ui.applyVisibility("cv-e", false);

      expect(seen).toEqual([{ id: "cv-e", kind: "canvas" }]);
      expect(observedHidden).toEqual([true]);
      expect(canvas.classList.contains(HIDDEN)).toBe(true);
    });

    it("a canvas show emits LAYER_CHANGE and the callback reads the new class", () => {
      const canvas = document.createElement("canvas");
      const { ui, manager } = boot([
        { id: "cv-f", name: "CV-F", group: "overlay", canvas },
      ]);
      ui.runtimeStore.setAuthorVisible("cv-f", true);
      ui.applyVisibility("cv-f", false);

      const seen: Array<{ id: string; kind: string } | undefined> = [];
      const observedHidden: Array<boolean | undefined> = [];
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        seen.push(payload as { id: string; kind: string } | undefined);
        observedHidden.push(canvas.classList.contains(HIDDEN));
      });

      ui.applyVisibility("cv-f", true);

      expect(seen).toEqual([{ id: "cv-f", kind: "canvas" }]);
      expect(observedHidden).toEqual([false]);
      expect(canvas.classList.contains(HIDDEN)).toBe(false);
    });

    it("a repeated canvas hide emits only once", () => {
      const canvas = document.createElement("canvas");
      const { ui, manager } = boot([
        { id: "cv-g", name: "CV-G", group: "overlay", canvas },
      ]);
      ui.runtimeStore.setAuthorVisible("cv-g", true);
      setIntent(ui, "cv-g", "visible", false);
      applyProjection(ui, "cv-g");

      const spy = vi.fn();
      manager.events.on(EVENTS.LAYER_CHANGE, spy);

      applyProjection(ui, "cv-g");
      applyProjection(ui, "cv-g");

      expect(spy).not.toHaveBeenCalled();
    });

    it("a zoom sweep that moves a layer out of its range emits LAYER_CHANGE", () => {
      // A zoomend (`applyProjectionAll`) that pushes a layer past its stored
      // zoom range is a real visibility flip — the layer leaves the map.
      // This is the executor's one notification channel; without the emit
      // subscribers (annotation, controller) would never hear the sweep.
      const layer = paneCapableLayer();
      const onMap = { current: false };
      const { ui, manager, map } = boot([
        { id: "zv", name: "ZV", group: "overlay", layer },
      ]);
      ui.runtimeStore.setAuthorVisible("zv", true);
      map.hasLayer = vi.fn((l: L.Layer) => onMap.current && l === layer);
      map.addLayer = vi.fn(() => {
        onMap.current = true;
      });
      map.removeLayer = vi.fn(() => {
        onMap.current = false;
      });
      applyProjection(ui, "zv");
      expect(onMap.current).toBe(true);

      const seen: Array<{ id: string; kind: string } | undefined> = [];
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        seen.push(payload as { id: string; kind: string } | undefined);
      });

      setIntent(ui, "zv", "zoomRange", [0, 1]);
      ui.intentStore.seedProvenance("zv", ["zoomRange"]);
      ui.onZoomEnd?.();

      expect(onMap.current).toBe(false);
      expect(seen.length).toBe(1);
      expect(seen[0]).toEqual({ id: "zv", kind: "vector" });
    });

    it("a zoom sweep that brings a layer back into range emits LAYER_CHANGE", () => {
      const layer = paneCapableLayer();
      const onMap = { current: false };
      const { ui, manager, map } = boot([
        { id: "zv2", name: "ZV2", group: "overlay", layer },
      ]);
      ui.runtimeStore.setAuthorVisible("zv2", true);
      map.hasLayer = vi.fn((l: L.Layer) => onMap.current && l === layer);
      map.addLayer = vi.fn(() => {
        onMap.current = true;
      });
      map.removeLayer = vi.fn(() => {
        onMap.current = false;
      });
      applyProjection(ui, "zv2");
      setIntent(ui, "zv2", "zoomRange", [0, 1]);
      ui.intentStore.seedProvenance("zv2", ["zoomRange"]);
      ui.onZoomEnd?.();
      expect(onMap.current).toBe(false);

      const seen: Array<{ id: string; kind: string } | undefined> = [];
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        seen.push(payload as { id: string; kind: string } | undefined);
      });

      clearIntent(ui, "zv2", "zoomRange");
      ui.onZoomEnd?.();

      expect(onMap.current).toBe(true);
      expect(seen.length).toBe(1);
      expect(seen[0]).toEqual({ id: "zv2", kind: "vector" });
    });

    it("does not emit LAYER_CHANGE when the layer reference is still null", () => {
      // Late binding: the surface resolved `visibility: "native"` but the
      // registry entry lost its layer and `findLayer` returns nothing. The
      // projection sweep still runs — the diff disagrees on `effectiveShown`
      // — but the executor cannot write the map, so it must not manufacture
      // a change notification nobody can observe.
      const layer = paneCapableLayer();
      const { ui, manager } = boot([
        { id: "nv2", name: "NV2", group: "overlay", layer },
      ]);
      ui.runtimeStore.setAuthorVisible("nv2", true);
      applyProjection(ui, "nv2");

      ui.c.layerRegistry.get("nv2")!.layer = null;
      ui.c.findLayer = vi.fn(() => null) as typeof ui.c.findLayer;
      ui.c.surfaceFor = (() => ({
        capabilities: { visibility: "native", opacity: "none", zoomRange: "none" },
      })) as unknown as typeof ui.c.surfaceFor;
      ui.c.map.hasLayer = vi.fn(() => false);
      ui.c.map.addLayer = vi.fn();

      const spy = vi.fn();
      manager.events.on(EVENTS.LAYER_CHANGE, spy);

      setIntent(ui, "nv2", "visible", true);
      applyProjection(ui, "nv2");

      expect(spy).not.toHaveBeenCalled();
      expect(ui.c.map.addLayer).not.toHaveBeenCalled();
    });
  });

  describe("LAYER_INTENT_CHANGE — emitted once the operation has settled", () => {
    // `LAYER_CHANGE` rides the effective flip (intent && policy), so a
    // user-only intent movement gated by zoomRange never reaches it.
    // `LAYER_INTENT_CHANGE` is the separate channel for that user-only
    // signal — subscribers that mirror the user's checkbox state in
    // their own UI listen to it rather than re-reading the registry.
    //
    // Semantic matrix (intent / effective flip):
    //   intent moved + effective moved → INTENT + CHANGE
    //   intent moved + effective same  → INTENT only (policy-gated)
    //   intent same  + effective moved → CHANGE only (zoom sweep)
    //   intent same  + effective same  → neither
    //   first projection               → neither (no prev to diff)

    it("intent flip with an effective flip fires INTENT and CHANGE", () => {
      const canvas = document.createElement("canvas");
      const { ui, manager } = boot([
        { id: "ie-both", name: "IE-Both", group: "overlay", canvas },
      ]);
      ui.runtimeStore.setAuthorVisible("ie-both", true);
      applyProjection(ui, "ie-both");
      expect(canvas.classList.contains(HIDDEN)).toBe(false);

      const intentSeen: Array<{
        id: string;
        kind: string;
        intent: { visible: boolean };
      }> = [];
      const changeSeen: Array<{ id: string; kind: string }> = [];
      manager.events.on(EVENTS.LAYER_INTENT_CHANGE, payload =>
        intentSeen.push(
          payload as {
            id: string;
            kind: string;
            intent: { visible: boolean };
          },
        ),
      );
      manager.events.on(EVENTS.LAYER_CHANGE, payload =>
        changeSeen.push(payload as { id: string; kind: string }),
      );

      ui.applyVisibility("ie-both", false);

      expect(intentSeen).toEqual([
        { id: "ie-both", kind: "canvas", intent: { visible: false } },
      ]);
      expect(changeSeen).toEqual([{ id: "ie-both", kind: "canvas" }]);
      expect(canvas.classList.contains(HIDDEN)).toBe(true);
    });

    it("intent flip gated by zoomRange fires INTENT only, not CHANGE", () => {
      // The core policy-gated case: intent moves but the effective
      // visibility is already off (range excludes the current zoom),
      // so the executor has no map-membership write to notify of.
      // Only the user-only channel fires — external UIs reading INTENT
      // see the checkbox movement even though the layer never appears.
      const canvas = document.createElement("canvas");
      const { ui, manager } = boot([
        { id: "ie-oor", name: "IE-OOR", group: "overlay", canvas },
      ]);
      ui.runtimeStore.setAuthorVisible("ie-oor", true);
      // Push the range entirely above the current zoom (mock returns 5):
      // the layer starts hidden from the start, and stays hidden no
      // matter what the user's checkbox says.
      setIntent(ui, "ie-oor", "zoomRange", [15, 18]);
      ui.intentStore.seedProvenance("ie-oor", ["zoomRange"]);
      // Establish a false intent baseline first, so the second apply
      // below can exercise a real intent flip gated by the range.
      setIntent(ui, "ie-oor", "visible", false);
      applyProjection(ui, "ie-oor");
      expect(canvas.classList.contains(HIDDEN)).toBe(true);

      const intentSeen: Array<{ intent: { visible: boolean } }> = [];
      const changeSeen: unknown[] = [];
      manager.events.on(EVENTS.LAYER_INTENT_CHANGE, payload =>
        intentSeen.push(payload as { intent: { visible: boolean } }),
      );
      manager.events.on(EVENTS.LAYER_CHANGE, payload => changeSeen.push(payload));

      // User checks the box. Intent flips false → true; policy keeps the
      // layer off the map, so no effective change, no LAYER_CHANGE.
      ui.applyVisibility("ie-oor", true);

      expect(intentSeen).toEqual([
        { id: "ie-oor", kind: "canvas", intent: { visible: true } },
      ]);
      expect(changeSeen).toEqual([]);
      expect(canvas.classList.contains(HIDDEN)).toBe(true);
    });

    it("effective flip without intent change fires CHANGE only, not INTENT", () => {
      // A zoom sweep that pushes a layer out of its range moves
      // effectiveShown without touching the user's stored intent —
      // the executor's one policy-gated path. Only LAYER_CHANGE fires.
      const layer = paneCapableLayer();
      const onMap = { current: false };
      const { ui, manager, map } = boot([
        { id: "ie-oom", name: "IE-OOM", group: "overlay", layer },
      ]);
      ui.runtimeStore.setAuthorVisible("ie-oom", true);
      map.hasLayer = vi.fn((l: L.Layer) => onMap.current && l === layer);
      map.addLayer = vi.fn(() => {
        onMap.current = true;
      });
      map.removeLayer = vi.fn(() => {
        onMap.current = false;
      });
      applyProjection(ui, "ie-oom");
      expect(onMap.current).toBe(true);

      const intentSeen: unknown[] = [];
      const changeSeen: Array<{ id: string; kind: string }> = [];
      manager.events.on(EVENTS.LAYER_INTENT_CHANGE, payload =>
        intentSeen.push(payload),
      );
      manager.events.on(EVENTS.LAYER_CHANGE, payload =>
        changeSeen.push(payload as { id: string; kind: string }),
      );

      setIntent(ui, "ie-oom", "zoomRange", [0, 1]);
      ui.intentStore.seedProvenance("ie-oom", ["zoomRange"]);
      ui.onZoomEnd?.();

      expect(onMap.current).toBe(false);
      expect(changeSeen).toEqual([{ id: "ie-oom", kind: "vector" }]);
      expect(intentSeen).toEqual([]);
    });

    it("a repeated applyProjection with the same intent fires neither event", () => {
      const canvas = document.createElement("canvas");
      const { ui, manager } = boot([
        { id: "ie-nochange", name: "IE-NoChange", group: "overlay", canvas },
      ]);
      ui.runtimeStore.setAuthorVisible("ie-nochange", true);
      applyProjection(ui, "ie-nochange");

      const intentSpy = vi.fn();
      const changeSpy = vi.fn();
      manager.events.on(EVENTS.LAYER_INTENT_CHANGE, intentSpy);
      manager.events.on(EVENTS.LAYER_CHANGE, changeSpy);

      applyProjection(ui, "ie-nochange");
      applyProjection(ui, "ie-nochange");

      expect(intentSpy).not.toHaveBeenCalled();
      expect(changeSpy).not.toHaveBeenCalled();
    });

    it("the first projection records a baseline without emitting", () => {
      // First pass has no `prev` to diff against — nothing to say has
      // "changed". Recording the baseline is a projection, not a
      // user action.
      const canvas = document.createElement("canvas");
      const { ui, manager } = boot([
        { id: "ie-first", name: "IE-First", group: "overlay", canvas },
      ]);
      ui.runtimeStore.setAuthorVisible("ie-first", true);
      ui.runtimeStore.deleteApplied("ie-first");

      const intentSpy = vi.fn();
      const changeSpy = vi.fn();
      manager.events.on(EVENTS.LAYER_INTENT_CHANGE, intentSpy);
      manager.events.on(EVENTS.LAYER_CHANGE, changeSpy);

      applyProjection(ui, "ie-first");

      expect(intentSpy).not.toHaveBeenCalled();
      expect(changeSpy).not.toHaveBeenCalled();
    });

    describe("reentrancy", () => {
      // A subscriber that re-enters through the operation layer during
      // `LAYER_INTENT_CHANGE` sees whatever `runtimeStore.getApplied`
      // returns at that moment. The projection commits its baseline before
      // returning to the operation layer, so that baseline is fresh by the
      // time the subscriber runs. If it were stale, a same-value write-back
      // looks like a new change and re-emits; if the outer operation then
      // re-wrote its own projection on return, the inner snapshot would be
      // clobbered and the next real change would look like a no-op.

      it("a subscriber that writes the same value back emits exactly once", () => {
        // The recursive write-back loop: a subscriber that observes the
        // intent and mirrors it through the operation layer would, before
        // the fix, see the stale baseline (still the pre-emit value),
        // diff to a false positive, and re-emit. The projection commits
        // its baseline before the operation emits, so the reentrant
        // operation diffs against the already-committed value and no
        // further emit fires.
        const canvas = document.createElement("canvas");
        const { ui, manager } = boot([
          { id: "re-entry-1", name: "Re-Entry-1", group: "overlay", canvas },
        ]);
        ui.runtimeStore.setAuthorVisible("re-entry-1", true);
        ui.runtimeStore.deleteApplied("re-entry-1");
        applyProjection(ui, "re-entry-1");

        const intentSpy = vi.fn();
        const changeSpy = vi.fn();
        // A mirroring subscriber: on every intent change it re-applies
        // the same intent through the public operation. Before the
        // commit-before-emit fix, the inner call read a stale baseline
        // (outer's commit hadn't landed yet), saw the same value as a
        // new change, and re-emitted — the loop only stopped because a
        // call-budget safety net tripped it after six rounds.
        manager.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
          intentSpy(payload);
          ui.applyVisibility(payload.id, payload.intent.visible);
        });
        manager.events.on(EVENTS.LAYER_CHANGE, payload => changeSpy(payload));

        ui.applyVisibility("re-entry-1", false);

        expect(intentSpy).toHaveBeenCalledTimes(1);
        expect(intentSpy.mock.calls[0][0].intent.visible).toBe(false);
        expect(changeSpy).toHaveBeenCalledTimes(1);
        expect(canvas.classList.contains(HIDDEN)).toBe(true);
      });

      it("a subscriber that reverses the value reports the new intent immediately", () => {
        // Reverse correction: the outer operation flips intent false
        // → true and emits; a subscriber that disagrees applies
        // `visible: false` through the same operation, synchronously.
        // The inner projection must land its own baseline without the
        // outer re-overwriting it on return, so the emitted intent and
        // the runtimeStore agree. Without this the outer would write
        // its own projection back over the inner snapshot and the
        // subscriber's correction would only surface on the next
        // zoomend sweep — one nobody is waiting for.
        const canvas = document.createElement("canvas");
        const { ui, manager } = boot([
          { id: "re-entry-2", name: "Re-Entry-2", group: "overlay", canvas },
        ]);
        ui.runtimeStore.setAuthorVisible("re-entry-2", false);
        ui.runtimeStore.deleteApplied("re-entry-2");
        // First pass seeds a false-intent baseline; intent stays
        // false through that first projection (the canvas starts
        // hidden and stays hidden — policy doesn't force it on).
        applyProjection(ui, "re-entry-2");
        expect(ui.runtimeStore.getApplied("re-entry-2")?.intent.visible).toBe(false);

        const intentSeen: Array<{ intent: { visible: boolean } }> = [];
        const changeSeen: Array<{ id: string; kind: string }> = [];
        manager.events.on(EVENTS.LAYER_INTENT_CHANGE, payload =>
          intentSeen.push(payload as { intent: { visible: boolean } }),
        );
        manager.events.on(EVENTS.LAYER_CHANGE, payload =>
          changeSeen.push(payload as { id: string; kind: string }),
        );
        // The reentrant subscriber: the outer flip triggers its handler,
        // which disagrees and writes back the opposite value. Because the
        // projection commits its baseline before the outer operation emits,
        // the inner projection reads a fresh baseline, sees its own diff as
        // a real movement, and lands its own setApplied — the last snapshot
        // that wins. Its operation then emits, so the correction is visible
        // immediately rather than on a later zoomend sweep.
        manager.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
          ui.applyVisibility("re-entry-2", false);
        });

        ui.applyVisibility("re-entry-2", true);

        // Outer fired once (intent true), inner fired once (intent
        // false). The inner's setApplied must have survived the outer
        // return — no second outer overwrite clobbered it.
        expect(intentSeen.map(p => p.intent.visible)).toEqual([true, false]);
        // Both the outer flip and the inner reverse flip land on the
        // carrier — the reverse is a real visibility movement the
        // subscriber intended, so it emits its own CHANGE.
        expect(changeSeen.length).toBe(2);
        expect(ui.runtimeStore.getApplied("re-entry-2")?.intent.visible).toBe(false);
        expect(canvas.classList.contains(HIDDEN)).toBe(true);
      });

      it("two subscribers that both re-write terminate with a consistent final state", () => {
        // Two subscribers reacting to the same emit each write their
        // own operation back. Both read the fresh baseline the outer
        // just committed; neither re-emits, so no infinite loop, and
        // the last writer's baseline is what wins. The outer operation
        // never re-commits over the inner — the final `getApplied`
        // matches the intent the last subscriber put in the store.
        const canvas = document.createElement("canvas");
        const { ui, manager } = boot([
          { id: "re-entry-3", name: "Re-Entry-3", group: "overlay", canvas },
        ]);
        ui.runtimeStore.setAuthorVisible("re-entry-3", true);
        ui.runtimeStore.deleteApplied("re-entry-3");
        applyProjection(ui, "re-entry-3");

        let intentTotal = 0;
        let changeTotal = 0;
        manager.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
          intentTotal++;
          ui.applyVisibility("re-entry-3", true);
        });
        manager.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
          ui.applyVisibility("re-entry-3", true);
        });
        manager.events.on(EVENTS.LAYER_CHANGE, () => changeTotal++);

        expect(() => {
          ui.applyVisibility("re-entry-3", false);
        }).not.toThrow();

        expect(intentTotal).toBeLessThanOrEqual(4);
        expect(changeTotal).toBeLessThanOrEqual(4);
        expect(ui.runtimeStore.getApplied("re-entry-3")?.intent.visible).toBe(true);
        expect(canvas.classList.contains(HIDDEN)).toBe(false);
      });
    });
  });

  it("applyProjection reads the canvas class back as the current carrier state", () => {
    // The executor's `currentShown` comes from the live class, not from
    // runtime `applied` row: a canvas somebody hid out-of-band converges back to
    // intent, and an intent hide lands even though the class started clear.
    const canvas = document.createElement("canvas");
    const { ui } = boot([{ id: "cv2", name: "CV2", group: "overlay", canvas }]);
    ui.runtimeStore.setAuthorVisible("cv2", true);

    canvas.classList.add("hidden"); // out-of-band hide while intent says shown
    applyProjection(ui, "cv2");
    expect(canvas.classList.contains("hidden")).toBe(false);

    setIntent(ui, "cv2", "visible", false); // the user unchecks
    applyProjection(ui, "cv2");
    expect(canvas.classList.contains("hidden")).toBe(true);
  });

  it("a visible op on a 'none' carrier writes nothing", () => {
    // No Leaflet layer, no canvas — neither branch of the dispatcher has an
    // honest target, and the read side reports `false` for "shown" rather
    // than guessing.
    const { ui, map } = boot([{ id: "nc", name: "NC", group: "overlay" }]);
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();

    dispatchStateOp(ui, ui.c.layerRegistry.get("nc")!, {
      type: "visible",
      value: false,
    });

    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.removeLayer).not.toHaveBeenCalled();
  });

  it("a pane-carrier visible write whose canvas vanished writes nothing", () => {
    // The surface resolved `visibility: "pane"` while the canvas existed;
    // if the element is gone by write time the dispatcher must not throw —
    // there is simply no element left to stamp.
    const canvas = document.createElement("canvas");
    const { ui } = boot([{ id: "pc", name: "PC", group: "overlay", canvas }]);
    ui.c.layerRegistry.get("pc")!.canvas = null;

    expect(() =>
      dispatchStateOp(ui, ui.c.layerRegistry.get("pc")!, {
        type: "visible",
        value: false,
      }),
    ).not.toThrow();
    expect(canvas.classList.contains("hidden")).toBe(false);
  });

  it("defensive: a pane carrier whose canvas target vanished writes nothing", () => {
    // Unlike the test above (where surfaceFor re-resolves and reports
    // "none"), pin the dispatcher's own guard: the carrier may still say
    // "pane" while the element is gone — stub the surface so the branch
    // under test is the `if (canvas)` miss, not the rebuild.
    const { ui, map } = boot([
      {
        id: "pc2",
        name: "PC2",
        group: "overlay",
        canvas: document.createElement("canvas"),
      },
    ]);
    const li = ui.c.layerRegistry.get("pc2")!;
    li.canvas = null;
    ui.c.surfaceFor = (() => ({
      capabilities: { visibility: "pane", opacity: "none", zoomRange: "none" },
    })) as unknown as typeof ui.c.surfaceFor;
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();

    dispatchStateOp(ui, li, { type: "visible", value: false });

    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("defensive: a native carrier whose layer target vanished writes nothing", () => {
    // Carrier says "native", but the registry entry lost its layer and the
    // window/map lookup finds nothing: both the `?? findLayer` miss and the
    // `if (layer)` miss must fall through to no write, and the projection's
    // currentShown read must report `false` rather than throw.
    const { ui, map } = boot([
      { id: "nv", name: "NV", group: "overlay", layer: { options: {} } as L.Layer },
    ]);
    const li = ui.c.layerRegistry.get("nv")!;
    li.layer = null;
    ui.c.findLayer = vi.fn(() => null) as typeof ui.c.findLayer;
    ui.c.surfaceFor = (() => ({
      capabilities: { visibility: "native", opacity: "none", zoomRange: "none" },
    })) as unknown as typeof ui.c.surfaceFor;
    ui.runtimeStore.setAuthorVisible("nv", true);
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();
    (map.hasLayer as ReturnType<typeof vi.fn>).mockReturnValue(false);

    dispatchStateOp(ui, li, { type: "visible", value: true });
    applyProjection(ui, "nv");

    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("throws on an unknown StateOp type — the exhaustiveness guard fires", () => {
    // `StateOp` is a closed union (`"visible" | "opacity"`). If someone adds
    // a new variant without extending the dispatcher, the trailing
    // `const _exhaustive: never = op; throw ...` is what makes the missing
    // branch loud instead of a silent `return false`. Exercised here by
    // deliberately violating the union — the throw is the honest outcome.
    const { ui } = boot([{ id: "x", name: "X", group: "overlay" }]);

    expect(() =>
      dispatchStateOp(ui, ui.c.layerRegistry.get("x")!, {
        type: "bogus" as never,
        value: 0,
      }),
    ).toThrow(/unreachable dispatchStateOp type/);
  });

  it("a 'none' opacity carrier stores nothing and writes nothing", () => {
    // A slider that writes nothing must not pretend it wrote. MarkerCluster
    // icons live in the shared markerPane, which no per-layer CSS write can
    // reach — the honest answer is "no write exists".
    const layer = paneCapableLayer();
    const { ui, manager } = boot([{ id: "n", name: "None", group: "overlay", layer }]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "none", zoomRange: "none" },
      paneNames: [],
      geometryType: () => "point",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    setIntent(ui, "n", "opacity", 0.2);
    ui.intentStore.seedProvenance("n", ["opacity"]);
    applyProjection(ui, "n");

    expect((layer.options as { opacity?: number }).opacity).toBeUndefined();
    expect(manager.layerRegistry.get("n")?.opacity).toBe(1);
  });

  it("a native opacity carrier with setOpacity multiplies the author's base", () => {
    // The slider is a multiplier over the declared default, so the base is
    // captured once — repeated drags must not compound on their own output.
    const setOpacity = vi.fn();
    const layer = { options: { opacity: 0.5 }, setOpacity } as unknown as L.Layer;
    const { ui, manager } = boot([{ id: "img", name: "Img", group: "overlay", layer }]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "native", zoomRange: "none" },
      paneNames: [],
      geometryType: () => "polygon",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    setIntent(ui, "img", "opacity", 0.5);
    ui.intentStore.seedProvenance("img", ["opacity"]);
    applyProjection(ui, "img");
    applyProjection(ui, "img");

    expect(setOpacity).toHaveBeenNthCalledWith(1, 0.25);
  });

  it("a native opacity carrier without setOpacity writes options.opacity", () => {
    // GridLayer / TileLayer honor `options.opacity` at the next tile cycle
    // rather than through a setter.
    const layer = { options: { opacity: 0.8 } } as L.Layer;
    const { ui, manager } = boot([
      { id: "tile", name: "Tile", group: "overlay", layer },
    ]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "native", zoomRange: "native" },
      paneNames: [],
      geometryType: () => "polygon",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    setIntent(ui, "tile", "opacity", 0.5);
    ui.intentStore.seedProvenance("tile", ["opacity"]);
    applyProjection(ui, "tile");

    expect((layer.options as { opacity?: number }).opacity).toBe(0.4);
  });

  it("freezes the opacity base on the first write; later slider drags never re-read the mutated options", () => {
    // memoizeLayer idempotency contract: the base is captured once from
    // `options.opacity` at first access and never re-read. `dispatchStateOp`
    // writes the multiplied value back to `options.opacity`, so a second call
    // that re-read options.opacity would compound (0.8 → 0.4 → 0.24). The
    // frozen skeleton keeps it at 0.8 * slider — the second drag lands at
    // 0.8 * 0.6 = 0.48, not the ratcheted 0.24.
    const layer = { options: { opacity: 0.8 } } as L.Layer;
    const { ui, manager } = boot([
      { id: "tile", name: "Tile", group: "overlay", layer },
    ]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "native", zoomRange: "native" },
      paneNames: [],
      geometryType: () => "polygon",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    setIntent(ui, "tile", "opacity", 0.5);
    ui.intentStore.seedProvenance("tile", ["opacity"]);
    applyProjection(ui, "tile");
    expect((layer.options as { opacity?: number }).opacity).toBe(0.4);

    setIntent(ui, "tile", "opacity", 0.6);
    applyProjection(ui, "tile");
    expect((layer.options as { opacity?: number }).opacity).toBe(0.48);

    // Third drag — the base is still 0.8, not the previous 0.48.
    setIntent(ui, "tile", "opacity", 0.25);
    applyProjection(ui, "tile");
    expect((layer.options as { opacity?: number }).opacity).toBe(0.2);
  });

  it("memoizeLayer skips caching for a null layer — a later call with the same id still reads fresh", () => {
    // The zoom-bounds memo is keyed by layer identity. A layer id that the
    // registry doesn't know about (or a layer that hasn't materialized yet)
    // means `ui.c.layerRegistry.get(id)?.layer` is undefined and the memo
    // takes its null-layer branch: no cache entry, no cache lookup. Every
    // call falls through to the read closure, so the map's live min/max is
    // consulted each time — the correct answer for a not-yet-registered
    // layer, whose author bounds could still arrive.
    const { ui } = boot([]);
    const first = authorZoomBoundsForLayer(ui, "ghost");
    expect(first).toEqual([0, 18]);

    // A later call re-reads the map, not a cached value from the first call.
    // We verify this by advancing the map's maxZoom and seeing the new value
    // — a cached result would still report 18.
    (ui as any).c.map.getMaxZoom = vi.fn(() => 20);
    const second = authorZoomBoundsForLayer(ui, "ghost");
    expect(second).toEqual([0, 20]);
  });

  it("zoomRange does not write to layer options (visibility-only resolution)", () => {
    // Writing `options.minZoom/maxZoom` pollutes `map.getMaxZoom()` —
    // Leaflet derives map zoom from layer options, so the +/- controls
    // lock. The zoomRange resolves through the `visible` op instead.
    const layer = paneCapableLayer();
    let onMap = false;
    const { ui, map } = boot([{ id: "z", name: "Z", group: "overlay", layer }]);
    map.hasLayer.mockImplementation(() => onMap);
    map.addLayer.mockImplementation(() => {
      onMap = true;
    });
    map.removeLayer.mockImplementation(() => {
      onMap = false;
    });
    ui.intentStore.seedProvenance("z", ["visible"]); // authorize map writes

    // A range that includes the current zoom: layer is added.
    setIntent(ui, "z", "zoomRange", [4, 10]);
    applyProjection(ui, "z");
    const opts = layer.options as { minZoom?: number; maxZoom?: number };
    expect("minZoom" in opts).toBe(false);
    expect("maxZoom" in opts).toBe(false);
    expect(map.addLayer).toHaveBeenCalledWith(layer);

    // A range that excludes the current zoom: layer is removed, but
    // options are still untouched.
    map.getZoom.mockReturnValue(12);
    applyProjection(ui, "z");
    expect("minZoom" in opts).toBe(false);
    expect("maxZoom" in opts).toBe(false);
    expect(map.removeLayer).toHaveBeenCalledWith(layer);
  });

  it("the LayerUI delegates reach the same executor", () => {
    const { ui, map, manager } = boot([
      {
        id: "d",
        name: "D",
        group: "overlay",
        layer: paneCapableLayer(),
        show: false,
      },
    ]);
    setIntent(ui, "d", "opacity", 0.6);
    ui.intentStore.seedProvenance("d", ["opacity"]);
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();

    ui.applyProjection("d");
    expect(manager.layerRegistry.get("d")?.opacity).toBe(0.6);

    ui.applyProjectionAll();
    expect(map.addLayer).not.toHaveBeenCalled(); // idempotent: nothing moved
  });
});

describe("applyProjectionAll: the sweep walks the registry, not the intent store", () => {
  beforeEach(() => {
    installLeafletGlobals();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("keeps an id with stored dimensions even when nothing is registered under it", () => {
    // "Not in the registry" never means "gone": Heatmap and Measure register
    // after the panel attaches, so their ids are unresolvable on the first
    // pass and must not be pruned from the projection.
    const { container, map } = makeOffMapFixture();
    const manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay", layer: { options: {} } as L.Layer },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    setIntent(ui, "late", "opacity", 0.3);
    ui.intentStore.seedProvenance("late", ["opacity"]);
    expect(() => applyProjectionAll(ui)).not.toThrow();
    // The record is untouched — the id simply has nothing to write to yet.
    expect(getIntent(ui, "late", "opacity")).toBe(0.3);
    expect(ui.intentStore.dumpProvenance().late).toEqual(["opacity"]);
  });

  it("projectAll treats an empty LayerIntentStore as empty", () => {
    const { container, map } = makeOffMapFixture();
    const manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay", layer: { options: {} } as L.Layer },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    ui.intentStore.clearAll();
    expect(() => applyProjectionAll(ui)).not.toThrow();
  });
});

describe("executor: the branches behind the gates", () => {
  beforeEach(() => {
    installLeafletGlobals();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const boot = (layers: ConstructorParameters<typeof LayerController>[1]) => {
    const { container, map } = makeOffMapFixture();
    const manager = new LayerController(map, layers);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();
    return { container, map, manager, ui };
  };

  it("removes a layer that is on the map when policy takes it off", () => {
    // The `else if (!op.value && has)` half of the membership branch: the
    // fixture otherwise reports `hasLayer` as false, so the remove side was
    // never reached.
    const { container, map } = makeOffMapFixture();
    const layer = paneCapableLayer();
    map.hasLayer = vi.fn(() => true);
    map.addLayer = vi.fn();
    map.removeLayer = vi.fn();

    const manager = new LayerController(map, [
      { id: "on", name: "On", group: "overlay", layer },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    map.removeLayer.mockClear();
    map.hasLayer = vi.fn(() => true);
    setIntent(ui, "on", "visible", false);
    ui.intentStore.seedProvenance("on", ["visible"]);
    applyProjection(ui, "on");

    expect(map.removeLayer).toHaveBeenCalledWith(layer);
  });

  it("captures the author's opacity base once, defaulting to 1 when undeclared", () => {
    // `nativeBaseOf` caches on first use; the author's declared `opacity`
    // seeds it, and an undeclared layer falls back to fully opaque. The
    // slider is then a multiplier over that base, so a repeat apply must
    // not compound on its own output.
    const layer = paneCapableLayer();
    const { ui, manager } = boot([{ id: "b", name: "B", group: "overlay", layer }]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "native", zoomRange: "none" },
      paneNames: [],
      geometryType: () => "polygon",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    setIntent(ui, "b", "opacity", 0.5);
    ui.intentStore.seedProvenance("b", ["opacity"]);
    applyProjection(ui, "b");
    expect((layer.options as { opacity?: number }).opacity).toBe(0.5);

    // Reset: the stored value leaves, so the write returns to the author's
    // base rather than to zero, and the mirror reads fully opaque.
    clearIntent(ui, "b", "opacity");
    ui.intentStore.seedProvenance("b", []);
    applyProjection(ui, "b");
    expect((layer.options as { opacity?: number }).opacity).toBe(1);
    expect(manager.layerRegistry.get("b")?.opacity).toBe(1);
  });

  it("an opacity op with no Leaflet layer and no canvas writes nothing", () => {
    // `if (!layer) return` — a stale registry entry whose layer object has
    // already left. Nothing to carry the write, and nothing to throw on.
    const { ui, manager } = boot([
      { id: "stale", name: "Stale", group: "overlay", layer: null as never },
    ]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "pane", zoomRange: "none" },
      paneNames: [],
      geometryType: () => "point",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    setIntent(ui, "stale", "opacity", 0.3);
    ui.intentStore.seedProvenance("stale", ["opacity"]);
    expect(() => applyProjection(ui, "stale")).not.toThrow();
    expect(manager.layerRegistry.get("stale")?.opacity).toBe(1);
  });

  it("a pane write still lands when its element has already left the map", () => {
    // `if (pane)` — a pane released mid-session (teardown racing a write)
    // must be skipped rather than throw.
    const { container, map } = makeOffMapFixture();
    map.getPane = vi.fn(() => null as never);
    const layer = paneCapableLayer({
      // The group holds one migratable leaf, so the carrier probe sees a
      // family the migrator can relocate (an empty group reads as unknown).
      eachLayer: (cb: (l: L.Layer) => void) => cb(paneCapableLayer()),
      getBounds: vi.fn(() => ({ isValid: () => true })),
    });
    const manager = new LayerController(map, [
      { id: "gone", name: "Gone", group: "overlay", layer },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    setIntent(ui, "gone", "opacity", 0.4);
    ui.intentStore.seedProvenance("gone", ["opacity"]);
    expect(() => applyProjection(ui, "gone")).not.toThrow();
    expect(manager.layerRegistry.get("gone")?.opacity).toBe(0.4);
  });

  it("a ui with an empty LayerIntentStore still projects", () => {
    // The `?? false` fallbacks on both choice axes: `applyProjection`,
    // `intentVisibleOf` and `projectLayer` treat an empty store as "no user
    // choice", so a thin stub degrades to the author default.
    const bare = {
      intentStore: new LayerIntentStore(),
      runtimeStore: new LayerRuntimeStore(),
      focusController: { focusingLayerId: null },
      c: {
        layerRegistry: {
          get: vi.fn(() => ({ id: "n", layer: { options: {} } })),
        },
        layers: [],
        findLayer: vi.fn(() => null),
        annotation: null,
        surfaceFor: vi.fn(() => ({
          capabilities: { opacity: "none", zoomRange: "none" },
          paneNames: [],
          geometryType: () => "point",
        })),
        map: {
          getZoom: vi.fn(() => 5),
          getMinZoom: vi.fn(() => 0),
          getMaxZoom: vi.fn(() => 18),
          hasLayer: vi.fn(() => false),
        },
      },
    } as never;

    const info = { id: "n", layer: { options: {} } } as any;
    const projection = projectLayer(bare, info);
    expect(projection.intent.visible).toBe(true);
    expect(projection.effectiveShown).toBe(true);
    expect(intentVisibleOf(bare, info.id)).toBe(true);
    expect(() => applyProjection(bare, "n")).not.toThrow();
  });

  it("adds an author-visible layer that is not yet on the map", () => {
    // The other half of the membership write: gate 1 holds the executor
    // back from an *unauthorized* add, so this pins the authorized one.
    // Author snapshot says shown, intent has no override, policy is fine —
    // and the map has never been told.
    const layer = paneCapableLayer();
    const { ui, map } = boot([{ id: "a2", name: "A2", group: "overlay", layer }]);
    ui.runtimeStore.setAuthorVisible("a2", true);
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();

    applyProjection(ui, "a2");

    expect(map.addLayer).toHaveBeenCalledWith(layer);
    expect(ui.intentVisible("a2")).toBe(true);
  });

  it("the dispatcher itself is idempotent when the value already matches", () => {
    // `applyProjection` only reaches the dispatcher for a dimension that
    // moved, so the "value already equals what is on the map" side of that
    // comparison is unreachable through the executor. Calling the
    // dispatcher directly is how it gets covered — and it is the property
    // the comment promises: a redundant write is a no-op, not a re-add.
    const layer = paneCapableLayer();
    const { ui, map } = boot([{ id: "dup", name: "Dup", group: "overlay", layer }]);
    map.hasLayer = vi.fn(() => true);
    map.addLayer = vi.fn();
    map.removeLayer = vi.fn();

    dispatchStateOp(ui, ui.c.layerRegistry.get("dup")!, {
      type: "visible",
      value: true,
    });

    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.removeLayer).not.toHaveBeenCalled();
  });

  it("leaves a layer that is already on the map when asked to show it", () => {
    // The third shape of the membership branch: `op.value && has` is neither
    // "add it" nor "remove it" — the layer is where it should already be, so
    // neither side fires. Covered here so the `else if` is the only run
    // path exercised by omission.
    const { container, map } = makeOffMapFixture();
    const layer = paneCapableLayer();
    map.hasLayer = vi.fn(() => true);
    map.addLayer = vi.fn();

    const manager = new LayerController(map, [
      { id: "up", name: "Up", group: "overlay", layer },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    map.addLayer.mockClear();
    map.removeLayer = vi.fn();
    map.hasLayer = vi.fn(() => true);
    // No `intents.visible` / override, and the author's default was observed as
    // `true` while the layer sits on the map — so intent and policy both
    // say "shown" and the layer is already shown.
    ui.runtimeStore.setAuthorVisible("up", true);
    applyProjection(ui, "up");

    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.removeLayer).not.toHaveBeenCalled();
  });
});

describe("membership invariants: only intent + author snapshot authorise membership", () => {
  beforeEach(() => {
    installLeafletGlobals();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  /** Boot a manager with one leaflet layer that the author declared
   *  hidden (`show: false`) and is not on the map. No user intent. */
  const bootUnobserved = (id = "x") => {
    const { container, map } = makeOffMapFixture();
    const layer = paneCapableLayer();
    const manager = new LayerController(map, [
      { id, name: id, group: "overlay", layer, show: false },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();
    return { map, manager, ui, layer };
  };

  it("a policy-only flip can never add a layer the user has hidden", () => {
    // intent.visible = false (user chose to hide), policy permissive.
    // effectiveShown is false by `intent && policy`, so the projection
    // already says "not shown" — the policy dimension cannot flip it back.
    const { map, ui } = bootUnobserved("hidden");

    setIntent(ui, "hidden", "visible", false);
    ui.intentStore.seedProvenance("hidden", ["visible"]);
    ui.focusController.focusingLayerId = null; // policy permissive

    applyProjectionAll(ui);
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(getIntent(ui, "hidden", "visible")).toBe(false);
  });

  it("dismissing focus after intent=false does not add the layer back", () => {
    // The reverse half of the one-way gate: focus retracts a layer the
    // user has checked on and dismissing focus restores it via the
    // executor's own write path. But intent=false + policy=true must stay
    // false — a policy dimension can only suppress.
    const { map, ui } = bootUnobserved("p");
    setIntent(ui, "p", "visible", false);
    ui.intentStore.seedProvenance("p", ["visible"]);
    ui.focusController.focusingLayerId = null;

    applyProjectionAll(ui);
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(getIntent(ui, "p", "visible")).toBe(false);
  });
});

// ── Notification-contract cases, moved from the former
// ── notifyContract.test.ts so they live with the script they drive. ──
it("a later subscriber observes the state the earlier subscriber left", () => {
  // Two subscribers share one emit. The first rewrites the intent; the
  // second must read the rewritten state, not the value the emit was
  // carrying. Only a last-step notify gives that: a notify fired mid-
  // operation would hand the second subscriber a panel the first had
  // already moved on from, and it would record [true, false] instead.
  // The reentrant rewrite supersedes the in-flight delivery, so the outer
  // round never reaches the second subscriber at all — the correction's
  // own round is the only one, and it already carries the rewritten state.
  const { ui, map } = initFixture();
  const id = "overlay1";

  // Track real membership: the executor reads the carrier back before it
  // writes, so a `hasLayer` that always answers true would make the
  // re-add a diff miss.
  const onMap = { current: true };
  map.hasLayer = vi.fn(() => onMap.current);
  map.addLayer = vi.fn(() => {
    onMap.current = true;
  });
  map.removeLayer = vi.fn(() => {
    onMap.current = false;
  });

  const secondSaw: boolean[] = [];
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
    ui.applyVisibility(id, true);
  });
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
    secondSaw.push(intentVisibleOf(ui, id));
  });

  ui.applyVisibility(id, false);

  expect(secondSaw).toEqual([true]);
  expect(intentVisibleOf(ui, id)).toBe(true);
  expect(onMap.current).toBe(true);
  expect(ui.listPanel.checkedCount[GROUP.OVERLAY]).toEqual({
    total: 1,
    on: 1,
  });
});

it("a reentrant correction never hands a later subscriber a stale intent", () => {
  // Subscriber 1 reverses the hide synchronously inside the notify, which
  // fires a reentrant round for the same id; the outer delivery then
  // continues to subscriber 2. Subscriber 2 must never receive the outer
  // "hidden" value after the correction's own "visible" — the delivery is
  // superseded at the reentry point, so subscriber 2 reads only the
  // correction, and it is the final choice.
  const { ui, manager } = initFixture();
  const id = "overlay1";

  let corrected = false;
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
    if (payload.id !== id || corrected) return;
    corrected = true;
    manager.setVisible(id, true);
  });
  const received: boolean[] = [];
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
    if (payload.id !== id) return;
    received.push(payload.intent.visible);
  });

  manager.setVisible(id, false);

  expect(received).toEqual([true]);
  expect(intentVisibleOf(ui, id)).toBe(true);
});

it("a reentrant flip inside the CHANGE callback announces the intent once", () => {
  // The outer hide delivers its CHANGE first. A subscriber that reverses the
  // flip inside that delivery emits the correction's own CHANGE+INTENT while
  // the outer round is still between its two halves — and a CHANGE token
  // cannot stop an INTENT. The outer INTENT must still not follow: it would
  // duplicate the final state, and LAYER_INTENT_CHANGE is only supposed to
  // fire when the stored intent actually moves.
  const { ui, manager } = initFixture();
  const id = "overlay1";

  let corrected = false;
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== id || corrected) return;
    corrected = true;
    manager.setVisible(id, true);
  });
  const intents: boolean[] = [];
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
    if (payload.id !== id) return;
    intents.push(payload.intent.visible);
  });

  manager.setVisible(id, false);

  expect(intents).toEqual([true]);
  expect(intentVisibleOf(ui, id)).toBe(true);
});

it("the group count reflects the intent a reentrant correction left", () => {
  const { ui } = initFixture({
    data: [
      { id: "one", name: "One", group: "overlay", layer: polygonLayer() },
      { id: "two", name: "Two", group: "overlay", layer: polygonLayer() },
    ],
  });
  const count = () => ui.listPanel.checkedCount[GROUP.OVERLAY];
  expect(count()).toEqual({ total: 2, on: 2 });

  // A subscriber that disagrees with the uncheck and pushes the layer back
  // on, synchronously, inside the notify.
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
    ui.applyVisibility("one", true);
  });

  ui.applyVisibility("one", false);

  // The count is the final intent, not the delta the outer operation
  // computed against the state it started from.
  expect(count()).toEqual({ total: 2, on: 2 });
  expect(intentVisibleOf(ui, "one")).toBe(true);
});

it("a subscriber that throws leaves every side effect applied", () => {
  // The notify is last, so a throwing handler can only interrupt delivery —
  // the carrier write, the row paint and the group count are already done.
  // A mid-operation notify would have left the checkbox and the count
  // behind while the map had already moved.
  const { ui } = initFixture();
  const id = "overlay1";
  const row = findItem(ui, id);
  ui.events.on(EVENTS.LAYER_CHANGE, () => {
    throw new Error("subscriber boom");
  });

  expect(() => ui.applyVisibility(id, false)).toThrow("subscriber boom");

  expect(ui.c.map.removeLayer).toHaveBeenCalled();
  expect(intentVisibleOf(ui, id)).toBe(false);
  expect(
    (row.querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
  ).toBe(false);
  expect(ui.listPanel.checkedCount[GROUP.OVERLAY]).toEqual({
    total: 1,
    on: 0,
  });
});

it("a subscriber that destroys the control leaves no null deref", () => {
  // A subscriber that tears the control down takes its panel container with
  // it. Every panel read of the operation happens *before* the notify, so
  // nothing after the callback dereferences the missing container — a
  // mid-operation notify would have left a row paint and a tri-state rescan
  // queued behind the teardown, and that rescan reads the container with a
  // non-null assertion.
  const { ui } = initFixture();
  const id = "overlay1";
  ui.events.on(EVENTS.LAYER_CHANGE, () => {
    // The container half of `LayerController.destroy()`.
    ui.c.uiContainer = null;
  });

  expect(() => ui.applyVisibility(id, false)).not.toThrow();
  expect(ui.c.map.removeLayer).toHaveBeenCalled();
  expect(intentVisibleOf(ui, id)).toBe(false);
  expect(ui.listPanel.checkedCount[GROUP.OVERLAY]).toEqual({
    total: 1,
    on: 0,
  });
});

it("a zoom sweep notifies each moved layer once, in registry order", () => {
  const layerA = polygonLayer();
  const layerB = polygonLayer();
  const { ui, map } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", group: "overlay", layer: layerA },
      { id: "beta", name: "Beta", group: "overlay", layer: layerB },
    ],
  });
  for (const id of ["alpha", "beta"]) {
    setIntent(ui, id, "zoomRange", [0, 1]);
    ui.intentStore.seedProvenance(id, ["zoomRange"]);
  }
  const removed: string[] = [];
  map.removeLayer = vi.fn((l: L.Layer) =>
    removed.push(l === layerA ? "alpha" : "beta"),
  );

  const seen: string[] = [];
  const removedAtDelivery: string[][] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    seen.push(payload.id);
    removedAtDelivery.push(removed.slice());
  });

  ui.onZoomEnd?.();

  expect(removed).toEqual(["alpha", "beta"]);
  expect(seen).toEqual(["alpha", "beta"]);
  // The whole sweep landed before the first notify: a mid-sweep notify
  // would have shown only ["alpha"] at the first delivery.
  expect(removedAtDelivery[0]).toEqual(["alpha", "beta"]);
});

it("a subscriber that unregisters a later layer does not strand the sweep", () => {
  // The sweep decides what moves before it announces anything, so a delta
  // can still name a layer that has left the registry by the time its own
  // delivery comes around. That is a no-delivery, not a throw: the sweep
  // skips the gone layer instead of dropping whatever came after it.
  const layerA = polygonLayer();
  const layerB = polygonLayer();
  const { ui } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", group: "overlay", layer: layerA },
      { id: "beta", name: "Beta", group: "overlay", layer: layerB },
    ],
  });
  for (const id of ["alpha", "beta"]) {
    setIntent(ui, id, "zoomRange", [0, 1]);
    ui.intentStore.seedProvenance(id, ["zoomRange"]);
  }

  const seen: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    seen.push(payload.id);
    if (payload.id === "alpha") ui.c.layerRegistry.remove("beta");
  });

  expect(() => ui.onZoomEnd?.()).not.toThrow();
  expect(seen).toEqual(["alpha"]);
  expect(ui.c.layerRegistry.has("beta")).toBe(false);
});

it("a CHANGE that retires its layer suppresses the intent half", () => {
  // The two halves of one round belong to the entry that ran the pass. A
  // subscriber that retires that entry inside the CHANGE has answered for it
  // already, so the intent half is not delivered for an id nobody holds —
  // and in particular not for a replacement registered under the same id.
  const { ui, manager } = initFixture();

  const changes: string[] = [];
  const intents: string[] = [];
  let retired = false;
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    changes.push(payload.id);
    if (payload.id === "overlay1" && !retired) {
      retired = true;
      manager.unregisterLayer("overlay1");
    }
  });
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
    intents.push(payload.id);
  });

  ui.applyVisibility("overlay1", false);

  expect(changes).toEqual(["overlay1", "overlay1"]);
  expect(intents).toEqual([]);
  expect(ui.c.layerRegistry.has("overlay1")).toBe(false);
});

it("a batch delta for a layer replaced under the same id delivers nothing", () => {
  // The sweep stamps each delta with the entry it ran against, so a
  // replacement registered under the same id by an earlier delivery of the
  // same round is not handed the delta it never produced. Delivery is
  // identity, not presence: the id is live, the entry is not.
  const layerAlpha = polygonLayer();
  const layerBeta = polygonLayer();
  const replacement = polygonLayer();
  const { ui, manager } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", group: "overlay", layer: layerAlpha },
      { id: "beta", name: "Beta", group: "overlay", layer: layerBeta },
    ],
  });
  // Both layers sit on the map while their stored intent says hidden, so the
  // sweep has a flip for each. `visible` rather than `zoomRange`: with
  // `visible` false the re-registration below stays off the map, so its own
  // projection is a no-op and the only beta announce in the round is its
  // registration CHANGE.
  const onMap = trackMembership(ui.c.map);
  onMap.set(layerAlpha, true);
  onMap.set(layerBeta, true);
  setIntent(ui, "alpha", "visible", false);
  setIntent(ui, "beta", "visible", false);
  ui.intentStore.seedProvenance("alpha", ["visible"]);
  ui.intentStore.seedProvenance("beta", ["visible"]);

  const changes: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    changes.push(payload.id);
    if (payload.id === "alpha") {
      manager.registerLayer({
        id: "beta",
        name: "Beta",
        group: "overlay",
        layer: replacement,
      });
    }
  });

  ui.onZoomEnd?.();

  // alpha's flip, then the re-registration's own CHANGE — and nothing else.
  // The sweep's delta for the beta it replaced is the third one on a
  // build without the identity check.
  expect(changes).toEqual(["alpha", "beta"]);
  expect(ui.c.layerRegistry.get("beta")?.layer).toBe(replacement);
  expect(onMap.get(replacement) ?? false).toBe(false);
});

// ── Consumer-failure contract: a throwing subscriber must not truncate the
// ── rest of the operation. The state and the projection baselines are already
// ── committed before the notify, so a retry produces no delta and can never
// ── replay what a fail-fast delivery skipped.

it("a throwing CHANGE subscriber does not steal later subscribers or the intent half", () => {
  // Three independent consumers of one operation: a thrower first, then a
  // CHANGE consumer, then the INTENT half. The thrower must not starve the
  // subscriber behind it, and a CHANGE failure must not suppress the INTENT
  // that carries the user's choice — the two are separate public semantics.
  const { ui } = initFixture();
  const id = "overlay1";
  const changes: string[] = [];
  const intents: boolean[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, () => {
    throw new Error("change boom");
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    changes.push(payload.id);
  });
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
    intents.push(payload.intent.visible);
  });

  expect(() => ui.applyVisibility(id, false)).toThrow("change boom");

  expect(changes).toEqual([id]);
  expect(intents).toEqual([false]);
  expect(intentVisibleOf(ui, id)).toBe(false);
});

it("a throwing INTENT subscriber does not starve the subscribers behind it", () => {
  const { ui } = initFixture();
  const id = "overlay1";
  const seen: boolean[] = [];
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
    throw new Error("intent boom");
  });
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
    seen.push(payload.intent.visible);
  });

  expect(() => ui.applyVisibility(id, false)).toThrow("intent boom");

  expect(seen).toEqual([false]);
});

it("both halves throwing completes both fan-outs and reports the CHANGE failure first", () => {
  const { ui } = initFixture();
  const id = "overlay1";
  const intents: boolean[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, () => {
    throw new Error("change boom");
  });
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, () => {
    throw new Error("intent boom");
  });
  ui.events.on(EVENTS.LAYER_INTENT_CHANGE, payload => {
    intents.push(payload.intent.visible);
  });

  expect(() => ui.applyVisibility(id, false)).toThrow("change boom");

  // The INTENT half still ran to the end; its failure was the second one and
  // is not the error the operation reports.
  expect(intents).toEqual([false]);
});

it("a throwing subscriber on the first swept layer does not strand the layers behind it", () => {
  // A zoom sweep announces several layers as one batch. Stopping at the first
  // throw would leave beta's membership change permanently unannounced.
  const layerA = polygonLayer();
  const layerB = polygonLayer();
  const { ui, map } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", group: "overlay", layer: layerA },
      { id: "beta", name: "Beta", group: "overlay", layer: layerB },
    ],
  });
  for (const id of ["alpha", "beta"]) {
    setIntent(ui, id, "zoomRange", [0, 1]);
    ui.intentStore.seedProvenance(id, ["zoomRange"]);
  }
  map.removeLayer = vi.fn();

  const seen: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id === "alpha") throw new Error("alpha boom");
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    seen.push(payload.id);
    if (payload.id === "beta") throw new Error("beta boom");
  });

  expect(() => ui.onZoomEnd?.()).toThrow("alpha boom");

  expect(seen).toEqual(["alpha", "beta"]);
  expect(map.removeLayer).toHaveBeenCalledWith(layerA);
  expect(map.removeLayer).toHaveBeenCalledWith(layerB);
});

it("a basemap switch still announces the sweep when the own layer throws", () => {
  // applyVisibility announces the acted-on layer and the basemap sweep as one
  // operation. The own layer's consumer failing must not strand the sweep —
  // the sweep layers were already re-projected and their baselines written.
  const { ui, map } = initFixture();
  const overlay = ui.c.layerRegistry.get("overlay1")!.layer!;
  const base = ui.c.layerRegistry.get("base1")!.layer!;
  // Real membership: the projection reads the carrier back before it writes,
  // and a hasLayer that always answers true turns every re-projection into a
  // fresh flip (the sweep would announce the base a second time).
  const onMap = trackMembership(map);
  onMap.set(overlay, true);
  onMap.set(base, true);
  setIntent(ui, "overlay1", "zoomRange", [0, 1]);
  ui.intentStore.seedProvenance("overlay1", ["zoomRange"]);

  const seen: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id === "base1") throw new Error("base boom");
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    seen.push(payload.id);
  });

  expect(() => ui.applyVisibility("base1", false)).toThrow("base boom");

  expect(seen).toEqual(["base1", "overlay1"]);
  expect(map.removeLayer).toHaveBeenCalledWith(overlay);
  expect(onMap.get(base)).toBe(false);
});

it("a subscriber that destroys the control stops the remaining batch without throwing", () => {
  // Retirement is checked at each item, so the layers after the destroy have
  // no registered entry left to announce for — a no-delivery, not a throw.
  const layerA = polygonLayer();
  const layerB = polygonLayer();
  const { ui, manager, map } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", group: "overlay", layer: layerA },
      { id: "beta", name: "Beta", group: "overlay", layer: layerB },
    ],
  });
  // Real membership: destroy() runs dismissFocus, which sweeps and would see a
  // phantom flip on a hasLayer that never notices the removal — a reentrant
  // notify into the handler that is already destroying the control.
  const onMap = trackMembership(map);
  onMap.set(layerA, true);
  onMap.set(layerB, true);
  for (const id of ["alpha", "beta"]) {
    setIntent(ui, id, "zoomRange", [0, 1]);
    ui.intentStore.seedProvenance(id, ["zoomRange"]);
  }

  const seen: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    seen.push(payload.id);
    if (payload.id === "alpha") manager.destroy();
  });

  expect(() => ui.onZoomEnd?.()).not.toThrow();
  expect(seen).toEqual(["alpha"]);
  expect(manager.layerRegistry.has("beta")).toBe(false);
});

it("notifyDelta raises a single layer's consumer failure after its fan-out", () => {
  // The single-entry notify (opacity / zoom-range / count paths) has no wider
  // batch left to finish, so it raises the first consumer failure itself —
  // after every subscriber of the CHANGE has seen the round.
  const { ui } = initFixture();
  const entry = ui.c.layerRegistry.get("overlay1")!;
  const seen: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, () => {
    throw new Error("single boom");
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    seen.push(payload.id);
  });

  expect(() =>
    notifyDelta(ui, entry, { wroteVisible: true, intentMoved: false }),
  ).toThrow("single boom");

  expect(seen).toEqual([entry.id]);
});
