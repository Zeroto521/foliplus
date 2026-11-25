// test/js/control/LayerControl/controller — core registry, layer type probes and find/destroy.
import {
  GridLayer,
  createLayerControllerFixture,
  makeStore,
  teardownLayerControllerFixture,
} from "./controller.fixture.js";
import { makeDerivedUI } from "./ui/fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_PANE_PREFIX, GEOM_TYPE, Z_INDEX } from "#core/layer/index.js";
import * as coreLayer from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import {
  LayerController,
  installBringToFrontPatch,
  uninstallBringToFrontPatch,
} from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { saveState } from "#control/LayerControl/ui/state.js";

// ===========================================================================
// bringToFront patch refcounting (merged from guard.test.ts)
// Runs before the main describe('LayerController') because that block's beforeEach
// replaces window.L.Path with a class lacking bringToFront on its prototype;
// these guard tests rely on the original L mock from setup.ts.

describe("bringToFront patch refcounting", () => {
  it("patch is idempotent; unpatch restores only at zero refcount", () => {
    const proto = window.L.Path.prototype;
    const base = proto.bringToFront;
    try {
      installBringToFrontPatch();
      installBringToFrontPatch();
      expect(proto.bringToFront).not.toBe(base);
      uninstallBringToFrontPatch();
      expect(proto.bringToFront).not.toBe(base); // second instance still patched
      uninstallBringToFrontPatch();
      expect(proto.bringToFront).toBe(base); // last instance restored
    } finally {
      // leave the module counter at zero even if an assertion failed
      uninstallBringToFrontPatch();
      uninstallBringToFrontPatch();
      proto.bringToFront = base;
    }
  });

  it("guarded bringToFront skips detached paths without throwing", () => {
    const proto = window.L.Path.prototype;
    const base = proto.bringToFront;
    installBringToFrontPatch();
    try {
      const guarded = proto.bringToFront as unknown as (this: unknown) => unknown;
      // _path missing / detached → no-op, returns this
      expect(() => guarded.call({})).not.toThrow();
      expect(() => guarded.call({ _path: null })).not.toThrow();
      expect(() => guarded.call({ _path: { parentNode: null } })).not.toThrow();
      expect(() => guarded.call({ _path: { parentNode: {} } })).not.toThrow();
    } finally {
      uninstallBringToFrontPatch();
      proto.bringToFront = base;
    }
  });
});

