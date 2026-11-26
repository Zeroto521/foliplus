// Unit tests for HeatmapControl/manager — the manager assembly layer and cross-mixin integration.
import { initFixture, trackMembership } from "../LayerControl/ui/fixture.js";
import {
  makeManager,
  makeManagerOn,
  makeMarker, SCAN_DEBOUNCE, setupWithPoints, FakeGroup, fsSize,
} from "./fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, SettledOperation } from "#core/event/index.js";
import { CLASS_COUNT, SCHEME_FALLBACK_COLOR } from "#core/value/index.js";
import { BORDER_WEIGHT } from "#ui/index.js";
import { canvasMethods } from "#control/HeatmapControl/canvas.js";
import { extractMethods } from "#control/HeatmapControl/extract.js";
import { filterMethods } from "#control/HeatmapControl/filter.js";
import { initMethods } from "#control/HeatmapControl/init.js";
import { lifecycleMethods } from "#control/HeatmapControl/lifecycle.js";
import { stateMethods } from "#control/HeatmapControl/state.js";
import { HeatmapManager } from "#control/HeatmapControl/manager.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import * as CONST from "#control/HeatmapControl/const.js";


describe("HeatmapManager — style delegation", () => {
  function getCanvasOpts() {
    const createCanvas = (
      window.map.foliplus!.LayerAPI as unknown as {
        createCanvas: ReturnType<typeof vi.fn>;
      }
    ).createCanvas;
    return createCanvas.mock.calls[0][0] as {
      styleProvider?: () => Record<string, unknown>;
      styleSetters?: Record<string, (v: unknown) => void>;
      styleDefaultsProvider?: () => Record<string, unknown>;
    };
  }

  it("createCanvas receives styleProvider and styleSetters (no field)", () => {
    makeManager();
    const opts = getCanvasOpts();
    expect(typeof opts.styleProvider).toBe("function");
    expect(typeof opts.styleSetters?.labelShow).toBe("function");
    expect(typeof opts.styleSetters?.labelColor).toBe("function");
    expect(typeof opts.styleSetters?.labelSize).toBe("function");
    expect(typeof opts.styleSetters?.labelFormat).toBe("function");
    // Aggregation field is data config — not delegated into the style drawer.
    expect(opts.styleSetters?.field).toBeUndefined();
    expect((opts as any).fieldOptions).toBeUndefined();
  });

  it("styleProvider returns the live labelShow, color, size and format values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();
    expect(opts.styleProvider!()).toEqual({
      labelShow: true,
      labelColor: "#ffffff",
      labelSize: 11,
      labelFormat: "auto",
      borderWeight: 1.5,
      borderColor: "#333333",
    });

    m.labelShow = false;
    m.labelColor = "#ff0000";
    m.labelSize = 16;
    m.labelFormat = "comma";
    expect(opts.styleProvider!()).toEqual({
      labelShow: false,
      labelColor: "#ff0000",
      labelSize: 16,
      labelFormat: "comma",
      borderWeight: 1.5,
      borderColor: "#333333",
    });
  });

  it("constructs with empty field when CONFIG.field is absent", () => {
    delete (window.CONFIG as Record<string, unknown>).field;
    const m = makeManager();
    expect(m.field).toBe("");
  });

  it("labelShow setter flips state, re-renders and persists", () => {
    const m = makeManager();
    const renderSpy = vi.spyOn(m, "renderHexagons");
    const saveSpy = vi.spyOn(m, "saveConfig");
    const opts = getCanvasOpts();

    opts.styleSetters!.labelShow!(false);

    expect(m.labelShow).toBe(false);
    expect(renderSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  it("labelShow setter touches the layer and emits LAYER_STYLE_CHANGE", () => {
    const m = makeManager();
    // makeManager builds a bare map stub; the setter reaches LayerAPI through
    // this.map.foliplus (makeCtrl wires the same object).
    (m.map as unknown as { foliplus: unknown }).foliplus = window.map.foliplus;
    const touchLayer = window.map.foliplus.LayerAPI.touchLayer;
    const emitSpy = vi.spyOn(m.events, "publish");
    const opts = getCanvasOpts();

    opts.styleSetters!.labelShow!(true);

    expect(touchLayer).toHaveBeenCalledWith(m.layerId);
    expect(emitSpy).toHaveBeenCalledWith(
      EVENTS.LAYER_STYLE_CHANGE,
      {
        id: m.layerId,
      },
      { kind: "user", via: "panel" },
    );
  });

  it("labelFormat setter touches the layer and emits LAYER_STYLE_CHANGE", () => {
    const m = makeManager();
    (m.map as unknown as { foliplus: unknown }).foliplus = window.map.foliplus;
    const touchLayer = window.map.foliplus.LayerAPI.touchLayer;
    const emitSpy = vi.spyOn(m.events, "publish");
    const opts = getCanvasOpts();

    opts.styleSetters!.labelFormat!("comma");

    expect(touchLayer).toHaveBeenCalledWith(m.layerId);
    expect(emitSpy).toHaveBeenCalledWith(
      EVENTS.LAYER_STYLE_CHANGE,
      {
        id: m.layerId,
      },
      { kind: "user", via: "panel" },
    );
  });

  it("styleDefaultsProvider returns the Python CONFIG snapshot for the drawer Reset", () => {
    const m = makeManager();
    const opts = getCanvasOpts() as {
      styleDefaultsProvider?: () => Record<string, unknown>;
    };
    expect(typeof opts.styleDefaultsProvider).toBe("function");
    expect(opts.styleDefaultsProvider!()).toEqual({
      labelShow: true,
      labelColor: "#ffffff",
      labelSize: 11,
      labelFormat: "auto",
      borderWeight: 1.5,
      borderColor: "#333333",
    });

    // Runtime toggles must not leak into the Reset snapshot.
    m.labelShow = false;
    m.labelColor = "#00ff00";
    m.labelSize = 20;
    m.labelFormat = "comma";
    expect(opts.styleDefaultsProvider!()).toEqual({
      labelShow: true,
      labelColor: "#ffffff",
      labelSize: 11,
      labelFormat: "auto",
      borderWeight: 1.5,
      borderColor: "#333333",
    });
  });

  it("labelColor and labelSize setters update state, clear the style cache and persist", () => {
    const m = makeManager();
    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    const saveSpy = vi.spyOn(m, "saveConfig");
    const opts = getCanvasOpts();

    opts.styleSetters!.labelColor!("#00ff00");
    expect(m.labelColor).toBe("#00ff00");
    expect(m.cachedLabelStyle).toBeNull();

    opts.styleSetters!.labelSize!(18);
    expect(m.labelSize).toBe(18);
    expect(redrawSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  it("labelSize setter clamps out-of-range values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.labelSize!(99);
    expect(m.labelSize).toBe(CONST.LABEL.SIZE_MAX);

    opts.styleSetters!.labelSize!(1);
    expect(m.labelSize).toBe(CONST.LABEL.SIZE_MIN);
  });

  it("labelColor setter ignores non-string values and normalizes #rgb", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.labelColor!(42);
    expect(m.labelColor).toBe("#ffffff");

    opts.styleSetters!.labelColor!("#abc");
    expect(m.labelColor).toBe("#aabbcc");
  });

  it("labelSize setter ignores NaN and non-number values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.labelSize!(Number.NaN);
    expect(m.labelSize).toBe(11);

    opts.styleSetters!.labelSize!("18" as unknown as number);
    expect(m.labelSize).toBe(11);
  });

  it("labelColor and labelSize setters work without a bound panel", () => {
    const m = makeManager();
    // ui is null — the setters own state only; panels refresh via
    // LAYER_STYLE_CHANGE, so no panel sync happens here.
    expect(() => {
      getCanvasOpts().styleSetters!.labelColor!("#00ff00");
      getCanvasOpts().styleSetters!.labelSize!(20);
    }).not.toThrow();
    expect(m.labelColor).toBe("#00ff00");
    expect(m.labelSize).toBe(20);
  });

  it("labelFormat setter updates state, redraws labels and persists", () => {
    const m = makeManager();
    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    const saveSpy = vi.spyOn(m, "saveConfig");
    const opts = getCanvasOpts();

    opts.styleSetters!.labelFormat!("comma");

    expect(m.labelFormat).toBe("comma");
    expect(redrawSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  it("labelFormat setter falls back to auto for non-string values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.labelFormat!(42);

    expect(m.labelFormat).toBe("auto");
  });

  it("labelFormat seeds from CONFIG.label_format", () => {
    const m = makeManager({ label_format: "percent" });
    expect(m.labelFormat).toBe("percent");
  });

  it("labelFormat defaults to auto when CONFIG omits label_format", () => {
    const m = makeManager({ label_format: undefined });
    expect(m.labelFormat).toBe("auto");
  });

  it("labelShow defaults to true when CONFIG omits label_show", () => {
    // Python serializes label_show=True by default; a missing key must not
    // silently flip labels off — the same `!== false` rule MeasureControl uses.
    const m = makeManager({ label_show: undefined });
    const opts = getCanvasOpts() as {
      styleDefaultsProvider?: () => Record<string, unknown>;
    };

    expect(m.labelShow).toBe(true);
    expect(opts.styleDefaultsProvider!().labelShow).toBe(true);
  });

  it("borderWeight defaults to BORDER_WEIGHT.DEFAULT when CONFIG omits border_weight", () => {
    const m = makeManager({ border_weight: undefined });
    expect(m.borderWeight).toBe(BORDER_WEIGHT.DEFAULT);
  });

  it("borderWeight setter updates state, re-renders and persists", () => {
    const m = makeManager();
    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    const saveSpy = vi.spyOn(m, "saveConfig");
    const opts = getCanvasOpts();

    opts.styleSetters!.borderWeight!(3);

    expect(m.borderWeight).toBe(3);
    expect(redrawSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  it("borderWeight setter clamps out-of-range values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.borderWeight!(99);
    expect(m.borderWeight).toBe(BORDER_WEIGHT.MAX);

    opts.styleSetters!.borderWeight!(-5);
    expect(m.borderWeight).toBe(BORDER_WEIGHT.MIN);
  });

  it("borderWeight setter ignores NaN and non-number values", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.borderWeight!(Number.NaN);
    expect(m.borderWeight).toBe(1.5);

    opts.styleSetters!.borderWeight!("3" as unknown as number);
    expect(m.borderWeight).toBe(1.5);
  });

  it("borderWeight setter touches the layer and emits LAYER_STYLE_CHANGE", () => {
    const m = makeManager();
    (m.map as unknown as { foliplus: unknown }).foliplus = window.map.foliplus;
    const touchLayer = window.map.foliplus.LayerAPI.touchLayer;
    const emitSpy = vi.spyOn(m.events, "publish");
    const opts = getCanvasOpts();

    opts.styleSetters!.borderWeight!(2.5);

    expect(touchLayer).toHaveBeenCalledWith(m.layerId);
    expect(emitSpy).toHaveBeenCalledWith(
      EVENTS.LAYER_STYLE_CHANGE,
      {
        id: m.layerId,
      },
      { kind: "user", via: "panel" },
    );
  });

  it("borderColor setter updates state, re-renders and persists", () => {
    const m = makeManager();
    const redrawSpy = vi.spyOn(m, "redrawHeatmap");
    const saveSpy = vi.spyOn(m, "saveConfig");
    const opts = getCanvasOpts();

    opts.styleSetters!.borderColor!("#abcdef");

    expect(m.borderColor).toBe("#abcdef");
    expect(redrawSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });

  it("borderColor setter ignores non-string values and normalizes #rgb", () => {
    const m = makeManager();
    const opts = getCanvasOpts();

    opts.styleSetters!.borderColor!(42);
    expect(m.borderColor).toBe("#333333");

    opts.styleSetters!.borderColor!("#abc");
    expect(m.borderColor).toBe("#aabbcc");
  });

  it("borderColor setter touches the layer and emits LAYER_STYLE_CHANGE", () => {
    const m = makeManager();
    (m.map as unknown as { foliplus: unknown }).foliplus = window.map.foliplus;
    const touchLayer = window.map.foliplus.LayerAPI.touchLayer;
    const emitSpy = vi.spyOn(m.events, "publish");
    const opts = getCanvasOpts();

    opts.styleSetters!.borderColor!("#00ff00");

    expect(touchLayer).toHaveBeenCalledWith(m.layerId);
    expect(emitSpy).toHaveBeenCalledWith(
      EVENTS.LAYER_STYLE_CHANGE,
      {
        id: m.layerId,
      },
      { kind: "user", via: "panel" },
    );
  });
});

describe("constructor — CONFIG fallbacks", () => {
  it("uses library defaults when CONFIG omits optional style fields", () => {
    const m = makeManager({
      agg: undefined,
      color_scheme: undefined,
      method: undefined,
      num_classes: undefined,
      border_color: undefined,
      label_color: undefined,
      label_size: undefined,
    });
    expect(m.agg).toBe(CONST.AGG.COUNT);
    expect(m.scheme).toBe("Reds");
    expect(m.method).toBe("jenks");
    expect(m.numClasses).toBe(CLASS_COUNT.DEFAULT);
    expect(m.borderColor).toBe(SCHEME_FALLBACK_COLOR);
  });
});

describe("featureCountProvider", () => {
  it("returns 0 when cachedFeatures is null", () => {
    makeManager();
    const opts = window.map.foliplus.LayerAPI.createCanvas.mock.calls[0][0];
    expect(opts.featureCountProvider()).toBe(0);
  });

  it("returns the filtered feature count when cachedFeatures is set", () => {
    const m = makeManager();
    // cachedFeatures is the drawn (post-filter) set: the Attributes panel and
    // the row therefore report the kept features, while the unfiltered cell
    // total lives only in getFilterModel / the filter panel's Result.
    m.cachedFeatures = [{}, {}, {}] as any;
    const opts = window.map.foliplus.LayerAPI.createCanvas.mock.calls[0][0];
    expect(opts.featureCountProvider()).toBe(3);
  });
});

describe("NO_OP_ENV T fallback", () => {
  it("returns prefixed key when env is not provided", () => {
    const map = {
      getContainer: vi.fn(() => {
        const c = document.createElement("div");
        c.id = "heatmap-noop-map";
        return c;
      }),
      getBounds: vi.fn(),
      getZoom: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      foliplus: window.map.foliplus,
    };
    const m = new HeatmapManager(map);
    m.init();
    expect(m.T("title")).toBe("HeatmapControl.title");
  });
});

describe("HeatmapControl source content signal (LayerAPI integration)", () => {
  let ctrl: LayerController;
  let map: any;
  let mgr: HeatmapManager;
  let src: ReturnType<LayerController["createLayers"]>;
  let filterSpy: ReturnType<typeof vi.fn<(payload: { id: string }) => void>>;

  /** Flush both debounces the manager uses for layer/content changes. */
  const flushScans = () => vi.advanceTimersByTime(SCAN_DEBOUNCE + 50);

  beforeEach(() => {
    vi.restoreAllMocks();
    const fixture = initFixture();
    ctrl = fixture.manager;
    map = fixture.map;
    trackMembership(map);

    // The factory creates its groups through L.layerGroup — give it a real
    // one so addLayer/removeLayer/clearLayers actually move children.
    window.L.layerGroup = vi.fn(() => new FakeGroup()) as any;

    mgr = makeManagerOn(map);
    // One hex cell per marker: the fixture stub returns a constant cell, but
    // these assertions are about the owner-unit counts (cells kept / total),
    // so distinct cells keep the mapping to the old point totals legible.
    (globalThis.h3 as any).latLngToCell = vi.fn(
      (lat: number, lng: number) => `${lat}:${lng}`,
    );
    // HeatmapManager reads the LayerAPI through the free `map` global
    // (window.map) in getSelectedPoints / publishCount. Point it at the real
    // controller mounted on the fixture map.
    window.map.foliplus = map.foliplus;
    vi.spyOn(mgr, "redrawHeatmap").mockImplementation(() => {});

    vi.useFakeTimers();
    src = ctrl.createLayers({
      id: "src",
      name: "Source",
      panes: [{ name: "srcPane" }],
    });
    filterSpy = vi.fn<(payload: { id: string }) => void>();
    mgr.events.on(EVENTS.LAYER_FILTER_CHANGE, filterSpy);
  });

  afterEach(() => {
    mgr?.onSourceContentChange?.cancel?.();
    mgr?.onLayerChange?.cancel?.();
    ctrl?.debouncedEnforce?.cancel?.();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  /** Register the source with its initial points, flush the registration
   *  scan, then hand the manager the source row the production scan would
   *  have built (the fixture's source is a vector row, so the type filter
   *  drops it from `getLayersByType("point")`). */
  const selectSource = (values: number[]) => {
    const markers = values.map(makeMarker);
    markers.forEach(marker => src.addLayer(marker as unknown as L.Layer));
    flushScans();
    mgr.selectedLayerId = "src";
    mgr.pointLayers = [
      { id: "src", name: "Source", layer: src.mainLayer, count: values.length },
    ];
    return markers;
  };

  it("re-renders from a real addLayer and updates the panel model range", () => {
    const markers = selectSource([10, 30]);
    mgr.renderHexagons();
    expect(mgr.getFilterModel()!.dimensions[0]).toMatchObject({
      kind: "range",
      range: [10, 30],
    });

    // Move the content through the public API: the values now span [1, 5].
    // removeLayer keeps the row registered (only clearLayers retires it), so
    // this is a data update, not a source departure.
    markers.forEach(marker => src.removeLayer(marker as unknown as L.Layer));
    src.addLayer(makeMarker(1) as unknown as L.Layer);
    src.addLayer(makeMarker(5) as unknown as L.Layer);

    // The count signal drops the extraction caches synchronously, before the
    // debounced repaint — a panel read in between must not answer from the
    // retired snapshot.
    expect((mgr as any).cachedPoints).toBeNull();
    expect((mgr as any).cachedSnapshot).toBeNull();

    flushScans();

    expect(mgr.getFilterModel()!.dimensions[0]).toMatchObject({
      kind: "range",
      range: [1, 5],
    });
    expect(mgr.getFilterModel()!.total).toBe(2);
  });

  it("a real content change clamps a committed filter and notifies once", () => {
    const markers = selectSource([10, 30]);
    mgr.renderHexagons();
    mgr.setFilter({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
    expect(mgr.getFilterModel()!.filter).toBeDefined();
    filterSpy.mockClear();

    markers.forEach(marker => src.removeLayer(marker as unknown as L.Layer));
    src.addLayer(makeMarker(1) as unknown as L.Layer);
    src.addLayer(makeMarker(5) as unknown as L.Layer);
    flushScans();

    // [10, 20] cannot intersect [1, 5]: the stored band clamps to the only
    // still-valid point, and the one notification lands after the render.
    expect(mgr.getFilterModel()!.filter).toEqual({
      kind: "atom",
      field: "value",
      op: "between",
      range: [5, 5],
    });
    expect(filterSpy).toHaveBeenCalledTimes(1);
    expect(filterSpy).toHaveBeenCalledWith(
      { id: mgr.layerId },
      { origin: { kind: "user", via: "panel" } },
    );
  });

  it("notifies a content change even when the stored filter survives", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    mgr.setFilter({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
    expect(mgr.getFilterModel()!.kept).toBe(1);
    filterSpy.mockClear();

    // An added point inside the committed band leaves [10, 20] valid and
    // unchanged, but `kept` moves 1 → 2. An open panel's live readout is
    // derived from that model, so the content signal owes a notification even
    // without a clamp.
    src.addLayer(makeMarker(15) as unknown as L.Layer);
    flushScans();

    const model = mgr.getFilterModel()!;
    expect(model.filter).toEqual({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
    expect(model.kept).toBe(2);
    expect(filterSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the unfiltered cell total when the filter keeps nothing", () => {
    selectSource([10, 20, 30]);
    mgr.renderHexagons();
    expect(mgr.getFilterModel()!.total).toBe(3);

    // [12, 18] is a valid band inside the extent that no point falls in: the
    // render paints nothing, but the row still reports its unfiltered cell
    // count — 0 of 0 would hide what the filter is narrowing.
    mgr.setFilter({
      kind: "atom",
      field: "value",
      op: "between",
      range: [12, 18],
    });
    const model = mgr.getFilterModel()!;
    expect(model.kept).toBe(0);
    expect(model.total).toBe(3);
    expect((mgr as any).cachedFeatures).toBeNull();
    // (The Attributes panel and the row share featureCountProvider, which
    // counts this drawn set — that path is pinned in the featureCountProvider
    // describe; the unfiltered cell total only feeds the filter Result.)

    // The kept geometry survives the empty render: the next paint reuses the
    // same cell set (no h3 walk) and the total stays legible.
    const bins = (mgr as any).cachedBins;
    expect(bins.bins.size).toBe(3);
    mgr.renderHexagons();
    expect((mgr as any).cachedBins).toBe(bins);
    expect(mgr.getFilterModel()!.total).toBe(3);
  });

  it("a real removeLayer shrinks the snapshot and rebuilds the geometry cache", () => {
    const markers = selectSource([10, 20, 30]);
    mgr.renderHexagons();
    const binsBefore = (mgr as any).cachedBins;

    src.removeLayer(markers[1] as unknown as L.Layer);
    flushScans();

    const model = mgr.getFilterModel()!;
    expect(model.dimensions[0]).toMatchObject({ kind: "range", range: [10, 30] });
    expect(model.total).toBe(2);
    expect(model.kept).toBe(2);
    // Point identity moved, so the bin walk is redone for the new set.
    expect((mgr as any).cachedBins).not.toBe(binsBefore);
  });

  it("clearLayers on the selected source drops the selection, canvas and filter", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    mgr.setFilter({
      kind: "atom",
      field: "value",
      op: "between",
      range: [10, 20],
    });
    filterSpy.mockClear();

    src.clearLayers();
    flushScans();

    expect(mgr.selectedLayerId).toBeNull();
    expect(fsSize(mgr)).toBe(0);
    expect((mgr as any).cachedFeatures).toBeNull();
    // Exactly one notification, whichever debounced pass revalidates first.
    expect(filterSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores the count signal of its own output row (no self-trigger)", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    const cachedPoints = (mgr as any).cachedPoints;
    const renderSpy = vi.spyOn(mgr, "renderHexagons");

    // The manager publishes this event for its own row after every render;
    // consuming it would make each paint schedule another paint.
    mgr.events.publish(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: mgr.layerId });
    flushScans();

    expect(renderSpy).not.toHaveBeenCalled();
    expect((mgr as any).cachedPoints).toBe(cachedPoints);
  });

  it("drops a scheduled content repaint when the selection is gone", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();

    // A content signal schedules the debounced repaint; the selection is
    // cleared before the timer fires, so the callback must bail out instead of
    // rendering an owner that no longer exists.
    mgr.events.publish(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "src" });
    mgr.selectedLayerId = null;
    expect(() => flushScans()).not.toThrow();
    // The count signal already dropped the caches; the cleared selection then
    // keeps the debounced callback from touching the canvas.
    expect((mgr as any).cachedPoints).toBeNull();
  });

  it("keeps the snapshot when only the aggregation key changed", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    const snapshot = (mgr as any).cachedSnapshot;

    // A field/aggregation switch invalidates the extracted points (the cache
    // key changes) but not the owner snapshot: the same source keeps the same
    // points/fields/ranges, so the snapshot must not be rebuilt.
    mgr.agg = "sum" as typeof mgr.agg;
    expect(mgr.getSelectedPoints()).toHaveLength(2);
    expect((mgr as any).cachedSnapshot).toBe(snapshot);
    expect((mgr as any).cachedSnapshotLayerId).toBe("src");
  });

  it("syncFilterField is a no-op without a selected source", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    mgr.selectedLayerId = null;

    expect(() => (mgr as any).syncFilterField()).not.toThrow();
    expect(fsSize(mgr)).toBe(0);
  });

  it("settles a caller-owned operation when the selection is cleared mid-write", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    mgr.selectedLayerId = null;

    // A wider write already owns the operation: renderHexagons must not
    // settle it, the caller raises after its whole fan-out.
    const op = new SettledOperation(mgr.events);
    expect(() => mgr.renderHexagons(op)).not.toThrow();
  });

  it("renders an empty canvas when the selection is cleared without an operation", () => {
    selectSource([10, 30]);
    mgr.renderHexagons();
    mgr.selectedLayerId = null;

    // No caller-owned operation: the local one is settled (and would raise)
    // inside renderHexagons.
    expect(() => mgr.renderHexagons()).not.toThrow();
    expect((mgr as any).cachedFeatures).toBeNull();
  });
});

describe("HeatmapControl filter field follows the aggregation field", () => {
  let m: HeatmapManager;

  const points = [
    { lat: 26.08, lng: 119.3, value: 10, field: "b" },
    { lat: 26.09, lng: 119.31, value: 20, field: "a" },
    { lat: 26.1, lng: 119.32, value: 30, field: "a" },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    m = makeManager();
    setupWithPoints(m, points);
  });

  it("reads this.field, not numericFields[0]", () => {
    // numericFields order is ["b", "a"]; the aggregation field is "a".
    m.agg = "sum";
    m.field = "a";
    m.renderHexagons();
    const model = m.getFilterModel();
    expect(model).not.toBeNull();
    expect(model!.dimensions[0]).toMatchObject({ kind: "range", field: "a" });
    expect(model!.dimensions[0]).toMatchObject({ kind: "range", range: [20, 30] });
    expect(model!.total).toBe(3);
  });

  it("falls back to the first numeric field when this.field is empty", () => {
    // Marker values are exposed as the "value" field, which the snapshot
    // orders first — the default field is numericFields[0].
    m.field = "";
    const model = m.getFilterModel()!;
    expect(model.dimensions[0]).toMatchObject({ kind: "range", field: "value" });
    expect(model.dimensions[0]).toMatchObject({ kind: "range", range: [10, 30] });
  });

  it("syncFilterField drops a filter written for the previous field", () => {
    m.agg = "sum";
    m.field = "a";
    m.setFilter({ kind: "atom", field: "a", op: "between", range: [20, 25] });
    expect(fsSize(m)).toBe(1);
    m.field = "b";
    // The panel's field write saves the config, which is what drops the
    // memoised effective field — without it syncFilterField would still read
    // the previous field from the cache.
    m.saveConfig();
    m.syncFilterField();
    expect(fsSize(m)).toBe(0);
  });

  it("syncFilterField keeps a filter bound to the same field", () => {
    m.agg = "sum";
    m.field = "a";
    m.setFilter({ kind: "atom", field: "a", op: "between", range: [20, 25] });
    m.syncFilterField();
    expect(fsSize(m)).toBe(1);
  });
});

describe("HeatmapManager mixin split", () => {
  const MIXINS = {
    canvas: canvasMethods,
    extract: extractMethods,
    filter: filterMethods,
    init: initMethods,
    lifecycle: lifecycleMethods,
    state: stateMethods,
  };
  const prototype = HeatmapManager.prototype as unknown as Record<string, unknown>;

  it("installs every mixin method on the prototype", () => {
    const broken: string[] = [];
    for (const [module, methods] of Object.entries(MIXINS)) {
      for (const [name, fn] of Object.entries(methods)) {
        if (typeof fn !== "function") {
          broken.push(`${module}.${name} is not a function`);
        } else if (typeof prototype[name] !== "function") {
          broken.push(`${module}.${name} is not installed on HeatmapManager.prototype`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("keeps every mixin module non-empty", () => {
    for (const [module, methods] of Object.entries(MIXINS)) {
      expect(Object.keys(methods).length, module).toBeGreaterThan(0);
    }
  });
});
