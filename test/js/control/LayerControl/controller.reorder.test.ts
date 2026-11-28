// test/js/control/LayerControl/controller.reorder — z-order moves, bring-to-front and enforceOrder.
import {
  TileLayer,
  createLayerControllerFixture,
  orderFromRoles,
  readOrderTreeStorage,
  teardownLayerControllerFixture,
} from "./controller.fixture.js";
import { initFixture, polygonLayer } from "./ui/fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { FALLBACK_PANE_PREFIX } from "#core/layer/index.js";
import { folderDocKey } from "#core/layer/index.js";
import { layerKeyOf } from "#core/layer/index.js";
import { LayerController } from "#control/LayerControl/controller.js";

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
      { id: "a", name: "A", role: "overlay" },
      { id: "b", name: "B", role: "overlay" },
      { id: "c", name: "C", role: "overlay" },
    ]);
    expect(manager.moveLayerUp("b")).toBe(true);
    expect(manager.layers[0].id).toBe("b");
    expect(manager.layers[1].id).toBe("a");
    expect(manager.layers[2].id).toBe("c");
  });

  it("returns false when layer is already at top", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "b", name: "B", role: "overlay" },
    ]);
    expect(manager.moveLayerUp("a")).toBe(false);
  });

  it("returns false for unknown layer id", () => {
    manager = new LayerController(map, [{ id: "a", name: "A", role: "overlay" }]);
    expect(manager.moveLayerUp("unknown")).toBe(false);
  });

  it("does not move base layer past overlay boundary", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "b", name: "B", role: "overlay" },
      { id: "base1", name: "Base", role: "base" },
      { id: "base2", name: "Base2", role: "base" },
    ]);
    expect(manager.moveLayerUp("base2")).toBe(true);
    expect(manager.layers[2].id).toBe("base2");
    expect(manager.moveLayerUp("base2")).toBe(false);
  });

  it("moves an overlay one position down", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "b", name: "B", role: "overlay" },
      { id: "c", name: "C", role: "overlay" },
    ]);
    expect(manager.moveLayerDown("a")).toBe(true);
    expect(manager.layers[0].id).toBe("b");
    expect(manager.layers[1].id).toBe("a");
    expect(manager.layers[2].id).toBe("c");
  });

  it("returns false when layer is already at bottom of group", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "b", name: "B", role: "overlay" },
    ]);
    expect(manager.moveLayerDown("b")).toBe(false);
  });

  it("does not move overlay past base boundary", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "base1", name: "Base", role: "base" },
      { id: "base2", name: "Base2", role: "base" },
    ]);
    expect(manager.moveLayerDown("a")).toBe(false);
  });

  it("moves base layer down within base group", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "base1", name: "Base1", role: "base" },
      { id: "base2", name: "Base2", role: "base" },
    ]);
    expect(manager.moveLayerDown("base1")).toBe(true);
    expect(manager.layers[1].id).toBe("base2");
    expect(manager.layers[2].id).toBe("base1");
  });

  it("moveLayerUp and moveLayerDown are inverse operations", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "b", name: "B", role: "overlay" },
      { id: "c", name: "C", role: "overlay" },
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
      { id: "a", name: "A", role: "overlay" },
      { id: "b", name: "B", role: "overlay" },
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
    manager = new LayerController(map, [{ id: "a", name: "A", role: "overlay" }]);
    expect(manager.moveLayerUp("a")).toBe(false);
    expect(manager.moveLayerDown("a")).toBe(false);
  });

  it("moves first overlay to the top of overlay group", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "b", name: "B", role: "overlay" },
      { id: "c", name: "C", role: "overlay" },
      { id: "base1", name: "Base1", role: "base" },
    ]);
    expect(manager.moveLayerUp("b")).toBe(true);
    expect(manager.layers[0].id).toBe("b");
    expect(manager.moveLayerUp("c")).toBe(true);
    expect(manager.moveLayerUp("c")).toBe(true);
    expect(manager.layers[0].id).toBe("c");
  });

  it("does not move overlay that is the only overlay into base group", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "base1", name: "Base1", role: "base" },
    ]);
    expect(manager.moveLayerDown("a")).toBe(false);
  });

  it("reorder works across multiple base layers", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "b", name: "B", role: "overlay" },
      { id: "base1", name: "Base1", role: "base" },
      { id: "base2", name: "Base2", role: "base" },
      { id: "base3", name: "Base3", role: "base" },
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
      { id: "a", name: "A", role: "overlay" },
      { id: "b", name: "B", role: "overlay" },
    ]);
    const enforceSpy = vi.spyOn(manager, "enforceOrder");
    manager.moveLayerUp("b");
    expect(enforceSpy).toHaveBeenCalled();
  });

  it("moveLayerDown returns false when layer is already at bottom of base group", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "base1", name: "Base1", role: "base" },
    ]);
    expect(manager.moveLayerDown("base1")).toBe(false);
  });

  it("moveLayerUp returns false when layer is the only overlay", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "base1", name: "Base1", role: "base" },
    ]);
    expect(manager.moveLayerUp("a")).toBe(false);
  });

  it("moveLayerUp returns false when layer is the only base map", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "base1", name: "Base1", role: "base" },
    ]);
    expect(manager.moveLayerUp("base1")).toBe(false);
  });

  it("moveLayerDown calls enforceOrder", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "b", name: "B", role: "overlay" },
    ]);
    const enforceSpy = vi.spyOn(manager, "enforceOrder");
    manager.moveLayerDown("a");
    expect(enforceSpy).toHaveBeenCalled();
  });

  it("moveLayerUp rebuilds the list via LAYER_LIST_REBUILD when a UI is attached", () => {
    // Move is the last remaining register-time signal that used to call the
    // UI's rebuildAfterLayoutChange directly; it now rides the same bus the rest of
    // the reorder paths do, so a missing emit silently breaks drag + keyboard
    // reordering. Attach a bare ui + uiContainer to reach the branch.
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "b", name: "B", role: "overlay" },
    ]);
    manager.uiContainer = document.createElement("div");
    manager.ui = {} as any;
    const emitSpy = vi.spyOn(manager.events, "emitSettled");
    manager.moveLayerUp("b");
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_LIST_REBUILD, {
      kind: "system",
      via: "teardown",
    });
  });

  it("moveLayerDown rebuilds the list via LAYER_LIST_REBUILD when a UI is attached", () => {
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "b", name: "B", role: "overlay" },
    ]);
    manager.uiContainer = document.createElement("div");
    manager.ui = {} as any;
    const emitSpy = vi.spyOn(manager.events, "emitSettled");
    manager.moveLayerDown("a");
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_LIST_REBUILD, {
      kind: "system",
      via: "teardown",
    });
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
      { id: "a", name: "A", role: "overlay" },
      { id: "b", name: "B", role: "overlay" },
      { id: "c", name: "C", role: "overlay" },
    ]);
    const onLayerChange = vi.fn();
    manager.events.on(EVENTS.LAYER_CHANGE, onLayerChange);

    expect(manager.moveLayerUp("c")).toBe(true);

    expect(onLayerChange).toHaveBeenCalledTimes(1);
    // One hop: index 2 -> 1. reorder(2, 1) on [a, b, c] gives [a, c, b].
    expect(manager.layers.map(l => l.id)).toEqual(["a", "c", "b"]);
    // Flush instead of ticking the clock: the debounces another test left on
    // it would write their own order over this test's read of storage.
    const stored = readOrderTreeStorage(map)!;
    const rootIds = Object.entries(stored.nodes as Record<string, any>)
      .filter(([, n]) => n.parent === null && n.kind === "layer")
      .sort((a, b) => (a[1].rank as string).localeCompare(b[1].rank as string))
      .map(([k]) => k.replace(/^layer:/, ""));
    expect(rootIds).toEqual(["a", "c", "b"]);

    vi.useRealTimers();
  });

  it("a rejected move produces no side effects — no event, no persistence, no re-ordering", () => {
    // The rejection paths are `idx`/group-boundary checks, but the contract is
    // that all of them are inert. If a later edit adds enforcement between the
    // check and the early return, these catch it; the per-case behavior itself
    // is covered by the boundary tests above.
    manager = new LayerController(map, [
      { id: "a", name: "A", role: "overlay" },
      { id: "base1", name: "Base1", role: "base" },
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

describe("enforceOrder isolation", () => {
  it("prices the rest of the stack and reports the layer that failed", () => {
    window.localStorage.clear();
    const { manager, map } = initFixture({
      data: [
        { id: "a", name: "A", role: "overlay" },
        { id: "bad", name: "Bad", role: "overlay" },
        { id: "c", name: "C", role: "overlay" },
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
      data: [{ id: "a", name: "A", role: "overlay" }],
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

describe("LayerController", () => {
  let manager: LayerController;

  beforeEach(() => {
    ({ manager } = createLayerControllerFixture());
  });

  afterEach(() => {
    teardownLayerControllerFixture(manager);
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
    expect(emitSpy).toHaveBeenCalledWith(EVENTS.LAYER_LIST_REBUILD, {
      kind: "system",
      via: "teardown",
    });
  });

  it("bringLayerToFront ignores base layers", () => {
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "b",
      name: "B",
      layer: new TileLayer(),
      role: "base",
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
});

describe("LayerController moveLayerUp / moveLayerDown within and across folders", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };
  });

  // The tree is the single order source: a folder member's registry position is
  // its rank inside the folder block. These tests pin the folder-branch index
  // math of stepLayerInTree (up = pos.index - 1; down = pos.index + 1, because
  // moveEntry detaches the member before inserting, so the follower sits at
  // pos.index afterwards).
  const visibleOrder = (manager: LayerController): string[] =>
    manager.layers.map(l => l.id).filter(id => !id.startsWith("foliplus_"));

  it("folder-up moves a member before its previous sibling", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["F"] }),
      data: [
        { id: "A", name: "A", role: "overlay", folder: "F", layer: polygonLayer() },
        { id: "id1", name: "id", role: "overlay", folder: "F", layer: polygonLayer() },
        { id: "B", name: "B", role: "overlay", folder: "F", layer: polygonLayer() },
        { id: "C", name: "C", role: "overlay", folder: "F", layer: polygonLayer() },
      ],
    });
    expect(visibleOrder(manager)).toEqual(["A", "id1", "B", "C"]);

    expect(manager.moveLayerUp("id1")).toBe(true);
    expect(visibleOrder(manager)).toEqual(["id1", "A", "B", "C"]);
  });

  it("folder-down moves a member after its next sibling (pos.index + 1)", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["F"] }),
      data: [
        { id: "A", name: "A", role: "overlay", folder: "F", layer: polygonLayer() },
        { id: "id1", name: "id", role: "overlay", folder: "F", layer: polygonLayer() },
        { id: "B", name: "B", role: "overlay", folder: "F", layer: polygonLayer() },
        { id: "C", name: "C", role: "overlay", folder: "F", layer: polygonLayer() },
      ],
    });
    expect(visibleOrder(manager)).toEqual(["A", "id1", "B", "C"]);

    expect(manager.moveLayerDown("id1")).toBe(true);
    expect(visibleOrder(manager)).toEqual(["A", "B", "id1", "C"]);
  });

  it("cross-folder up: a root layer moves above the preceding folder block via the root branch", () => {
    // r1 sits between folder F and folder G; moving it up must cross the F
    // block as a top-level anchor (root branch), not mutate inside the folder.
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["F", "G"] }),
      data: [
        { id: "fa", name: "FA", role: "overlay", folder: "F", layer: polygonLayer() },
        { id: "r1", name: "R1", role: "overlay", layer: polygonLayer() },
        { id: "gb", name: "GB", role: "overlay", folder: "G", layer: polygonLayer() },
      ],
    });
    expect(visibleOrder(manager)).toEqual(["fa", "r1", "gb"]);

    expect(manager.moveLayerUp("r1")).toBe(true);
    expect(visibleOrder(manager)).toEqual(["r1", "fa", "gb"]);
  });

  it("cross-folder down: a root layer moves below the following folder block via the root branch", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["F", "G"] }),
      data: [
        { id: "fa", name: "FA", role: "overlay", folder: "F", layer: polygonLayer() },
        { id: "r1", name: "R1", role: "overlay", layer: polygonLayer() },
        { id: "gb", name: "GB", role: "overlay", folder: "G", layer: polygonLayer() },
      ],
    });
    expect(visibleOrder(manager)).toEqual(["fa", "r1", "gb"]);

    expect(manager.moveLayerDown("r1")).toBe(true);
    // r1 is already below F; moving down places it below the G block.
    expect(visibleOrder(manager)).toEqual(["fa", "gb", "r1"]);
  });

  it("folder boundaries refuse a first-member up and a last-member down without mutating the tree", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["F"] }),
      data: [
        { id: "A", name: "A", role: "overlay", folder: "F", layer: polygonLayer() },
        { id: "id1", name: "id", role: "overlay", folder: "F", layer: polygonLayer() },
        { id: "B", name: "B", role: "overlay", folder: "F", layer: polygonLayer() },
        { id: "C", name: "C", role: "overlay", folder: "F", layer: polygonLayer() },
      ],
    });
    const before = visibleOrder(manager);
    expect(before).toEqual(["A", "id1", "B", "C"]);

    expect(manager.moveLayerUp("A")).toBe(false);
    expect(manager.moveLayerDown("C")).toBe(false);
    expect(visibleOrder(manager)).toEqual(before);
  });
});

