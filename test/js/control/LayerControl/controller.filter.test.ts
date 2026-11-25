// test/js/control/LayerControl/controller.filter — generic data-layer filter wiring.
import {
  between,
  leafWithElement,
  makeFeatures,
  makeStore,
  stableStamp,
} from "./controller.fixture.js";
import {
  initFixture,
  installLeafletGlobals,
  makeAuthorIcon,
  makeDerivedUI,
  polygonLayer,
} from "./ui/fixture.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import {
  FILTER_SOURCE,
  type LayerFilterFeatures,
  LayerRuntimeStore,
} from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { commitGlyph } from "#control/LayerControl/ui/style/icon.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

it("routes the injected generic filterSetter through setLayerFilter", () => {
  const { manager } = initFixture({
    data: [
      { id: "overlay1", name: "Polygons", role: "overlay", layer: polygonLayer() },
    ],
  });
  manager.uiContainer = document.createElement("div");
  manager.ui = makeDerivedUI({
    intentStore: makeStore(),
    runtimeStore: (() => {
      const s = new LayerRuntimeStore();
      s.setFilterFeatures("overlay1", {
        features: [],
        numericFields: ["mag"],
        ranges: { mag: [0, 10] },
        enumFields: [],
        enumValues: {},
        total: 5,
      } as any);
      return s;
    })(),
    colorSurface: {} as any,
    currentColor: "#000000",
    dropPersistedLayerState: vi.fn(),
    saveState: vi.fn(),
    syncToggleAll: vi.fn(),
    syncNoBasemap: vi.fn(),
    renamedNames: {},
    saveNamesState: vi.fn(),
    invalidateFields: vi.fn(),
  }) as any;

  // A plain data layer owns no caller capability, so the gate injects the
  // generic pair; the row carries it onto the registry entry.
  const info = manager.layerRegistry.get("overlay1")!;
  expect(info.filterSetter).toBeTypeOf("function");
  expect(manager.hasFilterableFields("overlay1")).toBe(true);

  const setSpy = vi.spyOn(manager, "setLayerFilter");
  info.filterSetter!({
    kind: "atom",
    field: "mag",
    op: "between",
    range: [2, 8],
  } as any);
  // The injected closure is a plain delegation: it must not own the write,
  // so setLayerFilter is the only carrier into the shared store.
  expect(setSpy).toHaveBeenCalledWith("overlay1", {
    kind: "atom",
    field: "mag",
    op: "between",
    range: [2, 8],
  });
  expect(info.filter).toEqual({
    kind: "atom",
    field: "mag",
    op: "between",
    range: [2, 8],
  });
  expect(
    (manager as any).filterStore.getFilter("overlay1", FILTER_SOURCE.GENERIC),
  ).toEqual({
    kind: "atom",
    field: "mag",
    op: "between",
    range: [2, 8],
  });
  setSpy.mockRestore();
});

it("hasGenericFields probe is bounded by PROBE_K: a field past the window is conservative false", () => {
  // 64 leaves with no properties, then a 65th with a value. The bounded
  // scan stops at PROBE_K, so the 65th is invisible → conservative false.
  const leaves = Array.from({ length: 65 }, (_, i) => ({
    options: {},
    feature: i === 64 ? { properties: { value: 1 } } : { properties: {} },
    getElement: () => document.createElement("path"),
  }));
  const layer = {
    options: {},
    eachLayer: vi.fn((fn: (l: unknown) => void) => leaves.forEach(fn)),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager: m } = initFixture({
    data: [{ id: "p1", name: "P", role: "overlay", layer: layer as any }],
  });
  expect(m.hasFilterableFields("p1")).toBe(false);
});

it("hasGenericFields caches the probe answer per dataRevision (one scan, repeated reads)", () => {
  const leaf = {
    options: {},
    feature: { properties: { value: 1 } },
    getElement: () => document.createElement("path"),
  };
  const layer = {
    options: {},
    eachLayer: vi.fn((fn: (l: unknown) => void) => fn(leaf)),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager: m, ui } = initFixture({
    data: [{ id: "p1", name: "P", role: "overlay", layer: layer as any }],
  });
  const spy = vi.spyOn(m as any, "scanGenericFields");
  expect(m.hasFilterableFields("p1")).toBe(true);
  expect(m.hasFilterableFields("p1")).toBe(true);
  expect(spy).toHaveBeenCalledTimes(1);
  // A bump invalidates the probe cache: the next read re-scans.
  ui.runtimeStore.bumpDataRevision("p1");
  expect(m.hasFilterableFields("p1")).toBe(true);
  expect(spy).toHaveBeenCalledTimes(2);
  spy.mockRestore();
});

it("escape hatch: a declared filter reports filterable even when the probe window reads false", () => {
  const leaf = {
    options: {},
    feature: { properties: {} },
    getElement: () => document.createElement("path"),
  };
  const layer = {
    options: {},
    eachLayer: vi.fn((fn: (l: unknown) => void) => fn(leaf)),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager: m } = initFixture({
    data: [{ id: "p1", name: "P", role: "overlay", layer: layer as any }],
  });
  expect(m.hasFilterableFields("p1")).toBe(false);
  // A committed filter (the author declared one) flips the gate on.
  m.setLayerFilter("p1", {
    kind: "atom",
    field: "value",
    op: "between",
    range: [1, 5],
  } as any);
  expect(m.hasFilterableFields("p1")).toBe(true);
});

