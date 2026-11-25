// test/js/control/LayerControl/ui/style/state.opacity — opacity restore and event-driven row refresh.
import {
  TEST_ENV,
  attachedPanel,
  findItem,
  initFixture,
  installLeafletGlobals,
} from "./fixture.js";
import { specs } from "./state.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GEOM_TYPE, getLayerAlpha } from "#core/layer/index.js";
import { DEFAULT_SCHEMES, METHOD } from "#core/value/index.js";
import { EVENTS, ensureEvents } from "#foliplus/core/event/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { LayerController } from "#control/LayerControl/controller.js";
import { LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";
import { flushStyleDimApplies } from "#control/LayerControl/ui/style/styleBag.js";

// ─────────────────── opacity apply / restore / retention ─────────────────

describe("LayerUI opacity restore / retention", () => {
  const makeMap = () => {
    const setStyle = vi.fn();
    const layer = { options: {}, setStyle } as unknown as L.Layer;
    // The executor's pane write only promises coverage for migratable
    // families; this test's stand-in for a Path layer declares the family.
    Object.setPrototypeOf(layer, new window.L.Path());
    const panes = new Map<
      string,
      {
        style: Record<string, string>;
        classList: {
          add: () => void;
          remove: () => void;
          contains: (cls: string) => boolean;
        };
      }
    >();
    const getPane = vi.fn((name: string) => {
      let p = panes.get(name);
      if (!p) {
        p = {
          style: {},
          classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => true) },
        };
        panes.set(name, p);
      }
      return p;
    });
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      hasLayer: vi.fn(() => true),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getContainer: vi.fn(() => {
        const el = document.createElement("div");
        el.id = "map";
        return el;
      }),
      getPane,
      createPane: vi.fn(() => ({
        style: {},
        classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => true) },
      })),
      foliplus: { hint: { set: vi.fn(), clear: vi.fn(), registerIcon: vi.fn() } },
      getZoom: vi.fn(() => 4),
      getMaxZoom: vi.fn(() => 18),
      getMinZoom: vi.fn(() => 0),
      options: { maxZoom: 18 },
    };
    return { map, layer, setStyle, panes };
  };

  beforeEach(() => {
    installLeafletGlobals();
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("applyUserState restores a stored opacity onto Path layers", () => {
    const { map, layer, panes } = makeMap();
    const m = new LayerController(map, [{ id: "overlay1", name: "Poly", layer }]);
    const u = new LayerUI(m, TEST_ENV);
    seedIntentMap(u, "opacity", { overlay1: 0.45 });

    u.applyUserState();

    expect(m.layerRegistry.get("overlay1")?.opacity).toBe(0.45);
    // The pane carrier received the write (multiplicative over each feature).
    const writtenPane = [...panes.values()].find(p => p.style.opacity === "0.45");
    expect(writtenPane).toBeDefined();
  });

  it("applyUserState(id) applies opacity for a late-registered canvas layer", () => {
    const { map } = makeMap();
    const canvas = document.createElement("canvas");
    const m = new LayerController(map, [
      { id: "heat", name: "Heat", canvas, layer: null },
    ]);
    const u = new LayerUI(m, TEST_ENV);
    seedIntentMap(u, "opacity", { heat: 0.25 });

    u.applyUserState("heat");

    // Default "redraw" branch: CSS live + layerAlpha stored for the next paint.
    expect(canvas.style.opacity).toBe("0.25");
    expect(getLayerAlpha(canvas)).toBeCloseTo(0.25);
    expect(m.layerRegistry.get("heat")?.opacity).toBe(0.25);
  });

  it("keeps opacity entries whose layers are gone", () => {
    // An unresolvable id is not a leak to clean up — it may belong to a
    // component that registers later, and the user's stored opacity must not
    // revert to the author default while it waits.
    const { map, layer, panes } = makeMap();
    const m = new LayerController(map, [{ id: "overlay1", name: "Poly", layer }]);
    const u = new LayerUI(m, TEST_ENV);
    seedIntentMap(u, "opacity", { overlay1: 0.4, ghost: 0.1 });

    u.applyUserState();

    expect(u.intentStore.dumpIntents()).toEqual({
      overlay1: { opacity: 0.4 },
      ghost: { opacity: 0.1 },
    });
    // The live entry was written to the pane; the unresolvable one was kept
    // in memory and written nowhere.
    const writtenPanes = [...panes.values()].filter(p => p.style.opacity);
    expect(writtenPanes).toHaveLength(1);
    expect(writtenPanes[0].style.opacity).toBe("0.4");
  });

  it("keeps a zoom range and its provenance for a layer that is gone", () => {
    // Both halves stay. Only a provenance marker with no value is invalid
    // ({@link markOverride} refuses it), never a value whose layer has not
    // registered yet.
    const { map, layer } = makeMap();
    const m = new LayerController(map, [{ id: "overlay1", name: "Poly", layer }]);
    const u = new LayerUI(m, TEST_ENV);
    seedIntentMap(u, "zoomRange", { overlay1: [4, 10], ghost: [2, 8] });
    u.intentStore.replaceProvenance({ ghost: ["zoomRange"] });

    u.applyUserState();

    expect(u.intentStore.dumpIntents()).toEqual({
      overlay1: { zoomRange: [4, 10] },
      ghost: { zoomRange: [2, 8] },
    });
    expect(u.intentStore.dumpProvenance().ghost).toEqual(["zoomRange"]);
  });

  it("leaves a live layer alone when no opacity is stored", () => {
    const { map, layer, setStyle } = makeMap();
    const m = new LayerController(map, [{ id: "overlay1", name: "Poly", layer }]);
    const u = new LayerUI(m, TEST_ENV);
    seedIntentMap(u, "opacity", {});

    u.applyUserState();

    expect(setStyle).not.toHaveBeenCalled();
    expect(m.layerRegistry.get("overlay1")?.opacity).toBe(1);
  });
});