describe("LayerController moveRow (node-level keyboard reorder)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };
  });

  const visibleOrder = (manager: LayerController): string[] =>
    manager.layers.map(l => l.id).filter(id => !id.startsWith("foliplus_"));

  it("moveRow on a folder key moves the whole block across an adjacent root layer", () => {
    // F (members fa, gb? no — F holds fa) sits before root layer r1 before G.
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["F", "G"] }),
      data: [
        { id: "fa", name: "FA", role: "overlay", folder: "F", layer: polygonLayer() },
        { id: "r1", name: "R1", role: "overlay", layer: polygonLayer() },
        { id: "gb", name: "GB", role: "overlay", folder: "G", layer: polygonLayer() },
      ],
    });
    expect(visibleOrder(manager)).toEqual(["fa", "r1", "gb"]);
    // Move the F block down across r1: the whole folder (fa) travels as a unit.
    expect(manager.moveRow(folderDocKey("overlay", "f"), false)).toBe(true);
    expect(visibleOrder(manager)).toEqual(["r1", "fa", "gb"]);
    // Move it back up across r1: the block precedes the root layer again.
    expect(manager.moveRow(folderDocKey("overlay", "f"), true)).toBe(true);
    expect(visibleOrder(manager)).toEqual(["fa", "r1", "gb"]);
  });

  it("moveRow steps a root layer across an adjacent folder by sibling order", () => {
    // r1 sits between F and G blocks; sibling order, not registry index, decides.
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["F", "G"] }),
      data: [
        { id: "fa", name: "FA", role: "overlay", folder: "F", layer: polygonLayer() },
        { id: "r1", name: "R1", role: "overlay", layer: polygonLayer() },
        { id: "gb", name: "GB", role: "overlay", folder: "G", layer: polygonLayer() },
      ],
    });
    expect(visibleOrder(manager)).toEqual(["fa", "r1", "gb"]);
    // r1 up: crosses the F block by sibling order (registry index was 1, but the
    // sibling above is the folder block, not a layer row).
    expect(manager.moveRow(layerKeyOf("r1"), true)).toBe(true);
    expect(visibleOrder(manager)).toEqual(["r1", "fa", "gb"]);
  });

  it("moveRow refuses a folder member at the folder boundary", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: ["F"] }),
      data: [
        { id: "A", name: "A", role: "overlay", folder: "F", layer: polygonLayer() },
        { id: "B", name: "B", role: "overlay", folder: "F", layer: polygonLayer() },
      ],
    });
    const before = visibleOrder(manager);
    expect(manager.moveRow(layerKeyOf("A"), true)).toBe(false);
    expect(manager.moveRow(layerKeyOf("B"), false)).toBe(false);
    expect(visibleOrder(manager)).toEqual(before);
  });

  it("moveLayerUp / moveLayerDown delegate to stepRow with identical behavior", () => {
    const { manager } = initFixture({
      seedOrderTree: orderFromRoles({ overlay: [] }),
      data: [
        { id: "a", name: "A", role: "overlay", layer: polygonLayer() },
        { id: "b", name: "B", role: "overlay", layer: polygonLayer() },
        { id: "c", name: "C", role: "overlay", layer: polygonLayer() },
      ],
    });
    expect(visibleOrder(manager)).toEqual(["a", "b", "c"]);
    expect(manager.moveLayerUp("b")).toBe(true);
    expect(visibleOrder(manager)).toEqual(["b", "a", "c"]);
    expect(manager.moveLayerDown("a")).toBe(true);
    expect(visibleOrder(manager)).toEqual(["b", "c", "a"]);
  });

  it("moveRow refuses a root-level overlay/base crossing", () => {
    const { manager } = initFixture({
      data: [
        { id: "a", name: "A", role: "overlay", layer: polygonLayer() },
        { id: "b", name: "B", role: "base", layer: polygonLayer() },
      ],
    });
    // overlay cannot move down across the base boundary at the root.
    expect(manager.moveRow(layerKeyOf("a"), false)).toBe(false);
  });
});