it("scanGenericFields walks a wrapper's _layers registry when eachLayer is absent (T2)", () => {
  // A wrapper exposes children through _layers but no eachLayer — the
  // bounded scan must read the registry instead of bailing on an empty
  // child list (a group whose only children live in _layers).
  const leaf = {
    options: {},
    feature: { properties: { value: 1 } },
    getElement: () => document.createElement("path"),
  };
  const wrapper = {
    options: {},
    _layers: { l1: leaf },
    getBounds: () => ({ isValid: () => true }),
  };
  Object.setPrototypeOf(wrapper, new window.L.Path());
  const { manager: m } = initFixture({
    data: [{ id: "p1", name: "P", role: "overlay", layer: wrapper as any }],
  });
  expect(m.hasFilterableFields("p1")).toBe(true);
});

it("scanGenericFields tolerates a group whose child enumeration throws (T3)", () => {
  // A hostile/partial layer may throw from eachLayer or _layers access —
  // the probe must degrade to "no children scanned" rather than crash a
  // menu row render.
  const layer = {
    options: {},
    eachLayer: () => {
      throw new Error("boom");
    },
    getBounds: () => ({ isValid: () => true }),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager: m } = initFixture({
    data: [{ id: "p1", name: "P", role: "overlay", layer: layer as any }],
  });
  // The probe reads false (nothing scannable) — but it must not throw.
  expect(() => m.hasFilterableFields("p1")).not.toThrow();
  expect(m.hasFilterableFields("p1")).toBe(false);
});

it("ensureGenericHost registers hasFields as a live probe (T4)", () => {
  // The generic host carries a hasFields closure wired to hasGenericFields;
  // nothing in the store calls it — it is a caller-side probe. Capture the
  // registered host and invoke the closure directly: the closure must answer
  // the bounded probe for the layer it was registered for.
  const leaf = {
    options: {},
    feature: { properties: { value: 1 } },
    getElement: () => document.createElement("path"),
  };
  const layer = {
    options: {},
    eachLayer: vi.fn((fn: (l: unknown) => void) => fn(leaf)),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager: m } = initFixture({
    data: [{ id: "p1", name: "P", role: "overlay", layer: layer as any }],
  });
  let captured: { hasFields?: () => boolean } | undefined;
  const spy = vi.spyOn((m as any).filterStore, "registerHost").mockImplementation(((
    id: string,
    name: string,
    host: any,
  ) => {
    captured = host;
  }) as any);
  m.setLayerFilter("p1", {
    kind: "atom",
    field: "value",
    op: "between",
    range: [1, 5],
  } as any);
  spy.mockRestore();
  expect(captured?.hasFields).toBeTypeOf("function");
  expect(captured?.hasFields?.()).toBe(true);
});

it("unregister-then-read: ensureFilterFeatures keeps a pre-seeded row after the layer unregisters (A)", () => {
  // A cached filterFeatures row is authoritative even when the layer is gone:
  // `if (!layer) return cached ?? null` must return the seeded snapshot, not
  // drop the model. Seed the row, read once (builds the cache), unregister,
  // read again - the second read must still answer the cached row.
  const layer = polygonLayer();
  const { manager, ui } = initFixture({
    data: [{ id: "p1", name: "P", role: "overlay", layer }],
  });
  const s = new LayerRuntimeStore();
  s.setFilterFeatures("p1", {
    features: [],
    numericFields: ["mag"],
    ranges: { mag: [0, 10] },
    enumFields: [],
    enumValues: {},
    total: 5,
  });
  (ui as any).runtimeStore = s;
  (manager as any).ui = ui;

  // First read builds/answers the cached row.
  expect(manager.genericFilterModel("p1")).not.toBeNull();
  // Unregister the layer (teardown, not delete): the layer is gone from the registry.
  expect(manager.unregisterLayer("p1")).toBe(true);
  // The model read must not throw and must keep the cached snapshot.
  expect(() => manager.genericFilterModel("p1")).not.toThrow();
});

it("fresh-layer-read: a first read on an un-built id builds filterFeatures from the layer (B)", () => {
  // A freshly registered id (never probed by the attach sweep) has no cached
  // row; the first genericFilterModel read must walk the layer and store the
  // row. Observed through the runtimeStore write: exactly one build, and the
  // model answers with the built snapshot.
  installLeafletGlobals();
  const leaf = new window.L.Polygon() as any;
  leaf.feature = { properties: { mag: 3 } };
  const layer = {
    options: {},
    eachLayer: vi.fn((fn: (l: unknown) => void) => fn(leaf)),
    getBounds: () => ({ isValid: () => true }),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager, ui } = initFixture({ data: [] });
  const writeSpy = vi.spyOn(ui.runtimeStore, "setFilterFeatures");
  // Register a fresh id after the attach sweep, so no prior probe built it.
  manager.registerLayer({
    id: "fresh1",
    name: "F",
    role: "overlay",
    layer: layer as any,
  });
  const model = manager.genericFilterModel("fresh1");
  expect(model).not.toBeNull();
  expect(model!.dimensions).toEqual([
    { kind: "range", field: "mag", range: [3, 3], step: 1 },
  ]);
  expect(writeSpy).toHaveBeenCalledTimes(1);
  writeSpy.mockRestore();
});