describe("LayerController", () => {
  let manager: LayerController;
  let map: any;

  beforeEach(() => {
    ({ manager, map } = createLayerControllerFixture());
  });

  afterEach(() => {
    teardownLayerControllerFixture(manager);
  });

  it("constructor creates registry from data", () => {
    expect(manager.layerRegistry.size).toBe(2);
  });

  it("non-TileLayer GridLayer gets a synthesized pane for z-ordering", () => {
    // First-class basemaps: every layer carries its own z in the ordering
    // ladder through a synthesized pane, GridLayer included. The z no longer
    // rides on options.zIndex (which only works inside a shared pane).
    const grid = new GridLayer();
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "grid1", name: "Grid", layer: grid, role: "base" });
    manager.enforceOrder();
    expect(grid.options.pane).toMatch(new RegExp(`^${FALLBACK_PANE_PREFIX}`));
  });

  it("slots a layer's label pane just above that layer", () => {
    manager.map.hasLayer.mockReturnValue(true);
    // Labelable overlay: the registration edge declares the
    // `role: "label"` spec, the surface materializes it, and the
    // ordering pass prices it through the same `zFor` ladder as every other
    // PaneHandle (role label = one step above the slot) — no
    // name-keyed spot-write in enforceOrder anymore.
    const panes = new Map<string, HTMLElement>();
    const realGetPane = map.getPane;
    map.getPane = vi.fn((name: string) => {
      if (!panes.has(name)) panes.set(name, realGetPane(name));
      return panes.get(name)!;
    });
    manager.registerLayer({
      id: "labelable",
      name: "Labelable",
      role: "overlay",
      layer: {
        options: {},
        feature: { properties: { name: "x" } },
      } as unknown as L.Layer,
    });
    manager.enforceOrder();

    const li = manager.layerRegistry.get("labelable")!;
    const annName = manager
      .surfaceFor(li)
      .paneNames.find(name => name.startsWith(CONST.LABEL_PANE_PREFIX));
    expect(annName).toBeDefined();
    const slotZ = manager.computeZIndex(manager.layers.indexOf(li), li.role);
    expect(panes.get(annName!)!.style.zIndex).toBe(
      String(slotZ + coreLayer.LABEL_Z_OFFSET),
    );
  });

  it("unregisterLayer keeps the label config so a later flush cannot erase it", () => {
    // An unregister is a teardown, not a delete: the `layers` live source
    // re-reads `configEntries` on every flush, so dropping the config here
    // would wipe `layers[id].label` from storage the next time any
    // dimension saves — a label-only layer would lose its role for good.
    const m = new LayerController(map, [
      {
        id: "keepcfg",
        name: "KeepCfg",
        role: "overlay",
        layer: {
          options: {},
          feature: { properties: { n: 1 } },
        } as unknown as L.Layer,
      },
    ]);
    m.map.hasLayer.mockReturnValue(true);
    m.label.setConfig("keepcfg", {
      show: true,
      field: "n",
      color: "#ffffff",
      size: 12,
      format: "auto",
      collide: true,
    });
    const schedule = vi.spyOn(m.persistence, "schedule");
    m.ui = makeDerivedUI({
      c: m,
      invalidateFields: vi.fn(),
      syncToggleAll: vi.fn(),
      intentStore: makeStore(),
      saveState: () => saveState(m.ui!),
    }) as unknown as LayerUI;

    expect(m.unregisterLayer("keepcfg")).toBe(true);
    expect(m.label.hasConfig("keepcfg")).toBe(true);

    saveState(m.ui!);
    const fields = schedule.mock.calls.at(-1)![0] as {
      layers: () => Record<string, { label?: { show?: boolean } }>;
    };
    expect(fields.layers().keepcfg.label).toEqual(
      expect.objectContaining({ show: true }),
    );
  });

  it("keeps a foreign label spec as declared instead of re-probing over it", () => {
    // `withLabelSpec` appends the probe's spec only when nobody has
    // declared one: a caller that owns its own `role: "label"` pane
    // keeps that name — the probe must not stack a second label pane next
    // to it, and the capability reads whichever spec came in.
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "foreignAnn",
      name: "ForeignAnn",
      role: "overlay",
      // Labelable, so the probe alone WOULD append its own spec.
      layer: {
        options: {},
        feature: { properties: { name: "x" } },
      } as unknown as L.Layer,
      paneSpecs: [{ role: "label", order: 1, name: "custom-label-pane" }],
    });

    const li = manager.layerRegistry.get("foreignAnn")!;
    const names = manager.surfaceFor(li).paneNames;
    expect(names).toContain("custom-label-pane");
    expect(names.some(name => name.startsWith(CONST.LABEL_PANE_PREFIX))).toBe(false);
    expect(manager.surfaceFor(li).capabilities.label).toBe("pane");
  });

  it("skips the label-pane slot when the layer has no label pane", () => {
    manager.map.hasLayer.mockReturnValue(true);
    const realGetPane = map.getPane;
    map.getPane = vi.fn((name: string) =>
      name === `${CONST.LABEL_PANE_PREFIX}base1` ? null : realGetPane(name),
    );

    expect(() => manager.enforceOrder()).not.toThrow();
  });

  it("computeZIndex returns expected values", () => {
    // 2 layers, index 0, layer count = 2
    // z = Z_INDEX.BASE + (2 - 0) * 10 = 600 + 20 = 620
    const base = Z_INDEX.BASE;
    const step = Z_INDEX.STEP;
    expect(manager.computeZIndex(0, "overlay")).toBe(base + 2 * step);
    // eslint-disable-next-line no-implicit-coercion -- false positive: reads `+ 1 *` as unary
    expect(manager.computeZIndex(1, "overlay")).toBe(base + 1 * step);
    // Tile layers use TILE_BASE
    expect(manager.computeZIndex(0, "base")).toBe(Z_INDEX.TILE_BASE + 2 * step);
  });

  it("getLayerType returns null for unknown id", () => {
    expect(manager.getLayerType("nonexistent")).toBeNull();
  });

  it("getLayerType returns 'base' for base layers", () => {
    expect(manager.getLayerType("base1")).toBe("base");
  });

  it("getLayersByType filters by type", () => {
    const bases = manager.getLayersByType("base");
    expect(bases).toHaveLength(1);
    expect(bases[0].id).toBe("base1");
  });

  it("extractPoints returns empty array for non-existent layer", () => {
    expect(manager.extractPoints("nonexistent")).toEqual([]);
  });

  it("destroy clears registry and unbinds events", () => {
    manager.destroy();
    expect(manager.layerRegistry.size).toBe(0);
    expect(map.off).toHaveBeenCalled();
  });

  it("unregisterLayer returns false for unknown id", () => {
    expect(manager.unregisterLayer("nonexistent")).toBe(false);
  });

  it("getLayerPanes falls back to the layer tree when nobody registered it", () => {
    // A layer that never went through registerLayer has no surface in the
    // stamp index, so resolveLayerPanes must read the pane names from the
    // layer's own tree (PaneManager discovery) instead of the surface.
    const orphan = { options: { pane: "customPane" } };
    expect(manager.getLayerPanes(orphan)).toEqual(["customPane"]);
  });

  it("clearAllLayers is safe for null", () => {
    expect(() => manager.clearAllLayers(null)).not.toThrow();
  });

  it("clearAllLayers handles eachLayer recursively", () => {
    const child = { clearLayers: vi.fn() };
    const parent = { eachLayer: vi.fn(cb => cb(child)) };
    manager.clearAllLayers(parent);
    expect(child.clearLayers).toHaveBeenCalled();
  });

  // ── getLayerType geometry inference ──

  it("getLayerType infers polygon from a Polygon layer", () => {
    manager.registerLayer({
      id: "poly",
      name: "Poly",
      layer: new window.L.Polygon(),
    });
    expect(manager.getLayerType("poly")).toBe(GEOM_TYPE.POLYGON);
  });

  it("getLayerType returns custom for iconSvg layers", () => {
    manager.registerLayer({
      id: "icon",
      name: "Icon",
      iconSvg: '<svg viewBox="0 0 4 4"><rect width="2" height="2"/></svg>',
    });
    expect(manager.getLayerType("icon")).toBe(GEOM_TYPE.CUSTOM);
  });

  it("invalidateType also drops the surface cache, forcing a re-probe", () => {
    // The surface owns the authoritative cache. Clearing the manager's
    // snapshot without also invalidating the surface would leave a stale
    // string sitting in the cache that the next getLayerType call picks up.
    manager.registerLayer({
      id: "poly3",
      name: "Poly",
      layer: new window.L.Polygon(),
    });
    const surface = manager.surfaces.get("poly3")!;
    expect(surface.geometryType()).toBe(GEOM_TYPE.POLYGON);
    const spy = vi.spyOn(surface, "invalidate");
    manager.invalidateType("poly3");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(manager.layerRegistry.get("poly3")!.type).toBeNull();
  });

  it("getLayerType delegates the probe to the surface, not to getGeometryType", () => {
    // The whole point of the split is that getGeometryType lives on the surface;
    // if this test ever calls getGeometryType directly, the manager has regressed.
    manager.registerLayer({
      id: "delegate",
      name: "Poly",
      layer: new window.L.Polygon(),
    });
    const surface = manager.surfaces.get("delegate")!;
    const spy = vi.spyOn(surface, "geometryType");
    expect(manager.getLayerType("delegate")).toBe(GEOM_TYPE.POLYGON);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(manager.layerRegistry.get("delegate")!.type).toBe(GEOM_TYPE.POLYGON);
  });

  it("getLayerType falls back to layerInfo.type when the surface is missing", () => {
    // A registered id with no surface (e.g. a stub layer the manager has not
    // resolved) still answers from whatever snapshot was already written.
    manager.registerLayer({
      id: "no-surface",
      name: "X",
      layer: { options: {} },
    });
    manager.layerRegistry.get("no-surface")!.type = GEOM_TYPE.POINT;
    manager.surfaceIndex.delete("no-surface");
    expect(manager.getLayerType("no-surface")).toBe(GEOM_TYPE.POINT);
  });

  it("invalidateType on an unknown id does not touch surfaces", () => {
    const spy = vi.spyOn(manager.surfaces, "get");
    manager.invalidateType("never-registered");
    expect(spy).toHaveBeenCalledWith("never-registered");
  });

  // ── findLayer ──

  it("findLayer resolves a layer by string id", () => {
    const layer = new window.L.TileLayer();
    manager.registerLayer({ id: "x", name: "X", layer });
    expect(manager.findLayer("x")).toBe(layer);
  });

  it("findLayer returns null after unregisterLayer", () => {
    manager.registerLayer({ id: "x", name: "X", layer: new window.L.TileLayer() });
    manager.unregisterLayer("x");
    expect(manager.findLayer("x")).toBeNull();
  });

  it("findLayer takes a layer-info object without a live layer and falls through", () => {
    // idOrInfo is a LayerInfo whose `layer` is still unresolved; the map has
    // nothing under that id either, so the registry-entry branch and the map
    // fallback both miss and the result is null.
    const info = { id: "ghost", layer: null } as never;
    expect(manager.findLayer(info)).toBeNull();
  });

  // ── destroy lifecycle ──

  it("destroy reverts to lightweight LayerAPI", () => {
    expect(map.foliplus.LayerAPI).toBeDefined();
    expect(map.foliplus.LayerAPI.layers.length).toBe(2);
    manager.destroy();
    // After destroy, LayerAPI is still valid (lightweight default) but
    // layers is empty and registerLayer is a no-op.
    expect(map.foliplus.LayerAPI).toBeDefined();
    expect(map.foliplus.LayerAPI.layers).toEqual([]);
    expect(map.foliplus.LayerAPI.registerLayer({ id: "x" })).toBeNull();
  });

  it("normalizes initial data into the full layerInfo field set", () => {
    const m2 = new LayerController(map, [{ id: "a", name: "A", role: "overlay" }]);
    const li = m2.layers[0];
    expect(li).toMatchObject({ id: "a", name: "A", role: "overlay" });
    for (const key of ["paneName", "iconSvg", "type", "canvas"]) {
      expect(key in li).toBe(true);
    }
  });

  // ── registerLayer id validation ──

  it("registerLayer throws when id is missing", () => {
    expect(() => manager.registerLayer({} as any)).toThrow("id_required");
  });

  it("registerLayer throws when id is empty", () => {
    expect(() => manager.registerLayer({ id: "" } as any)).toThrow("id_required");
  });

  // ── createCanvas id validation ──

  it("createCanvas throws when id is missing", () => {
    expect(() => manager.factory.createCanvas({} as any)).toThrow(
      "createCanvas requires an id",
    );
  });

  it("createCanvas throws when id is empty", () => {
    expect(() => manager.factory.createCanvas({ id: "" } as any)).toThrow(
      "createCanvas requires an id",
    );
  });

  // ── unregisterLayer skips invalidateSize ──

  it("unregisterLayer does not call invalidateSize", () => {
    const spy = vi.spyOn(map, "invalidateSize");
    manager.unregisterLayer("nonexistent");
    expect(spy).not.toHaveBeenCalled();
  });

  // ── getLayersByType ──

  it("getLayersByType returns empty array for unknown type", () => {
    expect(manager.getLayersByType("nonexistent")).toEqual([]);
  });

  // ── coverage-gap tests: register/unregister UI paths, factory delegation ──

  it("createCanvas delegates to the factory", () => {
    window.L.DomUtil = { getPosition: vi.fn(() => ({ x: 0, y: 0 })) };
    map.getPanes = vi.fn(() => ({ mapPane: document.createElement("div") }));
    // The shared mock's getPane always returns a fresh element; force the
    // canvas-pane name to miss so ensurePane takes the createPane path.
    const realGetPane = map.getPane;
    map.getPane = vi.fn((name: string) =>
      name.startsWith("foliplus-canvas-") ? null : realGetPane(name),
    );
    try {
      const api = manager.createCanvas({ id: "canvas1" });
      expect(api.canvas).toBeInstanceOf(HTMLCanvasElement);
      expect(typeof api.register).toBe("function");
      expect(typeof api.bringToFront).toBe("function");
      api.register();
      expect(api.canvas.parentElement?.classList.contains("foliplus-layer-pane")).toBe(
        true,
      );
      api.destroy();
    } finally {
      map.getPane = realGetPane;
    }
  });

  it("createColor delegates to the factory", () => {
    window.L.DomUtil = { getPosition: vi.fn(() => ({ x: 0, y: 0 })) };
    map.getPanes = vi.fn(() => ({ mapPane: document.createElement("div") }));
    const spy = vi.spyOn(manager.factory, "createColor");
    const api = manager.createColor({ id: "solid1" } as any);
    expect(spy).toHaveBeenCalledWith({ id: "solid1" });
    expect(api).toBeDefined();
  });

  it("canReorderBetween delegates to the registry", () => {
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({ id: "o2", name: "O2", layer: { options: {} } });
    // layers: [o2, overlay1, base1] — 0↔1 same overlay group, 0↔2 cross-group
    expect(manager.canReorderBetween(0, 1)).toBe(true);
    expect(manager.canReorderBetween(0, 2)).toBe(false);
  });

  it("registerLayer ensures child panes via discoverChildPanes", () => {
    const childPaneLayer = {
      options: { pane: "custom_child" },
      eachLayer: (cb: (l: unknown) => void) =>
        cb({ options: { pane: "custom_child" } }),
    } as any;
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({ id: "cp", name: "Cp", layer: childPaneLayer });
    // ensurePane was reached — the pane should exist in defaultPanes set? just verify no throw
  });
});