describe("event-driven row refresh", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    if (!manager.layerRegistry.get("overlay2")) {
      manager.registerLayer({
        id: "overlay2",
        name: "Circles",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
      });
    }
    window.localStorage.clear();
  });

  it("onLayerItemCountChange re-renders the type label and count column", () => {
    const events = ensureEvents(ui.c.map);
    const info = manager.layerRegistry.get("overlay1")!;
    // A numeric feature-count provider makes the count column render (the
    // fixture's default layers have none).
    info.featureCountProvider = () => 42;

    const item = findItem(ui, "overlay1");
    events.emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "overlay1" });

    expect(item.title).toContain("42");
    expect(item.querySelector(CONST.SEL.COUNT_COL)?.textContent).toContain("42");
    // The type icon column re-detects geometry for an iconSvg-less layer.
    expect(item.querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`)).not.toBeNull();
  });

  it("onLayerItemCountChange renders the type from the surface without stamping the snapshot", () => {
    // 33.2 authority: the surface owns the geometry probe; the manager never
    // calls getGeometryType directly, and the row only reads the surface — it
    // does not write layerInfo.type (single-writer snapshot via getLayerType).
    // The fixture's plain object is not an L.Polygon, so the surface resolves
    // it to EMPTY, which the row renders verbatim.
    const info = manager.layerRegistry.get("overlay1")!;
    const geomSpy = vi
      .spyOn(manager.surfaces.get("overlay1")!, "geometryType")
      .mockReturnValue(GEOM_TYPE.POLYGON as any);

    ensureEvents(ui.c.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "overlay1" });

    expect(geomSpy).toHaveBeenCalledTimes(1);
    expect(info.type).toBeNull();
    expect(
      findItem(ui, "overlay1").querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`),
    ).not.toBeNull();
  });

  it("onLayerItemCountChange falls back to UNKNOWN for an iconSvg-less layer with no resolvable layer object", () => {
    // Canvas / late-registered surface: findLayer returns null, so the row
    // paints SVGs.UNKNOWN without touching the snapshot.
    const info = manager.layerRegistry.get("overlay1")!;
    vi.spyOn(manager, "findLayer").mockReturnValue(null);

    ensureEvents(ui.c.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "overlay1" });

    expect(info.type).toBeNull();
    expect(
      findItem(ui, "overlay1").querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`)
        ?.innerHTML,
    ).toContain("svg");
  });

  it("onLayerItemCountChange leaves an iconSvg layer's custom SVG untouched", () => {
    // iconSvg-only layers short-circuit the geometry branch: the type column
    // keeps the custom icon, and the surface is never probed. The snapshot
    // stays null until getLayerType stamps it.
    const iconSvg = '<svg viewBox="0 0 8 8"><rect width="8" height="8"/></svg>';
    manager.registerLayer({
      id: "custom1",
      name: "Custom",
      role: "overlay",
      iconSvg,
    });
    const info = manager.layerRegistry.get("custom1")!;
    const item = findItem(ui, "custom1");
    expect(info.type).toBeNull();
    expect(item.querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`)?.innerHTML).toContain(
      "rect",
    );

    ensureEvents(ui.c.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "custom1" });

    expect(item.querySelector(`.${CONST.CLASSES.TYPE_ICON_COL}`)?.innerHTML).toContain(
      "rect",
    );
    expect(info.type).toBeNull();
  });

  it("onLayerItemCountChange re-applies the layer opacity to finalized geometry", () => {
    // A measurement finalized at store.add fires LAYER_ITEM_COUNT_CHANGE. The
    // panes were painted at full opacity while the preview was live; this is
    // when the opacity "snaps in" to the real geometry.
    const events = ensureEvents(ui.c.map);
    const li = manager.layerRegistry.get("overlay1")!;
    li.paneSpecs = specs("__test_opacity_pane__");
    // The projection reads the opacity value gated by the provenance
    // provenance marker, so both must be set for the stored value to flow
    // through — a raw `intents.opacity` write is not a user intent.
    seedIntentMap(ui, "opacity", { overlay1: 0.4 });
    ui.intentStore.seedProvenance("overlay1", ["opacity"]);

    const paneEl = document.createElement("div");
    vi.spyOn(manager.map, "getPane").mockReturnValue(paneEl);

    events.emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "overlay1" });

    expect(paneEl.style.opacity).toBe("0.4");
    expect(li.opacity).toBe(0.4);
  });

  describe("onLayerItemCountChange — the stored fill replays", () => {
    // A streamed createLayers fires the count change as each feature lands,
    // so this is where a stored fill re-paints the new geometry. It is
    // coalesced per frame like every panel write, so a batch costs one walk
    // and the walk always reads the latest layer state.

    afterEach(() => {
      delete globalThis.chroma;
      vi.clearAllMocks();
    });

    // Polygon features with distinct drive values on the layer the registry
    // points at — the reference the fill walk resolves.
    const attachFeatures = (values: number[]) => {
      const leaves = values.map(value => {
        const leaf: any = {
          feature: { properties: { value }, geometry: { type: "Polygon" } },
          options: { fillColor: "#3388ff", fillOpacity: 0.2, fill: true },
          setStyle: vi.fn(),
          on: vi.fn(),
        };
        return leaf;
      });
      const info = manager.layerRegistry.get("overlay1")!;
      info.layer = {
        options: {},
        eachLayer: (fn: (leaf: unknown) => void) => leaves.forEach(l => fn(l)),
      };
      return leaves;
    };

    it("repaints a stored ramp onto the features a count change lands", () => {
      // The defect this rail guards: without the replay the new features keep
      // the author fill, and the existing ones keep breaks classified before
      // those values arrived.
      globalThis.chroma = {
        scale: () => ({
          mode: () => ({
            colors: (n: number) =>
              Array.from({ length: n }, (_, i) => ["#a00000", "#ff7f00"][i % 2]),
          }),
        }),
      } as never;
      const leaves = attachFeatures([1, 5, 9]);
      seedIntentMap(ui, "fillValue", {
        overlay1: {
          field: "value",
          method: METHOD.EQUAL,
          classes: 2,
          scheme: DEFAULT_SCHEMES[0],
        },
      });

      ui.onLayerItemCountChange("overlay1");
      flushStyleDimApplies("overlay1");

      for (const leaf of leaves) expect(leaf.setStyle).toHaveBeenCalled();
      const colors = leaves.map(leaf => leaf.setStyle.mock.calls[0][0].fillColor);
      // The ramp owns the color: the extremes land in different classes.
      expect(colors[0]).not.toBe(colors[colors.length - 1]);
    });

    it("a throwing CHANGE consumer does not skip the scheduled replay", () => {
      // Ramp replay is queued before the projection notify: a consumer that
      // throws on the CHANGE must not stop the new features from being
      // repainted, and a reentrant unregister must find the task to clear.
      globalThis.chroma = {
        scale: () => ({
          mode: () => ({
            colors: (n: number) =>
              Array.from({ length: n }, (_, i) => ["#a00000", "#ff7f00"][i % 2]),
          }),
        }),
      } as never;
      const leaves = attachFeatures([1, 5, 9]);
      seedIntentMap(ui, "fillValue", {
        overlay1: {
          field: "value",
          method: METHOD.EQUAL,
          classes: 2,
          scheme: DEFAULT_SCHEMES[0],
        },
      });
      // The opacity gate is what makes the count change run a projection; a
      // visible flip gives that projection a CHANGE to deliver.
      seedIntentMap(ui, "opacity", { overlay1: 0.4 });
      seedIntentMap(ui, "visible", { overlay1: false });
      ui.intentStore.seedProvenance("overlay1", ["opacity", "fillValue", "visible"]);
      ensureEvents(ui.c.map).on(EVENTS.LAYER_CHANGE, () => {
        throw new Error("change boom");
      });

      expect(() => ui.onLayerItemCountChange("overlay1")).toThrow("change boom");

      flushStyleDimApplies("overlay1");
      for (const leaf of leaves) expect(leaf.setStyle).toHaveBeenCalled();
    });

    it("coalesces a batch of count changes into one walk", () => {
      // A batched createLayers fires one count change per feature. N walks in
      // one frame would make the streaming cost linear in the batch.
      globalThis.chroma = {
        scale: () => ({ mode: () => ({ colors: () => ["#a00000", "#ff7f00"] }) }),
      } as never;
      const leaves = attachFeatures([1, 5, 9]);
      seedIntentMap(ui, "fillValue", {
        overlay1: {
          field: "value",
          method: METHOD.EQUAL,
          classes: 2,
          scheme: DEFAULT_SCHEMES[0],
        },
      });

      ui.onLayerItemCountChange("overlay1");
      ui.onLayerItemCountChange("overlay1");
      ui.onLayerItemCountChange("overlay1");
      flushStyleDimApplies("overlay1");

      // The fill walk and the border follow-walk (C8: a fill value ramp
      // derives the border) each paint once; both are coalesced per frame.
      for (const leaf of leaves) expect(leaf.setStyle).toHaveBeenCalledTimes(1);
    });

    it("rides the solid mode onto the same new features", () => {
      const leaves = attachFeatures([1, 2, 3]);
      seedIntentMap(ui, "fillColor", { overlay1: "#abcdef" });
      seedIntentMap(ui, "fillStyleMode", { overlay1: "solid" });

      ui.onLayerItemCountChange("overlay1");
      flushStyleDimApplies("overlay1");

      // Solid paints every fill leaf once, with no classify in between.
      for (const leaf of leaves) {
        expect(leaf.setStyle).toHaveBeenCalledTimes(1);
        expect(leaf.setStyle.mock.calls[0][0].fillColor).toBe("#abcdef");
      }
    });
  });

  it("subscribeControlAttached reruns init when another control attaches", () => {
    const events = ensureEvents(ui.c.map);
    events.publish(EVENTS.CONTROL_ATTACHED, { component: "ScaleControl" });
    // The callback keeps the rendered rows intact (init re-syncs, no error).
    expect(
      attachedPanel(ui).querySelectorAll(`.${CONST.CLASSES.LAYER_ITEM}`).length,
    ).toBeGreaterThan(0);
  });
});