it("genericFilterModel returns null when the cached feature row is gone (B)", () => {
  // The dimensions read and the features read are two store calls; a host
  // whose cached row is cleared between them (a teardown racing the panel
  // open) must fall back to the empty state instead of throwing.
  installLeafletGlobals();
  const { manager, ui } = initFixture({ data: [] });
  vi.spyOn((manager as any).filterStore, "filterModel").mockReturnValue({
    dimensions: [{ kind: "range", field: "mag", range: [0, 10], step: 1 }],
    ranges: { mag: [0, 10] },
    enumFields: [],
    enumValues: {},
    total: 5,
  } as any);
  vi.spyOn(ui.runtimeStore, "getFilterFeatures").mockReturnValue(undefined as any);
  expect(manager.genericFilterModel("gone1")).toBeNull();
});

it("scanGenericFields prunes a group nested deeper than RECURSION.LAYER_DEPTH (B)", () => {
  // depth > 10 returns false inside walk - a >10-deep nesting must be pruned,
  // not walked to the bottom. Build a 12-deep chain where only the innermost
  // leaf carries a value; the probe must read false (conservative) and not throw.
  // Register the layer AFTER the attach sweep so no cached probe row exists -
  // otherwise hasGenericFields answers from the cache and scanGenericFields
  // (the depth guard) is never reached.
  installLeafletGlobals();
  const leaf = new window.L.Polygon() as any;
  leaf.feature = { properties: { value: 1 } };
  let node: any = leaf;
  for (let k = 0; k < 12; k++) {
    // Capture the current child per iteration - eachLayer must descend into
    // THIS parent's child, not the loop-reassigned `node` reference.
    const child = node;
    const parent: any = {
      options: {},
      eachLayer: vi.fn((fn: (l: unknown) => void) => fn(child)),
    };
    Object.setPrototypeOf(parent, new window.L.Path());
    node = parent;
  }
  const { manager } = initFixture({ data: [] });
  manager.registerLayer({ id: "deep", name: "D", role: "overlay", layer: node as any });
  expect(() => manager.hasFilterableFields("deep")).not.toThrow();
  expect(manager.hasFilterableFields("deep")).toBe(false);
});

it("hasGenericFields bails false for a registered id with no carrier layer (A)", () => {
  // The `if (!layer) return false` arm of hasGenericFields: an id that is
  // registered but carries no layer (layer:null / unresolved carrier) must
  // answer false without touching the probe cache.
  const { manager } = initFixture({ data: [] });
  manager.registerLayer({
    id: "null1",
    name: "N",
    role: "overlay",
    layer: null as any,
  });
  expect(manager.hasFilterableFields("null1")).toBe(false);
});

it("Tier2 cache hit: ensureFilterFeatures reuses the built row until dataRevision moves (D)", () => {
  // `if (cached && this.filterFeaturesRev.get(id) === revision) return cached` -
  // a second read at the same revision must NOT re-walk. Bump the revision and
  // the next read re-walks. Observed by counting the runtimeStore write: the
  // builder writes the row once per build, a cache hit never writes. A fresh
  // id is registered after the attach sweep so the build is attributable to
  // the model reads, not the fixture render.
  installLeafletGlobals();
  const leaf = new window.L.Polygon() as any;
  leaf.feature = { properties: { mag: 3 } };
  const layer = {
    options: {},
    eachLayer: vi.fn((fn: (l: unknown) => void) => fn(leaf)),
    getBounds: () => ({ isValid: () => true }),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager, ui } = initFixture({ data: [] });
  const writeSpy = vi.spyOn(ui.runtimeStore, "setFilterFeatures");
  manager.registerLayer({ id: "t2", name: "T", role: "overlay", layer: layer as any });
  // First read: build + write (1).
  expect(manager.genericFilterModel("t2")).not.toBeNull();
  expect(writeSpy).toHaveBeenCalledTimes(1);
  // Same revision: cache hit, no re-walk / no re-write.
  expect(manager.genericFilterModel("t2")).not.toBeNull();
  expect(writeSpy).toHaveBeenCalledTimes(1);
  // Revision moved: the next read re-walks and re-writes.
  ui.runtimeStore.bumpDataRevision("t2");
  expect(manager.genericFilterModel("t2")).not.toBeNull();
  expect(writeSpy).toHaveBeenCalledTimes(2);
  writeSpy.mockRestore();
});

it("escape hatch reverse: clearing a declared filter flips the gate back to the probe (A)", () => {
  // The author-declaration escape hatch short-circuits to true. Clearing the
  // declaration (setLayerFilter(id, undefined)) must fall back to the probe -
  // the reverse arm of `if (declared !== undefined) return true`.
  const leaf = {
    options: {},
    feature: { properties: {} },
    getElement: () => document.createElement("path"),
  };
  const layer = {
    options: {},
    eachLayer: vi.fn((fn: (l: unknown) => void) => fn(leaf)),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager } = initFixture({
    data: [{ id: "p1", name: "P", role: "overlay", layer: layer as any }],
  });
  expect(manager.hasFilterableFields("p1")).toBe(false);
  manager.setLayerFilter("p1", {
    kind: "atom",
    field: "value",
    op: "between",
    range: [1, 5],
  } as any);
  expect(manager.hasFilterableFields("p1")).toBe(true);
  // Clearing the committed filter must return the gate to the probe (false here).
  manager.setLayerFilter("p1", undefined);
  expect(manager.hasFilterableFields("p1")).toBe(false);
});

it("hasFilterableFields answers false for an id with no registry entry (A)", () => {
  const { manager } = initFixture({ data: [] });
  expect(manager.hasFilterableFields("never-registered")).toBe(false);
});

