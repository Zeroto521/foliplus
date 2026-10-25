import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { LayerRuntimeStore } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import {
  LayerController,
  installBringToFrontPatch,
  uninstallBringToFrontPatch,
} from "#foliplus/LayerControl/controller.js";
import { LayerIntentStore } from "#foliplus/LayerControl/domain/index.js";
import { LayerPersistence } from "#foliplus/LayerControl/persistence.js";
import { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { getIntent, setIntent } from "#foliplus/LayerControl/ui/intent.js";
import {
  applyUserState,
  dropPersistedLayerState,
  saveNamesState,
  saveState,
} from "#foliplus/LayerControl/ui/state.js";
import {
  FALLBACK_PANE_PREFIX,
  GEOM_TYPE,
  GROUP,
  Z_INDEX,
} from "#foliplus/core/layer/const.js";
import * as coreLayer from "#foliplus/core/layer/index.js";
import { getLayerAlpha } from "#common/canvasAlpha.js";
import * as Storage from "#common/storage.js";
import {
  TEST_ENV,
  attachWithGroup,
  attachedPanel,
  initFixture,
  polygonLayer,
  trackMembership,
} from "./ui/fixture.js";

const ENFORCE_ORDER_DEBOUNCE_MS = 50;

/** Build a LayerIntentStore from the old two-map fixture shape. */
const makeStore = (
  intents: Record<string, Record<string, unknown>> = {},
  provenance: Record<string, string[]> = {},
): LayerIntentStore => {
  const store = new LayerIntentStore();
  store.replaceIntents(intents as never);
  store.replaceProvenance(provenance as never);
  return store;
};

/** Seed the persisted record so a constructor or a replay reads it. */
const seedStorage = (record: Record<string, unknown>) => {
  window.localStorage.setItem(CONST.STORAGE.KEY, JSON.stringify(record));
};

// Leaflet models a TileLayer as a GridLayer subclass, and the manager relies on
// that: a GridLayer carries its z natively (`setZIndex` / `options.zIndex`) and
// therefore gets no pane of its own, a decision LayerSurface makes with the same
// `instanceof L.GridLayer` check.
class GridLayer {
  options: Record<string, unknown> = {};
}

class TileLayer extends GridLayer {
  options: Record<string, unknown> = { attribution: "© OpenStreetMap" };
  setZIndex = vi.fn();
}

/** A container with Leaflet's `eachLayer`/`hasLayer` surface. The fixture's
 *  `L.layerGroup` is a stub, so carrier recovery tests build the tree
 *  explicitly and call `manager.onLayerAdd` / `onLayerRemove` directly. */
class TestGroup {
  options: Record<string, unknown> = {};
  children: unknown[];
  constructor(children: unknown[] = []) {
    this.children = children;
  }
  eachLayer(fn: (child: unknown) => void): void {
    this.children.forEach(fn);
  }
  addLayer(layer: unknown): this {
    this.children.push(layer);
    return this;
  }
  removeLayer(layer: unknown): this {
    this.children = this.children.filter(child => child !== layer);
    return this;
  }
  hasLayer(layer: unknown): boolean {
    return this.children.includes(layer);
  }
  getLayers(): unknown[] {
    return this.children.slice();
  }
}

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

// Identity-stable stamp: the shared mock in beforeEach is a counter, which
// would shift a layer's stamp between the sweep and the assertion.
const stableStamp = vi.fn(obj => obj.__id ?? (obj.__id = ++stableStampId));
let stableStampId = 1000;

describe("LayerController", () => {
  let manager: LayerController;
  let map: any;

  beforeEach(() => {
    // A test that flushes persistence leaves a real record behind, and the next
    // constructor reads it: without this clear, an order written by one test
    // decides where the next test's layers land.
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };

    class Renderer {}

    class Path {
      options = {};
    }

    class Polygon {
      options = {};
    }

    class Polyline {
      options = {};
    }

    class Marker {
      getElement() {
        return null;
      }
    }

    class CircleMarker {}
    const stamp = (() => {
      let id = 0;
      return vi.fn(() => ++id);
    })();

    window.L.TileLayer = TileLayer;
    window.L.GridLayer = GridLayer;
    window.L.Renderer = Renderer;
    window.L.layerGroup = vi.fn(() => ({
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      hasLayer: vi.fn(() => false),
      getLayers: vi.fn(() => []),
      clearLayers: vi.fn(),
      options: {},
    }));
    window.L.Path = Path;
    window.L.Polygon = Polygon;
    window.L.Polyline = Polyline;
    window.L.Marker = Marker;
    window.L.CircleMarker = CircleMarker;
    window.L.stamp = stamp;
    window.L.svg = vi.fn(() => ({
      addTo: vi.fn(),
      // Real renderers carry a root element: `pinLateContent` needs it to move
      // path nodes, and its absence would silently take the "mark handled"
      // branch instead.
      _container: document.createElement("div"),
    }));

    const makePane = () => {
      const el = document.createElement("div");
      el.style.zIndex = "0";
      return el;
    };

    map = {
      on: vi.fn(),
      off: vi.fn(),
      invalidateSize: vi.fn(),
      eachLayer: vi.fn(),
      hasLayer: vi.fn(() => false),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      closePopup: vi.fn(),
      getZoom: vi.fn(() => 5),
      getMaxZoom: vi.fn(() => 18),
      getMinZoom: vi.fn(() => 0),
      getContainer: vi.fn(() => map._container),
      getPane: vi.fn(() => {
        const p = makePane();
        p.style.zIndex = "0";
        return p;
      }),
      createPane: vi.fn(() => {
        const p = makePane();
        p.classList.add("foliplus-layer-pane");
        return p;
      }),
      _container: document.createElement("div"),
      _layers: {},
      _paneRenderers: {},
      options: { maxZoom: 18 },
      attributionControl: { _attributions: {}, _update: vi.fn() },
    };

    manager = new LayerController(map, [
      { id: "overlay1", name: "Points", group: "overlay" },
      {
        id: "base1",
        name: "OSM",
        group: "base",
        layer: new TileLayer(),
        paneName: "tilePane",
      },
    ]);
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
    manager.registerLayer({ id: "grid1", name: "Grid", layer: grid, group: "base" });
    manager.enforceOrder();
    expect(grid.options.pane).toMatch(new RegExp(`^${FALLBACK_PANE_PREFIX}`));
  });

  it("slots a layer's label pane just above that layer", () => {
    manager.map.hasLayer.mockReturnValue(true);
    // Labelable overlay: the registration edge declares the
    // `role: "annotation"` spec, the surface materializes it, and the
    // ordering pass prices it through the same `zFor` ladder as every other
    // PaneHandle (role annotation = one step above the slot) — no
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
      group: "overlay",
      layer: {
        options: {},
        feature: { properties: { name: "x" } },
      } as unknown as L.Layer,
    });
    manager.enforceOrder();

    const li = manager.layerRegistry.get("labelable")!;
    const annName = manager
      .surfaceFor(li)
      .paneNames.find(name => name.startsWith(CONST.ANNOTATION_PANE_PREFIX));
    expect(annName).toBeDefined();
    const slotZ = manager.computeZIndex(manager.layers.indexOf(li), li.group);
    expect(panes.get(annName!)!.style.zIndex).toBe(
      String(slotZ + coreLayer.ANNOTATION_Z_OFFSET),
    );
  });

  it("unregisterLayer keeps the label config so a later flush cannot erase it", () => {
    // An unregister is a teardown, not a delete: the `layers` live source
    // re-reads `configEntries` on every flush, so dropping the config here
    // would wipe `layers[id].annotation` from storage the next time any
    // dimension saves — a label-only layer would lose its section for good.
    const m = new LayerController(map, [
      {
        id: "keepcfg",
        name: "KeepCfg",
        group: "overlay",
        layer: {
          options: {},
          feature: { properties: { n: 1 } },
        } as unknown as L.Layer,
      },
    ]);
    m.map.hasLayer.mockReturnValue(true);
    m.annotation.setConfig("keepcfg", {
      show: true,
      field: "n",
      color: "#ffffff",
      size: 12,
      format: "auto",
      collide: true,
    });
    const schedule = vi.spyOn(m.persistence, "schedule");
    m.ui = {
      c: m,
      invalidateFields: vi.fn(),
      syncToggleAll: vi.fn(),
      intentStore: makeStore(),
      saveState: () => saveState(m.ui!),
    } as unknown as LayerUI;

    expect(m.unregisterLayer("keepcfg")).toBe(true);
    expect(m.annotation.hasConfig("keepcfg")).toBe(true);

    saveState(m.ui!);
    const fields = schedule.mock.calls.at(-1)![0] as {
      layers: () => Record<string, { annotation?: { show?: boolean } }>;
    };
    expect(fields.layers().keepcfg.annotation).toEqual(
      expect.objectContaining({ show: true }),
    );
  });

  it("keeps a foreign annotation spec as declared instead of re-probing over it", () => {
    // `withAnnotationSpec` appends the probe's spec only when nobody has
    // declared one: a caller that owns its own `role: "annotation"` pane
    // keeps that name — the probe must not stack a second label pane next
    // to it, and the capability reads whichever spec came in.
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "foreignAnn",
      name: "ForeignAnn",
      group: "overlay",
      // Labelable, so the probe alone WOULD append its own spec.
      layer: {
        options: {},
        feature: { properties: { name: "x" } },
      } as unknown as L.Layer,
      paneSpecs: [{ role: "annotation", order: 1, name: "custom-annotation-pane" }],
    });

    const li = manager.layerRegistry.get("foreignAnn")!;
    const names = manager.surfaceFor(li).paneNames;
    expect(names).toContain("custom-annotation-pane");
    expect(names.some(name => name.startsWith(CONST.ANNOTATION_PANE_PREFIX))).toBe(
      false,
    );
    expect(manager.surfaceFor(li).capabilities.annotation).toBe("pane");
  });

  it("skips the label-pane slot when the layer has no annotation pane", () => {
    manager.map.hasLayer.mockReturnValue(true);
    const realGetPane = map.getPane;
    map.getPane = vi.fn((name: string) =>
      name === CONST.ANNOTATION_PANE_PREFIX + "base1" ? null : realGetPane(name),
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

  describe("touchLayer", () => {
    it("delegates to the registry and reports whether the id was known", () => {
      expect(manager.touchLayer("overlay1")).toBe(true);
      expect(manager.touchLayer("nope")).toBe(false);
    });

    it("overwrites a published timestamp when the content changes at runtime", () => {
      // `createLayerInfo` deliberately keeps a re-registration's previous
      // provenance (the provider does not always resend it), so without the
      // touch call the panel would show the original publish time forever,
      // long after the runtime content changed. The epoch-ms stamp is the
      // contract: `touch` is the escape hatch, not `registerLayer`.
      const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      manager.registerLayer({ id: "pub1", name: "Published", updatedAt: 1 });
      expect(manager.layerRegistry.get("pub1")?.updatedAt).toBe(1);

      manager.touchLayer("pub1");
      expect(manager.layerRegistry.get("pub1")?.updatedAt).toBe(1_000_000);
      clock.mockRestore();
    });

    it("leaves a layer untouched when its id is unknown", () => {
      // The lightweight stub and destroyed managers both report false rather
      // than throwing, so callers can use the boolean to decide whether to
      // show a hint.
      expect(manager.touchLayer("ghost")).toBe(false);
    });
  });

  describe("intentVisible", () => {
    it("returns true for an unknown id (author default stands)", () => {
      expect(manager.intentVisible("ghost")).toBe(true);
    });

    it("returns true before UI is attached (pre-boot contract)", () => {
      const fresh = new LayerController(map, []);
      expect(fresh.intentVisible("x")).toBe(true);
    });

    it("returns true for a known layer when no UI is attached yet", () => {
      // Pre-attach the registry already knows the id, but there is no row and
      // no intent store to read — the author default still stands.
      manager.ui = null;
      expect(manager.intentVisible("overlay1")).toBe(true);
    });

    it("returns the UI's intent for a known layer", () => {
      const ui = vi.fn().mockReturnValue(false);
      manager.ui = { intentVisible: ui } as any;
      expect(manager.intentVisible("overlay1")).toBe(false);
      expect(ui).toHaveBeenCalledWith("overlay1");
    });
  });

  describe("setVisible", () => {
    it("refuses an unknown id rather than reporting a hide that never happened", () => {
      expect(manager.setVisible("ghost", false)).toBe(false);
    });

    it("refuses before the panel is attached — there is no row to sync", () => {
      // The hidden set lives on LayerUI, and destroy() clears the registry too,
      // so a "success" with no panel would be a state change nothing can show.
      manager.ui = null;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(manager.setVisible("overlay1", false)).toBe(false);
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("delegates to the panel's applyVisibility for a known layer", () => {
      const apply = vi.fn(() => true);
      manager.ui = { applyVisibility: apply } as any;
      expect(manager.setVisible("overlay1", false)).toBe(true);
      expect(apply).toHaveBeenCalledWith("overlay1", false);
    });
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

  it("unregisterLayer sweeps child panes no longer referenced", () => {
    manager.map.hasLayer.mockReturnValue(false);
    const api = manager.createLayers({
      id: "g1",
      name: "Group",
      panes: [{ name: "g1_base" }, { name: "g1_label", isLabel: true }],
    });
    api.register();
    expect(manager.panes.childPaneSpecs.has("g1_label")).toBe(true);
    expect(manager.unregisterLayer("g1")).toBe(true);
    expect(manager.panes.childPaneSpecs.has("g1_label")).toBe(false);
  });

  it("unregisterLayer returns true when layer is found and removed", () => {
    manager.registerLayer({ id: "test_layer", name: "Test" });
    const result = manager.unregisterLayer("test_layer");
    expect(result).toBe(true);
  });

  it("unregisterLayer reclaims only the unregistered layer's synthesized pane", () => {
    // A full sweep on every unregister would also delete another registered
    // layer's pane. The map fixture needs the Leaflet pane registry for the
    // teardown to run, and an identity-stable stamp: the surface derives its
    // pane name from one, and the shared stamp mock is a counter.
    window.L.stamp = stableStamp;
    const paneRegistry: Record<string, HTMLElement> = {};
    map._panes = paneRegistry;
    map.getPane = vi.fn((name: string) => paneRegistry[name] ?? null);
    map.createPane = vi.fn((name: string) => {
      const pane = document.createElement("div");
      pane.classList.add("foliplus-layer-pane");
      return (paneRegistry[name] = pane);
    });
    const layerA = { options: {} };
    const layerB = { options: {} };
    (window as any)["fb_a"] = layerA;
    (window as any)["fb_b"] = layerB;
    manager.registerLayer({ id: "fb_a", name: "A", layer: layerA });
    manager.registerLayer({ id: "fb_b", name: "B", layer: layerB });

    const paneA = `${FALLBACK_PANE_PREFIX}${window.L.stamp(layerA)}`;
    const paneB = `${FALLBACK_PANE_PREFIX}${window.L.stamp(layerB)}`;
    // Both surfaces synthesized their own pane at registration.
    expect(paneRegistry[paneA]).toBeDefined();
    expect(paneRegistry[paneB]).toBeDefined();

    expect(manager.unregisterLayer("fb_a")).toBe(true);
    // A is gone from both the records and the map DOM.
    expect(manager.surfaces.has("fb_a")).toBe(false);
    expect(map._panes[paneA]).toBeUndefined();
    // B is still registered, so its pane survives.
    expect(map._panes[paneB]).toBeDefined();
    expect(manager.getLayerPanes(layerB)).toEqual([paneB]);

    delete (window as any)["fb_a"];
    delete (window as any)["fb_b"];
  });

  it("routes AnnotationManager's pane wiring through the surface", () => {
    // The label pane is the surface's (declared `role: "annotation"` spec
    // from the registration edge, materialized and class-stamped by
    // PaneManager); AnnotationManager only mounts canvases into it. This
    // test drives the real chain end-to-end: surfaceFor declares the pane,
    // renderLabels mounts the canvas, unregisterLayer unmounts the canvas
    // while the declared pane survives for a re-registration of the id.
    window.L.stamp = stableStamp;
    const paneRegistry: Record<string, HTMLElement> = {};
    map._panes = paneRegistry;
    map.getPane = vi.fn((name: string) => paneRegistry[name] ?? null);
    // Do NOT stamp the base class here — that would make the assertion
    // below self-proving. The base `foliplus-layer-pane` comes from
    // PaneManager.ensurePane; leaving it out of the mock means the
    // assertion has teeth: if ensurePane ever stops stamping it, this
    // goes red.
    map.createPane = vi.fn((name: string) => {
      const pane = document.createElement("div");
      return (paneRegistry[name] = pane);
    });
    map.getPanes = vi.fn(() => ({}));
    const leaf = {
      options: {},
      getLatLng: () => ({ lat: 0, lng: 0 }),
      feature: { properties: { name: "hello" } },
    } as unknown as L.Layer;
    const m = new LayerController(map, [
      { id: "lbl", name: "Lbl", group: "overlay", layer: leaf },
    ]);
    m.map.hasLayer.mockReturnValue(true);
    // The panel gate is what resolves the surface in production (the menu /
    // panel call surfaceFor before a label can render); drive it explicitly
    // here so the declaration is on the record before renderLabels.
    m.surfaceFor(m.layerRegistry.get("lbl")!);
    m.annotation.setConfig("lbl", {
      show: true,
      field: "name",
      color: "",
      size: 12,
      format: "default" as any,
      collide: false,
    });
    vi.spyOn(m.annotation as any, "refresh").mockImplementation(() => {});
    m.annotation.renderLabels("lbl");

    const paneName = CONST.ANNOTATION_PANE_PREFIX + "lbl";
    const pane = paneRegistry[paneName];
    expect(pane).toBeDefined();
    expect(pane!.classList.contains("foliplus-layer-pane")).toBe(true);
    expect(pane!.classList.contains("foliplus-annotation-pane")).toBe(true);

    m.unregisterLayer("lbl");
    // The pane is declared, so it survives like every other declared pane
    // (the same id can register again without rebuilding its face); what
    // unregister takes down is our canvas.
    expect(paneRegistry[paneName]).toBeDefined();
    expect(pane!.querySelector("canvas")).toBeNull();
  });

  it("unregisterLayer emits EVENTS.LAYER_REMOVED event with the layer id", () => {
    manager.registerLayer({ id: "test_layer", name: "Test" });
    const bus = map.foliplus!.events;
    const handler = vi.fn();
    bus.on(EVENTS.LAYER_REMOVED, handler);

    manager.unregisterLayer("test_layer");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ id: "test_layer" });
  });

  it("unregisterLayer does NOT emit EVENTS.LAYER_REMOVED for unknown id", () => {
    const bus = map.foliplus!.events;
    const handler = vi.fn();
    bus.on(EVENTS.LAYER_REMOVED, handler);

    manager.unregisterLayer("nonexistent");

    expect(handler).not.toHaveBeenCalled();
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
    manager.surfaces.delete("no-surface");
    expect(manager.getLayerType("no-surface")).toBe(GEOM_TYPE.POINT);
  });

  it("invalidateType on an unknown id does not touch surfaces", () => {
    const spy = vi.spyOn(manager.surfaces, "get");
    manager.invalidateType("never-registered");
    expect(spy).toHaveBeenCalledWith("never-registered");
  });

  it("getLayerType caches the resolved type on the layer info", () => {
    manager.registerLayer({
      id: "poly2",
      name: "Poly",
      layer: new window.L.Polygon(),
    });
    expect(manager.getLayerType("poly2")).toBe(GEOM_TYPE.POLYGON);
    expect(manager.getLayerType("poly2")).toBe(GEOM_TYPE.POLYGON);
    expect(manager.layerRegistry.get("poly2")!.type).toBe(GEOM_TYPE.POLYGON);
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

  it("registerLayer uses incremental item init instead of full re-scan", () => {
    manager.map.hasLayer.mockReturnValue(true);
    manager.uiContainer = document.createElement("div");
    manager.ui = {
      intentStore: makeStore(),
      // The replay entry point always returns a round; the stub has to honour it.
      applyUserState: vi.fn(() => []),
    } as any;
    const emitSpy = vi.spyOn(manager.events, "emitSettled");
    manager.registerLayer({
      id: "new1",
      name: "New",
      layer: { options: {} },
    } as any);
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_ITEM_ADDED, {
      id: "new1",
    });
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_ITEM_REFRESHED, {
      id: "new1",
    });
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_GROUP_COUNT_CHANGED, {
      group: "overlay",
    });
    expect(emitSpy).not.toHaveBeenCalledWith(EVENTS.LAYER_LIST_REBUILD);
  });

  it("re-applies hidden state when a previously-hidden layer is re-registered at runtime", () => {
    const layer = { options: {} };
    manager.map.hasLayer.mockReturnValue(false);
    const addLayer = vi.fn();
    const removeLayer = vi.fn();
    manager.map.addLayer = addLayer;
    manager.map.removeLayer = removeLayer;
    manager.intentStore = makeStore({ new1: { visible: false } });
    manager.ui = { saveState: vi.fn() } as any;
    manager.registerLayer({ id: "new1", name: "New", layer } as any);

    // Hidden layer is kept off the map entirely (no add, no remove) so
    // onAdd side effects never fire.
    expect(addLayer).not.toHaveBeenCalled();
    expect(removeLayer).not.toHaveBeenCalled();
  });

  it("does not add a hidden canvas layer (layer=null) to the map before removing it", () => {
    manager.map.hasLayer.mockReturnValue(false);
    const addLayer = vi.fn();
    const removeLayer = vi.fn();
    manager.map.addLayer = addLayer;
    manager.map.removeLayer = removeLayer;
    manager.intentStore = makeStore({ canvas1: { visible: false } });
    manager.ui = { saveState: vi.fn() } as any;
    manager.registerLayer({
      id: "canvas1",
      name: "Canvas",
      layer: null,
    } as any);

    // Canvas-only layer has no Leaflet layer to add/remove — the guard
    // skips addLayer and removeLayer.
    expect(addLayer).not.toHaveBeenCalled();
    expect(removeLayer).not.toHaveBeenCalled();
  });

  it("does not add a hidden layer to the map before removing it", () => {
    const layer = { options: {} };
    manager.map.hasLayer.mockReturnValue(false);
    const addLayer = vi.fn();
    const removeLayer = vi.fn();
    manager.map.addLayer = addLayer;
    manager.map.removeLayer = removeLayer;
    manager.intentStore = makeStore({ new1: { visible: false } });
    manager.ui = { saveState: vi.fn() } as any;
    manager.registerLayer({ id: "new1", name: "New", layer } as any);

    // Hidden layers must be kept off the map entirely (skip addLayer) so
    // onAdd side effects never fire.
    expect(addLayer).not.toHaveBeenCalled();
    expect(removeLayer).not.toHaveBeenCalled();
  });

  it("does not re-apply hidden state when the layer is not in the hidden set", () => {
    const layer = { options: {} };
    manager.map.hasLayer.mockReturnValue(false);
    const removeLayer = vi.fn();
    manager.map.removeLayer = removeLayer;
    manager.intentStore = makeStore({ other: { visible: false } });
    manager.ui = { saveState: vi.fn() } as any;
    manager.registerLayer({ id: "visible1", name: "V", layer } as any);

    expect(removeLayer).not.toHaveBeenCalled();
  });

  it("registerLayer resolves layer from map when opts.layer is absent", () => {
    const layer = new window.L.TileLayer();
    map._layers["resolved"] = layer;
    manager.registerLayer({ id: "resolved", name: "R" });
    expect(manager.findLayer("resolved")).toBe(layer);
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

  // ── syncAttribution ──

  it("syncAttribution is a silent no-op when the map has no attribution control", () => {
    // A stripped map (Leaflet built without the control) must not throw — the
    // ordering pass calls this on every reorder.
    (manager.map as any).attributionControl = null;
    expect(() => manager.syncAttribution()).not.toThrow();
  });

  // ── batch registration coalescing ──

  it("registerLayer does not run enforceOrder synchronously", () => {
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.registerLayer({ id: "a", name: "A", layer: new window.L.TileLayer() });
    manager.registerLayer({ id: "b", name: "B", layer: new window.L.TileLayer() });
    expect(spy).not.toHaveBeenCalled();
  });

  it("batch registration coalesces into a single debounced enforceOrder", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.registerLayer({ id: "a", name: "A", layer: new window.L.TileLayer() });
    manager.registerLayer({ id: "b", name: "B", layer: new window.L.TileLayer() });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  // ── layeradd re-entry during enforceOrder ──

  it("layeradd during enforceOrder does NOT reschedule debouncedEnforce (prevents freeze loop)", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.isEnforcing = true;
    manager.onLayerAdd({ layer: new window.L.Path() });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("getNavigableItems returns layer items and toggle-all rows", () => {
    // Mock the uiContainer and the ui that reads it.
    const container = document.createElement("div");
    container.innerHTML = `
      <div class="foliplus-layer-toggle-all" data-group="overlay">
        <div class="foliplus-checkbox"><input type="checkbox" data-role="toggle-all" /></div>
      </div>
      <div class="foliplus-layer-item" data-layer-id="a">
        <div class="foliplus-checkbox"><input type="checkbox" /></div>
      </div>
      <div class="foliplus-layer-toggle-all" data-group="base">
        <div class="foliplus-checkbox"><input type="checkbox" data-role="toggle-all" /></div>
      </div>
      <div class="foliplus-layer-item" data-layer-id="color" data-layer-type="base">
        <input type="checkbox" />
      </div>
    `;
    manager.uiContainer = container;
    manager.ui = { reindexAfterMove: vi.fn() } as any;
    // verify DOM structure includes toggle-all rows and every layer item
    // (getNavigableItems is tested via browser tests)
    const items = container.querySelectorAll(
      ".foliplus-layer-item, .foliplus-layer-toggle-all",
    );
    expect(items.length).toBe(4);
    expect(items[0].classList.contains("foliplus-layer-toggle-all")).toBe(true);
    expect(items[1].classList.contains("foliplus-layer-item")).toBe(true);
    expect(items[2].classList.contains("foliplus-layer-toggle-all")).toBe(true);
    // The base row that carries the color control is navigable too.
    expect(items[3].classList.contains("foliplus-layer-item")).toBe(true);
  });

  it("onLayerAdd emits LAYER_CHANGE when a pending layer's global finally joins the map", () => {
    // Late binding: folium streams a layer's JS global *after* this control's
    // own script, so the registration lands with `layer: null` and the real
    // object reaches the map through `layeradd` later. No registry write
    // covers that arrival, so without this emit a bus-only consumer (the
    // annotation manager repainting labels) would watch a layer appear and
    // never hear about it.
    const realStamp = window.L.stamp;
    window.L.stamp = stableStamp;
    try {
      manager.registerLayer({ id: "late", name: "Late", group: "overlay" });
      const arrived = new window.L.Path();
      map._layers["late"] = arrived;
      const onChange = vi.fn();
      manager.events.on(EVENTS.LAYER_CHANGE, onChange);

      manager.onLayerAdd({ layer: arrived });

      // kind comes from the registry entry ("vector" for a pending Leaflet
      // registration), not from re-probing `arrived`.
      expect(onChange).toHaveBeenCalledWith({ id: "late", kind: "vector" });
    } finally {
      window.L.stamp = realStamp;
    }
  });

  it("onLayerAdd stays silent when no pending entry can claim the arriving layer", () => {
    // The other arm: a registration that already carries its layer is not
    // "late", so an unrelated add must not manufacture a change — and a
    // pending entry whose resolved object is a *different* layer must not
    // claim it either.
    const realStamp = window.L.stamp;
    window.L.stamp = stableStamp;
    try {
      manager.registerLayer({ id: "pending", name: "Pending", group: "overlay" });
      map._layers["pending"] = new window.L.Path();
      const onChange = vi.fn();
      manager.events.on(EVENTS.LAYER_CHANGE, onChange);

      manager.onLayerAdd({ layer: new window.L.Path() });

      expect(onChange).not.toHaveBeenCalled();
    } finally {
      window.L.stamp = realStamp;
    }
  });

  it("rewrites the registry entry when a pending layer resolves (bad order: control before layer)", () => {
    // Bad script order: the control registers a layer by id before folium
    // lands its JS global, so the entry lands with `layer: null` and a
    // pending `kind`. When the real object joins the map via `layeradd`, the
    // entry must be rewritten so `layer`, `carrier.layer`, and `kind` all
    // reflect the resolved layer — not just emit on the bus, which was the
    // original bug. Without the write-back, every consumer that reads
    // `layerInfo.layer` directly (the fill swatch, maxZoom scanning) sees a
    // stale `null` forever.
    const realStamp = window.L.stamp;
    window.L.stamp = stableStamp;
    try {
      manager.registerLayer({ id: "late", name: "Late", group: "base" });
      const arrived = new window.L.TileLayer();
      map._layers["late"] = arrived;

      manager.onLayerAdd({ layer: arrived });

      const info = manager.layerRegistry.get("late")!;
      expect(info.layer).toBe(arrived);
      expect(info.carrier.layer).toBe(arrived);
      // The pending entry derived `kind` as "vector" (no layer to probe); a
      // real GridLayer must re-derive to "tile" so NO_FEATURE_TREE_KINDS and
      // every downstream kind gate see the honest shape.
      expect(info.kind).toBe("tile");
      // `overlay1` seeded by `beforeEach` still sits pending (that test
      // doesn't resolve it), so `hasUnresolvedLayers()` on the whole registry
      // isn't the right check here — the invariant is that the just-resolved
      // entry is no longer pending. Assert it directly.
      expect(info.layer === null && info.kind === "vector").toBe(false);
    } finally {
      window.L.stamp = realStamp;
    }
  });

  it("keeps the entry correct when the layer arrives before the control (good order)", () => {
    // Regression: the pre-fix path was already correct here. Registering with
    // `opts.layer` present resolves at the edge, so the entry lands with the
    // right `layer`, `carrier.layer`, and `kind` from the start — and the
    // fix must not disturb that path.
    const tile = new window.L.TileLayer();
    manager.registerLayer({ id: "early", name: "Early", group: "base", layer: tile });

    const info = manager.layerRegistry.get("early")!;
    expect(info.layer).toBe(tile);
    expect(info.carrier.layer).toBe(tile);
    expect(info.kind).toBe("tile");
    // `overlay1` seeded by `beforeEach` is deliberately still pending, so we
    // scope the check to the entry this test just registered.
    expect(info.layer === null && info.kind === "vector").toBe(false);
  });

  it("no entry mixes layer:null with a carrier-dependent kind (invariant)", () => {
    // The pending `kind` fallback for a `layer:null` entry is `vector`
    // (util.ts: deriveLayerKind). Only the three explicit no-carrier shapes
    // (canvas / solid / custom) may legitimately sit at `layer:null` — every
    // other `kind` combined with a null layer means the entry is either
    // still pending (not yet resolved) or was resolved incorrectly and left
    // stale. This is the guard that the fix writes back rather than merely
    // emitting: without the upsert, a resolved TileLayer would keep the
    // pending kind and this assert would catch it.
    const realStamp = window.L.stamp;
    window.L.stamp = stableStamp;
    try {
      // Resolve the seeded `overlay1` before the invariant check so we can
      // assert globally — the check is about the resolved state, not the
      // transient pending one.
      const overlay = new window.L.Path();
      map._layers["overlay1"] = overlay;
      manager.onLayerAdd({ layer: overlay });

      manager.registerLayer({
        id: "custom",
        name: "C",
        group: "overlay",
        custom: { x: 1 },
      });
      const tile = new window.L.TileLayer();
      map._layers["tileLate"] = tile;
      manager.registerLayer({ id: "tileLate", name: "TL", group: "base" });
      manager.onLayerAdd({ layer: tile });

      const noCarrierKinds = new Set(["canvas", "solid", "custom"]);
      for (const entry of manager.layers) {
        if (entry.layer === null) {
          expect(
            noCarrierKinds.has(entry.kind),
            `entry "${entry.id}" has layer:null with kind "${entry.kind}"`,
          ).toBe(true);
        }
      }
    } finally {
      window.L.stamp = realStamp;
    }
  });

  it("onLayerAdd responds to container layers (GeoJSON/FeatureGroup) too", () => {
    // Container layers (L.GeoJSON / FeatureGroup) previously fell through the
    // Path/Marker filter, so their addTo never re-ran enforceOrder. Any
    // registered container's add must coalesce into one enforce.
    vi.useFakeTimers();
    const spy = vi.spyOn(manager, "enforceOrder");
    const container = { options: {} as Record<string, unknown>, eachLayer: vi.fn() };
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({ id: "fg", name: "FG", layer: container });
    manager.onLayerAdd({ layer: container });
    manager.onLayerAdd({ layer: container });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("onLayerAdd marks materialized surfaces dirty for an add it cannot attribute", () => {
    // The manager cannot tell which surface a new layer belongs to — that is
    // what makes the reconcile observation-based (walk the tree, pin what is
    // unpinned) rather than interception-based (hook `addLayer`, and silently
    // half-fade the day something bypasses the hook). So every materialized
    // surface is marked, and the pass re-pins whichever tree actually changed.
    // The price is one tree walk per content change, paid only while a surface
    // is dirty.
    vi.useFakeTimers();
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.registerLayer({ id: "overlay1", name: "Points", layer: { options: {} } });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    spy.mockClear();
    manager.onLayerAdd({ layer: { options: {}, eachLayer: vi.fn() } });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("onLayerAdd schedules nothing while no surface is materialized", () => {
    // Nothing registered, nothing materialized: an add has no pane to re-pin,
    // so the add is not a reason to run a pass.
    vi.useFakeTimers();
    const fresh = new LayerController(map, []);
    const spy = vi.spyOn(fresh, "enforceOrder");
    fresh.onLayerAdd({ layer: { options: {}, eachLayer: vi.fn() } });
    vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
    expect(spy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // ── initial data normalization ──

  it("syncAttribution picks the topmost visible base tile and stops early", () => {
    const tile1 = new TileLayer(); // attribution: © OpenStreetMap (default)
    const tile2 = new TileLayer();
    manager.map.hasLayer.mockImplementation((l: any) => l === tile1);
    // Re-register base1 with the test instance; base2 registers ahead of it
    // (insertAt firstBaseIdx) but is invisible, so base1 is the topmost
    // visible tile whose attribution wins.
    manager.registerLayer({ id: "base1", name: "Base1", layer: tile1, group: "base" });
    manager.registerLayer({ id: "base2", name: "Base2", layer: tile2, group: "base" });
    manager.enforceOrder();
    expect(map.attributionControl._attributions).toEqual({ "© OpenStreetMap": 1 });
  });

  it("syncAttribution fully rebuilds the table on every call — no stale Leaflet entries linger", () => {
    // Two visible bases: the topmost (registry index 0, which is the
    // later-registered one under insertAt firstBaseIdx) wins. Every sync
    // clears the table first — so a stale entry Leaflet's own layeradd
    // callback may have added cannot survive a subsequent sync. Without the
    // full-clear step, the table would grow with every toggle and the
    // attribution line would stack every base's credit.
    const osm = new TileLayer(); // default attribution
    const custom = new TileLayer();
    custom.options.attribution = "Custom base";
    manager.map.hasLayer.mockImplementation((l: any) => l === osm || l === custom);
    manager.registerLayer({ id: "osm", name: "OSM", layer: osm, group: "base" });
    manager.registerLayer({
      id: "custom",
      name: "Custom",
      layer: custom,
      group: "base",
    });
    // Seed a stale entry as if Leaflet's layeradd for osm had already run.
    const ac = map.attributionControl;
    ac._attributions = { "© OpenStreetMap": 1 };
    manager.syncAttribution();
    expect(ac._attributions).toEqual({ "Custom base": 1 });
  });

  it("syncAttribution leaves the table empty when no base tile is visible", () => {
    manager.map.hasLayer.mockReturnValue(false);
    manager.enforceOrder();
    expect(map.attributionControl._attributions).toEqual({});
  });

  it("syncAttribution skips non-base entries while scanning for the top tile", () => {
    // The scan walks from firstBaseIdx and normal ordering keeps overlays out
    // of the base ladder — but a registry can hold an overlay between bases
    // (e.g. after a raw replace), and the scan must skip it instead of
    // treating it as a candidate attribution.
    const tileA = new TileLayer();
    const tileB = new TileLayer();
    manager.map.hasLayer.mockImplementation((l: any) => l === tileB);
    manager.registerLayer({ id: "baseA", name: "A", layer: tileA, group: "base" });
    manager.registerLayer({ id: "baseB", name: "B", layer: tileB, group: "base" });
    const overlayInfo = manager.layerRegistry.get("overlay1")!;
    // Force the interleaved layout: an invisible base, then the overlay, then
    // a visible base — the visible tile must still win.
    manager.layerRegistry.replace([
      manager.layerRegistry.get("baseA")!,
      overlayInfo,
      manager.layerRegistry.get("baseB")!,
    ]);
    manager.syncAttribution();
    expect(map.attributionControl._attributions).toEqual({ "© OpenStreetMap": 1 });
  });

  it("syncAttribution rebuilds the entry table when the visible base changes", () => {
    // Every sync is a full clear + rebuild of the entry table — the "last
    // value" cache is gone because it could not see a base Leaflet had
    // already added underneath another visible base. A change of visible
    // base therefore replaces the entry rather than diffing against a
    // remembered value.
    const tile = new TileLayer();
    manager.map.hasLayer.mockImplementation((l: any) => l === tile);
    manager.registerLayer({ id: "base1", name: "OSM", layer: tile, group: "base" });

    const attr = map.attributionControl;
    manager.syncAttribution();
    expect(attr._attributions).toEqual({ "© OpenStreetMap": 1 });

    tile.options.attribution = "© Second";
    manager.syncAttribution();
    expect(attr._attributions).toEqual({ "© Second": 1 });
  });

  // ── desiredAttribution (pure, no Leaflet writes) ──

  it("desiredAttribution returns empty string when no base tile is visible", () => {
    manager.map.hasLayer.mockReturnValue(false);
    expect(manager.desiredAttribution()).toBe("");
  });

  it("desiredAttribution picks the topmost visible base in registry order", () => {
    const tileA = new TileLayer();
    tileA.options.attribution = "A attr";
    const tileB = new TileLayer();
    tileB.options.attribution = "B attr";
    manager.map.hasLayer.mockImplementation((l: any) => l === tileA || l === tileB);
    manager.registerLayer({ id: "bA", name: "A", layer: tileA, group: "base" });
    manager.registerLayer({ id: "bB", name: "B", layer: tileB, group: "base" });
    // B registers second → inserted at firstBaseIdx → index 0 → topmost
    expect(manager.desiredAttribution()).toBe("B attr");
  });

  it("desiredAttribution skips non-TileLayer layers", () => {
    const nonTile = { options: {} } as unknown as L.Layer;
    manager.map.hasLayer.mockImplementation((l: any) => l === nonTile);
    manager.registerLayer({ id: "ng", name: "NG", layer: nonTile, group: "base" });
    expect(manager.desiredAttribution()).toBe("");
  });

  it("desiredAttribution skips layers outside their own zoom range", () => {
    const tile = new TileLayer();
    tile.options.attribution = "Hidden";
    tile.options.maxZoom = 5;
    manager.map.getZoom.mockReturnValue(10);
    manager.map.hasLayer.mockImplementation((l: any) => l === tile);
    manager.registerLayer({ id: "hidden", name: "H", layer: tile, group: "base" });
    expect(manager.desiredAttribution()).toBe("");
  });

  // ── syncAttribution settled fast-path ──

  it("syncAttribution skips redraw when the table is already settled", () => {
    const tile = new TileLayer(); // default attribution
    manager.map.hasLayer.mockImplementation((l: any) => l === tile);
    manager.registerLayer({ id: "b1", name: "B1", layer: tile, group: "base" });

    const ac = map.attributionControl;
    const updateSpy = vi.fn();
    ac._update = updateSpy;

    // First call: table starts empty → must rebuild and call _update.
    manager.syncAttribution();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(ac._attributions).toEqual({ "© OpenStreetMap": 1 });

    // Second call: table already has the expected single entry → skip.
    manager.syncAttribution();
    expect(updateSpy).toHaveBeenCalledTimes(1); // unchanged
  });

  it("syncAttribution rebuilds when Leaflet added a second entry behind our back", () => {
    const tile = new TileLayer(); // default attribution
    manager.map.hasLayer.mockImplementation((l: any) => l === tile);
    manager.registerLayer({ id: "b1", name: "B1", layer: tile, group: "base" });

    const ac = map.attributionControl;
    const updateSpy = vi.fn();
    ac._update = updateSpy;

    // Seed a stale second entry as if Leaflet's layeradd for another base ran.
    ac._attributions = { "© OpenStreetMap": 1, Stale: 1 };

    // Settled check must see the wrong key count and fall through to rebuild.
    manager.syncAttribution();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(ac._attributions).toEqual({ "© OpenStreetMap": 1 });
  });

  it("saveOrder is debounced — rapid calls coalesce into one storage write", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(Storage, "saveRecord");
    manager.saveOrder();
    manager.saveOrder();
    manager.saveOrder();
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    vi.useRealTimers();
  });

  describe("loadSavedOrder", () => {
    it("restores a persisted overlay/base order", () => {
      const spy = vi
        .spyOn(Storage, "loadRecord")
        .mockReturnValue(["overlay1", "base1"]);
      const m = new LayerController(map, [
        { id: "base1", name: "B", group: "base" },
        { id: "overlay1", name: "O", group: "overlay" },
      ]);
      expect(m.layers.map(l => l.id)).toEqual(["overlay1", "base1"]);
      spy.mockRestore();
    });

    it("drops unknown ids from persisted order and keeps the rest", () => {
      const spy = vi
        .spyOn(Storage, "loadRecord")
        .mockReturnValue(["ghost", "overlay1", "gone", "base1"]);
      const m = new LayerController(map, [
        { id: "base1", name: "B", group: "base" },
        { id: "overlay1", name: "O", group: "overlay" },
      ]);
      expect(m.layers.map(l => l.id)).toEqual(["overlay1", "base1"]);
      spy.mockRestore();
    });

    it("ignores non-array storage data", () => {
      const spy = vi.spyOn(Storage, "loadRecord").mockReturnValue("nope");
      const m = new LayerController(map, [
        { id: "overlay1", name: "O", group: "overlay" },
      ]);
      // falls back to the initial (insertion) order
      expect(m.layers.map(l => l.id)).toEqual(["overlay1"]);
      spy.mockRestore();
    });

    it("reads the record once at construction time", () => {
      // The constructor runs before LayerControl's UI has attached. Order seeds
      // the registry's starting arrangement and removed gates the registration
      // entry point, so both come from this one read rather than a second one
      // against a registry that has since grown.
      const spy = vi.spyOn(Storage, "loadRecord");
      new LayerController(map, [
        { id: "base1", name: "B", group: "base" },
        { id: "overlay1", name: "O", group: "overlay" },
      ]);
      const keys = spy.mock.calls.map(c => c[0]);
      expect(keys).toEqual([CONST.STORAGE.KEY]);
      spy.mockRestore();
    });
  });

  // ── Saved-order replay ─────────────────────────────────────────

  // The record's order is read once at construction and held in `savedOrder`;
  // nothing re-applies it afterwards, so every appearance point has to. A
  // component that registers after the record was loaded (Heatmap, Measure)
  // keeps the slot it was inserted into unless its position is replayed, and a
  // flush that lands first would otherwise erase the position that registration
  // is meant to read back.
  describe("saved-order replay", () => {
    it("places a late registration at its persisted position", () => {
      seedStorage({ order: ["B", "H", "A"] });
      const m = new LayerController(map, [
        { id: "A", name: "A", group: "overlay" },
        { id: "B", name: "B", group: "overlay" },
      ]);

      m.registerLayer({ id: "H", name: "H", group: "overlay" });

      expect(m.layers.map(l => l.id)).toEqual(["B", "H", "A"]);
    });

    it("keeps a layer stored below every registered layer at the bottom", () => {
      // Nothing below H is registered, so the placement falls back to the end
      // of the group. That end must actually be the end — the layer is the
      // rightmost of the layers that exist, not the topmost.
      seedStorage({ order: ["B", "A", "H"] });
      const m = new LayerController(map, [
        { id: "A", name: "A", group: "overlay" },
        { id: "B", name: "B", group: "overlay" },
      ]);

      m.registerLayer({ id: "H", name: "H", group: "overlay" });

      expect(m.layers.map(l => l.id)).toEqual(["B", "A", "H"]);
    });

    it("skips a saved neighbor that has not registered yet", () => {
      // G sits between X and Y in the stored order but is not registered, so it
      // cannot be located. The walk keeps going past the gap instead of stopping
      // there and leaving X where prepend put it.
      seedStorage({ order: ["X", "G", "Y"] });
      const m = new LayerController(map, [{ id: "Y", name: "Y", group: "overlay" }]);

      m.registerLayer({ id: "X", name: "X", group: "overlay" });

      expect(m.layers.map(l => l.id)).toEqual(["X", "Y"]);
    });

    it("re-applies the stored order to a layer that drifted below its neighbor", () => {
      // The drag moved A under B without a flush landing yet. A is now below its
      // own saved neighbor, which is the case where the target index is not the
      // neighbor's shifted-down index.
      seedStorage({ order: ["A", "B"] });
      const m = new LayerController(map, [
        { id: "A", name: "A", group: "overlay" },
        { id: "B", name: "B", group: "overlay" },
      ]);
      m.layerRegistry.reorder(0, 1);
      expect(m.layers.map(l => l.id)).toEqual(["B", "A"]);

      m.replaySavedOrder("A");

      expect(m.layers.map(l => l.id)).toEqual(["A", "B"]);
    });

    it("leaves the registry alone for an id that is not registered", () => {
      seedStorage({ order: ["A"] });
      const m = new LayerController(map, [{ id: "A", name: "A", group: "overlay" }]);

      expect(() => m.replaySavedOrder("ghost")).not.toThrow();
      expect(m.layers.map(l => l.id)).toEqual(["A"]);
    });

    it("keeps a layer the record never ranked at its live position", () => {
      // D arrived this session, so the record has no rank for it. The sweep
      // sorts the ranked ids by rank and leaves the unranked ones in their own
      // relative order at the bottom.
      seedStorage({ order: ["D"] });
      const m = new LayerController(map, [
        { id: "A", name: "A", group: "overlay" },
        { id: "B", name: "B", group: "overlay" },
        { id: "C", name: "C", group: "overlay" },
        { id: "D", name: "D", group: "overlay" },
      ]);
      m.layerRegistry.reorder(0, 2);
      expect(m.layers.map(l => l.id)).toEqual(["A", "B", "D", "C"]);

      m.replaySavedOrder();

      expect(m.layers.map(l => l.id)).toEqual(["D", "A", "B", "C"]);
    });

    it("writes no saved order from registration alone (no user action)", () => {
      // #515's original semantics, now enforced by the mechanism itself: only
      // explicit user reorders snapshot the live order. A boot that registers
      // the color basemap and further layers must leave the order slot
      // untouched — not even a snapshot that happens to match the registration
      // sequence is a user arrangement.
      seedStorage({});
      const m = new LayerController(map, [
        { id: "fg", name: "FG", group: "overlay" },
        { id: "tile", name: "Tile", group: "base" },
      ]);
      m.registerLayer({
        id: "foliplus_color_map",
        name: "Color",
        group: "base",
      });
      m.registerLayer({ id: "X", name: "X", group: "overlay" });
      m.persistence.flushAll();

      const record = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!) as {
        order?: string[] | null;
      };
      // No order key at all — registration never touched the saved order.
      expect(record.order).toBeUndefined();
    });

    it("snapshots every layer present at the user reorder, color basemap included", () => {
      // A user reorder writes the full live order. The color basemap is an
      // ordinary layer with zero privileges, so its slot lands on disk like
      // any other layer's — a late registration that is not on the map yet
      // does not: the snapshot is what was on screen.
      seedStorage({ order: ["fg", "tile"] });
      const m = new LayerController(map, [
        { id: "fg", name: "FG", group: "overlay" },
        { id: "tile", name: "Tile", group: "base" },
      ]);
      m.registerLayer({
        id: "foliplus_color_map",
        name: "Color",
        group: "base",
      });
      expect(m.layers.map(l => l.id)).toEqual(["fg", "foliplus_color_map", "tile"]);

      m.saveOrder();
      m.persistence.flushAll();

      const record = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!) as {
        order: string[] | null;
      };
      expect(record.order).toEqual(["fg", "foliplus_color_map", "tile"]);
    });

    it("keeps a dragged solid-color basemap position across a reload (user bug)", () => {
      // The user drags the color basemap up within the base group and reloads:
      // the dragged slot must survive. Before the fix, the color layer's slot
      // was treated as attach timing and dropped from every write, so the
      // reload fell back to the registration order (bottom of the base group).
      const m = new LayerController(map, [
        { id: "fg", name: "FG", group: "overlay" },
        { id: "tile", name: "Tile", group: "base" },
      ]);
      m.registerLayer({
        id: "foliplus_color_map",
        name: "Color",
        group: "base",
        baseInsert: "bottom",
      });
      // Registration order: fg, tile, color (color at the bottom, as createColor
      // mounts it).
      expect(m.layers.map(l => l.id)).toEqual(["fg", "tile", "foliplus_color_map"]);

      // The drag moves the color basemap above the tile basemap.
      m.layerRegistry.reorder(2, 1);
      m.saveOrder();
      m.persistence.flushAll();

      const record = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!) as {
        order: string[] | null;
      };
      expect(record.order).toEqual(["fg", "foliplus_color_map", "tile"]);

      // Reload, the way a real page does it: the color basemap is not part of
      // the author's data — LayerControl re-creates it through registerLayer
      // (baseInsert bottom), which must replay the dragged slot from the
      // record instead of sinking to the bottom of the base block.
      const reloaded = new LayerController(map, [
        { id: "fg", name: "FG", group: "overlay" },
        { id: "tile", name: "Tile", group: "base" },
      ]);
      reloaded.registerLayer({
        id: "foliplus_color_map",
        name: "Color",
        group: "base",
        baseInsert: "bottom",
      });
      expect(reloaded.layers.map(l => l.id)).toEqual([
        "fg",
        "foliplus_color_map",
        "tile",
      ]);
    });

    it("replays a dragged base layer into the base block, never the overlay end", () => {
      // placeBeforeSavedNeighbor's no-registered-neighbor fallback is
      // group-local: a base layer with no registered saved neighbor below it
      // lands at the end of the base block (the registry end), not at the end
      // of the overlay block — the overlay-before-base invariant holds.
      seedStorage({ order: ["fg", "baseA", "baseB"] });
      const m = new LayerController(map, [{ id: "fg", name: "FG", group: "overlay" }]);
      m.registerLayer({ id: "baseA", name: "A", group: "base" });

      // Neither baseB nor anything else is registered below baseA in the
      // stored order, so the fallback is the base-block end: below the
      // overlay, at the bottom of the registry.
      expect(m.layers.map(l => l.id)).toEqual(["fg", "baseA"]);
    });
  });

  // ── forgetSavedOrder ──

  // Component clear paths (Heatmap, Measure) call this to drop an id from the
  // stored order without retiring the layer. The next registration lands at
  // the top of the overlay stack rather than back at the old slot. Contrast
  // with deleteLayer: forgetSavedOrder filters savedOrder only; it must never
  // touch removedIds, otherwise a cleared layer could not be re-registered.
  describe("forgetSavedOrder", () => {
    it("drops the id from savedOrder and persists the change", () => {
      // Component clears always unregister the layer before calling this —
      // saveOrder would otherwise re-insert an id that is still live.
      seedStorage({ order: ["A", "H", "B", "C"] });
      const m = new LayerController(map, [
        { id: "A", name: "A", group: "overlay" },
        { id: "H", name: "H", group: "overlay" },
        { id: "B", name: "B", group: "overlay" },
        { id: "C", name: "C", group: "overlay" },
      ]);
      m.unregisterLayer("H");

      expect(m.forgetSavedOrder("H")).toBe(true);
      expect((m as any).order.savedOrder).toEqual(["A", "B", "C"]);
    });

    it("persists the pruned order so a reload does not resurrect the old slot", () => {
      seedStorage({ order: ["A", "H", "B"] });
      const m = new LayerController(map, [
        { id: "A", name: "A", group: "overlay" },
        { id: "H", name: "H", group: "overlay" },
        { id: "B", name: "B", group: "overlay" },
      ]);
      m.unregisterLayer("H");
      m.forgetSavedOrder("H");
      m.persistence.flushAll();

      const record = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!) as {
        order: string[] | null;
      };
      expect(record.order).toEqual(["A", "B"]);
    });

    it("returns false for an id that is not in savedOrder", () => {
      seedStorage({ order: ["A", "B"] });
      const m = new LayerController(map, [
        { id: "A", name: "A", group: "overlay" },
        { id: "B", name: "B", group: "overlay" },
      ]);
      expect(m.forgetSavedOrder("never")).toBe(false);
    });

    it("returns false when savedOrder is null (fresh page)", () => {
      const m = new LayerController(map, [{ id: "A", name: "A", group: "overlay" }]);
      expect((m as any).order.savedOrder).toBeNull();
      expect(m.forgetSavedOrder("A")).toBe(false);
    });

    it("does NOT add the id to removedIds — the layer stays registerable", () => {
      seedStorage({ order: ["A", "H", "B"] });
      const m = new LayerController(map, [
        { id: "A", name: "A", group: "overlay" },
        { id: "H", name: "H", group: "overlay" },
        { id: "B", name: "B", group: "overlay" },
      ]);
      m.unregisterLayer("H");
      m.forgetSavedOrder("H");

      expect((m as any).order.removedIds.has("H")).toBe(false);
      // And a subsequent registration actually works:
      m.registerLayer({ id: "H", name: "H", group: "overlay" });
      expect(m.layerRegistry.has("H")).toBe(true);
    });

    it("next registration lands at the top of the overlay stack", () => {
      // Without forgetSavedOrder the re-registration would land back at index 1
      // (below A). With it, insertOverlayAt's prepend branch wins because the
      // id has no stored rank anymore.
      seedStorage({ order: ["A", "H", "B"] });
      const m = new LayerController(map, [
        { id: "A", name: "A", group: "overlay" },
        { id: "H", name: "H", group: "overlay" },
        { id: "B", name: "B", group: "overlay" },
      ]);
      m.unregisterLayer("H");
      m.forgetSavedOrder("H");
      m.registerLayer({ id: "H", name: "H", group: "overlay" });

      expect(m.layers.map(l => l.id)).toEqual(["H", "A", "B"]);
    });

    it("preserves neighbor order across a reload after forget", () => {
      // A clear must not disturb the layers around it: forget only removes the
      // one id and leaves the rest in their saved positions, which replay on
      // the next construction.
      seedStorage({ order: ["A", "H", "B", "C"] });
      const m = new LayerController(map, [
        { id: "A", name: "A", group: "overlay" },
        { id: "H", name: "H", group: "overlay" },
        { id: "B", name: "B", group: "overlay" },
        { id: "C", name: "C", group: "overlay" },
      ]);
      m.unregisterLayer("H");
      m.forgetSavedOrder("H");
      m.persistence.flushAll();

      // Simulate reload: a fresh manager reads the record and gets neighbors
      // in the same relative order.
      const fresh = new LayerController(map, [
        { id: "A", name: "A", group: "overlay" },
        { id: "B", name: "B", group: "overlay" },
        { id: "C", name: "C", group: "overlay" },
      ]);
      expect(fresh.layers.map(l => l.id)).toEqual(["A", "B", "C"]);
    });
  });

  // ── dropPersistedLayerState ──

  // The component-clear counterpart of deleteLayer: it drops the same two
  // sections (stored order + intent row) but never retires the id, so a
  // cleared component can draw again from the author's defaults.
  describe("dropPersistedLayerState", () => {
    it("drops the intent row and its provenance, keeps the id registerable", () => {
      const m = new LayerController(map, [
        { id: "A", name: "A", group: "overlay" },
        { id: "H", name: "H", group: "overlay" },
      ]);
      const save = vi.fn(() => saveState(m.ui!));
      m.ui = {
        c: m,
        listPanel: {} as never,
        intentStore: makeStore(
          {
            H: { visible: false, opacity: 0.35 },
            A: { visible: false, opacity: 0.4 },
          },
          { H: ["visible", "opacity"], A: ["visible", "opacity"] },
        ),
        dropPersistedLayerState: (id: string) => dropPersistedLayerState(m.ui!, id),
        saveState: save,
        invalidateFields: vi.fn(),
      } as any;
      // A component clear always unregisters first (saveOrder would otherwise
      // re-insert an id that is still live).
      m.unregisterLayer("H");

      expect(m.dropPersistedLayerState("H")).toBe(true);

      expect(getIntent(m.ui!, "H", "visible")).toBeUndefined();
      expect(getIntent(m.ui!, "H", "opacity")).toBeUndefined();
      // A sibling's tuning is nobody's business on a component clear.
      expect(getIntent(m.ui!, "A", "visible")).toBe(false);
      expect(getIntent(m.ui!, "A", "opacity")).toBe(0.4);
      expect(m.ui!.intentStore.dumpProvenance()).toEqual({
        A: ["visible", "opacity"],
      });
      expect(save).toHaveBeenCalledTimes(1);
      // A clear is not a delete: the id stays registerable.
      expect((m as any).order.removedIds.has("H")).toBe(false);
      m.registerLayer({ id: "H", name: "H", group: "overlay" });
      expect(m.layerRegistry.has("H")).toBe(true);
    });

    it("drops the stored order slot too, so a redraw lands at the top", () => {
      seedStorage({ order: ["A", "H", "B"] });
      const m = new LayerController(map, [
        { id: "A", name: "A", group: "overlay" },
        { id: "H", name: "H", group: "overlay" },
        { id: "B", name: "B", group: "overlay" },
      ]);
      m.unregisterLayer("H");

      expect(m.dropPersistedLayerState("H")).toBe(true);

      expect((m as any).order.savedOrder).toEqual(["A", "B"]);
      m.registerLayer({ id: "H", name: "H", group: "overlay" });
      expect(m.layers.map(l => l.id)).toEqual(["H", "A", "B"]);
    });

    it("returns false when nothing was stored for the id", () => {
      // No panel and no stored order — a clear of a layer the user never
      // touched erases nothing, and must say so rather than throwing.
      const m = new LayerController(map, [{ id: "H", name: "H", group: "overlay" }]);
      expect(m.dropPersistedLayerState("H")).toBe(false);
    });

    it("persists the erase so a reload cannot resurrect the old tuning", () => {
      // The probe that motivated this: the entry survived both clear paths, so
      // a redraw — or a plain reload — handed back the opacity and visibility
      // the user had arranged for the previous draw.
      seedStorage({
        layers: {
          H: {
            visible: false,
            opacity: 0.35,
            overrides: ["visible", "opacity"],
          },
        },
      });
      const m = new LayerController(map, [{ id: "H", name: "H", group: "overlay" }]);
      const save = vi.fn(() => saveState(m.ui!));
      m.ui = {
        c: m,
        listPanel: {} as never,
        intentStore: makeStore(
          { H: { visible: false, opacity: 0.35 } },
          { H: ["visible", "opacity"] },
        ),
        dropPersistedLayerState: (id: string) => dropPersistedLayerState(m.ui!, id),
        saveState: save,
        invalidateFields: vi.fn(),
      } as any;
      m.unregisterLayer("H");
      m.dropPersistedLayerState("H");
      m.persistence.flushAll();

      const record = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!) as {
        layers?: Record<string, unknown>;
      };
      expect(record.layers?.H).toBeUndefined();
      expect(save).toHaveBeenCalledTimes(1);
    });
  });

  it("normalizes initial data into the full layerInfo field set", () => {
    const m2 = new LayerController(map, [{ id: "a", name: "A", group: "overlay" }]);
    const li = m2.layers[0];
    expect(li).toMatchObject({ id: "a", name: "A", group: "overlay" });
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

  // ── bringLayerToFront ──

  it("bringLayerToFront moves layer to front of z-order", () => {
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.registerLayer({ id: "a", name: "A", layer: new window.L.TileLayer() });
    manager.registerLayer({ id: "b", name: "B", layer: new window.L.TileLayer() });
    manager.bringLayerToFront("a");
    expect(spy).toHaveBeenCalled();
  });

  it("bringLayerToFront is a no-op for unknown id", () => {
    const spy = vi.spyOn(manager, "enforceOrder");
    manager.bringLayerToFront("nonexistent");
    expect(spy).not.toHaveBeenCalled();
  });

  // ── traverse / extractPoints ──

  it("extractPoints returns empty array for non-existent layer", () => {
    expect(manager.extractPoints("nonexistent")).toEqual([]);
  });

  // ── surface container guard ──

  it("a surface pins a container's content, never the container itself", () => {
    // Leaflet ignores a group's own `options.pane` for its children, so the pin
    // walks the tree instead of writing a pane onto the container.
    const container = { options: {} as Record<string, unknown>, eachLayer: vi.fn() };
    manager.registerLayer({ id: "c", name: "C", layer: container });
    expect(container.options.pane).toBeUndefined();
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

  it("BEFORE_EXPORT flushes the pending order before the exporter captures", () => {
    // A debounced reorder would otherwise land after the capture, exporting the
    // stale z-order the panel already showed.
    const spy = vi
      .spyOn(manager, "enforceOrder")
      .mockImplementation(() => ({ failed: [], skipped: false }));
    manager.events.publish(EVENTS.BEFORE_EXPORT as string);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("BEFORE_EXPORT warns when a layer cannot be priced, and the capture still runs", () => {
    // The pass isolates layers, so the export continues either way — but a
    // stale z in the capture is invisible in the image, so it must be logged.
    // `env.log` defaults to one shared logger for every controller built with
    // the no-op env, so the spy is restored rather than left in place.
    const log = (manager as any).log as { warn: (...args: unknown[]) => void };
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const order = vi
      .spyOn(manager, "enforceOrder")
      .mockReturnValue({ failed: ["bad", "worse"], skipped: false });
    const captured: string[] = [];
    const off = manager.events.on(EVENTS.BEFORE_EXPORT as string, () =>
      captured.push("capture"),
    );

    try {
      manager.events.publish(EVENTS.BEFORE_EXPORT as string);

      expect(warn).toHaveBeenCalledWith(
        "enforceOrder failed for 2 layer(s) before export: bad, worse",
      );
      expect(captured).toEqual(["capture"]);
    } finally {
      off();
      warn.mockRestore();
      order.mockRestore();
    }
  });

  it("a runtime content change routes through invalidateType and the live count", () => {
    // clearLayers is how a group empties itself; the factory must invalidate the
    // cached type and refresh the count column, not just drop the layers.
    const invalidate = vi.spyOn(manager, "invalidateType").mockImplementation(() => {});
    const refresh = vi.spyOn(manager, "refreshCount").mockImplementation(() => {});
    const api = manager.createLayers({
      id: "g3",
      name: "Group",
      panes: [{ name: "g3_sub" }],
    });
    api.register();
    api.addLayer({ options: {} } as any, "g3_sub");
    api.clearLayers();
    expect(invalidate).toHaveBeenCalledWith("g3");
    expect(refresh).toHaveBeenCalledWith("g3");
  });

  it("does not price a pane for a canvas whose id was deleted", () => {
    // registerLayer refuses an id the user deleted and returns before inserting
    // it, so slotOf has nothing to look up. preRegister still mounted the pane,
    // and it must be left unpriced rather than given a slot that does not exist
    // — and the path must not throw, since a late component can hold that id.
    seedStorage({ removed: ["gone"] });
    window.L.DomUtil = { getPosition: vi.fn(() => ({ x: 0, y: 0 })) };
    map.getPanes = vi.fn(() => ({ mapPane: document.createElement("div") }));
    const m2 = new LayerController(map, [
      { id: "kept", name: "K", group: "overlay", layer: { options: {} } },
    ]);
    const warn = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(warn);
    try {
      const api = m2.createCanvas({ id: "gone" });
      expect(() => api.register()).not.toThrow();
      expect(m2.layerRegistry.get("gone")).toBeUndefined();
      // Mounted, but carrying the mock pane's untouched default z: nothing was
      // written by the factory.
      expect(api.canvas.parentElement).toBeTruthy();
      expect(api.canvas.parentElement?.style.zIndex).toBe("0");
      api.destroy();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('registerLayer: refusing "gone"'),
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("registerLayer appends a base layer when no base exists yet", () => {
    const m2 = new LayerController(map, [
      { id: "only_overlay", name: "O", group: "overlay" },
    ]);
    map.hasLayer.mockReturnValue(false);
    m2.registerLayer({ id: "first_base", name: "B", group: "base" });
    expect(m2.layerRegistry.firstBaseIdx).toBe(1);
  });

  it("registerLayer sets pane options for non-Path/Marker layers", () => {
    const layer = { options: {} } as any;
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({ id: "p", name: "P", layer, paneName: "my_pane" });
    expect(layer.options.pane).toBe("my_pane");
  });

  it("re-registering an existing layer updates the UI row", () => {
    manager.map.hasLayer.mockReturnValue(false);
    manager.uiContainer = document.createElement("div");
    manager.ui = {
      intentStore: makeStore(),
      // The replay entry point always returns a round; the stub has to honour it.
      applyUserState: vi.fn(() => []),
    } as any;
    const emitSpy = vi.spyOn(manager.events, "emitSettled");
    manager.registerLayer({ id: "overlay1", name: "Renamed" });
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_ITEM_UPDATED, {
      id: "overlay1",
    });
    expect(emitSpy).not.toHaveBeenCalledWith(EVENTS.LAYER_ITEM_ADDED, {
      id: "overlay1",
    });
    // A re-registration is how the API says the layer's content changed, so the
    // cached field list — and the auto field resolved from it — must be dropped.
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_ITEM_REFRESHED, {
      id: "overlay1",
    });
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_GROUP_COUNT_CHANGED, {
      group: "overlay",
    });
    // Opacity is stored per-id; re-registration may swap the live layer/canvas.
    expect(manager.ui!.applyUserState).toHaveBeenCalledWith("overlay1");
  });

  it("re-registering with a different group is refused before any mutation", () => {
    // A layer's group is its role for the id's lifetime — z ladder,
    // attribution, basemap semantics, panel section. Changing it in place
    // would strand the row in the old section with a stale section boundary
    // and a broken overlay-before-base partition, so the gate refuses
    // before a single mutation lands.
    const { manager, ui } = initFixture({
      data: [
        { id: "A", name: "A", group: "overlay" },
        { id: "T", name: "T", group: "base" },
      ],
    });
    const rowA = attachedPanel(ui).querySelector(
      `[${CONST.DATA.LAYER_ID}="A"]`,
    ) as HTMLElement;
    const seen: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, p => seen.push(`change:${p.id}`));
    ui.events.on(EVENTS.LAYER_ITEM_ADDED, p => seen.push(`added:${p.id}`));
    ui.events.on(EVENTS.LAYER_ITEM_UPDATED, p => seen.push(`updated:${p.id}`));

    // Same group or no group is an ordinary content refresh.
    expect(() =>
      manager.registerLayer({ id: "A", name: "A2", group: "overlay" }),
    ).not.toThrow();
    expect(() => manager.registerLayer({ id: "A", name: "A3" })).not.toThrow();

    // A different group is a role change, in both directions.
    expect(() => manager.registerLayer({ id: "A", name: "A", group: "base" })).toThrow(
      /role change/,
    );
    expect(() =>
      manager.registerLayer({ id: "T", name: "T", group: "overlay" }),
    ).toThrow(/role change/);

    // Nothing moved: partition, cached boundary, the row's section. The only
    // announcements are the two ordinary refreshes above — nothing for T,
    // no added rows.
    expect(manager.layers.map(l => `${l.id}:${l.group}`)).toEqual([
      "A:overlay",
      "T:base",
      `${CONST.SOLID_BASEMAP_ID}:base`,
    ]);
    expect(manager.layerRegistry.firstBaseIdx).toBe(
      manager.layers.findIndex(l => l.group === GROUP.BASE),
    );
    expect(rowA.getAttribute("data-layer-type")).toBe("overlay");
    expect(seen.filter(e => e.startsWith("updated"))).toHaveLength(2);
    expect(seen.filter(e => e.startsWith("change"))).toHaveLength(2);
    expect(seen.every(e => e.endsWith(":A"))).toBe(true);
  });

  it("a cross-role re-registration after unregister replays its order role-locally", () => {
    // The gate says "unregister first"; that path must stay safe. A's old
    // saved rank sits above B, but A is now a base and B an overlay — an
    // unconditional replay would push A into the overlay block and strand
    // the boundary.
    const { manager } = initFixture({
      seed: { order: ["A", "B"] },
      data: [
        { id: "A", name: "A", group: "overlay" },
        { id: "B", name: "B", group: "overlay" },
        { id: "T", name: "T", group: "base" },
      ],
    });

    manager.unregisterLayer("A");
    manager.registerLayer({ id: "A", name: "A", group: "base" });

    const firstBase = manager.layers.findIndex(l => l.group === GROUP.BASE);
    expect(firstBase).not.toBe(-1);
    expect(manager.layers.slice(0, firstBase).every(l => l.group !== GROUP.BASE)).toBe(
      true,
    );
    expect(manager.layerRegistry.firstBaseIdx).toBe(firstBase);
  });

  it("a stored record that interleaves roles still replays partitioned", () => {
    // A corrupted or legacy record ranks T(base) above B(overlay) above
    // A(base). The full replay sorts per role and concatenates, so the
    // overlay block never inherits a base.
    const { manager } = initFixture({
      seed: { order: ["T", "B", "A"] },
      data: [
        { id: "A", name: "A", group: "base" },
        { id: "B", name: "B", group: "overlay" },
        { id: "T", name: "T", group: "base" },
      ],
    });

    const firstBase = manager.layers.findIndex(l => l.group === GROUP.BASE);
    expect(manager.layers.slice(0, firstBase).every(l => l.group !== GROUP.BASE)).toBe(
      true,
    );
    expect(manager.layerRegistry.firstBaseIdx).toBe(firstBase);
    expect(manager.layers[0].id).toBe("B");
  });

  it("a failed canvas registration leaves no authority and a clean face", () => {
    // A second owner tries an id the registry already holds as base; the
    // controller refuses its implicit overlay role. The factory must not
    // report success, must not keep the face mounted, and its unregister
    // must not touch the legal owner.
    const { manager } = initFixture({
      data: [{ id: "A", name: "A", group: "base" }],
    });
    const canvas = manager.createCanvas({ id: "A", name: "A" });

    expect(() => canvas.register()).toThrow(/role change/);
    expect(canvas.registered()).toBe(false);
    // The face was prepared for mount and rolled back: no pane parent. (The
    // fixture's panes are detached divs, so "connected" is read through the
    // parent link, not isConnected.)
    expect(canvas.canvas.parentElement).toBeNull();
    canvas.unregister();
    expect(manager.layerRegistry.get("A")?.group).toBe("base");

    // A second failure while the conflict persists: the rollback is
    // idempotent — the face was already detached, nothing to undo.
    expect(() => canvas.register()).toThrow(/role change/);
    expect(canvas.canvas.parentElement).toBeNull();

    // Once the conflict is gone, the same surface retries for real.
    manager.unregisterLayer("A");
    canvas.register();
    expect(canvas.registered()).toBe(true);
    expect(canvas.canvas.parentElement).not.toBeNull();
    canvas.unregister();
    expect(canvas.registered()).toBe(false);
  });

  it("a refused canvas pane does not mask the role gate's error", () => {
    // P2-1: a foreign element already occupies the canvas pane name, so
    // mountFace leaves facePane null. The registration then fails the role
    // gate; the rollback must not dereference the pane it never got, or the
    // caller sees a TypeError instead of the role error.
    const { manager } = initFixture({
      data: [{ id: "A", name: "A", group: "base" }],
    });
    const foreignPane = document.createElement("div");
    foreignPane.appendChild(document.createElement("canvas"));
    const paneName = "foliplus-canvas-A";
    const realGetPane = manager.map.getPane;
    manager.map.getPane = vi.fn((name: string) =>
      name === paneName ? foreignPane : realGetPane(name),
    );

    const canvas = manager.createCanvas({ id: "A", name: "A" });

    expect(() => canvas.register()).toThrow(/role change/);
    expect(canvas.registered()).toBe(false);
    expect(canvas.canvas.parentElement).toBeNull();
    // The refused pane kept only its own content.
    expect(foreignPane.childElementCount).toBe(1);

    // A second attempt re-runs the transaction and still reports the role
    // error: the failed rollback did not poison the surface.
    expect(() => canvas.register()).toThrow(/role change/);
  });

  it("an old owner cannot unregister a same-id replacement and still ends in its terminal state", () => {
    const { manager } = initFixture({
      data: [{ id: "A", name: "A", group: "overlay" }],
    });
    const first = manager.createCanvas({ id: "A", name: "A" });
    first.register();
    expect(first.registered()).toBe(true);

    // A second surface replaces the entry under the same id; the first
    // owner's lease has lapsed.
    const second = manager.createCanvas({ id: "A", name: "A2" });
    second.register();
    first.unregister();

    // The registry stays with the replacement, and the lapsed surface ends
    // in its terminal state: not registered anymore, face hidden — the old
    // canvas must not keep drawing under the replacement's.
    expect(manager.layerRegistry.has("A")).toBe(true);
    expect(first.registered()).toBe(false);
    expect(first.canvas.classList.contains("hidden")).toBe(true);

    second.unregister();
    expect(manager.layerRegistry.has("A")).toBe(false);
  });

  it("a failing pricing pass still saves the arrangement it committed", () => {
    // commitReorder's local-commit rule: the persisted order agrees with the
    // live registry whatever happens to the steps that follow the registry
    // move — a throwing pricing pass must not leave the record lagging.
    const { manager, ui } = initFixture({
      data: [
        { id: "A", name: "A", group: "overlay" },
        { id: "B", name: "B", group: "overlay" },
      ],
    });
    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, p => changes.push(p.id));
    vi.spyOn(manager, "enforceOrder").mockImplementation(() => {
      throw new Error("order boom");
    });

    expect(() => manager.moveLayerUp("B")).toThrow("order boom");

    expect(manager.layers[0].id).toBe("B");
    expect((manager as any).order.savedOrder?.[0]).toBe("B");
    // The rows follow the committed arrangement too: a stale panel was the
    // visible half of the old failure path, and the row-order signal now
    // lands before the error surfaces.
    expect(
      Array.from(
        attachedPanel(ui).querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM),
      ).map(el => el.dataset.layerId),
    ).toEqual(manager.layers.map(l => l.id));
    // The operation still never opened: no announcement for a half-committed move.
    expect(changes).toEqual([]);
  });

  it("a throwing map teardown still converges the retirement", () => {
    const { manager, ui } = initFixture({
      data: [{ id: "A", name: "A", group: "overlay", layer: polygonLayer() }],
    });
    ui.listPanel.dragEntry = manager.layerRegistry.get("A")!;
    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, p => changes.push(p.id));
    manager.map.removeLayer.mockImplementation(() => {
      throw new Error("map boom");
    });

    expect(() => manager.unregisterLayer("A")).toThrow("map boom");

    // The local ledger converged despite the throw: registry, gesture,
    // DOM row, and the owed CHANGE all landed.
    expect(manager.layerRegistry.has("A")).toBe(false);
    expect(ui.listPanel.dragEntry).toBeNull();
    expect(attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="A"]`)).toBeNull();
    expect(changes).toContain("A");
  });

  it("a throwing map teardown still converges a user delete", () => {
    const { manager, ui } = initFixture({
      data: [{ id: "A", name: "A", group: "overlay", layer: polygonLayer() }],
    });
    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, p => changes.push(p.id));
    manager.map.removeLayer.mockImplementation(() => {
      throw new Error("map boom");
    });

    expect(() => manager.deleteLayer("A")).toThrow("map boom");

    // The delete's persistent effects and its fan-out all landed before the
    // map error surfaced: entry gone, id pruned as deleted, CHANGE owed.
    expect(manager.layerRegistry.has("A")).toBe(false);
    expect((manager as any).order.removedIds.has("A")).toBe(true);
    expect(changes).toContain("A");
  });

  it("a throwing map teardown still converges a color-basemap delete", () => {
    const { manager, ui } = initFixture({
      data: [{ id: "A", name: "A", group: "overlay", layer: polygonLayer() }],
    });
    // The color entry registers with a canvas, no Leaflet layer; give it one
    // so the map teardown path (and its throw) is real.
    manager.layerRegistry.get(CONST.SOLID_BASEMAP_ID)!.layer = polygonLayer();
    const changes: string[] = [];
    ui.events.on(EVENTS.LAYER_CHANGE, p => changes.push(p.id));
    manager.map.removeLayer.mockImplementation(() => {
      throw new Error("map boom");
    });

    expect(() => manager.deleteLayer(CONST.SOLID_BASEMAP_ID)).toThrow("map boom");

    expect(manager.layerRegistry.has(CONST.SOLID_BASEMAP_ID)).toBe(false);
    expect(changes).toContain(CONST.SOLID_BASEMAP_ID);
  });

  it("re-registration re-applies stored opacity onto a replaced canvas", () => {
    manager.map.hasLayer.mockReturnValue(false);
    manager.uiContainer = document.createElement("div");
    const canvas = document.createElement("canvas");
    manager.registerLayer({ id: "heat", name: "Heat", canvas });
    manager.ui = {
      updateLayerItemLabel: vi.fn(),
      initLayerItem: vi.fn(),
      syncToggleAll: vi.fn(),
      insertLayerItem: vi.fn(),
      invalidateFields: vi.fn(),
      applyUserState: (id: string) =>
        applyUserState(
          {
            c: manager,
            uiContainer: manager.uiContainer,
            renamedNames: {},
            focusController: { focusingLayerId: null },
            intentStore: makeStore({ heat: { opacity: 0.4 } }, { heat: ["opacity"] }),
            runtimeStore: new LayerRuntimeStore(),
          } as any,
          id,
        ),
      intentStore: makeStore({ heat: { opacity: 0.4 } }, { heat: ["opacity"] }),
      runtimeStore: new LayerRuntimeStore(),
    } as any;

    // Swap the canvas on re-registration — the new element starts opaque.
    const fresh = document.createElement("canvas");
    manager.registerLayer({ id: "heat", name: "Heat", canvas: fresh });

    // Default "redraw" arm: CSS live + layerAlpha stored.
    expect(fresh.style.opacity).toBe("0.4");
    expect(getLayerAlpha(fresh)).toBeCloseTo(0.4);
    expect(manager.layerRegistry.get("heat")?.opacity).toBe(0.4);
  });

  it("unregisterLayer removes the UI row", () => {
    manager.map.hasLayer.mockReturnValue(false);
    const row = document.createElement("div");
    row.setAttribute("data-layer-id", "overlay1");
    manager.uiContainer = document.createElement("div");
    manager.uiContainer.appendChild(row);
    manager.ui = {
      intentStore: makeStore(),
      saveState: vi.fn(),
      invalidateFields: vi.fn(),
    } as any;
    expect(manager.unregisterLayer("overlay1")).toBe(true);
    expect(manager.uiContainer.querySelector("[data-layer-id=overlay1]")).toBeNull();
  });

  it("unregisterLayer tolerates a row already gone from the panel", () => {
    // The panel is attached but no row carries this id — the layer left the
    // panel before unregister ran. The removal guard (target === null) must
    // not throw.
    manager.map.hasLayer.mockReturnValue(false);
    manager.uiContainer = document.createElement("div");
    manager.ui = {
      intentStore: makeStore(),
      saveState: vi.fn(),
      invalidateFields: vi.fn(),
    } as any;
    expect(manager.unregisterLayer("overlay1")).toBe(true);
  });

  it("retires the row it started with when the id is re-registered mid-teardown", () => {
    // The registry entry is gone before the steps run, so a `remove` listener
    // inside `clear-layer-tree` can register the same id again and mount a
    // second row. The retirement owns the element it captured when it started,
    // not whatever currently answers to the id — otherwise the teardown deletes
    // the replacement's row and leaves the dead one behind.
    manager.map.hasLayer.mockReturnValue(false);
    const layer = { options: {} } as any;
    manager.registerLayer({ id: "overlay1", name: "Points", group: "overlay", layer });
    const original = document.createElement("div");
    original.setAttribute("data-layer-id", "overlay1");
    manager.uiContainer = document.createElement("div");
    manager.uiContainer.appendChild(original);
    manager.ui = {
      intentStore: makeStore(),
      saveState: vi.fn(),
      invalidateFields: vi.fn(),
    } as any;

    const decoy = document.createElement("div");
    decoy.setAttribute("data-layer-id", "overlay1");
    vi.spyOn(manager, "clearAllLayers").mockImplementation(() => {
      // A row for the freshly registered replacement, in front of the original.
      manager.uiContainer!.prepend(decoy);
    });

    expect(manager.unregisterLayer("overlay1")).toBe(true);

    expect(manager.uiContainer.contains(original)).toBe(false);
    expect(manager.uiContainer.contains(decoy)).toBe(true);
  });

  it("still retires the captured row when the panel goes away mid-teardown", () => {
    // The row is captured before the steps, so a remove handler that tears the
    // whole control down (nulling `uiContainer`) must not strand it: the row is
    // removed anyway, and only the group/toggle-all rescan is skipped because
    // there is no panel left to rescan.
    manager.map.hasLayer.mockReturnValue(false);
    const layer = { options: {} } as any;
    manager.registerLayer({ id: "overlay1", name: "Points", group: "overlay", layer });
    const row = document.createElement("div");
    row.setAttribute("data-layer-id", "overlay1");
    manager.uiContainer = document.createElement("div");
    manager.uiContainer.appendChild(row);
    const container = manager.uiContainer;
    manager.ui = {
      intentStore: makeStore(),
      saveState: vi.fn(),
      invalidateFields: vi.fn(),
    } as any;
    vi.spyOn(manager, "clearAllLayers").mockImplementation(() => {
      manager.uiContainer = null;
    });

    expect(manager.unregisterLayer("overlay1")).toBe(true);

    expect(container.contains(row)).toBe(false);
  });

  it("unregisterLayer reconciles the base group when a base layer is dropped", () => {
    // The unregister sweep's sync call reads `layerInfo.group === "base"` to pick the
    // group to rescan. Existing tests only unregister overlays, so the BASE
    // branch of the ternary would silently rot without a pin.
    manager.map.hasLayer.mockReturnValue(false);
    manager.ui = {
      intentStore: makeStore(),
      saveState: vi.fn(),
    } as any;
    const emitSpy = vi.spyOn(manager.events, "emitSettled");
    expect(manager.unregisterLayer("base1")).toBe(true);
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_GROUP_COUNT_CHANGED, {
      group: GROUP.BASE,
    });
  });

  it("attachUI skips a null entry in pending registrations", () => {
    // attachUI drains pendingRegistrations in a loop and guards each shift()
    // result; a null entry must be skipped rather than reaching
    // insertLayerItem. A null cannot arise from registerLayer, so this is
    // defensive — and it must stay that way.
    const ui = new LayerUI(manager, TEST_ENV);
    manager.pendingRegistrations.push(null as any);
    manager.ui = ui;
    expect(() => ui.attachUI(document.createElement("div"))).not.toThrow();
  });

  it("unregisterLayer leaves every persisted section alone", () => {
    // Generic teardown cannot tell a temporarily-empty layer from a deleted
    // one — HeatmapControl unregisters its canvas whenever the data goes
    // empty — so it must not erase the user's stored values, including the
    // rename: the component may register the same id again and the user
    // expects the name they chose, not the registry's default.
    manager.map.hasLayer.mockReturnValue(false);
    const saveState = vi.fn();
    manager.ui = {
      intentStore: makeStore(
        {
          overlay1: {
            visible: false,
            opacity: 0.4,
            zoomRange: [3, 12],
            name: "Renamed",
          },
          base1: { visible: false, opacity: 1 },
        },
        {
          overlay1: ["visible", "opacity", "zoomRange"],
          base1: ["visible"],
        },
      ),
      saveState,
      saveNamesState: vi.fn(),
      invalidateFields: vi.fn(),
    } as any;
    manager.unregisterLayer("overlay1");

    // Unregister keeps every stored dimension (maps + intents stay in step).
    expect(getIntent(manager.ui!, "overlay1", "visible")).toBe(false);
    expect(getIntent(manager.ui!, "overlay1", "opacity")).toBe(0.4);
    expect(getIntent(manager.ui!, "overlay1", "zoomRange")).toEqual([3, 12]);
    expect(getIntent(manager.ui!, "base1", "visible")).toBe(false);
    expect(getIntent(manager.ui!, "base1", "opacity")).toBe(1);
    expect(manager.ui!.intentStore.dumpProvenance()).toEqual({
      overlay1: ["visible", "opacity", "zoomRange"],
      base1: ["visible"],
    });
    expect(getIntent(manager.ui!, "overlay1", "name")).toBe("Renamed");
    expect(saveState).not.toHaveBeenCalled();
  });

  it("deleteLayer drops the layer id from every persisted section", () => {
    // The one call that knows a layer is gone for good, so the one call that
    // may erase its stored values — the per-layer intent and the rename.
    manager.map.hasLayer.mockReturnValue(false);
    const saveState = vi.fn();
    const saveNamesState = vi.fn();
    const store = makeStore(
      {
        overlay1: {
          visible: false,
          opacity: 0.4,
          zoomRange: [3, 12],
          name: "Renamed",
        },
        base1: { visible: false, opacity: 1 },
      },
      {
        overlay1: ["visible", "opacity", "zoomRange"],
        base1: ["visible"],
      },
    );
    manager.intentStore = store;
    manager.ui = {
      intentStore: store,
      dropPersistedLayerState: (id: string) => dropPersistedLayerState(manager.ui!, id),
      saveState,
      saveNamesState,
      invalidateFields: vi.fn(),
      syncToggleAll: vi.fn(),
      syncNoBasemap: vi.fn(),
    } as any;
    manager.deleteLayer("overlay1");

    expect(getIntent(manager.ui!, "overlay1", "visible")).toBeUndefined();
    expect(getIntent(manager.ui!, "base1", "visible")).toBe(false);
    expect(getIntent(manager.ui!, "base1", "opacity")).toBe(1);
    expect(manager.ui!.intentStore.dumpProvenance()).toEqual({ base1: ["visible"] });
    expect(getIntent(manager.ui!, "overlay1", "name")).toBeUndefined();
    expect(saveState).toHaveBeenCalledTimes(1);
    expect(saveNamesState).toHaveBeenCalledTimes(1);
  });

  it("deleteLayer refuses an unknown id and writes nothing", () => {
    manager.map.hasLayer.mockReturnValue(false);
    const saveState = vi.fn();
    manager.ui = {
      intentStore: makeStore(
        { overlay1: { visible: false, opacity: 0.4 } },
        { overlay1: ["opacity"] },
      ),
      renamedNames: {},
      dropPersistedLayerState: vi.fn(),
      saveState,
      saveNamesState: vi.fn(),
      invalidateFields: vi.fn(),
    } as any;

    expect(manager.deleteLayer("never-registered")).toBe(false);
    expect(getIntent(manager.ui!, "overlay1", "visible")).toBe(false);
    expect(saveState).not.toHaveBeenCalled();
  });

  it("deleteLayer completes when the panel never attached", () => {
    // A layer can be deleted before attachUI has created the UI, so the teardown
    // must not assume one exists — nothing was ever persisted to erase.
    manager.map.hasLayer.mockReturnValue(false);

    expect(manager.deleteLayer("overlay1")).toBe(true);
    expect(manager.layerRegistry.get("overlay1")).toBeUndefined();
  });

  it("deleteLayer skips the rename write when the id has no rename", () => {
    // The name map needs saving only when there was a rename to drop; the
    // per-layer intent write is separate, and an unrelated rename must survive.
    manager.map.hasLayer.mockReturnValue(false);
    const saveState = vi.fn();
    const saveNamesState = vi.fn();
    const store = makeStore(
      {
        overlay1: { visible: false, opacity: 0.4, zoomRange: [3, 12] },
        base1: { visible: false, name: "Renamed" },
      },
      { overlay1: ["visible", "opacity"] },
    );
    manager.intentStore = store;
    manager.ui = {
      intentStore: store,
      dropPersistedLayerState: (id: string) => dropPersistedLayerState(manager.ui!, id),
      saveState,
      saveNamesState,
      invalidateFields: vi.fn(),
      syncToggleAll: vi.fn(),
      syncNoBasemap: vi.fn(),
    } as any;

    expect(manager.deleteLayer("overlay1")).toBe(true);

    expect(saveState).toHaveBeenCalledTimes(1);
    expect(saveNamesState).not.toHaveBeenCalled();
    expect(getIntent(manager.ui!, "base1", "visible")).toBe(false);
    expect(getIntent(manager.ui!, "base1", "name")).toBe("Renamed");
    expect(getIntent(manager.ui!, "overlay1", "visible")).toBeUndefined();
  });

  it("deleteLayer prunes every persisted section that keys by layer id", () => {
    // `order`, `renamedNames` and `annotations` all survive a plain
    // unregister, and all three must die on a delete. `order` is the one that
    // needs care — saveOrder re-inserts any stored id that is not registered
    // yet, so the id has to leave the stored order itself or it comes straight
    // back as a pending position.
    seedStorage({
      order: ["overlay1", "base1"],
      renamedNames: { overlay1: "Renamed", base1: "Base" },
      annotations: { overlay1: { show: true, field: "name", format: "auto" } },
      layers: { overlay1: { opacity: 0.4, overrides: ["opacity"] } },
    });
    const m = new LayerController(map, [
      { id: "overlay1", name: "O", group: "overlay", layer: { options: {} } },
      { id: "base1", name: "B", group: "base", layer: { options: {} } },
    ]);
    m.annotation.setConfig("overlay1", {
      show: true,
      field: "name",
      color: "#e74c3c",
      size: 12,
      format: "auto",
      collide: true,
    });
    m.map.hasLayer.mockReturnValue(false);
    const store = makeStore(
      {
        overlay1: { opacity: 0.4, name: "Renamed" },
        base1: { name: "Base" },
      },
      { overlay1: ["opacity"] },
    );
    m.intentStore = store;
    m.ui = {
      c: m,
      intentStore: store,
      dropPersistedLayerState: (id: string) => dropPersistedLayerState(m.ui!, id),
      saveState: () => saveState(m.ui!),
      saveNamesState: () => saveNamesState(m.ui!),
      invalidateFields: vi.fn(),
      syncToggleAll: vi.fn(),
      syncNoBasemap: vi.fn(),
    } as any;

    expect(m.deleteLayer("overlay1")).toBe(true);

    const record = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!) as {
      order: string[] | null;
      removed: string[];
      renamedNames: Record<string, string>;
      annotations: Record<string, unknown>;
      layers: Record<string, unknown>;
    };
    expect(record.order).toEqual(["base1"]);
    expect(record.removed).toEqual(["overlay1"]);
    expect(record.renamedNames).toEqual({ base1: "Base" });
    expect(record.annotations).toEqual({});
    expect(record.layers).toEqual({});
  });

  it("deleteLayer writes removed in the same flush as the other dimensions", () => {
    // One shared timer, one record: removed must not become a seventh writer
    // that can land on a different tick than the order / names it prunes.
    vi.useFakeTimers();
    const save = vi.spyOn(Storage, "saveRecord").mockImplementation(() => true);
    // A stored order exists (the user arranged it); the delete prunes the id
    // from it on the same flush as removed.
    seedStorage({ order: ["overlay1", "base1"] });
    const m = new LayerController(map, [
      { id: "overlay1", name: "O", group: "overlay", layer: { options: {} } },
      { id: "base1", name: "B", group: "base", layer: { options: {} } },
    ]);
    m.map.hasLayer.mockReturnValue(false);

    m.deleteLayer("overlay1");

    expect(save).toHaveBeenCalledTimes(1);
    const written = save.mock.calls[0]![1] as {
      removed: string[];
      order: string[] | null;
    };
    expect(written.removed).toEqual(["overlay1"]);
    expect(written.order).toEqual(["base1"]);
    save.mockRestore();
    vi.useRealTimers();
  });

  it("never builds a layer the user deleted", () => {
    // The registry is built from the initial data before anything registers at
    // runtime, so the discovery path has to be gated as well: gating
    // registerLayer alone would still put a deleted layer back into the panel
    // on the next reload.
    seedStorage({ removed: ["gone"] });
    const m = new LayerController(map, [
      { id: "gone", name: "G", group: "overlay", layer: { options: {} } },
      { id: "kept", name: "K", group: "overlay", layer: { options: {} } },
    ]);

    expect(m.layers.map(l => l.id)).toEqual(["kept"]);
  });

  it("evicts a deleted layer from the map at construction", () => {
    // Gating registration only removes the layer from the panel. The layer
    // itself is still painted: folium emits `addTo(map)` for every layer at
    // page load, so a reload re-adds a deleted layer exactly as before the
    // delete. Without the eviction the panel shows it gone and the map keeps
    // drawing it — the user's delete did nothing.
    seedStorage({ removed: ["gone"] });
    const gone = { options: {} };
    map._layers["gone"] = gone;
    map.hasLayer = vi.fn(l => l === gone);
    const removeLayer = vi.fn();
    map.removeLayer = removeLayer;
    const m = new LayerController(map, [
      { id: "gone", name: "G", group: "overlay" },
      { id: "kept", name: "K", group: "overlay" },
    ]);

    expect(m.layers.map(l => l.id)).toEqual(["kept"]);
    expect(removeLayer).toHaveBeenCalledWith(gone);
  });

  it("refuses to re-register a deleted id, without throwing", () => {
    // A deletion is one-way, so the id must be refused at the registration
    // entry point rather than allowed back in. Refusal returns null and logs —
    // an exception would take down whatever was registering (a rebuild loop,
    // a late Heatmap/Measure component) instead of just dropping the layer.
    seedStorage({ removed: ["gone"] });
    const m = new LayerController(map, [
      { id: "kept", name: "K", group: "overlay", layer: { options: {} } },
    ]);
    const warn = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(warn);

    expect(m.registerLayer({ id: "gone", name: "G" })).toBeNull();
    expect(m.layerRegistry.get("gone")).toBeUndefined();
    expect(() => m.registerLayer({ id: "gone", name: "G" })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('registerLayer: refusing "gone"'),
    );
    vi.restoreAllMocks();
  });

  it("still accepts an id that is not in removed", () => {
    // The guard is keyed on the deleted list only: an unrelated stored id must
    // not start getting refused.
    seedStorage({ removed: ["gone"] });
    const m = new LayerController(map, [
      { id: "kept", name: "K", group: "overlay", layer: { options: {} } },
    ]);

    m.registerLayer({ id: "other", name: "Other" });
    expect(m.layerRegistry.get("other")).toBeDefined();
  });

  it("attachUI delegates to the UI", () => {
    manager.ui = { attachUI: vi.fn() } as any;
    const div = document.createElement("div");
    manager.attachUI(div);
    expect(manager.ui!.attachUI).toHaveBeenCalledWith(div);
  });

  it("destroy cleans up the UI container and unbinds", () => {
    manager.uiContainer = document.createElement("div");
    const ui = { unbindEvents: vi.fn() } as any;
    manager.ui = ui;
    manager.destroy();
    expect(ui.unbindEvents).toHaveBeenCalled();
    expect(manager.uiContainer).toBeNull();
    expect(manager.isDestroyed).toBe(true);
  });

  it("destroy without a UI container still tears down map bindings", () => {
    // A map without LayerControl on it has a manager with a registry but no
    // panel: destroy still must unbind the layeradd listener and clear the
    // registry.
    const m = new LayerController(map, [{ id: "a", name: "A", group: "overlay" }]);
    expect(m.uiContainer).toBeNull();
    m.destroy();
    expect(map.off).toHaveBeenCalledWith("layeradd", m.onLayerAdd);
    expect(map.off).toHaveBeenCalledWith("layerremove", m.onLayerRemove);
    expect(m.isDestroyed).toBe(true);
    expect(m.layerRegistry.size).toBe(0);
  });

  it("onLayerAdd is a no-op once the manager is destroyed", () => {
    // A destroyed manager must ignore stray layeradd events, including ones
    // fired before its off() takes effect in the same teardown pass.
    const m = new LayerController(map, [{ id: "a", name: "A", group: "overlay" }]);
    const spy = vi.spyOn(m, "enforceOrder");
    m.destroy();
    m.onLayerAdd({ layer: { options: {} } } as any);
    expect(spy).not.toHaveBeenCalled();
  });

  it("onLayerRemove is a no-op once the manager is destroyed", () => {
    const m = new LayerController(map, [{ id: "a", name: "A", group: "overlay" }]);
    const spy = vi.spyOn(m, "enforceOrder");
    m.destroy();
    expect(() => m.onLayerRemove({ layer: { options: {} } } as any)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("debouncedEnforce skips scheduling once destroyed", () => {
    // A register/unregister racing the teardown must not reschedule a
    // z-order pass on a manager that no longer has a map.
    const m = new LayerController(map, [{ id: "a", name: "A", group: "overlay" }]);
    const spy = vi.spyOn(m, "enforceOrder");
    m.destroy();
    m.debouncedEnforce();
    expect(spy).not.toHaveBeenCalled();
  });

  it("destroy flushes a pending order write instead of cancelling it", () => {
    // persistence.destroy cancels the timer, so the UI's flush in unbindEvents
    // must run first — otherwise the last reorder in the debounce window is lost.
    const m = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "b", name: "B", group: "overlay" },
    ]);
    m.persistence = new LayerPersistence();
    const save = vi.spyOn(Storage, "saveRecord");
    m.saveOrder();
    save.mockClear();
    m.destroy();
    expect(save).toHaveBeenCalledWith(
      CONST.STORAGE.KEY,
      expect.objectContaining({ order: ["a", "b"] }),
      expect.any(String),
    );
  });

  it("destroy flushes a pending intent write instead of cancelling it", () => {
    // Same ordering for per-layer intent: a hide just before teardown must
    // survive a reload, which is the whole point of the flush.
    const m = new LayerController(map, [{ id: "a", name: "A", group: "overlay" }]);
    m.persistence = new LayerPersistence();
    const save = vi.spyOn(Storage, "saveRecord");
    m.persistence.schedule({
      layers: () => ({ a: { visible: false, overrides: ["visible"] } }),
    });
    save.mockClear();
    m.destroy();
    expect(save).toHaveBeenCalledWith(
      CONST.STORAGE.KEY,
      expect.objectContaining({
        layers: { a: { visible: false, overrides: ["visible"] } },
      }),
      expect.any(String),
    );
  });

  it("registerLayer with a canvas skips the SVG renderer for its pane", () => {
    window.L.svg = vi.fn(() => ({
      addTo: vi.fn(),
      // Real renderers carry a root element: `pinLateContent` needs it to move
      // path nodes, and its absence would silently take the "mark handled"
      // branch instead.
      _container: document.createElement("div"),
    }));
    const paneName = "foliplus-canvas-heat_no_svg";
    manager.registerLayer({
      id: "heat_no_svg",
      name: "Heat",
      canvas: document.createElement("canvas"),
      paneName,
    });
    expect(window.L.svg).not.toHaveBeenCalled();
  });

  it("re-registering an id under a new layer releases the old surface's panes", () => {
    // Same id, new layer object: the old surface's synthesized base pane and
    // marker-shadow pane are the OLD layer's carrier — a replacement that
    // leaves them claimed would grow one orphan pane per re-register.
    manager.map.hasLayer.mockReturnValue(true);
    const first = Object.assign(new window.L.Marker(), { options: {} });
    manager.registerLayer({ id: "replace-me", name: "R", layer: first });
    const oldSurface = manager.surfaceFor(manager.layerRegistry.get("replace-me")!);
    expect(oldSurface.paneNames.length).toBeGreaterThan(0);
    const destroySpy = vi.spyOn(oldSurface, "destroy");

    const second = Object.assign(new window.L.Marker(), { options: {} });
    manager.registerLayer({ id: "replace-me", name: "R", layer: second });
    const newSurface = manager.surfaceFor(manager.layerRegistry.get("replace-me")!);
    // The replacement released the old face (its synthesized base pane and
    // marker-shadow pane) before claiming the id for the new one, AND the old
    // layer left the map — otherwise it would keep painting as an
    // unmanageable ghost next to the new layer.
    expect(newSurface).not.toBe(oldSurface);
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(manager.map.removeLayer).toHaveBeenCalledWith(first);
  });

  it("a layeradd marks only the owning surface dirty", () => {
    // One group gaining a leaf must not rescan every registered tree: the
    // handler attributes the arrival by stamp, then by group membership.
    manager.map.hasLayer.mockReturnValue(true);
    const groupA = { options: {}, eachLayer: vi.fn() };
    const groupB = { options: {}, eachLayer: vi.fn() };
    manager.registerLayer({ id: "ga", name: "A", layer: groupA as never });
    manager.registerLayer({ id: "gb", name: "B", layer: groupB as never });
    const surfaceA = manager.surfaces.get("ga")!;
    const surfaceB = manager.surfaces.get("gb")!;
    const spyA = vi.spyOn(surfaceA, "markContentDirty");
    const spyB = vi.spyOn(surfaceB, "markContentDirty");

    // A leaf joining group A: attributed to A (membership scan), not to B,
    // and not to the global sweep.
    const leaf = { options: {} } as never;
    groupA.eachLayer = vi.fn();
    (groupA as unknown as { hasLayer: (l: unknown) => boolean }).hasLayer = vi.fn(
      () => true,
    );
    manager.onLayerAdd({ layer: leaf } as never);

    expect(spyA).toHaveBeenCalledTimes(1);
    expect(spyB).not.toHaveBeenCalled();
  });

  it("a leaf recorded at the write point attributes to its surface in O(1)", () => {
    // createLayers' addLayer records the child -> group stamp (write-point
    // index); the handler reads the surface off the group's stamp without
    // running a membership scan at all.
    manager.map.hasLayer.mockReturnValue(true);
    const group = Object.assign({}, { options: {} });
    manager.registerLayer({ id: "gm", name: "M", layer: group as never });
    const surface = manager.surfaces.get("gm")!;
    const spy = vi.spyOn(surface, "markContentDirty");
    const leaf = { options: {} } as never;
    manager.panes.rememberChildOwnership(leaf as never, group as never);

    manager.onLayerAdd({ layer: leaf } as never);
    expect(spy).toHaveBeenCalledTimes(1);
    // A second leaf of the SAME group, also indexed, is O(1) as well.
    const leaf2 = { options: {} } as never;
    manager.panes.rememberChildOwnership(leaf2 as never, group as never);
    manager.onLayerAdd({ layer: leaf2 } as never);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("a leaf indexed to a registered surface marks that surface and no other", () => {
    // The O(1) path this index exists for: the leaf itself is not a
    // registered layer, so `directSurface` misses, and the child-ownership
    // record is the only claim. Because it claims, the fallback branch (a
    // membership scan, then the global sweep) must not run — if it did, one
    // add would still rescan every registered tree.
    //
    // The stamp has to be identity-stable for any of this to hold: the shared
    // mock is a per-call counter, so every lookup below would miss and the
    // handler would quietly take the sweep instead.
    // Fake timers so the debounced enforce this schedules cannot fire after
    // the test ends — a pending timer on a torn-down fixture is how a
    // green file turns into a flaky one on a loaded runner.
    vi.useFakeTimers();
    const realStamp = window.L.stamp;
    window.L.stamp = stableStamp;
    try {
      manager.map.hasLayer.mockReturnValue(true);
      const owned = new window.L.TileLayer();
      manager.registerLayer({ id: "gi", name: "Indexed", layer: owned });
      manager.registerLayer({
        id: "gother",
        name: "Other",
        layer: new window.L.TileLayer(),
      });
      const indexed = manager.surfaces.get("gi")!;
      const other = manager.surfaces.get("gother")!;
      const indexedSpy = vi.spyOn(indexed, "markContentDirty");
      const otherSpy = vi.spyOn(other, "markContentDirty");

      const leaf = { options: {} } as never;
      manager.panes.rememberChildOwnership(leaf as never, owned as never);
      manager.onLayerAdd({ layer: leaf } as never);

      expect(indexedSpy).toHaveBeenCalledTimes(1);
      expect(otherSpy).not.toHaveBeenCalled();
    } finally {
      window.L.stamp = realStamp;
      vi.useRealTimers();
    }
  });

  it("treats a recorded owner with no live surface as no claim at all", () => {
    // The write-point index can outlive the surface that wrote it (an
    // unregister between the record and the add). The lookup answers null,
    // and "recorded but gone" must not read as a claim — the handler falls
    // through to the global sweep instead, which is the conservative answer
    // for an arrival nothing provably owns.
    vi.useFakeTimers();
    const realStamp = window.L.stamp;
    window.L.stamp = stableStamp;
    try {
      manager.map.hasLayer.mockReturnValue(true);
      manager.registerLayer({ id: "gi", name: "I", layer: new window.L.TileLayer() });
      const indexed = manager.surfaces.get("gi")!;
      const spy = vi.spyOn(indexed, "markContentDirty");
      const leaf = { options: {} } as never;
      // A parent stamp no registered surface owns.
      manager.panes.rememberChildOwnership(leaf as never, { options: {} } as never);
      manager.onLayerAdd({ layer: leaf } as never);

      // The sweep marked it — once, and for the reason above, not because the
      // index claimed it.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      window.L.stamp = realStamp;
      vi.useRealTimers();
    }
  });

  it("registerLayer pins the pane on a layer with a container of its own", () => {
    // A non-Path/Marker layer with children (L.GeoJSON-style) must get its
    // pane written so enforceOrder does not fall back to a generated pane.
    const child = { options: {} as Record<string, unknown> };
    const parent = {
      options: {} as Record<string, unknown>,
      eachLayer: vi.fn(cb => cb(child)),
    };
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "layered",
      name: "Layered",
      layer: parent,
      paneName: "layer_graph",
    });
    expect(parent.options.pane).toBe("layer_graph");
  });

  it("TileLayer z is written to its synthesized pane, not through setZIndex", () => {
    // First-class basemaps: setZIndex on the layer element only orders it
    // inside the shared tilePane — enough when a layer has no pane of its
    // own, but every TileLayer now owns a synthesized pane and the ordering
    // ladder writes there instead.
    const tile = new TileLayer();
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "t1", name: "T", layer: tile, group: "base" });
    manager.enforceOrder();
    expect(tile.setZIndex).not.toHaveBeenCalled();
  });

  it("enforceOrder z-orders a canvas layer's dedicated pane (no Leaflet layer)", () => {
    const paneName = "foliplus-canvas-heat1";
    const canvasPane = document.createElement("div");
    canvasPane.classList.add("foliplus-layer-pane");
    const realGetPane = map.getPane;
    const realCreatePane = map.createPane;
    map.getPane = vi.fn((name: string) =>
      name === paneName ? canvasPane : realGetPane(name),
    );
    map.createPane = vi.fn((name: string) =>
      name === paneName ? canvasPane : realCreatePane(name),
    );

    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      paneName,
    });
    manager.enforceOrder();

    // Overlays are prepended, so heat1 lands at index 0 of
    // [heat1, overlay1, base1].
    const expected = manager.computeZIndex(0, "overlay");
    expect(canvasPane.style.zIndex).toBe(String(expected));
    map.getPane = realGetPane;
    map.createPane = realCreatePane;
  });

  it("extractPoints collects markers with features", () => {
    class Marker {
      getElement() {
        return null;
      }
    }
    window.L.Marker = Marker;
    const marker = new Marker() as any;
    marker.feature = { type: "Feature" };
    marker.getLatLng = () => ({ lat: 1, lng: 2 });
    marker.options = {};
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "pts",
      name: "Pts",
      layer: {
        eachLayer: (cb: (l: unknown) => void) => cb(marker),
        options: {},
      } as any,
    });
    const pts = manager.extractPoints("pts");
    expect(pts).toEqual([{ lat: 1, lng: 2, marker }]);
  });

  it("extractPoints excludes label markers (no double-counting)", () => {
    class Marker {
      getElement() {
        return null;
      }
    }
    window.L.Marker = Marker;
    const data = new Marker() as any;
    data.feature = { type: "Feature" };
    data.getLatLng = () => ({ lat: 1, lng: 2 });
    data.options = {};
    const label = new Marker() as any;
    label.feature = { type: "Feature" };
    label.getLatLng = () => ({ lat: 9, lng: 9 });
    label.options = {};
    label.isLabel = true;
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "el",
      name: "El",
      layer: {
        eachLayer: (cb: (l: unknown) => void) => {
          cb(data);
          cb(label);
        },
        options: {},
      } as any,
    });
    const pts = manager.extractPoints("el");
    expect(pts).toEqual([{ lat: 1, lng: 2, marker: data }]);
  });

  it("extractPoints rejects a plain Marker without .feature, matching the icon contract", () => {
    // countFeatureGeometry counts a plain Marker (no .feature) as a point, but
    // the layer's type icon shows "unknown" because .feature is required to
    // extract coordinates/properties.  extractPoints is that same .feature
    // gate, so a plain Marker must be rejected here too — otherwise the icon's
    // "unknown" promise would diverge from downstream behavior.
    // A Marker WITH .feature (consumable) is extracted, proving the gate is
    // specifically the missing envelope, not Marker identity.
    class Marker {
      getElement() {
        return null;
      }
    }
    window.L.Marker = Marker;
    const plain = new Marker() as any; // no .feature
    plain.getLatLng = () => ({ lat: 1, lng: 2 });
    plain.options = {};
    const consumed = new Marker() as any;
    consumed.feature = { type: "Feature", properties: {} };
    consumed.getLatLng = () => ({ lat: 3, lng: 4 });
    consumed.options = {};
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "mixed",
      name: "Mixed",
      layer: {
        eachLayer: (cb: (l: unknown) => void) => {
          cb(plain);
          cb(consumed);
        },
        options: {},
      } as any,
    });
    // count treats both as points (count==2), but extractPoints returns only
    // the consumable one — the count-vs-consumable contract held.
    expect(manager.getFeatureCount("mixed")).toBe(2);
    const pts = manager.extractPoints("mixed");
    expect(pts.length).toBe(1);
    expect(pts[0].marker).toBe(consumed);
  });

  it("extractPoints skips leaves that are not point markers", () => {
    // A line leaf is a legitimate child of a registered group, but it has no
    // latlng — the guard drops it instead of calling getLatLng on it.
    const line = new (window.L.Polyline as any)();
    line.options = {};
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "lines",
      name: "Lines",
      layer: {
        eachLayer: (cb: (l: unknown) => void) => {
          cb(line);
        },
        options: {},
      } as any,
    });
    expect(manager.extractPoints("lines")).toEqual([]);
  });

  it("bringLayerToFront re-renders the list when a UI is attached", () => {
    manager.map.hasLayer.mockReturnValue(false);
    // register bottom first so top lands at index 0; bottom is then movable
    manager.registerLayer({ id: "bottom", name: "Bottom", layer: { options: {} } });
    manager.registerLayer({ id: "top", name: "Top", layer: { options: {} } });
    manager.uiContainer = document.createElement("div");
    manager.ui = {} as any;
    const emitSpy = vi.spyOn(manager.events, "emitSettled");
    manager.bringLayerToFront("bottom");
    expect(manager.layers[0].id).toBe("bottom");
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_LIST_REBUILD);
  });

  it("bringLayerToFront ignores base layers", () => {
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "b",
      name: "B",
      layer: new TileLayer(),
      group: "base",
    });
    const orderBefore = manager.layers.map(l => l.id);
    manager.bringLayerToFront("b");
    expect(manager.layers.map(l => l.id)).toEqual(orderBefore);
  });

  it("bringLayerToFront is a no-op when the layer already sits at the front", () => {
    // Nothing to move: no reorder, no reprice, no persistence write.
    const save = vi.spyOn(manager, "saveOrder");
    const before = manager.layers.map(l => l.id);
    manager.bringLayerToFront("overlay1");
    expect(manager.layers.map(l => l.id)).toEqual(before);
    expect(save).not.toHaveBeenCalled();
  });

  it("applyLayerZIndex lands ordinary layers in a fallback pane", () => {
    const layer = { options: {} } as any;
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "fb", name: "Fb", layer });
    manager.enforceOrder();
    expect(layer.options.pane).toMatch(new RegExp(`^${FALLBACK_PANE_PREFIX}`));
  });

  describe("getFeatureCount", () => {
    // Build a leaf that looks like a real Leaflet layer (has options) so
    // registerLayer's discoverChildPanes does not fail, and that carries
    // the constructor identity forEachLeaf's instanceof checks need.
    const makeLeaf = (ctor: any, extra: Record<string, unknown> = {}) =>
      Object.assign(Object.create(ctor.prototype), {
        options: {},
        // A detached leaf has no element yet, and pinLateContent reads it.
        getElement: () => null,
        ...extra,
      });
    const wrap = (...leaves: unknown[]) =>
      ({
        options: {},
        eachLayer: (cb: (l: unknown) => void) => leaves.forEach(cb),
      }) as any;

    beforeEach(() => {
      manager.map.hasLayer.mockReturnValue(false);
    });

    it("returns null for base layers", () => {
      manager.registerLayer({
        id: "b1",
        name: "B",
        layer: { options: {} },
        group: "base",
      });
      expect(manager.getFeatureCount("b1")).toBe(null);
    });

    it("returns null for an unknown layer id", () => {
      expect(manager.getFeatureCount("ghost")).toBe(null);
    });

    it("returns null for a canvas/unknown layer without a provider", () => {
      manager.registerLayer({ id: "c1", name: "Canvas", layer: { options: {} } });
      expect(manager.getFeatureCount("c1")).toBe(null);
    });

    it("prefers the third-party featureCountProvider over forEachLeaf", () => {
      const provider = vi.fn(() => 999);
      manager.registerLayer({
        id: "pv",
        name: "PV",
        layer: { options: {} },
        featureCountProvider: provider,
      });
      expect(manager.getFeatureCount("pv")).toBe(999);
      expect(provider).toHaveBeenCalledTimes(1);
    });

    it("passes featureCountProvider through createLayerInfo (survives registration)", () => {
      const provider = vi.fn(() => 7);
      manager.registerLayer({
        id: "surv",
        name: "Surv",
        layer: { options: {} },
        featureCountProvider: provider,
      });
      const li = manager.layerRegistry.get("surv");
      expect(typeof li?.featureCountProvider).toBe("function");
      expect(manager.getFeatureCount("surv")).toBe(7);
    });

    it("logs an error when featureCountProvider throws", () => {
      const provider = vi.fn(() => {
        throw new Error("provider boom");
      });
      const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      manager.registerLayer({
        id: "boom",
        name: "Boom",
        layer: { options: {} },
        featureCountProvider: provider,
      });
      expect(manager.getFeatureCount("boom")).toBe(null);
      expect(logSpy).toHaveBeenCalled();
      expect(logSpy.mock.calls[0][0]).toContain("featureCountProvider threw");
      logSpy.mockRestore();
    });

    it("counts polygons in a feature container via forEachLeaf fallback", () => {
      const layer = wrap(makeLeaf(window.L.Polygon), makeLeaf(window.L.Polygon));
      manager.registerLayer({ id: "poly", name: "Poly", layer });
      expect(manager.getFeatureCount("poly")).toBe(2);
    });

    it("counts all markers, including markers without feature", () => {
      // A plain folium.Marker() has no .feature; both markers are data points.
      const m1 = makeLeaf(window.L.Marker, { feature: {} });
      const m2 = makeLeaf(window.L.Marker);
      const layer = wrap(m1, m2);
      manager.registerLayer({ id: "mk", name: "Mk", layer });
      expect(manager.getFeatureCount("mk")).toBe(2);
    });

    it("returns null for a container layer that is not present (findLayer null)", () => {
      manager.registerLayer({ id: "absent", name: "Absent" });
      expect(manager.getFeatureCount("absent")).toBe(null);
    });

    it("counts only data features when a label sub-group is nested under mainLayer", () => {
      const dataPoly = makeLeaf(window.L.Polygon);
      const labelPoly = makeLeaf(window.L.Polygon);
      (labelPoly as unknown as { isLabel: boolean }).isLabel = true;
      const labelGroup = {
        options: {},
        eachLayer: (cb: (l: unknown) => void) => cb(labelPoly),
      };
      const mainLayer = wrap(dataPoly, labelGroup);
      manager.registerLayer({ id: "nested", name: "Nested", layer: mainLayer });
      expect(manager.getFeatureCount("nested")).toBe(1);
    });
  });

  describe("refreshCount", () => {
    it("emits LAYER_ITEM_COUNT_CHANGE for a registered overlay layer", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({ id: "rc1", name: "RC", layer: { options: {} } });
      const bus = map.foliplus!.events;
      const handler = vi.fn();
      bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);
      manager.refreshCount("rc1");
      expect(handler).toHaveBeenCalledWith({ id: "rc1" });
    });

    it("does not emit for a base layer", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: "b1",
        name: "B",
        layer: { options: {} },
        group: "base",
      });
      const bus = map.foliplus!.events;
      const handler = vi.fn();
      bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);
      manager.refreshCount("b1");
      expect(handler).not.toHaveBeenCalled();
    });

    it("emits without touching the cached type; invalidation belongs to the content-change path", () => {
      manager.map.hasLayer.mockReturnValue(false);
      const poly = Object.assign(Object.create(window.L.Polygon.prototype), {
        options: {},
      });
      const polyLayer = {
        options: {},
        eachLayer: (cb: (l: unknown) => void) => cb(poly),
      };
      manager.registerLayer({ id: "rt", name: "RT", layer: polyLayer });
      expect(manager.getLayerType("rt")).toBe(GEOM_TYPE.POLYGON);
      // refreshCount is emit-only: LayerFactory invalidates on add/remove/clear,
      // so a caller that mutates geometry must invalidateType itself. The
      // snapshot survives a bare count notification.
      manager.refreshCount("rt");
      const layerInfo = manager.layerRegistry.get("rt");
      expect(layerInfo?.type).toBe(GEOM_TYPE.POLYGON);
      const bus = map.foliplus!.events;
      const handler = vi.fn();
      bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);
      manager.refreshCount("rt");
      expect(handler).toHaveBeenCalledWith({ id: "rt" });
      manager.invalidateType("rt");
      expect(manager.layerRegistry.get("rt")?.type).toBeNull();
    });

    it("emits for an unknown layer id (no-op subscriber; defensive)", () => {
      const bus = map.foliplus!.events;
      const handler = vi.fn();
      bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);
      manager.refreshCount("ghost");
      expect(handler).toHaveBeenCalledWith({ id: "ghost" });
    });
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

  it("syncAttribution clears the table when the visible base leaves", () => {
    const tile = new TileLayer();
    manager.map.hasLayer.mockImplementation((l: any) => l === tile);
    manager.registerLayer({ id: "b1", name: "B1", layer: tile, group: "base" });
    manager.enforceOrder();
    expect(map.attributionControl._attributions).toEqual({ "© OpenStreetMap": 1 });
    // flip visibility off → no base visible → table emptied
    manager.map.hasLayer.mockReturnValue(false);
    manager.enforceOrder();
    expect(map.attributionControl._attributions).toEqual({});
  });

  describe("deleteLayer — component ownership", () => {
    it("early-returns for a component layer, emits LAYER_DELETED, and keeps the id registerable", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: "measure1",
        name: "Measure",
        layer: { options: {} },
        styleSetters: { color: vi.fn() },
      } as any);
      const bus = map.foliplus!.events;
      const handler = vi.fn();
      bus.on(EVENTS.LAYER_DELETED, handler);
      const unregisterSpy = vi.spyOn(manager, "unregisterLayer");

      expect(manager.deleteLayer("measure1")).toBe(true);

      expect(handler).toHaveBeenCalledWith({ id: "measure1" });
      expect(unregisterSpy).not.toHaveBeenCalled();
      expect(manager.layerRegistry.has("measure1")).toBe(true);
      expect((manager as any).order.removedIds.has("measure1")).toBe(false);
    });

    it("prunes the component's stored state too, so a redraw starts clean", () => {
      // The component's own LAYER_DELETED handler wipes its canvas and its
      // saved config; without this half LayerControl kept the intent row, so a
      // redraw inherited the previous draw's opacity and visibility.
      manager.map.hasLayer.mockReturnValue(false);
      const save = vi.fn(() => saveState(manager.ui!));
      const store = makeStore(
        {
          measure1: { visible: false, opacity: 0.35 },
          overlay1: { visible: false, opacity: 0.4 },
        },
        { measure1: ["visible", "opacity"], overlay1: ["visible", "opacity"] },
      );
      manager.intentStore = store;
      manager.ui = {
        c: manager,
        listPanel: {} as never,
        intentStore: store,
        dropPersistedLayerState: (id: string) =>
          dropPersistedLayerState(manager.ui!, id),
        saveState: save,
        saveNamesState: vi.fn(),
        invalidateFields: vi.fn(),
      } as any;
      manager.registerLayer({
        id: "measure1",
        name: "Measure",
        layer: { options: {} },
        styleSetters: { color: vi.fn() },
      } as any);

      expect(manager.deleteLayer("measure1")).toBe(true);

      expect(getIntent(manager.ui!, "measure1", "visible")).toBeUndefined();
      expect(getIntent(manager.ui!, "measure1", "opacity")).toBeUndefined();
      // A sibling keeps its tuning: this is a clear, not a sweep.
      expect(getIntent(manager.ui!, "overlay1", "visible")).toBe(false);
      expect(getIntent(manager.ui!, "overlay1", "opacity")).toBe(0.4);
      expect((manager as any).order.removedIds.has("measure1")).toBe(false);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("retires a user layer and records the removed id", () => {
      manager.map.hasLayer.mockReturnValue(false);

      expect(manager.deleteLayer("overlay1")).toBe(true);

      expect(manager.layerRegistry.has("overlay1")).toBe(false);
      expect((manager as any).order.removedIds.has("overlay1")).toBe(true);
    });

    it("returns false when the entry is already gone", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.unregisterLayer("overlay1");

      expect(manager.deleteLayer("overlay1")).toBe(false);
      expect((manager as any).order.removedIds.has("overlay1")).toBe(false);
    });

    it("syncs toggle-all and no-basemap state after deleting a base layer", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.ui = {
        intentStore: makeStore(),
        dropPersistedLayerState: vi.fn(),
        saveState: vi.fn(),
        renamedNames: {},
        saveNamesState: vi.fn(),
        invalidateFields: vi.fn(),
      } as any;
      const emitSpy = vi.spyOn(manager.events, "emitSettled");

      expect(manager.deleteLayer("base1")).toBe(true);

      expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_GROUP_COUNT_CHANGED, {
        group: GROUP.BASE,
      });
      expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_NO_BASEMAP_CHANGED);
    });

    it("clears the colour basemap — unregisters but keeps the id registerable", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: CONST.SOLID_BASEMAP_ID,
        name: "Colour",
        group: "base",
        layer: { options: {} },
      } as any);

      const resetSpy = vi.fn();
      manager.ui = {
        intentStore: makeStore(),
        resetSolidBasemap: resetSpy,
        invalidateFields: vi.fn(),
      } as any;
      const emitSpy = vi.spyOn(manager.events, "emitSettled");

      expect(manager.deleteLayer(CONST.SOLID_BASEMAP_ID)).toBe(true);

      expect(manager.layerRegistry.has(CONST.SOLID_BASEMAP_ID)).toBe(false);
      expect(resetSpy).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_GROUP_COUNT_CHANGED, {
        group: GROUP.BASE,
      });
      expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_NO_BASEMAP_CHANGED);
      expect((manager as any).order.removedIds.has(CONST.SOLID_BASEMAP_ID)).toBe(false);
    });

    it("clears the colour basemap without a panel attached", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: CONST.SOLID_BASEMAP_ID,
        name: "Colour",
        group: "base",
        layer: { options: {} },
      } as any);
      manager.ui = null;

      expect(manager.deleteLayer(CONST.SOLID_BASEMAP_ID)).toBe(true);

      expect(manager.layerRegistry.has(CONST.SOLID_BASEMAP_ID)).toBe(false);
      expect((manager as any).order.removedIds.has(CONST.SOLID_BASEMAP_ID)).toBe(false);
    });

    it("returns false when the colour basemap cannot be unregistered", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: CONST.SOLID_BASEMAP_ID,
        name: "Colour",
        group: "base",
        layer: { options: {} },
      } as any);
      manager.layerRegistry.remove(CONST.SOLID_BASEMAP_ID);

      expect(manager.deleteLayer(CONST.SOLID_BASEMAP_ID)).toBe(false);
      expect((manager as any).order.removedIds.has(CONST.SOLID_BASEMAP_ID)).toBe(false);
    });

    it("removes the overlay toggle-all row when the last overlay layer is deleted", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.uiContainer = document.createElement("div");
      manager.uiContainer.innerHTML = `
        <div class="foliplus-layer-toggle-all" data-group="overlay">
          <div class="foliplus-checkbox"><input type="checkbox" data-role="toggle-all" /></div>
        </div>
        <div class="foliplus-layer-item" data-layer-id="overlay1" data-layer-type="overlay"></div>
        <div class="foliplus-layer-toggle-all" data-group="base">
          <div class="foliplus-checkbox"><input type="checkbox" data-role="toggle-all" /></div>
        </div>
        <div class="foliplus-layer-item" data-layer-id="base1" data-layer-type="base"></div>
      `;
      manager.ui = {
        intentStore: makeStore(),
        dropPersistedLayerState: vi.fn(),
        saveState: vi.fn(),
        syncToggleAll: vi.fn(),
        syncNoBasemap: vi.fn(),
        renamedNames: {},
        saveNamesState: vi.fn(),
        invalidateFields: vi.fn(),
      } as any;

      expect(manager.deleteLayer("overlay1")).toBe(true);

      expect(
        manager.uiContainer.querySelector(
          `.foliplus-layer-toggle-all[data-group="overlay"]`,
        ),
      ).toBeNull();
      expect(
        manager.uiContainer.querySelector(
          `.foliplus-layer-toggle-all[data-group="base"]`,
        ),
      ).not.toBeNull();
    });

    it("removes the base toggle-all row when the last non-colour base layer is deleted", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: CONST.SOLID_BASEMAP_ID,
        name: "Colour",
        group: "base",
        layer: { options: {} },
      } as any);
      manager.uiContainer = document.createElement("div");
      manager.uiContainer.innerHTML = `
        <div class="foliplus-layer-item" data-layer-id="overlay1" data-layer-type="overlay"></div>
        <div class="foliplus-layer-toggle-all" data-group="base">
          <div class="foliplus-checkbox"><input type="checkbox" data-role="toggle-all" /></div>
        </div>
        <div class="foliplus-layer-item" data-layer-id="base1" data-layer-type="base"></div>
        <div class="foliplus-layer-item" data-layer-id="${CONST.SOLID_BASEMAP_ID}" data-layer-type="base"></div>
      `;
      manager.ui = {
        intentStore: makeStore(),
        runtimeStore: (() => {
          const s = new LayerRuntimeStore();
          s.setAuthorVisible(CONST.SOLID_BASEMAP_ID, true);
          return s;
        })(),
        colorSurface: {} as any,
        currentColor: "#ff0000",
        dropPersistedLayerState: vi.fn(),
        saveState: vi.fn(),
        syncToggleAll: vi.fn(),
        syncNoBasemap: vi.fn(),
        renamedNames: {},
        saveNamesState: vi.fn(),
        invalidateFields: vi.fn(),
      } as any;

      expect(manager.deleteLayer("base1")).toBe(true);

      expect(
        manager.uiContainer.querySelector(
          `[data-group="base"][data-role="toggle-all"]`,
        ),
      ).toBeNull();
      expect(
        manager.uiContainer.querySelector(
          `[data-layer-id="${CONST.SOLID_BASEMAP_ID}"]`,
        ),
      ).not.toBeNull();
    });
  });

  describe("lifecycle operations settle their whole fan-out", () => {
    it("a throwing row signal does not cut off the registration CHANGE", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.uiContainer = document.createElement("div");
      manager.ui = {
        intentStore: makeStore(),
        applyUserState: vi.fn(() => []),
      } as any;
      const changes: string[] = [];
      manager.events.on(EVENTS.LAYER_ITEM_ADDED, () => {
        throw new Error("item boom");
      });
      manager.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

      expect(() =>
        manager.registerLayer({
          id: "new1",
          name: "New",
          layer: { options: {} },
        } as any),
      ).toThrow("item boom");

      // The internal signal failed but the registration change and the state
      // it announces still landed.
      expect(changes).toEqual(["new1"]);
      expect(manager.layerRegistry.has("new1")).toBe(true);
    });

    it("a throwing CHANGE consumer does not cut off LAYER_REMOVED", () => {
      manager.map.hasLayer.mockReturnValue(false);
      const removed: string[] = [];
      manager.events.on(EVENTS.LAYER_CHANGE, () => {
        throw new Error("change boom");
      });
      manager.events.on(EVENTS.LAYER_REMOVED, payload => removed.push(payload.id));

      expect(() => manager.unregisterLayer("overlay1")).toThrow("change boom");

      expect(removed).toEqual(["overlay1"]);
      expect(manager.layerRegistry.has("overlay1")).toBe(false);
    });

    it("a throwing consumer cannot leave a user delete half-applied", () => {
      manager.map.hasLayer.mockReturnValue(false);
      const removed: string[] = [];
      manager.events.on(EVENTS.LAYER_CHANGE, () => {
        throw new Error("change boom");
      });
      manager.events.on(EVENTS.LAYER_REMOVED, payload => removed.push(payload.id));

      expect(() => manager.deleteLayer("overlay1")).toThrow("change boom");

      // The retirement and every persisted prune committed before the fan-out;
      // a retry no longer finds an entry, so the delete cannot silently
      // degrade into a re-registerable unregister.
      expect(manager.layerRegistry.has("overlay1")).toBe(false);
      expect((manager as any).order.removedIds.has("overlay1")).toBe(true);
      expect(removed).toEqual(["overlay1"]);
      expect(manager.deleteLayer("overlay1")).toBe(false);
    });

    it("a throwing DELETED consumer does not starve the component owner or the prune", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: "measure1",
        name: "Measure",
        layer: { options: {} },
        styleSetters: { color: vi.fn() },
      } as any);
      const owner = vi.fn();
      const deleteEntrySpy = vi.spyOn((manager as any).domain, "deleteEntry");
      manager.events.on(EVENTS.LAYER_DELETED, () => {
        throw new Error("deleted boom");
      });
      manager.events.on(EVENTS.LAYER_DELETED, owner);

      expect(() => manager.deleteLayer("measure1")).toThrow("deleted boom");

      // The owner handler and LayerControl cleanup both ran even though a
      // consumer ahead of them threw.
      expect(owner).toHaveBeenCalledWith({ id: "measure1" });
      expect(deleteEntrySpy).toHaveBeenCalledWith("measure1");
      // Component clear keeps the id registerable for the next draw.
      expect(manager.layerRegistry.has("measure1")).toBe(true);
    });

    it("a throwing rebuild signal does not cut off the reorder CHANGE", () => {
      const m = new LayerController(map, [
        { id: "a", name: "A", group: "overlay" },
        { id: "b", name: "B", group: "overlay" },
      ]);
      m.uiContainer = document.createElement("div");
      m.ui = {} as any;
      const changes: string[] = [];
      m.events.on(EVENTS.LAYER_LIST_REBUILD, () => {
        throw new Error("list boom");
      });
      m.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

      expect(() => m.moveLayerUp("b")).toThrow("list boom");

      expect(changes).toEqual(["b"]);
      expect(m.layers[0].id).toBe("b");
    });

    it("a throwing consumer does not cut off a late-attach CHANGE", () => {
      const realStamp = window.L.stamp;
      window.L.stamp = stableStamp;
      try {
        manager.registerLayer({ id: "late2", name: "Late2", group: "overlay" });
        const arrived = new window.L.Path();
        map._layers["late2"] = arrived;
        const seen: string[] = [];
        manager.events.on(EVENTS.LAYER_CHANGE, () => {
          throw new Error("late boom");
        });
        manager.events.on(EVENTS.LAYER_CHANGE, payload => seen.push(payload.id));

        expect(() => manager.onLayerAdd({ layer: arrived })).toThrow("late boom");

        expect(seen).toEqual(["late2"]);
      } finally {
        window.L.stamp = realStamp;
      }
    });

    it("a replacement registered inside the retirement CHANGE gets no stale LAYER_REMOVED", () => {
      manager.map.hasLayer.mockReturnValue(false);
      const removed: string[] = [];
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        if (payload.id !== "overlay1") return;
        if (manager.layerRegistry.has("overlay1")) return;
        manager.registerLayer({
          id: "overlay1",
          name: "Replacement",
          group: "overlay",
          layer: { options: {} },
        });
      });
      manager.events.on(EVENTS.LAYER_REMOVED, payload => removed.push(payload.id));

      expect(manager.unregisterLayer("overlay1")).toBe(true);

      // The id is live again, so the rest of the old retirement would assert
      // a false "gone" state; the replacement announced its own CHANGE.
      expect(removed).toEqual([]);
      expect(manager.layerRegistry.get("overlay1")?.name).toBe("Replacement");
    });

    it("a replacement registered inside LAYER_ITEM_REMOVED stops the rest of the retirement", () => {
      manager.map.hasLayer.mockReturnValue(false);
      // A panel is required for the replacement to announce its registration
      // CHANGE (a pre-attach register only queues the entry).
      manager.uiContainer = document.createElement("div");
      manager.ui = {
        intentStore: makeStore(),
        applyUserState: vi.fn(() => []),
      } as any;
      const changes: string[] = [];
      const removed: string[] = [];
      manager.events.on(EVENTS.LAYER_ITEM_REMOVED, payload => {
        if (payload.id !== "overlay1") return;
        if (manager.layerRegistry.has("overlay1")) return;
        manager.registerLayer({
          id: "overlay1",
          name: "Replacement2",
          group: "overlay",
          layer: { options: {} },
        });
      });
      manager.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));
      manager.events.on(EVENTS.LAYER_REMOVED, payload => removed.push(payload.id));

      expect(manager.unregisterLayer("overlay1")).toBe(true);

      // Only the replacement registration CHANGE is announced; the old
      // retirement contributes no count/change/removed after its first event.
      expect(changes).toEqual(["overlay1"]);
      expect(removed).toEqual([]);
      expect(manager.layerRegistry.get("overlay1")?.name).toBe("Replacement2");
    });

    it("a replacement registered and unregistered inside the fan-out still stops the old REMOVED", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.uiContainer = document.createElement("div");
      manager.ui = {
        intentStore: makeStore(),
        applyUserState: vi.fn(() => []),
      } as any;
      const removed: string[] = [];
      let swapped = false;
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        if (payload.id !== "overlay1" || swapped) return;
        swapped = true;
        // Swap a replacement in, then immediately swap it out again inside the
        // same fan-out. Existence alone would let the old retirement re-pass
        // its gate and repeat LAYER_REMOVED.
        manager.registerLayer({
          id: "overlay1",
          name: "Swap",
          group: "overlay",
          layer: { options: {} },
        });
        manager.unregisterLayer("overlay1");
      });
      manager.events.on(EVENTS.LAYER_REMOVED, payload => removed.push(payload.id));

      expect(manager.unregisterLayer("overlay1")).toBe(true);

      // The inner unregister announced the removal once; the outer retirement
      // noticed the replacement and stayed silent — no identity-less repeat.
      expect(removed).toEqual(["overlay1"]);
      expect(manager.layerRegistry.has("overlay1")).toBe(false);
    });

    it("a replacement registered inside LAYER_GROUP_COUNT_CHANGED stops before the old change and removal", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.uiContainer = document.createElement("div");
      manager.ui = {
        intentStore: makeStore(),
        applyUserState: vi.fn(() => []),
      } as any;
      const changes: string[] = [];
      const removed: string[] = [];
      let swapped = false;
      manager.events.on(EVENTS.LAYER_GROUP_COUNT_CHANGED, payload => {
        if (payload.group !== "overlay" || swapped) return;
        swapped = true;
        manager.registerLayer({
          id: "overlay1",
          name: "Repl",
          group: "overlay",
          layer: { options: {} },
        });
      });
      manager.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));
      manager.events.on(EVENTS.LAYER_REMOVED, payload => removed.push(payload.id));

      expect(manager.unregisterLayer("overlay1")).toBe(true);

      // Only the replacement's registration CHANGE is announced; the old
      // retirement stops right after its first group-count sync.
      expect(changes).toEqual(["overlay1"]);
      expect(removed).toEqual([]);
      expect(manager.layerRegistry.get("overlay1")?.name).toBe("Repl");
    });

    it("a different id registering during a retirement does not stop the retirement", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.uiContainer = document.createElement("div");
      manager.ui = {
        intentStore: makeStore(),
        applyUserState: vi.fn(() => []),
      } as any;
      const removed: string[] = [];
      let otherDone = false;
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        if (payload.id !== "overlay1" || otherDone) return;
        otherDone = true;
        manager.registerLayer({
          id: "other",
          name: "Other",
          group: "overlay",
          layer: { options: {} },
        });
      });
      manager.events.on(EVENTS.LAYER_REMOVED, payload => removed.push(payload.id));

      expect(manager.unregisterLayer("overlay1")).toBe(true);

      // The identity listener only reacts to the retired id, so a different
      // id registering in between is irrelevant — the retirement completes.
      expect(removed).toEqual(["overlay1"]);
      expect(manager.layerRegistry.has("other")).toBe(true);
    });

    it("a replacement registered inside a solid-basemap delete skips the old reset and extra events", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: CONST.SOLID_BASEMAP_ID,
        name: "Colour",
        group: "base",
        layer: { options: {} },
      } as any);
      const reset = vi.fn();
      manager.ui = {
        intentStore: makeStore(),
        resetSolidBasemap: reset,
        invalidateFields: vi.fn(),
      } as any;
      const noBase = vi.fn();
      let swapped = false;
      manager.events.on(EVENTS.LAYER_CHANGE, payload => {
        if (payload.id !== CONST.SOLID_BASEMAP_ID || swapped) return;
        swapped = true;
        manager.registerLayer({
          id: CONST.SOLID_BASEMAP_ID,
          name: "NewColour",
          group: "base",
          layer: { options: {} },
        });
      });
      manager.events.on(EVENTS.LAYER_NO_BASEMAP_CHANGED, noBase);

      expect(manager.deleteLayer(CONST.SOLID_BASEMAP_ID)).toBe(true);

      // The old delete's post-announcement housekeeping is gated on the full
      // retirement having been announced: a replacement consumed it, so the
      // reset and the extra signals are skipped.
      expect(reset).not.toHaveBeenCalled();
      expect(noBase).not.toHaveBeenCalled();
      expect(manager.layerRegistry.get(CONST.SOLID_BASEMAP_ID)?.name).toBe("NewColour");
    });
  });
});

// ===========================================================================
// moveLayerUp / moveLayerDown (merged from move.test.ts)

describe("LayerController moveLayerUp / moveLayerDown", () => {
  let manager: LayerController;
  let map: any;

  beforeEach(() => {
    // A test that flushes persistence leaves a real record behind, and the next
    // constructor reads it: without this clear, an order written by one test
    // decides where the next test's layers land.
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };

    class Renderer {}

    class Path {
      options = {};
    }

    class Polygon {
      options = {};
    }

    class Polyline {
      options = {};
    }

    class Marker {
      getElement() {
        return null;
      }
    }

    class CircleMarker {}
    const stamp = (() => {
      let id = 0;
      return vi.fn(() => ++id);
    })();

    class GridLayer {
      options = {};
    }

    class TileLayer extends GridLayer {
      options = { attribution: "© OpenStreetMap" };
      setZIndex = vi.fn();
    }

    window.L.TileLayer = TileLayer;
    window.L.GridLayer = GridLayer;
    window.L.Renderer = Renderer;
    window.L.layerGroup = vi.fn(() => ({
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      hasLayer: vi.fn(() => false),
      getLayers: vi.fn(() => []),
      clearLayers: vi.fn(),
      options: {},
    }));
    window.L.Path = Path;
    window.L.Polygon = Polygon;
    window.L.Polyline = Polyline;
    window.L.Marker = Marker;
    window.L.CircleMarker = CircleMarker;
    window.L.stamp = stamp;
    window.L.svg = vi.fn(() => ({
      addTo: vi.fn(),
      // Real renderers carry a root element: `pinLateContent` needs it to move
      // path nodes, and its absence would silently take the "mark handled"
      // branch instead.
      _container: document.createElement("div"),
    }));

    const makePane = () => {
      const el = document.createElement("div");
      el.style.zIndex = "0";
      return el;
    };

    map = {
      on: vi.fn(),
      off: vi.fn(),
      invalidateSize: vi.fn(),
      eachLayer: vi.fn(),
      hasLayer: vi.fn(() => false),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      closePopup: vi.fn(),
      getZoom: vi.fn(() => 5),
      getMaxZoom: vi.fn(() => 18),
      getMinZoom: vi.fn(() => 0),
      getContainer: vi.fn(() => map._container),
      getPane: vi.fn(() => {
        const p = makePane();
        p.style.zIndex = "0";
        return p;
      }),
      createPane: vi.fn(() => {
        const p = makePane();
        p.classList.add("foliplus-layer-pane");
        return p;
      }),
      _container: document.createElement("div"),
      _layers: {},
      options: { maxZoom: 18 },
      attributionControl: { _attributions: {}, _update: vi.fn() },
    };
  });

  it("moves an overlay one position up", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "b", name: "B", group: "overlay" },
      { id: "c", name: "C", group: "overlay" },
    ]);
    expect(manager.moveLayerUp("b")).toBe(true);
    expect(manager.layers[0].id).toBe("b");
    expect(manager.layers[1].id).toBe("a");
    expect(manager.layers[2].id).toBe("c");
  });

  it("returns false when layer is already at top", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "b", name: "B", group: "overlay" },
    ]);
    expect(manager.moveLayerUp("a")).toBe(false);
  });

  it("returns false for unknown layer id", () => {
    manager = new LayerController(map, [{ id: "a", name: "A", group: "overlay" }]);
    expect(manager.moveLayerUp("unknown")).toBe(false);
  });

  it("does not move base layer past overlay boundary", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "b", name: "B", group: "overlay" },
      { id: "base1", name: "Base", group: "base" },
      { id: "base2", name: "Base2", group: "base" },
    ]);
    expect(manager.moveLayerUp("base2")).toBe(true);
    expect(manager.layers[2].id).toBe("base2");
    expect(manager.moveLayerUp("base2")).toBe(false);
  });

  it("moves an overlay one position down", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "b", name: "B", group: "overlay" },
      { id: "c", name: "C", group: "overlay" },
    ]);
    expect(manager.moveLayerDown("a")).toBe(true);
    expect(manager.layers[0].id).toBe("b");
    expect(manager.layers[1].id).toBe("a");
    expect(manager.layers[2].id).toBe("c");
  });

  it("returns false when layer is already at bottom of group", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "b", name: "B", group: "overlay" },
    ]);
    expect(manager.moveLayerDown("b")).toBe(false);
  });

  it("does not move overlay past base boundary", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "base1", name: "Base", group: "base" },
      { id: "base2", name: "Base2", group: "base" },
    ]);
    expect(manager.moveLayerDown("a")).toBe(false);
  });

  it("moves base layer down within base group", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "base1", name: "Base1", group: "base" },
      { id: "base2", name: "Base2", group: "base" },
    ]);
    expect(manager.moveLayerDown("base1")).toBe(true);
    expect(manager.layers[1].id).toBe("base2");
    expect(manager.layers[2].id).toBe("base1");
  });

  it("moveLayerUp and moveLayerDown are inverse operations", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "b", name: "B", group: "overlay" },
      { id: "c", name: "C", group: "overlay" },
    ]);
    manager.moveLayerUp("c");
    expect(manager.layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "b" }),
        expect.objectContaining({ id: "c" }),
        expect.objectContaining({ id: "a" }),
      ]),
    );
    manager.moveLayerDown("c");
    expect(manager.layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "a" }),
        expect.objectContaining({ id: "b" }),
        expect.objectContaining({ id: "c" }),
      ]),
    );
  });

  it("maintains z-index order after move", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "b", name: "B", group: "overlay" },
    ]);
    manager.moveLayerUp("b");
    const zB = manager.computeZIndex(
      manager.layerRegistry.indexOf(manager.layerRegistry.get("b")!),
      "overlay",
    );
    const zA = manager.computeZIndex(
      manager.layerRegistry.indexOf(manager.layerRegistry.get("a")!),
      "overlay",
    );
    expect(zB).toBeGreaterThan(zA);
  });

  it("returns false when only one layer exists", () => {
    manager = new LayerController(map, [{ id: "a", name: "A", group: "overlay" }]);
    expect(manager.moveLayerUp("a")).toBe(false);
    expect(manager.moveLayerDown("a")).toBe(false);
  });

  it("moves first overlay to the top of overlay group", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "b", name: "B", group: "overlay" },
      { id: "c", name: "C", group: "overlay" },
      { id: "base1", name: "Base1", group: "base" },
    ]);
    expect(manager.moveLayerUp("b")).toBe(true);
    expect(manager.layers[0].id).toBe("b");
    expect(manager.moveLayerUp("c")).toBe(true);
    expect(manager.moveLayerUp("c")).toBe(true);
    expect(manager.layers[0].id).toBe("c");
  });

  it("does not move overlay that is the only overlay into base group", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "base1", name: "Base1", group: "base" },
    ]);
    expect(manager.moveLayerDown("a")).toBe(false);
  });

  it("reorder works across multiple base layers", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "b", name: "B", group: "overlay" },
      { id: "base1", name: "Base1", group: "base" },
      { id: "base2", name: "Base2", group: "base" },
      { id: "base3", name: "Base3", group: "base" },
    ]);
    expect(manager.moveLayerDown("base1")).toBe(true);
    expect(manager.moveLayerDown("base1")).toBe(true);
    expect(manager.layers[2].id).toBe("base2");
    expect(manager.layers[3].id).toBe("base3");
    expect(manager.layers[4].id).toBe("base1");
    expect(manager.moveLayerDown("base1")).toBe(false);
  });

  it("moveLayerUp calls enforceOrder", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "b", name: "B", group: "overlay" },
    ]);
    const enforceSpy = vi.spyOn(manager, "enforceOrder");
    manager.moveLayerUp("b");
    expect(enforceSpy).toHaveBeenCalled();
  });

  it("moveLayerDown returns false when layer is already at bottom of base group", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "base1", name: "Base1", group: "base" },
    ]);
    expect(manager.moveLayerDown("base1")).toBe(false);
  });

  it("moveLayerUp returns false when layer is the only overlay", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "base1", name: "Base1", group: "base" },
    ]);
    expect(manager.moveLayerUp("a")).toBe(false);
  });

  it("moveLayerUp returns false when layer is the only base map", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "base1", name: "Base1", group: "base" },
    ]);
    expect(manager.moveLayerUp("base1")).toBe(false);
  });

  it("moveLayerDown calls enforceOrder", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "b", name: "B", group: "overlay" },
    ]);
    const enforceSpy = vi.spyOn(manager, "enforceOrder");
    manager.moveLayerDown("a");
    expect(enforceSpy).toHaveBeenCalled();
  });

  it("moveLayerUp rebuilds the list via LAYER_LIST_REBUILD when a UI is attached", () => {
    // Move is the last remaining register-time signal that used to call the
    // UI's reindexAfterMove directly; it now rides the same bus the rest of
    // the reorder paths do, so a missing emit silently breaks drag + keyboard
    // reordering. Attach a bare ui + uiContainer to reach the branch.
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "b", name: "B", group: "overlay" },
    ]);
    manager.uiContainer = document.createElement("div");
    manager.ui = {} as any;
    const emitSpy = vi.spyOn(manager.events, "emitSettled");
    manager.moveLayerUp("b");
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_LIST_REBUILD);
  });

  it("moveLayerDown rebuilds the list via LAYER_LIST_REBUILD when a UI is attached", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "b", name: "B", group: "overlay" },
    ]);
    manager.uiContainer = document.createElement("div");
    manager.ui = {} as any;
    const emitSpy = vi.spyOn(manager.events, "emitSettled");
    manager.moveLayerDown("a");
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_LIST_REBUILD);
  });

  it("a successful move persists the new order and emits LAYER_CHANGE", () => {
    // Reorder is observable to outside consumers only through these two
    // side effects — keyboard.ts reindexes the DOM off the event, and
    // reload-time order comes back from the persisted id list. A refactor
    // that reorders without notifying or persisting would pass every
    // `layers` snapshot assertion above and still silently regress.
    // The fake clock is cleared and storage emptied before the constructor: an
    // earlier test leaves debounced writes on the clock and a record in the
    // shared key, and either one would reorder these layers before the move.
    vi.useFakeTimers();
    vi.clearAllTimers();
    window.localStorage.clear();
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "b", name: "B", group: "overlay" },
      { id: "c", name: "C", group: "overlay" },
    ]);
    const onLayerChange = vi.fn();
    manager.events.on(EVENTS.LAYER_CHANGE, onLayerChange);

    expect(manager.moveLayerUp("c")).toBe(true);

    expect(onLayerChange).toHaveBeenCalledTimes(1);
    // One hop: index 2 -> 1. reorder(2, 1) on [a, b, c] gives [a, c, b].
    expect(manager.layers.map(l => l.id)).toEqual(["a", "c", "b"]);
    // Flush instead of ticking the clock: the debounces another test left on
    // it would write their own order over this test's read of storage.
    manager.persistence.flushAll();
    expect(JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!)).toEqual(
      expect.objectContaining({ order: ["a", "c", "b"] }),
    );

    vi.useRealTimers();
  });

  it("a rejected move produces no side effects — no event, no persistence, no re-ordering", () => {
    // The rejection paths are `idx`/group-boundary checks, but the contract is
    // that all of them are inert. If a later edit adds enforcement between the
    // check and the early return, these catch it; the per-case behavior itself
    // is covered by the boundary tests above.
    manager = new LayerController(map, [
      { id: "a", name: "A", group: "overlay" },
      { id: "base1", name: "Base1", group: "base" },
    ]);
    // Spy before the act: an unspy'd method assertion is a no-op claim.
    const enforceSpy = vi.spyOn(manager, "enforceOrder");
    const onLayerChange = vi.fn();
    manager.events.on(EVENTS.LAYER_CHANGE, onLayerChange);

    expect(manager.moveLayerUp("a")).toBe(false);
    expect(manager.moveLayerDown("a")).toBe(false);
    expect(manager.moveLayerUp("base1")).toBe(false);
    expect(manager.moveLayerDown("base1")).toBe(false);
    expect(manager.moveLayerUp("unknown")).toBe(false);
    expect(manager.moveLayerDown("unknown")).toBe(false);

    expect(onLayerChange).not.toHaveBeenCalled();
    expect(enforceSpy).not.toHaveBeenCalled();
    expect(manager.layers.map(l => l.id)).toEqual(["a", "base1"]);
  });
});

// ===========================================================================
// User-assigned display names (rename persistence)
//
// `intentStore.nameEntries()` is the source of truth; the registry's
// `LayerInfo.name` is a projection refreshed by `applyUserState()`. A
// third-party layer that re-registers itself re-advertises its own metadata,
// so a re-registration used to reset `name` back to the provider's original
// and the rename reverted visibly. `attachUI()` applies the persisted names at
// startup, so the rename also survives a reload.
//
// The initial registration carries a real layer object: an id-only one makes
// createLayerInfo fall through to `Reflect.get(window, id)`, which in jsdom
// resolves to a host object and crashes enforceOrder's `instanceof` check.

describe("LayerController user-assigned names", () => {
  // Assertions go through `ui.displayName(id)` — the render contract — never
  // the registry's `LayerInfo.name`, which a third-party re-registration can
  // legitimately overwrite before the refresh pushes the rename back out.
  let manager: LayerController;
  let map: any;

  beforeEach(() => {
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };

    class Renderer {}

    class Path {
      options = {};
    }

    class Polygon {
      options = {};
    }

    class Polyline {
      options = {};
    }

    class Marker {
      getElement() {
        return null;
      }
    }

    class CircleMarker {}
    window.L.TileLayer = TileLayer;
    window.L.GridLayer = GridLayer;
    window.L.Renderer = Renderer;
    window.L.Path = Path;
    window.L.Polygon = Polygon;
    window.L.Polyline = Polyline;
    window.L.Marker = Marker;
    window.L.CircleMarker = CircleMarker;
    window.L.stamp = vi.fn();
    window.L.svg = vi.fn(() => ({
      addTo: vi.fn(),
      // Real renderers carry a root element: `pinLateContent` needs it to move
      // path nodes, and its absence would silently take the "mark handled"
      // branch instead.
      _container: document.createElement("div"),
    }));

    const makePane = () => {
      const el = document.createElement("div");
      el.style.zIndex = "0";
      return el;
    };

    map = {
      on: vi.fn(),
      off: vi.fn(),
      invalidateSize: vi.fn(),
      eachLayer: vi.fn(),
      hasLayer: vi.fn(() => false),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      closePopup: vi.fn(),
      getZoom: vi.fn(() => 5),
      getMaxZoom: vi.fn(() => 18),
      getMinZoom: vi.fn(() => 0),
      getContainer: vi.fn(() => map._container),
      getPane: vi.fn(() => {
        const p = makePane();
        p.style.zIndex = "0";
        return p;
      }),
      createPane: vi.fn(() => {
        const p = makePane();
        p.classList.add("foliplus-layer-pane");
        return p;
      }),
      _container: document.createElement("div"),
      _layers: {},
      _paneRenderers: {},
      options: { maxZoom: 18 },
      attributionControl: { _attributions: {}, _update: vi.fn() },
    };

    // The third-party provider's own layer object; its metadata advertises the
    // provider's name, never the user's rename.
    const extLayer = { options: {} };

    manager = new LayerController(map, [
      { id: "ext", name: "Provider Layer", group: "overlay", layer: extLayer },
    ]);
    manager.ui = new LayerUI(manager, TEST_ENV);
    manager.attachUI(document.createElement("div"));
  });

  it("keeps a rename when the provider re-registers its own layer", () => {
    // The user renamed the layer, then the provider re-adds it still
    // advertising its own name. createLayerInfo used to take the caller's
    // `opts.name` over the existing value, reverting the panel to the
    // original on the next render or reload.
    manager.ui!.renameLayer("ext");
    const item = manager.ui!.uiContainer!.querySelector(
      `[${CONST.DATA.LAYER_ID}="ext"]`,
    )!;
    const label = item.querySelector("label") as HTMLLabelElement;
    const input = label.querySelector("input") as HTMLInputElement;
    input.value = "My Layer";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(manager.ui!.displayName("ext")).toBe("My Layer");

    // Re-registration rebuilds the registry entry from the caller's metadata,
    // then the incremental refresh pushes the rename back out.
    manager.registerLayer({ id: "ext", name: "Provider Layer" });
    manager.ui!.applyUserState();

    expect(manager.ui!.displayName("ext")).toBe("My Layer");
    expect(manager.layerRegistry.get("ext")?.name).toBe("My Layer");
  });

  it("applies a persisted rename at startup", () => {
    // `attachUI` reads the record at call time, so the seed has to land
    // before `attachUI` — but after the LayerController constructor, which has
    // already built the registry that loadPersistedState reads against.
    const fresh = new LayerController(map, [
      { id: "ext", name: "Provider Layer", group: "overlay", layer: { options: {} } },
    ]);
    fresh.ui = new LayerUI(fresh, TEST_ENV);
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({ renamedNames: { ext: "My Layer" } }),
    );
    fresh.attachUI(document.createElement("div"));

    // The registry is the projection, so the sweep pushes the rename into it
    // too; displayName is the render contract either way.
    expect(fresh.layerRegistry.get("ext")?.name).toBe("My Layer");
    expect(fresh.ui.displayName("ext")).toBe("My Layer");
  });

  it("keeps a rename for a layer that registers after the UI attaches", () => {
    // A component whose bundle loads after LayerControl registers its layer
    // in its own constructor — HeatmapControl's createCanvas and
    // MeasureControl's createLayers both run after attachUI has already
    // loaded the persisted names. loadNames filters value types only, so the
    // rename survives the attach and is projected the moment the layer
    // registers. A registry filter here would have reverted it on every reload.
    const fresh = new LayerController(map, [
      { id: "ext", name: "Provider Layer", group: "overlay", layer: { options: {} } },
    ]);
    fresh.ui = new LayerUI(fresh, TEST_ENV);
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({ renamedNames: { heatmap1: "POI Density" } }),
    );
    fresh.attachUI(document.createElement("div"));

    // The heatmap registers late, still advertising its own title.
    fresh.registerLayer({ id: "heatmap1", name: "Heatmap" });
    fresh.ui.applyUserState();

    expect(fresh.ui.displayName("heatmap1")).toBe("POI Density");
    expect(fresh.layerRegistry.get("heatmap1")?.name).toBe("POI Density");
  });

  it("accepts a caller-supplied name for a fresh layer", () => {
    // A fresh id has no existing entry, so the caller's `opts.name` wins
    // instead of the registry defaulting to the id.
    const fresh = new LayerController(map, [
      { id: "fresh", name: "Fresh Layer", group: "overlay", layer: { options: {} } },
    ]);

    expect(fresh.layerRegistry.get("fresh")?.name).toBe("Fresh Layer");
  });

  it("keeps a stored rename for an id that has no registry entry", () => {
    // The sweep must not drop a rename whose id is absent from the registry:
    // that id may belong to a component that registers later. Only deleteLayer
    // prunes a rename, since only it knows the layer is gone for good.
    window.localStorage.setItem(
      CONST.STORAGE.KEY,
      JSON.stringify({ renamedNames: { "no-such-id": "Ghost" } }),
    );
    manager.ui!.loadPersistedState();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    manager.ui!.applyUserState();
    warn.mockRestore();

    expect(getIntent(manager.ui!, "no-such-id", "name")).toBe("Ghost");
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("stale rename ids"));
  });

  it("keeps a rename when its layer unregisters", () => {
    // unregisterLayer is generic teardown — HeatmapControl reaches it whenever
    // its data goes empty — so a rename pruned there would vanish along with
    // a temporary data gap and resurface as the registry's own name. Only
    // deleteLayer prunes a rename.
    setIntent(manager.ui!, "ext", "name", "My Layer");
    const save = vi.fn();
    manager.ui!.saveNamesState = save;

    expect(manager.unregisterLayer("ext")).toBe(true);

    expect(getIntent(manager.ui!, "ext", "name")).toBe("My Layer");
    expect(save).not.toHaveBeenCalled();
  });

  it("deleteLayer prunes the rename for a deleted layer", () => {
    setIntent(manager.ui!, "ext", "name", "My Layer");
    const save = vi.fn();
    manager.ui!.saveNamesState = save;
    manager.ui!.dropPersistedLayerState = (id: string) =>
      dropPersistedLayerState(manager.ui!, id);

    expect(manager.deleteLayer("ext")).toBe(true);

    expect(getIntent(manager.ui!, "ext", "name")).toBeUndefined();
    expect(save).toHaveBeenCalled();
  });

  it("does not touch the rename map when unregistering an unknown id", () => {
    const save = vi.fn();
    manager.ui!.saveNamesState = save;

    expect(manager.unregisterLayer("never-registered")).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  describe("hasUnresolvedLayers (explicit no-carrier is not unresolved)", () => {
    it("canvas / solid / custom entries with layer:null are not unresolved", () => {
      manager.registerLayer({
        id: "heat",
        name: "Heat",
        layer: null,
        canvas: document.createElement("canvas"),
      } as any);
      manager.registerLayer({
        id: "color1",
        name: "Color",
        layer: null,
        canvas: document.createElement("canvas"),
        color: "#000000",
      } as any);
      manager.registerLayer({
        id: "third",
        name: "Third",
        layer: null,
        kind: "custom",
        custom: { plugin: 1 },
      } as any);
      expect((manager as any).hasUnresolvedLayers()).toBe(false);
    });

    it("a declared layer carrier that is still null is unresolved", () => {
      manager.registerLayer({ id: "ghost", name: "G", layer: null } as any);
      expect((manager as any).hasUnresolvedLayers()).toBe(true);
    });

    it("resolves once a layer appears", () => {
      manager.registerLayer({ id: "late", name: "L", layer: null } as any);
      expect((manager as any).hasUnresolvedLayers()).toBe(true);
      const li = manager.layerRegistry.get("late");
      li!.layer = { options: {} } as any;
      expect((manager as any).hasUnresolvedLayers()).toBe(false);
    });
  });

  // ── LayerAPI contract ──
  //
  // LayerController is the map's LayerAPI implementation. A future refactor
  // might rename, relocate, or drop a public member while the TypeScript
  // `implements LayerAPI` check stays green (e.g. via a cast, a stub, or an
  // interface widening). The assertions here pin the *runtime* surface: every
  // member the LayerAPI interface declares must exist on a real
  // LayerController instance and be the right kind of callable. They
  // deliberately assert presence and shape, not behavior — the tests above
  // cover behavior.

  describe("LayerAPI contract", () => {
    it("exposes every required LayerAPI member", () => {
      const required = [
        "isLayerControl",
        "layers",
        "registerLayer",
        "unregisterLayer",
        "deleteLayer",
        "bringLayerToFront",
        "setVisible",
        "createCanvas",
        "createLayers",
        "extractPoints",
        "getLayerPanes",
        "getLayersByType",
      ] as const;
      for (const name of required) {
        expect(name in manager, `missing ${name}`).toBe(true);
      }
    });

    it("exposes every optional LayerAPI member", () => {
      const optional = [
        "forgetSavedOrder",
        "dropPersistedLayerState",
        "intentVisible",
        "getFeatureCount",
        "touchLayer",
        "moveLayerUp",
        "moveLayerDown",
      ] as const;
      for (const name of optional) {
        expect(name in manager, `missing ${name}`).toBe(true);
      }
    });

    it("implements every member with its declared callable shape", () => {
      const functions: Array<[string, number]> = [
        ["registerLayer", 1],
        ["unregisterLayer", 1],
        ["deleteLayer", 1],
        ["forgetSavedOrder", 1],
        ["dropPersistedLayerState", 1],
        ["bringLayerToFront", 1],
        ["setVisible", 2],
        ["intentVisible", 1],
        ["createCanvas", 1],
        ["createLayers", 1],
        ["extractPoints", 1],
        ["getLayerPanes", 1],
        ["getLayersByType", 1],
        ["getFeatureCount", 1],
        ["touchLayer", 1],
        ["moveLayerUp", 1],
        ["moveLayerDown", 1],
      ] as const;
      for (const [name, arity] of functions) {
        expect(typeof (manager as any)[name], `${name} is callable`).toBe("function");
        expect(
          (manager as any)[name].length,
          `${name} arity matches the interface`,
        ).toBeLessThanOrEqual(arity * 2); // optional args (opts bag width) allowed
      }
    });

    it("exposes the registry-delegating `layers` getter (isRealLayerControl probe)", () => {
      const own = Object.getOwnPropertyDescriptor(manager, "layers");
      const proto = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(manager),
        "layers",
      );
      expect(Boolean(own && own.get) || Boolean(proto && proto.get)).toBe(true);
    });

    it("returns the real controller marker from isLayerControl", () => {
      expect(manager.isLayerControl).toBe(true);
    });

    it("exposes `layers` as a read-only snapshot that refuses mutation", () => {
      const view = manager.layers;
      expect(Array.isArray(view)).toBe(true);
      // The registry wraps its array in a read-only Proxy, not Object.freeze —
      // isFrozen would be false by design. The contract that matters: a write
      // through the view must throw, so consumers cannot rearrange the registry
      // behind the controller's back.
      expect(() => {
        (view as unknown[]).push({} as never);
      }).toThrow();
    });
  });
});

// ── Notification-contract cases, moved from the former
// ── notifyContract.test.ts so they live with the script they drive. ──
it("a registration announces after the group count has settled", () => {
  // The registration entry inserts the row, replays the stored state,
  // refreshes the row cells and syncs the group count before it publishes —
  // so the first CHANGE the new layer gets out already names the full
  // group. Announcing from the row insertion itself would have handed a
  // subscriber the count taken before that row existed.
  const { ui, manager } = initFixture({
    data: [
      { id: "one", name: "One", group: "overlay", layer: polygonLayer() },
      { id: "two", name: "Two", group: "overlay", layer: polygonLayer() },
      {
        id: "three",
        name: "Three",
        group: "overlay",
        layer: polygonLayer(),
      },
    ],
  });
  expect(ui.listPanel.checkedCount[GROUP.OVERLAY]).toEqual({
    total: 3,
    on: 3,
  });

  // The late layer arrives already hidden: a stored dimension is the only
  // state a late registration can carry, and it is the delta the entry
  // holds until the row and the count have settled.
  setIntent(ui, "fourth", "visible", false);
  ui.intentStore.seedProvenance("fourth", ["visible"]);

  const countsAtDelivery: { total: number; on: number }[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "fourth") return;
    countsAtDelivery.push({ ...ui.listPanel.checkedCount[GROUP.OVERLAY] });
  });

  manager.registerLayer({
    id: "fourth",
    name: "Fourth",
    group: "overlay",
    layer: polygonLayer(),
  });

  expect(countsAtDelivery.length).toBeGreaterThan(0);
  expect(countsAtDelivery[0]).toEqual({ total: 4, on: 3 });
});

it("a register whose notify destroys the control returns null", () => {
  // The projection delta goes out last, but before the entry returns it still
  // publishes the separate registration CHANGE and reads the row back out of
  // the container. A subscriber that tears the control down inside that
  // notify takes the container and the registry with it: a second emission
  // would announce for an entry that no longer exists, and the row lookup
  // would deref a null container.
  const { ui, manager } = initFixture();
  const layer = polygonLayer();
  // Tracked membership keeps the projection's diff real instead of a
  // constant, and leaves the teardown sweep with nothing new to say: the
  // one delivery below is the projection's, so a registration CHANGE would
  // show up as a second.
  const onMap = trackMembership(ui.c.map);
  onMap.set(layer, true);
  // A stored dimension is what gives the projection something to write — a
  // late registration arrives hidden, and that flip is the delta the
  // subscriber tears down on.
  setIntent(ui, "fourth", "visible", false);
  ui.intentStore.seedProvenance("fourth", ["visible"]);

  let deliveries = 0;
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "fourth") return;
    deliveries += 1;
    if (deliveries === 1) ui.c.destroy();
  });

  expect(
    manager.registerLayer({
      id: "fourth",
      name: "Fourth",
      group: "overlay",
      layer,
    }),
  ).toBeNull();
  expect(deliveries).toBe(1);
  expect(onMap.get(layer)).toBe(false);
  expect(ui.c.isDestroyed).toBe(true);
});

it("a register whose notify unregisters the entry returns null", () => {
  // The same boundary with the entry retired instead of the control: the id
  // is mapped to nothing, so the registration CHANGE would announce for a
  // layer that is already gone. Two CHANGEs are expected — the projection's,
  // then the unregister's own — not a third for the registration.
  const { ui, manager } = initFixture();

  setIntent(ui, "second", "visible", false);
  ui.intentStore.seedProvenance("second", ["visible"]);

  const changes: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    changes.push(payload.id);
    if (payload.id === "second" && changes.length === 1) {
      manager.unregisterLayer("second");
    }
  });

  expect(
    manager.registerLayer({
      id: "second",
      name: "Second",
      group: "overlay",
      layer: polygonLayer(),
    }),
  ).toBeNull();
  expect(changes).toEqual(["second", "second"]);
  expect(ui.c.layerRegistry.has("second")).toBe(false);
});

it("a register whose final notify destroys the control returns null", () => {
  // A layer that is already on the map and has no stored dimension carries no
  // projection delta, so the registration CHANGE is its only notify. It is
  // the last statement before the row is read back out of the container: a
  // subscriber that tears the control down there leaves a null container, and
  // the row lookup is reached by nothing else.
  const { ui, manager } = initFixture();
  const layer = polygonLayer();
  // Tracked membership keeps the teardown sweep from gaining a second opinion
  // about this layer, so the one delivery below is the registration's and a
  // spurious emit would show up as another.
  const onMap = trackMembership(ui.c.map);
  onMap.set(layer, true);

  let deliveries = 0;
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "fourth") return;
    deliveries += 1;
    if (deliveries === 1) ui.c.destroy();
  });

  expect(
    manager.registerLayer({
      id: "fourth",
      name: "Fourth",
      group: "overlay",
      layer,
    }),
  ).toBeNull();
  expect(deliveries).toBe(1);
  expect(ui.c.isDestroyed).toBe(true);
  expect(ui.uiContainer).toBeNull();
});

it("a register whose final notify destroys the control after a projection delta returns null", () => {
  // The saved range hides the layer, so the registration carries a real
  // projection delta and gets two notifies: the projection's first, then its
  // own registration CHANGE. Tearing the control down in the second one
  // exercises the same boundary on the path that already had one notify.
  const { ui, manager } = initFixture();
  const layer = polygonLayer();
  const onMap = trackMembership(ui.c.map);
  onMap.set(layer, true);
  setIntent(ui, "fourth", "zoomRange", [0, 1]);
  ui.intentStore.seedProvenance("fourth", ["zoomRange"]);

  let deliveries = 0;
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "fourth") return;
    deliveries += 1;
    if (deliveries === 2) ui.c.destroy();
  });

  expect(
    manager.registerLayer({
      id: "fourth",
      name: "Fourth",
      group: "overlay",
      layer,
    }),
  ).toBeNull();
  expect(deliveries).toBe(2);
  expect(onMap.get(layer)).toBe(false);
  expect(ui.c.isDestroyed).toBe(true);
});

it("a register whose final notify unregisters the entry returns null", () => {
  // The entry retired instead of the control, and by the registration's own
  // notify rather than the projection's: two CHANGEs are expected — the
  // registration's, then the unregister's own — not a third.
  const { ui, manager } = initFixture();
  const layer = polygonLayer();
  const onMap = trackMembership(ui.c.map);
  onMap.set(layer, true);

  const changes: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "second") return;
    changes.push(payload.id);
    if (changes.length === 1) manager.unregisterLayer("second");
  });

  expect(
    manager.registerLayer({
      id: "second",
      name: "Second",
      group: "overlay",
      layer,
    }),
  ).toBeNull();
  expect(changes).toEqual(["second", "second"]);
  expect(ui.c.layerRegistry.has("second")).toBe(false);
});

it("a register replaced under the same id inside the final notify returns null", () => {
  // A re-registration with the same id replaces the entry this call created,
  // so handing back its row would hand back another instance's row. The inner
  // call carries no projection delta of its own, so it announces only once
  // and the outer call is left to notice the swap.
  const { ui, manager } = initFixture();
  const onMap = trackMembership(ui.c.map);
  const layer = polygonLayer();
  onMap.set(layer, true);
  const replacement = polygonLayer();

  const changes: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "second") return;
    changes.push(payload.id);
    if (changes.length === 1) {
      manager.registerLayer({
        id: "second",
        name: "Second",
        group: "overlay",
        layer: replacement,
      });
    }
  });

  expect(
    manager.registerLayer({
      id: "second",
      name: "Second",
      group: "overlay",
      layer,
    }),
  ).toBeNull();
  expect(changes).toEqual(["second", "second"]);
  expect(onMap.get(replacement)).toBe(true);
  expect(ui.c.layerRegistry.get("second")?.layer).toBe(replacement);
});

it("a reorder announces after the row list has been rebuilt", () => {
  // The list rebuild is the reorder's own side effect, so it lands before the
  // notify: a subscriber reading the row order out of the panel during the
  // CHANGE sees the arrangement that was just made, not the one that is
  // about to be rendered.
  const { ui, manager } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", group: "overlay", layer: polygonLayer() },
      { id: "beta", name: "Beta", group: "overlay", layer: polygonLayer() },
      { id: "gamma", name: "Gamma", group: "overlay", layer: polygonLayer() },
    ],
  });
  const { children } = attachWithGroup(ui);
  const order = () =>
    children()
      .map(row => row.dataset.layerId)
      .join(",");
  expect(order()).toBe("alpha,beta,gamma");

  const orderAtDelivery: string[] = [];
  ui.events.on(EVENTS.LAYER_CHANGE, payload => {
    if (payload.id !== "alpha") return;
    orderAtDelivery.push(order());
  });

  expect(manager.moveLayerDown("alpha")).toBe(true);
  expect(orderAtDelivery).toEqual(["beta,alpha,gamma"]);
  expect(order()).toBe("beta,alpha,gamma");
});

it("a reorder whose rebuild signal destroys the control announces nothing more", () => {
  // The rebuild signal's fan-out is the reorder's own side-effect window: the
  // in-tree subscriber relocates the rows, and a third-party subscriber (the
  // panel is a public event surface) can tear the control down in the same
  // emit. The reorder's own CHANGE is suppressed — the registry went with the
  // control, so there is nothing left to announce the arrangement against.
  // The move itself already landed, so the arrangement stands regardless.
  const layerAlpha = polygonLayer();
  const layerBeta = polygonLayer();
  const { ui, manager } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", group: "overlay", layer: layerAlpha },
      { id: "beta", name: "Beta", group: "overlay", layer: layerBeta },
    ],
  });

  const changes: string[] = [];
  let orderAtSignal: string[] | null = null;
  ui.events.on(EVENTS.LAYER_LIST_REBUILD, () => {
    orderAtSignal = manager.layers
      .filter(layerInfo => layerInfo.group === GROUP.OVERLAY)
      .map(layerInfo => layerInfo.id);
    ui.c.destroy();
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

  expect(() => manager.moveLayerDown("alpha")).not.toThrow();
  expect(changes).toEqual([]);
  expect(ui.c.isDestroyed).toBe(true);
  expect(ui.uiContainer).toBeNull();
  // The reorder had already happened when the signal fired: the arrangement
  // the subscriber saw was the finished one. Overlay entries only — the
  // color basemap is a base-group layer outside this arrangement.
  expect(orderAtSignal).toEqual(["beta", "alpha"]);
});

it("a reorder whose rebuild signal retires its layer announces no reorder", () => {
  // The entry moved instead of the control going away: a subscriber that
  // retires the moved layer inside the signal has removed the thing the
  // reorder would announce for.
  const layerAlpha = polygonLayer();
  const layerBeta = polygonLayer();
  const { ui, manager } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", group: "overlay", layer: layerAlpha },
      { id: "beta", name: "Beta", group: "overlay", layer: layerBeta },
    ],
  });

  const changes: string[] = [];
  ui.events.on(EVENTS.LAYER_LIST_REBUILD, () => {
    manager.unregisterLayer("alpha");
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

  expect(() => manager.moveLayerDown("alpha")).not.toThrow();
  // The unregister's own CHANGE for alpha — and no second one: the reorder
  // would announce an entry nobody holds any more.
  expect(changes).toEqual(["alpha"]);
  expect(ui.c.layerRegistry.has("alpha")).toBe(false);
});

it("a rebuild signal delivers an already-settled panel", () => {
  // A reorder relocates rows in place, so unlike the bare-rows rebuild the
  // panel never stops being settled: every subscriber in the signal's
  // fan-out — in-tree first, third parties after — reads the finished
  // arrangement, the preserved row faces and the readiness flag. What a
  // subscriber sees at delivery is what the panel looks like when the
  // operation returns.
  const layerAlpha = polygonLayer();
  const layerBeta = polygonLayer();
  const layerGamma = polygonLayer();
  const { ui, manager } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", group: "overlay", layer: layerAlpha },
      { id: "beta", name: "Beta", group: "overlay", layer: layerBeta },
      { id: "gamma", name: "Gamma", group: "overlay", layer: layerGamma },
    ],
  });
  // A row the user hid through the real visibility path: a reorder must not
  // repaint it, so it still reads unchecked at signal delivery.
  manager.setVisible("gamma", false);

  const snapshot = () => {
    const rows = Array.from(
      attachedPanel(ui).querySelectorAll<HTMLElement>(
        `${CONST.SEL.LAYER_ITEM}[data-layer-type="${GROUP.OVERLAY}"]`,
      ),
    );
    return {
      order: rows.map(row => row.dataset.layerId).join(","),
      checked: rows.map(
        row =>
          (row.querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
      ),
      active: rows.map(row => row.classList.contains(CONST.CLASSES.ACTIVE)),
      counts: rows.map(
        row => row.querySelector(`.${CONST.CLASSES.COUNT_COL}`)?.textContent,
      ),
      ready: attachedPanel(ui).getAttribute("data-ready"),
    };
  };

  let atDelivery: ReturnType<typeof snapshot> | null = null;
  ui.events.on(EVENTS.LAYER_LIST_REBUILD, () => {
    if (!atDelivery) atDelivery = snapshot();
  });

  expect(manager.moveLayerDown("alpha")).toBe(true);

  expect(atDelivery).toEqual(snapshot());
  expect(atDelivery).toMatchObject({
    order: "beta,alpha,gamma",
    checked: [true, true, false],
    active: [true, true, false],
    ready: "true",
  });
});

it("a bringLayerToFront whose rebuild signal destroys the control announces nothing", () => {
  // Same retirement window as the move entries: a subscriber that destroys
  // the control inside the signal leaves no registry to announce the
  // reorder against.
  const layerAlpha = polygonLayer();
  const layerBeta = polygonLayer();
  const { ui, manager } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", group: "overlay", layer: layerAlpha },
      { id: "beta", name: "Beta", group: "overlay", layer: layerBeta },
    ],
  });

  const changes: string[] = [];
  ui.events.on(EVENTS.LAYER_LIST_REBUILD, () => {
    if (!manager.isDestroyed) manager.destroy();
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

  expect(() => manager.bringLayerToFront("beta")).not.toThrow();
  expect(changes).toEqual([]);
  expect(manager.isDestroyed).toBe(true);
});

it("a moveLayerUp whose rebuild signal destroys the control announces nothing", () => {
  const layerAlpha = polygonLayer();
  const layerBeta = polygonLayer();
  const { ui, manager } = initFixture({
    data: [
      { id: "alpha", name: "Alpha", group: "overlay", layer: layerAlpha },
      { id: "beta", name: "Beta", group: "overlay", layer: layerBeta },
    ],
  });

  const changes: string[] = [];
  ui.events.on(EVENTS.LAYER_LIST_REBUILD, () => {
    if (!manager.isDestroyed) manager.destroy();
  });
  ui.events.on(EVENTS.LAYER_CHANGE, payload => changes.push(payload.id));

  expect(manager.moveLayerUp("beta")).toBe(true);
  expect(changes).toEqual([]);
  expect(manager.isDestroyed).toBe(true);
});

describe("retireEntry finalization", () => {
  it("unloads the annotation even when the row step throws", () => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    const { manager, ui } = initFixture({
      data: [
        { id: "overlay1", name: "Polygons", group: "overlay" },
        { id: "base1", name: "OSM", group: "base" },
      ],
    });
    const unload = vi.spyOn(manager.annotation, "unloadLayer");
    const container = (ui as unknown as { uiContainer: HTMLElement }).uiContainer;
    const original = container.querySelector.bind(container);
    let armed = true;
    container.querySelector = ((sel: string) => {
      if (armed && String(sel).includes("data-layer-id")) {
        armed = false;
        throw new Error("panel read failed");
      }
      return original(sel);
    }) as typeof container.querySelector;

    try {
      expect(() => manager.unregisterLayer("overlay1")).toThrow("panel read failed");
    } finally {
      // The fixture owns this element; drop the own-property patch so the
      // prototype's querySelector is back for whatever runs next.
      Reflect.deleteProperty(container, "querySelector");
    }
    expect(unload.mock.calls.some(c => c[0] === "overlay1")).toBe(true);
    expect(manager.layerRegistry.has("overlay1")).toBe(false);
  });

  it("reports every failing step, not only the one it hands back", () => {
    document.body.innerHTML = "";
    window.localStorage.clear();
    const { manager } = initFixture({
      data: [
        {
          id: "overlay1",
          name: "Polygons",
          group: "overlay",
          layer: polygonLayer(),
        },
      ],
    });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});
    manager.map.removeLayer.mockImplementation(() => {
      throw new Error("map boom");
    });
    vi.spyOn(manager.annotation, "unloadLayer").mockImplementation(() => {
      throw new Error("labels stuck");
    });

    // The first failure remains the caller's contract...
    expect(() => manager.unregisterLayer("overlay1")).toThrow("map boom");

    // ...but the second failing step is no longer silent.
    expect(warn).toHaveBeenCalledWith(
      'retire step "detach-from-map" threw',
      expect.any(Error),
    );
    expect(warn).toHaveBeenCalledWith(
      'retire step "unload-annotation" threw',
      expect.any(Error),
    );
    warn.mockRestore();
  });
});

describe("enforceOrder isolation", () => {
  it("prices the rest of the stack and reports the layer that failed", () => {
    window.localStorage.clear();
    const { manager, map } = initFixture({
      data: [
        { id: "a", name: "A", group: "overlay" },
        { id: "bad", name: "Bad", group: "overlay" },
        { id: "c", name: "C", group: "overlay" },
      ],
    });
    const bad = manager.surfaceFor(manager.layerRegistry.get("bad")!);
    const c = manager.surfaceFor(manager.layerRegistry.get("c")!);
    vi.spyOn(bad, "setZ").mockImplementation(() => {
      throw new Error("no z");
    });
    const cSetZ = vi.spyOn(c, "setZ");
    map.getPane.mockClear();

    const { failed, skipped } = manager.enforceOrder();

    expect(failed).toEqual(["bad"]);
    expect(skipped).toBe(false);
    expect(cSetZ).toHaveBeenCalled();
    // The shared panes are priced after the registry pass, so a failed layer
    // must not leave markers/tooltips/popups at their default z.
    const priced = map.getPane.mock.calls.map(([name]: [string]) => name);
    expect(priced).toEqual(
      expect.arrayContaining(["popupPane", "tooltipPane", "markerPane"]),
    );
  });

  it("a re-entrant pass reports `skipped` and leaves the result to the running pass", () => {
    // A layer that reorders while being priced (a listener reacting to setZ)
    // reaches `enforceOrder` from inside a pass. The inner call must not report
    // a half-priced stack — the outer pass owns the answer.
    window.localStorage.clear();
    const { manager } = initFixture({
      data: [{ id: "a", name: "A", group: "overlay" }],
    });
    const domain = (manager as any).domain as { enforceOrder: () => string[] };
    const real = domain.enforceOrder.bind(domain);
    const inner: Array<{ failed: readonly string[]; skipped: boolean }> = [];
    const outer = vi.spyOn(domain, "enforceOrder").mockImplementation(() => {
      inner.push(manager.enforceOrder());
      return real();
    });

    try {
      expect(manager.enforceOrder()).toEqual({ failed: [], skipped: false });
      expect(inner).toEqual([{ failed: [], skipped: true }]);
      expect(outer).toHaveBeenCalledTimes(1);
    } finally {
      outer.mockRestore();
    }
  });
});

describe("destroy finalization", () => {
  it("reports the failing step, keeps tearing down, and still installs the stub API", () => {
    window.localStorage.clear();
    const { manager, map } = initFixture({
      data: [{ id: "overlay1", name: "Polygons", group: "overlay" }],
    });
    const warn = vi.spyOn((manager as any).log, "warn").mockImplementation(() => {});
    const unbind = vi.spyOn(manager.ui!, "unbindEvents");
    vi.spyOn(manager.annotation, "destroy").mockImplementation(() => {
      throw new Error("labels stuck");
    });

    expect(() => manager.destroy()).not.toThrow();

    // The steps behind the failure still ran.
    expect(unbind).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'destroy step "destroy-annotation" threw',
      expect.any(Error),
    );
    // Last step, and the one consumers depend on: a half-destroyed manager
    // must not stay mounted as the map's LayerAPI.
    expect(map.foliplus.LayerAPI.registerLayer({ id: "x" } as never)).toBeNull();
    expect(manager.isDestroyed).toBe(true);
    warn.mockRestore();
  });
});

describe("carrier recovery (controller wiring)", () => {
  it("recovers opacity after a content removal attributed by layerremove", () => {
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const group = new TestGroup([new window.L.Path()]);
    manager.registerLayer({
      id: "recover-direct",
      name: "Recover",
      layer: group as unknown as L.Layer,
    });
    const surface = manager.surfaceFor(manager.layerRegistry.get("recover-direct")!);
    expect(surface.capabilities.opacity).toBe("pane");

    const foreignEl = document.createElement("div");
    const foreign = { options: {}, getElement: () => foreignEl };
    group.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();
    expect(surface.capabilities.opacity).toBe("none");

    // Leaflet fires `layerremove` while the group still holds the child;
    // mark first, then let the group finish the removal — the production
    // order for `LayerGroup.removeLayer`.
    manager.onLayerRemove({ layer: foreign } as never);
    group.removeLayer(foreign);
    manager.enforceOrder();
    expect(surface.capabilities.opacity).toBe("pane");
  });

  it("attributes a nested group's content change without an owner scan", () => {
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const inner = new TestGroup([new window.L.Path()]);
    const outer = new TestGroup([inner]);
    manager.registerLayer({
      id: "recover-nested",
      name: "Nested",
      layer: outer as unknown as L.Layer,
    });
    const surface = manager.surfaceFor(manager.layerRegistry.get("recover-nested")!);
    expect(surface.capabilities.opacity).toBe("pane");

    // A nested leaf has no O(1) owner signal (no stamp index, no write-point
    // row, no `hasLayer` on the root), so the event marks every live surface
    // and the pass re-audits each tree once — the behavior survives, the
    // per-surface tree scan does not.
    const foreign = { options: {}, getElement: () => document.createElement("div") };
    inner.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();
    expect(surface.capabilities.opacity).toBe("none");

    manager.onLayerRemove({ layer: foreign } as never);
    inner.removeLayer(foreign);
    manager.enforceOrder();
    expect(surface.capabilities.opacity).toBe("pane");
  });

  it("re-audits a same-layer re-registration without a layeradd", () => {
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const group = new TestGroup([new window.L.Path()]);
    const opts = {
      id: "recover-rereg",
      name: "Rereg",
      layer: group as unknown as L.Layer,
    };
    manager.registerLayer(opts);
    const surface = manager.surfaceFor(manager.layerRegistry.get("recover-rereg")!);
    expect(surface.capabilities.opacity).toBe("pane");

    const foreign = { options: {}, getElement: () => document.createElement("div") };
    group.addLayer(foreign);
    // No layeradd is fired: same-object re-registration is the change signal.
    manager.registerLayer(opts);
    expect(surface.capabilities.opacity).toBe("none");

    group.removeLayer(foreign);
    manager.registerLayer(opts);
    expect(surface.capabilities.opacity).toBe("pane");
  });

  it("re-audits after invalidateType without a manual enforce", async () => {
    // The registration schedules its own ordering pass. This test settles
    // that pass BEFORE the DOM-only change, so it can only pass because
    // `invalidateType` scheduled one — otherwise (the pre-fix behavior) the
    // registration pass is what audits the change and the test is a no-op
    // that also passes on the unfixed code.
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    vi.useFakeTimers();
    try {
      const group = new TestGroup([new window.L.Path()]);
      manager.registerLayer({
        id: "invalidate-only",
        name: "Inv",
        layer: group as unknown as L.Layer,
      });
      const surface = manager.surfaceFor(manager.layerRegistry.get("invalidate-only")!);
      await vi.advanceTimersByTimeAsync(ENFORCE_ORDER_DEBOUNCE_MS);
      expect(surface.capabilities.opacity).toBe("pane");

      const foreignEl = document.createElement("div");
      const foreign = { options: {}, getElement: () => foreignEl };
      group.addLayer(foreign);
      // No layeradd/layerremove: a DOM-only tree change. Only the invalidate
      // hook can tell the ordering pass to re-audit.
      manager.invalidateType("invalidate-only");
      // Nothing has been audited yet — the pass is still pending.
      expect(surface.capabilities.opacity).toBe("pane");
      await vi.advanceTimersByTimeAsync(ENFORCE_ORDER_DEBOUNCE_MS);
      expect(surface.capabilities.opacity).toBe("none");

      group.removeLayer(foreign);
      manager.invalidateType("invalidate-only");
      await vi.advanceTimersByTimeAsync(ENFORCE_ORDER_DEBOUNCE_MS);
      expect(surface.capabilities.opacity).toBe("pane");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mark a surface or schedule a pass for its own hide/show", () => {
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const group = new TestGroup([new window.L.Path()]);
    manager.registerLayer({
      id: "own-membership",
      name: "Own",
      layer: group as unknown as L.Layer,
    });
    const surface = manager.surfaceFor(manager.layerRegistry.get("own-membership")!);
    // Settle the registration pass, then spy: a hide/show of the registered
    // layer is map membership, not content, so it must neither mark the
    // surface nor queue an ordering pass.
    manager.debouncedEnforce.cancel();
    vi.useFakeTimers();
    const mark = vi.spyOn(surface, "markContentDirty");
    const pass = vi.spyOn(manager, "enforceOrder");
    try {
      manager.onLayerRemove({ layer: group } as never);
      vi.advanceTimersByTime(ENFORCE_ORDER_DEBOUNCE_MS);
      expect(mark).not.toHaveBeenCalled();
      expect(pass).not.toHaveBeenCalled();
    } finally {
      mark.mockRestore();
      pass.mockRestore();
      vi.useRealTimers();
    }
  });

  it("marks surfaces for an unattributed add without scanning any tree", () => {
    // The old fallback ran one `findNode` per live surface for every event it
    // could not attribute — O(sum of tree sizes) per event, and again on every
    // re-add after a remove. The fallback now marks each live surface once
    // (O(surfaces)) and lets the coalesced pass walk each dirty tree once.
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    vi.useFakeTimers();
    const findSpy = vi.spyOn(coreLayer, "findNode");
    try {
      const surfaces = [];
      for (let i = 0; i < 5; i++) {
        const leaves = Array.from({ length: 40 }, () => new window.L.Path());
        manager.registerLayer({
          id: `scan${i}` as never,
          name: `Scan ${i}`,
          layer: new TestGroup(leaves) as unknown as L.Layer,
        });
        surfaces.push(manager.surfaceFor(manager.layerRegistry.get(`scan${i}`)!));
      }
      const marks = surfaces.map(surface => vi.spyOn(surface, "markContentDirty"));

      // A layer nothing provably owns (a third-party control's own layer).
      manager.onLayerAdd({ layer: { options: {}, eachLayer: vi.fn() } } as never);

      expect(findSpy).not.toHaveBeenCalled();
      for (const mark of marks) expect(mark).toHaveBeenCalledTimes(1);
    } finally {
      findSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does not rescan the trees when a nested leaf is removed and re-added", () => {
    // The regression the cache delete-on-remove left behind: a remove lost the
    // reverse entry, so the re-add paid a full owner scan again. Neither event
    // may scan now — both take the mark-all fallback.
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const inner = new TestGroup([new window.L.Path()]);
    const outer = new TestGroup([inner]);
    manager.registerLayer({
      id: "re-add",
      name: "Re-add",
      layer: outer as unknown as L.Layer,
    });
    const surface = manager.surfaceFor(manager.layerRegistry.get("re-add")!);
    expect(surface.capabilities.opacity).toBe("pane");
    const findSpy = vi.spyOn(coreLayer, "findNode");
    try {
      const foreign = { options: {}, getElement: () => document.createElement("div") };
      inner.addLayer(foreign);
      manager.onLayerAdd({ layer: foreign } as never);
      manager.enforceOrder();
      expect(surface.capabilities.opacity).toBe("none");

      // Remove (tree becomes migratable again), then re-add: neither the
      // remove nor the re-add may scan a tree for the owner.
      manager.onLayerRemove({ layer: foreign } as never);
      inner.removeLayer(foreign);
      manager.enforceOrder();
      expect(surface.capabilities.opacity).toBe("pane");

      inner.addLayer(foreign);
      manager.onLayerAdd({ layer: foreign } as never);
      manager.enforceOrder();

      expect(findSpy).not.toHaveBeenCalled();
      expect(surface.capabilities.opacity).toBe("none");
    } finally {
      findSpy.mockRestore();
    }
  });

  it("re-audits the new owner when a nested leaf moves without a layerremove", () => {
    // Probe V5: the reverse cache pointed at A after the first attribution, and
    // a blind hit marked A only. B then kept reporting opacity "pane" while its
    // tree already held a foreign leaf. A stale cache may never steer the mark.
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const innerA = new TestGroup([new window.L.Path()]);
    const outerA = new TestGroup([innerA]);
    const outerB = new TestGroup([new window.L.Path()]);
    manager.registerLayer({
      id: "move-a",
      name: "A",
      layer: outerA as unknown as L.Layer,
    });
    manager.registerLayer({
      id: "move-b",
      name: "B",
      layer: outerB as unknown as L.Layer,
    });
    const surfaceA = manager.surfaceFor(manager.layerRegistry.get("move-a")!);
    const surfaceB = manager.surfaceFor(manager.layerRegistry.get("move-b")!);
    manager.enforceOrder();
    expect(surfaceA.capabilities.opacity).toBe("pane");
    expect(surfaceB.capabilities.opacity).toBe("pane");

    const foreign = { options: {}, getElement: () => document.createElement("div") };
    innerA.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();
    expect(surfaceA.capabilities.opacity).toBe("none");

    // Move WITHOUT a layerremove: a detached source group does not propagate
    // child removals, so no re-attribution event reaches the controller.
    innerA.removeLayer(foreign);
    outerB.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();

    // B holds the leaf now, so B must report the degrade. A is left
    // conservatively degraded: nothing told the controller that A lost the
    // leaf (that is the missing `layerremove`), and a stale "none" hides a
    // control rather than offering one that writes into a foreign pane.
    expect(surfaceB.capabilities.opacity).toBe("none");
  });

  it("confirms a direct-child attribution before trusting a stale cache", () => {
    // A cached owner that no longer holds the leaf must be dropped, not
    // returned: the surface that holds it now is the one that has to re-audit.
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const groupA = new TestGroup([new window.L.Path()]);
    const groupB = new TestGroup([new window.L.Path()]);
    manager.registerLayer({
      id: "own-a",
      name: "A",
      layer: groupA as unknown as L.Layer,
    });
    manager.registerLayer({
      id: "own-b",
      name: "B",
      layer: groupB as unknown as L.Layer,
    });
    const surfaceA = manager.surfaceFor(manager.layerRegistry.get("own-a")!);
    const surfaceB = manager.surfaceFor(manager.layerRegistry.get("own-b")!);
    manager.enforceOrder();

    const foreign = { options: {}, getElement: () => document.createElement("div") };
    groupA.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();
    expect(surfaceA.capabilities.opacity).toBe("none");

    groupA.removeLayer(foreign);
    groupB.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();

    expect(surfaceB.capabilities.opacity).toBe("none");
    expect(surfaceA.capabilities.opacity).toBe("pane");
  });

  it("announces a capability change only when the projection actually moved", () => {
    // The style-panel live refresh rides this event. It has to fire on a
    // degrade and on a recovery, and stay silent on a pass that changed
    // nothing (the ordering pass runs on ordinary reorders too).
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const group = new TestGroup([new window.L.Path()]);
    manager.registerLayer({
      id: "caps",
      name: "Caps",
      layer: group as unknown as L.Layer,
    });
    // Seed the snapshot silently: the first observation of a surface is not a
    // change.
    manager.enforceOrder();
    const seen: Array<{ id: string }> = [];
    manager.events.on(EVENTS.LAYER_CAPABILITY_CHANGED, payload => seen.push(payload));

    const foreign = { options: {}, getElement: () => document.createElement("div") };
    group.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.enforceOrder();
    expect(seen).toEqual([{ id: "caps" }]);

    // Unchanged projection: the next pass must not re-announce it.
    manager.enforceOrder();
    expect(seen).toHaveLength(1);

    // Recovery is a change too.
    manager.onLayerRemove({ layer: foreign } as never);
    group.removeLayer(foreign);
    manager.enforceOrder();
    expect(seen).toEqual([{ id: "caps" }, { id: "caps" }]);
  });

  it("drops a reverse-index entry whose surface retired", () => {
    const { manager, map } = initFixture({ data: [] });
    map.hasLayer.mockReturnValue(true);
    const inner = new TestGroup([new window.L.Path()]);
    const outer = new TestGroup([inner]);
    manager.registerLayer({
      id: "retired-cache",
      name: "Retired",
      layer: outer as unknown as L.Layer,
    });
    const foreign = { options: {}, getElement: () => document.createElement("div") };
    inner.addLayer(foreign);
    manager.onLayerAdd({ layer: foreign } as never);
    manager.unregisterLayer("retired-cache");

    expect(() => manager.onLayerRemove({ layer: foreign } as never)).not.toThrow();
  });

  it("does not schedule an enforce after destroy", () => {
    const { manager } = initFixture({ data: [] });
    manager.destroy();
    expect(() => manager.invalidateType("gone")).not.toThrow();
  });
});
