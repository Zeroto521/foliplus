import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import {
  applyProjection,
  applyProjectionAll,
  applyStateOp,
} from "#foliplus/LayerControl/ui/apply.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { rowChecked } from "#foliplus/LayerControl/ui/rowView.js";
import { projectLayer } from "#foliplus/LayerControl/ui/store.js";
import { installLeafletGlobals } from "./fixture.js";

// ────────────────────────────────────────────────────────────────────────
// Gate: the executor must not let a derived dimension authorise
// display. Only user intent (or the author's declared default) determines
// map membership; effective = intent && policy, so a derived dimension
// (focus, zoom range) can only pull a layer off the map — never push one
// onto it.
//
// This is the quickstart regression: folium ships a `show=False`
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
    // authorise display. A derived dimension may only suppress, never
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
    // forward pass of the invariant: policy retracts -> policy
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

  it("a delayed annotation pane picks up the value, and nothing rewrites once settled", () => {
    // The annotation pane is created lazily — the pane carrier set is empty
    // on the first write and only includes the annotation name once the
    // label layer renders. A value-only diff sees `prev.opacity ===
    // next.opacity` and misses the write; carrier-identity detection fires
    // the replay onto the pane that just appeared.
    //
    // The second half is what the stable carrier key is for: once the value
    // and the carrier set have both settled, a repeated apply must not touch
    // the DOM at all. A per-call array key would rewrite here every time.
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

    const layer = { options: {} } as L.Layer;
    const manager = new LayerManager(map, [
      { id: "a1", name: "Labels", isBase: false, layer },
    ]);
    manager.ui = new LayerUI(manager);
    const ui = manager.ui as LayerUI;

    // Pin the carrier to a pane set. The surface's capability resolution is
    // not what this test is about — the executor's replay onto a moved
    // carrier is.
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "pane", zoomRange: "none" },
      paneNames: ["labels-pane"],
      geometryType: () => "polygon",
      materialize: () => {},
      setZ: () => {},
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    // Stored opacity, no annotation yet: the value lands on the declared pane.
    ui.opacityMap.a1 = 0.3;
    ui.userOverrides.a1 = ["opacity"];
    applyProjection(ui, "a1");
    expect(paneFor("labels-pane").style.opacity).toBe("0.3");

    // Settled: value and carrier are unchanged, so no pane is written again.
    (map.getPane as ReturnType<typeof vi.fn>).mockClear();
    applyProjection(ui, "a1");
    applyProjection(ui, "a1");
    expect(map.getPane).not.toHaveBeenCalled();

    // The annotation pane appears — the carrier set grows, so the stored
    // value must land on it too.
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "pane", zoomRange: "none" },
      paneNames: ["labels-pane"],
      geometryType: () => "polygon",
    } as unknown as ReturnType<typeof manager.surfaceFor>);
    (manager as any).annotation = {
      paneNameFor: (id: string) => (id === "a1" ? "fp-annotation-a1" : null),
    };
    applyProjection(ui, "a1");
    expect(paneFor("fp-annotation-a1").style.opacity).toBe("0.3");
    expect(paneFor("labels-pane").style.opacity).toBe("0.3");

    // Settled again.
    (map.getPane as ReturnType<typeof vi.fn>).mockClear();
    applyProjection(ui, "a1");
    expect(map.getPane).not.toHaveBeenCalled();
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
    // Structural lock: the executor keys `appliedState` by id
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

  const boot = (layers: ConstructorParameters<typeof LayerManager>[1]) => {
    const { container, map } = makeOffMapFixture();
    const manager = new LayerManager(map, layers);
    manager.ui = new LayerUI(manager);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();
    return { container, map, manager, ui };
  };

  it("an id with no registry entry is a no-op", () => {
    const { ui, map } = boot([{ id: "a", name: "A", isBase: false }]);
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();
    expect(() => applyProjection(ui, "ghost")).not.toThrow();
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("a hybrid layer fires both the map write and its callback", () => {
    // A layer that owns a Leaflet layer *and* an `onToggle` carries a
    // distinct piece of state in each: membership on the map, and the
    // canvas's own HIDDEN class. Both must fire on a visible write.
    const onToggle = vi.fn();
    const layer = { options: {} } as L.Layer;
    const { ui, map, manager } = boot([
      { id: "h", name: "Hybrid", isBase: false, layer, onToggle },
    ]);
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();

    ui.userOverrides.h = ["visible"]; // author default is off the map
    applyProjection(ui, "h");

    expect(map.addLayer).toHaveBeenCalledWith(layer);
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(manager.layerRegistry.get("h")?.visible).toBe(true);
  });

  it("a 'none' opacity carrier stores nothing and writes nothing", () => {
    // A slider that writes nothing must not pretend it wrote. MarkerCluster
    // icons live in the shared markerPane, which no per-layer CSS write can
    // reach — the honest answer is "no write exists".
    const layer = { options: {} } as L.Layer;
    const { ui, manager } = boot([{ id: "n", name: "None", isBase: false, layer }]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "none", zoomRange: "none" },
      paneNames: [],
      geometryType: () => "point",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    ui.opacityMap.n = 0.2;
    ui.userOverrides.n = ["opacity"];
    applyProjection(ui, "n");

    expect((layer.options as { opacity?: number }).opacity).toBeUndefined();
    expect(manager.layerRegistry.get("n")?.opacity).toBe(1);
  });

  it("a native opacity carrier with setOpacity multiplies the author's base", () => {
    // The slider is a multiplier over the declared default, so the base is
    // captured once — repeated drags must not compound on their own output.
    const setOpacity = vi.fn();
    const layer = { options: { opacity: 0.5 }, setOpacity } as unknown as L.Layer;
    const { ui, manager } = boot([{ id: "img", name: "Img", isBase: false, layer }]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "native", zoomRange: "none" },
      paneNames: [],
      geometryType: () => "polygon",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    ui.opacityMap.img = 0.5;
    ui.userOverrides.img = ["opacity"];
    applyProjection(ui, "img");
    applyProjection(ui, "img");

    expect(setOpacity).toHaveBeenNthCalledWith(1, 0.25);
  });

  it("a native opacity carrier without setOpacity writes options.opacity", () => {
    // GridLayer / TileLayer honour `options.opacity` at the next tile cycle
    // rather than through a setter.
    const layer = { options: { opacity: 0.8 } } as L.Layer;
    const { ui, manager } = boot([{ id: "tile", name: "Tile", isBase: false, layer }]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "native", zoomRange: "native" },
      paneNames: [],
      geometryType: () => "polygon",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    ui.opacityMap.tile = 0.5;
    ui.userOverrides.tile = ["opacity"];
    applyProjection(ui, "tile");

    expect((layer.options as { opacity?: number }).opacity).toBe(0.4);
  });

  it("a native zoomRange carrier sets and then clears minZoom/maxZoom", () => {
    // Leaflet does not self-apply `options.minZoom/maxZoom`, so the write is
    // paired with a level-set reset. Clearing the range removes both keys
    // and goes back to the author's declared default.
    const layer = { options: {} } as L.Layer;
    const { ui, manager } = boot([{ id: "z", name: "Z", isBase: false, layer }]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "pane", zoomRange: "native" },
      paneNames: [],
      geometryType: () => "polygon",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    ui.zoomRangeMap.z = [4, 10];
    ui.userOverrides.z = ["zoomRange"];
    applyProjection(ui, "z");
    const opts = layer.options as { minZoom?: number; maxZoom?: number };
    expect(opts.minZoom).toBe(4);
    expect(opts.maxZoom).toBe(10);

    delete ui.zoomRangeMap.z;
    delete ui.userOverrides.z;
    applyProjection(ui, "z");
    expect("minZoom" in opts).toBe(false);
    expect("maxZoom" in opts).toBe(false);
  });

  it("the LayerUI delegates reach the same executor", () => {
    const { ui, map, manager } = boot([
      { id: "d", name: "D", isBase: false, layer: { options: {} } as L.Layer },
    ]);
    ui.opacityMap.d = 0.6;
    ui.userOverrides.d = ["opacity"];
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();

    ui.applyProjection("d");
    expect(manager.layerRegistry.get("d")?.opacity).toBe(0.6);

    ui.applyProjectionAll();
    expect(map.addLayer).not.toHaveBeenCalled(); // idempotent: nothing moved
  });
});