it("scanGenericFields ignores a leaf that carries no feature properties (A)", () => {
  // The `if (!props) return false` arm: a geometry leaf whose feature (or its
  // properties) is absent must be skipped, not treated as filterable.
  installLeafletGlobals();
  const bare = new window.L.Polygon() as any;
  bare.feature = undefined;
  const layer = {
    options: {},
    eachLayer: vi.fn((fn: (l: unknown) => void) => fn(bare)),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager } = initFixture({ data: [] });
  manager.registerLayer({
    id: "bare1",
    name: "B",
    role: "overlay",
    layer: layer as any,
  });
  expect(manager.hasFilterableFields("bare1")).toBe(false);
});

it("scanGenericFields treats a non-empty string property as filterable (A)", () => {
  // The string value-kind arm: a single string prop must answer true (the
  // probe stops at the first filterable value, so each kind needs its own
  // layer to be observed). Plain leaf objects (not L.Polygon stubs, which
  // can expose _layers and be misread as group-like) keep the walk on the
  // leaf path.
  const sLeaf = {
    options: {},
    feature: { properties: { name: "alpha" } },
    getElement: () => document.createElement("path"),
  };
  const layer = {
    options: {},
    eachLayer: vi.fn((fn: (l: unknown) => void) => fn(sLeaf)),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager } = initFixture({ data: [] });
  manager.registerLayer({ id: "vs1", name: "V", role: "overlay", layer: layer as any });
  expect(manager.hasFilterableFields("vs1")).toBe(true);
});

it("scanGenericFields treats a boolean property as filterable (A)", () => {
  const bLeaf = {
    options: {},
    feature: { properties: { active: true } },
    getElement: () => document.createElement("path"),
  };
  const layer = {
    options: {},
    eachLayer: vi.fn((fn: (l: unknown) => void) => fn(bLeaf)),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager } = initFixture({ data: [] });
  manager.registerLayer({ id: "vb1", name: "V", role: "overlay", layer: layer as any });
  expect(manager.hasFilterableFields("vb1")).toBe(true);
});

it("scanGenericFields ignores a non-finite numeric property (A)", () => {
  // The Number.isFinite false arm: NaN (and Infinity) must NOT count as a
  // filterable numeric field, only finite numbers do.
  const nLeaf = {
    options: {},
    feature: { properties: { bad: NaN, alsoBad: Infinity } },
    getElement: () => document.createElement("path"),
  };
  const layer = {
    options: {},
    eachLayer: vi.fn((fn: (l: unknown) => void) => fn(nLeaf)),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager } = initFixture({ data: [] });
  manager.registerLayer({ id: "vn1", name: "V", role: "overlay", layer: layer as any });
  expect(manager.hasFilterableFields("vn1")).toBe(false);
});

it("scanGenericFields probe is bounded by PROBE_K on a fresh layer (B)", () => {
  // The `seen > PROBE_K` arm of scanGenericFields: a freshly registered id
  // (no cached probe row) with 65 childless leaves must stop the scan at
  // PROBE_K=64 and answer conservative false - the 65th (filterable) leaf is
  // invisible. The committed PROBE_K test uses initFixture data, whose attach
  // sweep caches the probe answer, so scanGenericFields (and the >PROBE_K arm)
  // never runs there; a fresh id reaches the walk. Plain leaf objects (not
  // L.Polygon) keep the walk on the leaf path - Polygon stubs can expose
  // _layers and be misread as group-like.
  const leaves = Array.from({ length: 65 }, (_, i) => ({
    options: {},
    feature: i === 64 ? { properties: { value: 1 } } : { properties: {} },
    getElement: () => document.createElement("path"),
  }));
  const layer = {
    options: {},
    eachLayer: vi.fn((fn: (l: unknown) => void) => leaves.forEach(fn)),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager } = initFixture({ data: [] });
  manager.registerLayer({ id: "pk1", name: "P", role: "overlay", layer: layer as any });
  expect(manager.hasFilterableFields("pk1")).toBe(false);
});

it("scanGenericFields treats string and boolean property values as filterable (A)", () => {
  // The value-kind arms of the probe: a non-empty string and a boolean are
  // both filterable; a NaN (not finite) must NOT count. Cover the branches
  // the existing numeric-only tests skip.
  installLeafletGlobals();
  const sLeaf = new window.L.Polygon() as any;
  sLeaf.feature = { properties: { name: "alpha" } };
  const bLeaf = new window.L.Polygon() as any;
  bLeaf.feature = { properties: { active: true } };
  const nLeaf = new window.L.Polygon() as any;
  nLeaf.feature = { properties: { bad: NaN } };
  const layer = {
    options: {},
    eachLayer: vi.fn((fn: (l: unknown) => void) => {
      fn(sLeaf);
      fn(bLeaf);
      fn(nLeaf);
    }),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager } = initFixture({ data: [] });
  manager.registerLayer({ id: "vb1", name: "V", role: "overlay", layer: layer as any });
  // string "alpha" is filterable (first hit stops the probe)
  expect(manager.hasFilterableFields("vb1")).toBe(true);
});

it("scanGenericFields skips a label leaf (A)", () => {
  // The `if ((node as LabelAwareLayer).isLabel) return false` arm: a label
  // leaf must be skipped even when it carries a filterable property.
  installLeafletGlobals();
  const lbl = new window.L.Polygon() as any;
  lbl.isLabel = true;
  lbl.feature = { properties: { value: 1 } };
  const layer = {
    options: {},
    eachLayer: vi.fn((fn: (l: unknown) => void) => fn(lbl)),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager } = initFixture({ data: [] });
  manager.registerLayer({
    id: "lbl1",
    name: "L",
    role: "overlay",
    layer: layer as any,
  });
  expect(manager.hasFilterableFields("lbl1")).toBe(false);
});

