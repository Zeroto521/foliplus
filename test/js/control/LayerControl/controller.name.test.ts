// test/js/control/LayerControl/controller.name — user-assigned layer names.
import { GridLayer, TileLayer } from "./controller.fixture.js";
import { TEST_ENV } from "./ui/fixture.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import { LayerController } from "#control/LayerControl/controller.js";
import { LayerUI } from "#control/LayerControl/ui/index.js";
import { getIntent, setIntent } from "#control/LayerControl/ui/intent.js";
import { dropPersistedLayerState } from "#control/LayerControl/ui/state.js";

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
      { id: "ext", name: "Provider Layer", role: "overlay", layer: extLayer },
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
      { id: "ext", name: "Provider Layer", role: "overlay", layer: { options: {} } },
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
      { id: "ext", name: "Provider Layer", role: "overlay", layer: { options: {} } },
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
      { id: "fresh", name: "Fresh Layer", role: "overlay", layer: { options: {} } },
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