describe("projectAll: the id set is a union, not just the registry", () => {
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
    const manager = new LayerManager(map, [
      { id: "a", name: "A", isBase: false, layer: { options: {} } as L.Layer },
    ]);
    manager.ui = new LayerUI(manager);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    ui.opacityMap.late = 0.3;
    ui.userOverrides.late = ["opacity"];
    expect(() => applyProjectionAll(ui)).not.toThrow();
    // The record is untouched — the id simply has nothing to write to yet.
    expect(ui.opacityMap.late).toBe(0.3);
    expect(ui.userOverrides.late).toEqual(["opacity"]);
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

  const boot = (layers: ConstructorParameters<typeof LayerManager>[1]) => {
    const { container, map } = makeOffMapFixture();
    const manager = new LayerManager(map, layers);
    manager.ui = new LayerUI(manager);
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
    const layer = { options: {} } as L.Layer;
    map.hasLayer = vi.fn(() => true);
    map.addLayer = vi.fn();
    map.removeLayer = vi.fn();

    const manager = new LayerManager(map, [
      { id: "on", name: "On", isBase: false, layer },
    ]);
    manager.ui = new LayerUI(manager);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    map.removeLayer.mockClear();
    map.hasLayer = vi.fn(() => true);
    ui.hiddenIds.add("on");
    ui.userOverrides.on = ["visible"];
    applyProjection(ui, "on");

    expect(map.removeLayer).toHaveBeenCalledWith(layer);
    expect(manager.layerRegistry.get("on")?.visible).toBe(false);
  });

  it("captures the author's opacity base once, defaulting to 1 when undeclared", () => {
    // `nativeBaseOf` caches on first use; the author's declared `opacity`
    // seeds it, and an undeclared layer falls back to fully opaque. The
    // slider is then a multiplier over that base, so a repeat apply must
    // not compound on its own output.
    const layer = { options: {} } as L.Layer;
    const { ui, manager } = boot([{ id: "b", name: "B", isBase: false, layer }]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "native", zoomRange: "none" },
      paneNames: [],
      geometryType: () => "polygon",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    ui.opacityMap.b = 0.5;
    ui.userOverrides.b = ["opacity"];
    applyProjection(ui, "b");
    expect((layer.options as { opacity?: number }).opacity).toBe(0.5);

    // Reset: the stored value leaves, so the write returns to the author's
    // base rather than to zero, and the mirror reads fully opaque.
    delete ui.opacityMap.b;
    delete ui.userOverrides.b;
    applyProjection(ui, "b");
    expect((layer.options as { opacity?: number }).opacity).toBe(1);
    expect(manager.layerRegistry.get("b")?.opacity).toBe(1);
  });

  it("an opacity op with no Leaflet layer and no canvas writes nothing", () => {
    // `if (!layer) return` — a stale registry entry whose layer object has
    // already left. Nothing to carry the write, and nothing to throw on.
    const { ui, manager } = boot([
      { id: "stale", name: "Stale", isBase: false, layer: null as never },
    ]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "pane", zoomRange: "none" },
      paneNames: [],
      geometryType: () => "point",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    ui.opacityMap.stale = 0.3;
    ui.userOverrides.stale = ["opacity"];
    expect(() => applyProjection(ui, "stale")).not.toThrow();
    expect(manager.layerRegistry.get("stale")?.opacity).toBe(1);
  });

  it("a pane write still lands when its element has already left the map", () => {
    // `if (pane)` — a pane released mid-session (teardown racing a write)
    // must be skipped rather than throw.
    const { container, map } = makeOffMapFixture();
    map.getPane = vi.fn(() => null as never);
    const layer = {
      options: {},
      eachLayer: vi.fn(),
      getBounds: vi.fn(() => ({ isValid: () => true })),
    } as unknown as L.Layer;
    const manager = new LayerManager(map, [
      { id: "gone", name: "Gone", isBase: false, layer },
    ]);
    manager.ui = new LayerUI(manager);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    ui.opacityMap.gone = 0.4;
    ui.userOverrides.gone = ["opacity"];
    expect(() => applyProjection(ui, "gone")).not.toThrow();
    expect(manager.layerRegistry.get("gone")?.opacity).toBe(0.4);
  });

  it("a ui with no hiddenIds and no userOverrides still projects", () => {
    // The `?? false` fallbacks on both choice maps: `applyProjection`,
    // `rowChecked` and `projectLayer` all read them as optional, because a
    // thin stub (and a partially-built shell) may not have them yet.
    const bare = {
      hiddenIds: undefined,
      userOverrides: undefined,
      authorVisible: new Map<string, boolean>(),
      opacityMap: {},
      fillColorMap: {},
      fillOpacityMap: {},
      zoomRangeMap: {},
      focusingLayerId: null,
      appliedState: new Map(),
      m: {
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

    const info = { id: "n", layer: { options: {} } } as never;
    const projection = projectLayer(bare, info);
    expect(projection.intent.visible).toBe(true);
    expect(projection.effectiveShown).toBe(true);
    expect(rowChecked(bare, info)).toBe(true);
    expect(() => applyProjection(bare, "n")).not.toThrow();
  });

  it("adds an author-visible layer that is not yet on the map", () => {
    // The other half of the membership write: gate 1 holds the executor
    // back from an *unauthorised* add, so this pins the authorised one.
    // Author snapshot says shown, intent has no override, policy is fine —
    // and the map has never been told.
    const layer = { options: {} } as L.Layer;
    const { ui, map } = boot([{ id: "a2", name: "A2", isBase: false, layer }]);
    ui.authorVisible.set("a2", true);
    (map.addLayer as ReturnType<typeof vi.fn>).mockClear();

    applyProjection(ui, "a2");

    expect(map.addLayer).toHaveBeenCalledWith(layer);
    expect(ui.m.layerRegistry.get("a2")?.visible).toBe(true);
  });

  it("the dispatcher itself is idempotent when the value already matches", () => {
    // `applyProjection` only reaches the dispatcher for a dimension that
    // moved, so the "value already equals what is on the map" side of that
    // comparison is unreachable through the executor. Calling the
    // dispatcher directly is how it gets covered — and it is the property
    // the comment promises: a redundant write is a no-op, not a re-add.
    const layer = { options: {} } as L.Layer;
    const { ui, map } = boot([{ id: "dup", name: "Dup", isBase: false, layer }]);
    map.hasLayer = vi.fn(() => true);
    map.addLayer = vi.fn();
    map.removeLayer = vi.fn();

    applyStateOp(ui, ui.m.layerRegistry.get("dup")!, {
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
    const layer = { options: {} } as L.Layer;
    map.hasLayer = vi.fn(() => true);
    map.addLayer = vi.fn();

    const manager = new LayerManager(map, [
      { id: "up", name: "Up", isBase: false, layer },
    ]);
    manager.ui = new LayerUI(manager);
    const ui = manager.ui as LayerUI;
    vi.useFakeTimers();
    manager.attachUI(container);
    vi.advanceTimersByTime(350);
    vi.useRealTimers();

    map.addLayer.mockClear();
    map.removeLayer = vi.fn();
    map.hasLayer = vi.fn(() => true);
    // No `hiddenIds` / override, and the author's default was observed as
    // `true` while the layer sits on the map — so intent and policy both
    // say "shown" and the layer is already shown.
    ui.authorVisible.set("up", true);
    applyProjection(ui, "up");

    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.removeLayer).not.toHaveBeenCalled();
  });
});