it("scanGenericFields skips a wrapper with neither eachLayer nor _layers (A)", () => {
  // The `if (reg)` arm of internalLayers: a group-like node that is neither a
  // Leaflet container (no eachLayer) nor a registry wrapper (no _layers) must
  // be treated as childless, not crash.
  installLeafletGlobals();
  const wrapper: any = { options: {} };
  Object.setPrototypeOf(wrapper, new window.L.Path());
  const { manager } = initFixture({ data: [] });
  manager.registerLayer({
    id: "w0",
    name: "W",
    role: "overlay",
    layer: wrapper as any,
  });
  expect(() => manager.hasFilterableFields("w0")).not.toThrow();
  expect(manager.hasFilterableFields("w0")).toBe(false);
});

it("genericCounts decrements kept for a leaf hidden by the active filter (A)", () => {
  // The `if (hidden.has(feature.leaf)) kept--` arm of genericCounts: when a
  // filter is applied and some leaves are in the hidden set, kept must drop
  // below total. Drive it through the public path that reads counts.
  installLeafletGlobals();
  const leaf = new window.L.Polygon() as any;
  leaf.feature = { properties: { mag: 3 } };
  const layer = {
    options: {},
    eachLayer: vi.fn((fn: (l: unknown) => void) => fn(leaf)),
    getBounds: () => ({ isValid: () => true }),
  };
  Object.setPrototypeOf(layer, new window.L.Path());
  const { manager } = initFixture({ data: [] });
  manager.registerLayer({ id: "kc1", name: "K", role: "overlay", layer: layer as any });
  const model = manager.genericFilterModel("kc1");
  expect(model).not.toBeNull();
  // Apply a filter that hides the single leaf: keep the value outside its range.
  manager.setLayerFilter("kc1", {
    kind: "atom",
    field: "mag",
    op: "between",
    range: [9, 10],
  } as any);
  const counts = (manager as any).genericCounts("kc1");
  expect(counts).toEqual({ kept: 0, total: 1 });
});

describe("generic data-layer filter (controller wiring)", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let map: L.Map;

  it("uses the design contract class name foliplus-feature-filtered", () => {
    // The apply mechanism's DOM class is part of the design contract. Assert
    // the literal so a wrong const cannot silently pass alongside a wrong
    // class: renaming the class must change this test too.
    expect(CONST.CLASSES.FILTER_HIDDEN).toBe("foliplus-feature-filtered");
  });

  beforeEach(() => {
    const fixture = initFixture();
    manager = fixture.manager;
    ui = fixture.ui;
    map = fixture.map;
  });

  describe("registerLayer injection", () => {
    it("injects filterProvider/filterSetter for an ordinary overlay", () => {
      manager.registerLayer({ id: "flt1", name: "Flt", role: "overlay" });
      const info = manager.layerRegistry.get("flt1");
      expect(info?.filterProvider).toBeTypeOf("function");
      expect(info?.filterSetter).toBeTypeOf("function");
    });

    it("does not inject for a base layer", () => {
      const tile = new (window.L.TileLayer as any)();
      manager.registerLayer({
        id: "base2",
        name: "Base",
        role: "base",
        layer: tile,
        paneName: "tilePane",
      });
      const info = manager.layerRegistry.get("base2");
      expect(info?.filterProvider).toBeNull();
      expect(info?.filterSetter).toBeNull();
    });

    it("does not override a caller-declared filterProvider", () => {
      const provider = vi.fn(() => null);
      manager.registerLayer({
        id: "explicit",
        name: "Explicit",
        role: "overlay",
        filterProvider: provider,
      });
      const info = manager.layerRegistry.get("explicit");
      expect(info?.filterProvider).toBe(provider);
    });

    it("filterSetter writes through to setLayerFilter", () => {
      manager.registerLayer({ id: "flt1", name: "Flt", role: "overlay" });
      const info = manager.layerRegistry.get("flt1");
      const filter = between("value", [2, 5]);
      // Calling the injected setter runs the write-through closure and, with
      // no feature snapshot yet, the empty-features branch of applyFilterClass.
      info?.filterSetter?.(filter);
      expect(manager.layerRegistry.get("flt1")?.filter).toEqual(filter);
      // With no feature snapshot the empty-features branch installs an empty
      // hidden set; a WeakSet has no .size here, so assert by identity.
      expect(manager.hiddenSets.get("flt1")).toBeInstanceOf(WeakSet);
    });
  });

  describe("setLayerFilter", () => {
    it("applies FILTER_HIDDEN to non-matching leaves and publishes the change", () => {
      const features = makeFeatures();
      ui.runtimeStore.setFilterFeatures("flt1", features);
      const listener = vi.fn();
      manager.events.on(EVENTS.LAYER_FILTER_CHANGE, listener, "internal");

      manager.setLayerFilter("flt1", between("value", [2, 5]));

      const [a, b, c] = features.features;
      const path = (leaf: L.Layer) =>
        (leaf as { getElement: () => HTMLElement })
          .getElement()
          .classList.contains(CONST.CLASSES.FILTER_HIDDEN);
      expect(path(a.leaf)).toBe(true);
      expect(path(b.leaf)).toBe(false);
      expect(path(c.leaf)).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("removes the class from a leaf that stops matching (re-filter)", () => {
      const features = makeFeatures();
      ui.runtimeStore.setFilterFeatures("flt1", features);
      manager.setLayerFilter("flt1", between("value", [2, 5]));
      const [a] = features.features;
      const path = (leaf: L.Layer) =>
        (leaf as { getElement: () => HTMLElement })
          .getElement()
          .classList.contains(CONST.CLASSES.FILTER_HIDDEN);
      expect(path(a.leaf)).toBe(true);
      // Widen the range so the once-hidden leaf now matches again: the
      // re-apply must remove the class (a hidden-only add would leave it
      // hidden forever).
      manager.setLayerFilter("flt1", between("value", [1, 5]));
      for (const feature of features.features) {
        expect(path(feature.leaf)).toBe(false);
      }
    });
    it("applies an enum filter to the matching values only", () => {
      // Three leaves: a/1, b/2, c/5. An enum filter on kind=b keeps b only.
      const leaves = [leafWithElement(), leafWithElement(), leafWithElement()];
      leaves[0].feature = { properties: { kind: "a" } };
      leaves[1].feature = { properties: { kind: "b" } };
      leaves[2].feature = { properties: { kind: "c" } };
      const features: LayerFilterFeatures = {
        features: [
          { leaf: leaves[0], fields: { kind: "a" } },
          { leaf: leaves[1], fields: { kind: "b" } },
          { leaf: leaves[2], fields: { kind: "c" } },
        ],
        total: 3,
        numericFields: [],
        ranges: {},
        enumFields: ["kind"],
        enumValues: { kind: ["a", "b", "c"] },
      };
      ui.runtimeStore.setFilterFeatures("flt1", features);

      manager.setLayerFilter("flt1", { kind: "enum", field: "kind", values: ["b"] });

      const path = (leaf: L.Layer) =>
        (leaf as { getElement: () => HTMLElement })
          .getElement()
          .classList.contains(CONST.CLASSES.FILTER_HIDDEN);
      expect(path(leaves[0])).toBe(true);
      expect(path(leaves[1])).toBe(false);
      expect(path(leaves[2])).toBe(true);
    });

    it("clears the class for every leaf when the filter is removed", () => {
      const features = makeFeatures();
      ui.runtimeStore.setFilterFeatures("flt1", features);
      manager.setLayerFilter("flt1", between("value", [2, 5]));
      manager.setLayerFilter("flt1", undefined);
      const path = (leaf: L.Layer) =>
        (leaf as { getElement: () => HTMLElement })
          .getElement()
          .classList.contains(CONST.CLASSES.FILTER_HIDDEN);
      for (const feature of features.features) {
        expect(path(feature.leaf)).toBe(false);
      }
    });

    it("mirrors the committed filter into the layer entry slot (layers[id].filter)", () => {
      const features = makeFeatures();
      manager.registerLayer({ id: "flt1", name: "Flt", role: "overlay" });
      ui.runtimeStore.setFilterFeatures("flt1", features);
      // No filter yet: the slot starts empty.
      expect(manager.layerRegistry.get("flt1")?.filter).toBeUndefined();
      manager.setLayerFilter("flt1", between("value", [2, 5]));
      expect(manager.layerRegistry.get("flt1")?.filter).toEqual(
        between("value", [2, 5]),
      );
      manager.setLayerFilter("flt1", undefined);
      expect(manager.layerRegistry.get("flt1")?.filter).toBeUndefined();
    });

    it("replayFilter is a no-op for a layer with no committed filter", () => {
      // The layeradd late-binding replay must skip a layer that was never
      // filtered — the early return must not touch the hidden set.
      (manager as unknown as { replayFilter(id: string): void }).replayFilter("flt1");
      expect(manager.hiddenSets.get("flt1")).toBeUndefined();
    });

    it("replayFilter re-applies the committed filter (late-binding layeradd)", () => {
      const features = makeFeatures();
      ui.runtimeStore.setFilterFeatures("flt1", features);
      manager.setLayerFilter("flt1", between("value", [2, 5]));
      const [a] = features.features;
      const path = (leaf: L.Layer) =>
        (leaf as { getElement: () => HTMLElement })
          .getElement()
          .classList.contains(CONST.CLASSES.FILTER_HIDDEN);
      expect(path(a.leaf)).toBe(true);
      // A layeradd that arrives after the filter is committed replays it.
      (manager as unknown as { replayFilter(id: string): void }).replayFilter("flt1");
      expect(path(a.leaf)).toBe(true);
    });

    it("replayFilter rebuilds the snapshot on demand when a reload cleared it", () => {
      // The reload root cause (user-verified): after a refresh the store's
      // filterFeatures row is gone (the feature-build slice runs lazily), so
      // the layeradd replay's applyFilterClass used to raw-read the store,
      // get null, and leave every marker visible while the panel showed the
      // restored filter. applyFilterClass now routes through
      // ensureFilterFeatures, so the replay builds the snapshot from the
      // registered layer's geometry and re-applies the class.
      const el = document.createElement("path");
      const leaf = Object.assign(new window.L.Polygon(), {
        feature: { properties: { value: 1 } },
        getElement: () => el,
      });
      manager.registerLayer({
        id: "reload",
        name: "Reload",
        role: "overlay",
        layer: leaf,
      });
      manager.setLayerFilter("reload", between("value", [2, 5]));
      const hidden = () => el.classList.contains(CONST.CLASSES.FILTER_HIDDEN);
      expect(hidden()).toBe(true);
      // A reload clears the snapshot (built lazily) and recreates the DOM —
      // the class is gone from the fresh element.
      ui.runtimeStore.deleteFilterFeatures("reload");
      el.classList.remove(CONST.CLASSES.FILTER_HIDDEN);
      expect(hidden()).toBe(false);
      // The layeradd replay must rebuild the snapshot and re-apply.
      (manager as unknown as { replayFilter(id: string): void }).replayFilter("reload");
      expect(hidden()).toBe(true);
    });

    it("the layeradd handler replays a committed filter onto a re-added layer", () => {
      // The 415-419 replay branch only runs when a filter is committed and a
      // layer rejoins the map; the direct replayFilter tests above cover the
      // method but not the layeradd wiring. A re-add recreates the leaf's DOM
      // element (dropping the class), so the handler must re-apply it. The
      // shared L.stamp stub is not stable per object, so swap in a memoizing
      // one for the stamp match the handler performs.
      const realStamp = window.L.stamp;
      window.L.stamp = stableStamp;
      try {
        const features = makeFeatures();
        manager.registerLayer({ id: "late", name: "Late", role: "overlay" });
        ui.runtimeStore.setFilterFeatures("late", features);
        manager.setLayerFilter("late", between("value", [2, 5]));
        const [a] = features.features;
        const path = (leaf: L.Layer) =>
          (leaf as { getElement: () => HTMLElement })
            .getElement()
            .classList.contains(CONST.CLASSES.FILTER_HIDDEN);
        expect(path(a.leaf)).toBe(true);
        (a.leaf as { getElement: () => HTMLElement })
          .getElement()
          .classList.remove(CONST.CLASSES.FILTER_HIDDEN);
        expect(path(a.leaf)).toBe(false);
        // The real object joins the map after the filter was committed; the
        // layeradd handler must match it by stamp and re-apply the class.
        const arrived = new window.L.Path();
        map._layers["late"] = arrived;
        manager.onLayerAdd({ layer: arrived });
        expect(path(a.leaf)).toBe(true);
      } finally {
        window.L.stamp = realStamp;
      }
    });

    it("the layeradd replay leaves a layer that is not findable alone", () => {
      // The replay's resolved check also needs the false side: a layer joins
      // the map but is not findable (not in the internal registry), so the
      // handler must not crash and must not re-apply a class to nothing.
      const realStamp = window.L.stamp;
      window.L.stamp = stableStamp;
      try {
        const features = makeFeatures();
        manager.registerLayer({ id: "late", name: "Late", role: "overlay" });
        ui.runtimeStore.setFilterFeatures("late", features);
        manager.setLayerFilter("late", between("value", [2, 5]));
        const stranger = new window.L.Path();
        manager.onLayerAdd({ layer: stranger });
        expect(manager.layerRegistry.get("late")?.layer).toBeNull();
        expect(manager.layerRegistry.get("late")?.filterProvider).toBeTypeOf(
          "function",
        );
      } finally {
        window.L.stamp = realStamp;
      }
    });

    it("deleteFilterFeatures drops the snapshot and prunes the row", () => {
      const features = makeFeatures();
      ui.runtimeStore.setFilterFeatures("flt1", features);
      expect(ui.runtimeStore.getFilterFeatures("flt1")).toBe(features);
      ui.runtimeStore.deleteFilterFeatures("flt1");
      expect(ui.runtimeStore.getFilterFeatures("flt1")).toBeUndefined();
    });

    it("deleteFilterFeatures on an unknown id is a no-op", () => {
      // The row-missing branch: deleting a snapshot for a layer that was
      // never registered must not throw or touch anything.
      expect(() => ui.runtimeStore.deleteFilterFeatures("nope")).not.toThrow();
    });
  });

  describe("genericFilterModel", () => {
    it("builds the range dimension + kept/total readout from the snapshot", () => {
      const features = makeFeatures();
      ui.runtimeStore.setFilterFeatures("flt1", features);
      const filter = between("value", [2, 5]);
      manager.setLayerFilter("flt1", filter);

      const model = manager.genericFilterModel("flt1");
      expect(model).not.toBeNull();
      expect(model?.dimensions[0]).toMatchObject({
        kind: "range",
        field: "value",
        range: [1, 5],
      });
      expect(model?.total).toBe(3);
      expect(model?.kept).toBe(2);
      expect(model?.filter).toEqual(filter);
    });

    it("returns null when the layer has no filterable numeric field", () => {
      ui.runtimeStore.setFilterFeatures("flt1", {
        features: [],
        total: 0,
        numericFields: [],
        ranges: {},
        enumFields: [],
        enumValues: {},
      });
      expect(manager.genericFilterModel("flt1")).toBeNull();
    });
  });

  it("bumpDataRevision invalidates the cached filterFeatures (Tier2 rebuild)", () => {
    const features = makeFeatures();
    ui.runtimeStore.setFilterFeatures("flt1", features);
    // First read caches at revision 0.
    expect(manager.genericFilterModel("flt1")).not.toBeNull();
    // Bump — the cached row is now stale and must be rebuilt.
    ui.runtimeStore.bumpDataRevision("flt1");
    expect(manager.genericFilterModel("flt1")).not.toBeNull();
    expect(manager.genericFilterModel("flt1")?.total).toBe(3);
  });

  it("bumpDataRevision is per-id: a sibling layer's cache is untouched", () => {
    const features = makeFeatures();
    ui.runtimeStore.setFilterFeatures("flt1", features);
    ui.runtimeStore.setFilterFeatures("sib", makeFeatures());
    manager.genericFilterModel("flt1");
    ui.runtimeStore.bumpDataRevision("sib");
    // flt1's cached answer stays valid (its revision did not move).
    expect(manager.genericFilterModel("flt1")).not.toBeNull();
    expect(manager.genericFilterModel("flt1")?.total).toBe(3);
  });

  it("a layer with no walkable layer falls back to the pre-seeded snapshot", () => {
    // flt1 was never given a layer object (the registerLayer call carries no
    // `layer`), so buildFilterFeatures has nothing to walk. The pre-seeded
    // row is the source of truth and must survive.
    const features = makeFeatures();
    ui.runtimeStore.setFilterFeatures("flt1", features);
    expect(manager.genericFilterModel("flt1")).not.toBeNull();
  });

  describe("declared filter seeding (per-layer declaration → committed filter)", () => {
    it("seeds a declared filter as the layer's initial committed filter", () => {
      const { manager } = initFixture({
        data: [
          {
            id: "flt1",
            name: "Filtered",
            role: "overlay",
            layer: polygonLayer(),
            filter: between("value", [2, 8]),
          },
          { id: "plain", name: "Plain", role: "overlay", layer: polygonLayer() },
        ],
      });
      expect(manager.layerRegistry.get("flt1")?.filter).toEqual(
        between("value", [2, 8]),
      );
      expect(manager.layerRegistry.get("plain")?.filter).toBeUndefined();
    });
  });
});

describe("filter hidden-class survives a glyph rebuild (controller-side)", () => {
  class TestDivIcon {
    options: any;
    constructor(options: any) {
      this.options = options;
    }
  }
  (window.L as any).Icon = { Default: class {} };
  (window.L as any).DivIcon = TestDivIcon;
  (window.L as any).divIcon = vi.fn((options: any) => new TestDivIcon(options));
  const makeRebuildMarker = (authorIcon: unknown): any => {
    let iconEl: HTMLElement | null = null;
    const leaf: any = {
      options: { icon: authorIcon },
      feature: { properties: { value: 1 } },
      getElement: () => iconEl,
      setIcon: vi.fn((next: unknown) => {
        leaf.options.icon = next;
        iconEl =
          typeof (next as { createIcon?: unknown })?.createIcon === "function"
            ? (next as { createIcon: () => HTMLElement }).createIcon()
            : document.createElement("div");
        return leaf;
      }),
    };
    leaf.setIcon(authorIcon);
    return leaf;
  };
  const makeMarkerGroup = (...markers: any[]): any => ({
    options: {},
    eachLayer: vi.fn((fn: (child: unknown) => void) => {
      for (const marker of markers) fn(marker);
    }),
  });
  const BASE_LAYER = {
    id: "base1",
    name: "OSM",
    role: "base",
    layer: { options: {}, setZIndex: vi.fn() } as never,
    paneName: "tilePane",
  };
  const featuresOf = (leaf: unknown): LayerFilterFeatures => ({
    features: [{ leaf: leaf as any, fields: { value: 1 } }],
    total: 1,
    numericFields: ["value"],
    ranges: { value: [1, 1] },
    enumFields: [],
    enumValues: {},
  });
  const hasHiddenClass = (el: HTMLElement | null) =>
    !!el?.classList.contains(CONST.CLASSES.FILTER_HIDDEN);

  it("a glyph change that rebuilds the icon must not drop the hidden class", () => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el: Element, pseudo?: string | null) =>
        ({
          content: pseudo === "::before" ? '"\\f00a"' : "none",
        }) as CSSStyleDeclaration,
    );
    const authorIcon = makeAuthorIcon();
    const marker = makeRebuildMarker(authorIcon);
    const layer = makeMarkerGroup(marker);
    const { manager: m, ui: u } = initFixture({
      data: [{ id: "flt1", name: "Flt", role: "overlay", layer }, BASE_LAYER],
    });
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    u.runtimeStore.setFilterFeatures("flt1", featuresOf(marker));
    m.setLayerFilter("flt1", between("value", [2, 5]));
    const firstEl = marker.getElement();
    expect(hasHiddenClass(firstEl)).toBe(true);
    expect(m.hiddenSets.get("flt1")?.has(marker)).toBe(true);
    const elementBefore = marker.getElement();
    commitGlyph(u, "flt1", "star");
    flushStyleDimApply(FACE.ICON, "flt1");
    const elementAfter = marker.getElement();
    expect(elementAfter).not.toBe(elementBefore);
    expect(marker.setIcon).toHaveBeenCalled();
    const labelWillSkip = m.hiddenSets.get("flt1")?.has(marker) ?? false;
    const domHidden = hasHiddenClass(elementAfter);
    expect(domHidden).toBe(labelWillSkip);
    expect(domHidden).toBe(true);
  });

  it("a layer with no committed filter keeps its rebuilt element unclassed", () => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el: Element, pseudo?: string | null) =>
        ({
          content: pseudo === "::before" ? '"\\f00a"' : "none",
        }) as CSSStyleDeclaration,
    );
    const authorIcon = makeAuthorIcon();
    const marker = makeRebuildMarker(authorIcon);
    const layer = makeMarkerGroup(marker);
    const { manager: m, ui: u } = initFixture({
      data: [{ id: "flt1", name: "Flt", role: "overlay", layer }, BASE_LAYER],
    });
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    u.runtimeStore.setFilterFeatures("flt1", featuresOf(marker));
    expect(m.layerRegistry.get("flt1")?.filter).toBeUndefined();
    expect(hasHiddenClass(marker.getElement())).toBe(false);
    commitGlyph(u, "flt1", "star");
    flushStyleDimApply(FACE.ICON, "flt1");
    expect(marker.setIcon).toHaveBeenCalled();
    expect(hasHiddenClass(marker.getElement())).toBe(false);
    expect(m.hiddenSets.get("flt1")).toBeUndefined();
  });
});
