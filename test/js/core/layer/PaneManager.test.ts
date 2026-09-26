import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaneManager } from "#foliplus/core/layer/PaneManager.js";
import * as CONST from "#foliplus/core/layer/const.js";
import type { PaneSpec } from "#foliplus/core/layer/type.js";

// Mock L.svg — needed by PaneManager.ensurePane
beforeEach(() => {
  vi.clearAllMocks();
  window.L.svg = vi.fn(() => ({ addTo: vi.fn() }));
  window.L.stamp = vi.fn(obj => obj.__id ?? (obj.__id = ++count));
  window.L.Path = class {};
  window.L.Marker = class {};
});
let count = 0;

/** The pane spec list `createLayers` derives from an ordered name list: the
 *  first name is the base pane, everything after it a `sub`, each one draw
 *  offset above the previous. */
const specs = (...names: string[]): PaneSpec[] =>
  names.map((name, i) => ({ role: i === 0 ? "base" : "sub", order: i, name }));

// Naming convention: DOM/CSS/named panes use hyphens.
describe("pane prefix naming convention", () => {
  it("fallback / canvas / annotation pane prefixes are hyphenated", () => {
    for (const prefix of [
      CONST.FALLBACK_PANE_PREFIX,
      CONST.CANVAS_PANE_PREFIX,
      "foliplus-annotation-",
    ]) {
      expect(prefix).toMatch(/^foliplus-[a-z]+-$/);
      expect(prefix).not.toContain("_");
    }
  });
});

// Map stub. Pane renderers live in Leaflet's own `_paneRenderers`, keyed by pane
// name — the single registry the adapter reads and writes (`getRendererFor`).
const makeMap = (
  panes: Record<string, HTMLElement>,
  renderers: Record<string, unknown> = {},
) => {
  const map = {
    getPane: vi.fn(name => panes[name] ?? null),
    createPane: vi.fn(),
    removeLayer: vi.fn(),
    hasLayer: vi.fn(() => true),
    _panes: panes,
    _paneRenderers: renderers,
  };
  return map;
};

describe("PaneManager", () => {
  it("isDefaultPane returns true for standard Leaflet panes", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    expect(pm.isDefaultPane("overlayPane")).toBe(true);
    expect(pm.isDefaultPane("markerPane")).toBe(true);
    expect(pm.isDefaultPane("tilePane")).toBe(true);
    expect(pm.isDefaultPane("shadowPane")).toBe(true);
    expect(pm.isDefaultPane("mapPane")).toBe(true);
  });

  it("isDefaultPane returns true for fallback panes", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    expect(pm.isDefaultPane(`${CONST.FALLBACK_PANE_PREFIX}123`)).toBe(true);
    expect(pm.isDefaultPane(`${CONST.FALLBACK_PANE_PREFIX}xyz`)).toBe(true);
  });

  it("isDefaultPane returns false for custom panes", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    expect(pm.isDefaultPane("foliplus-measure-graph")).toBe(false);
    expect(pm.isDefaultPane("foliplus-measure-label")).toBe(false);
    expect(pm.isDefaultPane("my-custom-pane")).toBe(false);
  });

  it("getLayerPanes returns the layer's custom pane", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = { options: { pane: "foliplus-measure-graph" } };
    // discoverChildPanes walks options.pane on the layer itself
    const panes = pm.getLayerPanes(layer);
    expect(panes).toContain("foliplus-measure-graph");
  });

  it("getLayerPanes answers [] when a layer declares no pane", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    // Nothing in the tree names a custom pane, so there is nothing this tree
    // can prove. The pane a LayerSurface synthesizes is resolved from the
    // surface, not from here — "none" is the honest answer, not a guess at
    // Leaflet's shared panes.
    const layer = { options: {} };
    expect(pm.getLayerPanes(layer)).toEqual([]);
  });

  it("getLayerPanes answers [] when a layer's tree names only default panes", () => {
    // The realistic case: a Marker with pane: "markerPane" lives in Leaflet's
    // own shared pane, which discoverChildPanes filters out via isDefaultPane.
    // Returning that shared pane as "this layer's pane" would hand the caller
    // every other marker on the map, so the answer comes back empty.
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = { options: { pane: "markerPane" } };
    expect(pm.getLayerPanes(layer)).toEqual([]);
  });

  it("getLayerPanes never answers with a Leaflet shared pane", () => {
    // Regression gate for the pre-fix fallback ["overlayPane","markerPane"]:
    // the returned list is the contract "these panes are this layer's", so
    // an infrastructure pane in it means the caller now owns every layer's
    // pixels. Layers that name nothing, that name a shared pane, and that name
    // a real custom pane must all stay clear of the shared set.
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const shared = new Set(["overlayPane", "markerPane", "tilePane", "shadowPane"]);
    for (const layer of [
      { options: {} },
      { options: { pane: "markerPane" } },
      { options: { pane: "tilePane" } },
      { options: { pane: "overlayPane" } },
      { options: { pane: "foliplus-measure-graph" } },
    ]) {
      for (const name of pm.getLayerPanes(layer)) {
        expect(shared.has(name)).toBe(false);
      }
    }
  });

  it("ensurePane reuses an existing pane without creating", () => {
    const existingPane = document.createElement("div");
    const map = {
      getPane: vi.fn(() => existingPane),
      createPane: vi.fn(),
    };
    const pm = new PaneManager(map);
    const result = pm.ensurePane("foliplus-measure-graph", false);
    expect(map.createPane).not.toHaveBeenCalled();
    expect(result.pane).toBe(existingPane);
    expect(result.renderer).toBeNull();
  });

  it("ensurePane creates a pane and adds the layer-pane class", () => {
    const newPane = document.createElement("div");
    const map = {
      getPane: vi.fn(() => null),
      createPane: vi.fn(() => newPane),
    };
    const pm = new PaneManager(map);
    pm.ensurePane("foliplus-measure-graph", false);
    expect(map.createPane).toHaveBeenCalledWith("foliplus-measure-graph");
    expect(newPane.classList.contains("foliplus-layer-pane")).toBe(true);
  });

  it("ensurePane sets provisional z-index on first creation only", () => {
    // First creation: each pane at BASE + its own order.
    // Re-entry (pane already exists) must NOT touch z-index — the ordering pass
    // may have already overwritten it with a position-based base.
    const panes: Record<string, HTMLElement> = {};
    const map = {
      getPane: vi.fn((name: string) => panes[name] ?? null),
      createPane: vi.fn((name: string) => {
        panes[name] = document.createElement("div");
        return panes[name];
      }),
    };
    const pm = new PaneManager(map);
    pm.registerPaneSpecs(specs("graph", "node", "label"));

    pm.ensurePane("label", false);
    pm.ensurePane("node", false);
    pm.ensurePane("graph", false);

    const base = CONST.Z_INDEX.BASE;
    const declared = specs("graph", "node", "label");
    for (const spec of declared) {
      expect(panes[spec.name]!.style.zIndex).toBe(String(base + spec.order));
    }

    // Simulate the ordering pass overwriting with a higher position-based base.
    panes["label"]!.style.zIndex = "622";
    pm.ensurePane("label", false);
    expect(panes["label"]!.style.zIndex).toBe("622");
  });

  it("ensurePane creates an SVG renderer when needRenderer is true", () => {
    const pane = document.createElement("div");
    const map = {
      getPane: vi.fn(() => pane),
      createPane: vi.fn(),
    };
    const pm = new PaneManager(map);
    const result = pm.ensurePane("foliplus-measure-graph", true);
    expect(window.L.svg).toHaveBeenCalledWith({ pane: "foliplus-measure-graph" });
    expect(result.renderer).toBeDefined();
  });

  it("ensurePane skips the SVG renderer when needRenderer is false (canvas panes)", () => {
    const pane = document.createElement("div");
    const map = {
      getPane: vi.fn(() => pane),
      createPane: vi.fn(),
    };
    const pm = new PaneManager(map);
    const result = pm.ensurePane("foliplus-canvas-heat", false);
    expect(window.L.svg).not.toHaveBeenCalled();
    expect(result.renderer).toBeNull();
  });

  it("ensurePane reuses an existing renderer", () => {
    const pane = document.createElement("div");
    const renderer = { addTo: vi.fn() };
    const map = {
      getPane: vi.fn(() => pane),
      createPane: vi.fn(),
      _paneRenderers: { "foliplus-measure-graph": renderer },
    };
    const pm = new PaneManager(map);
    const result = pm.ensurePane("foliplus-measure-graph", true);
    expect(window.L.svg).not.toHaveBeenCalled();
    expect(result.renderer).toBe(renderer);
  });

  it("ensurePane registers a new renderer in Leaflet's registry", () => {
    // Leaflet's `getRenderer` hands a Path with no `options.renderer` whatever
    // `_paneRenderers` holds for its pane, so a renderer missing from that
    // registry lets Leaflet build a second <svg> in the same pane.
    const pane = document.createElement("div");
    const map = {
      getPane: vi.fn(() => pane),
      createPane: vi.fn(),
      _paneRenderers: {} as Record<string, unknown>,
    };
    const pm = new PaneManager(map);
    const result = pm.ensurePane("foliplus-measure-graph", true);
    expect(map._paneRenderers["foliplus-measure-graph"]).toBe(result.renderer);
  });

  it("discoverChildPanes filters out default panes", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = {
      options: { pane: "overlayPane" },
    };
    expect(pm.discoverChildPanes(layer)).toEqual([]);
  });

  it("sweepChildPanes drops entries no longer referenced", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    pm.registerPaneSpecs(specs("keep_label", "drop_label"));
    pm.sweepChildPanes([{ paneSpecs: specs("keep_label") }, {}, { paneSpecs: [] }]);
    expect(pm.childPaneSpecs.has("keep_label")).toBe(true);
    expect(pm.childPaneSpecs.has("drop_label")).toBe(false);
  });

  it("sweepChildPanes keeps a pane shared by multiple layers", () => {
    // Two layers both use "shared_label" — after sweeping, the pane must
    // stay because it's still referenced by at least one layer.
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    pm.registerPaneSpecs(specs("shared_label"));
    pm.sweepChildPanes([
      { paneSpecs: specs("shared_label") },
      { paneSpecs: specs("shared_label") },
    ]);
    expect(pm.childPaneSpecs.has("shared_label")).toBe(true);
  });

  it("sweepChildPanes is a no-op when nothing is registered", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    expect(() => pm.sweepChildPanes([{ paneSpecs: specs("phantom") }])).not.toThrow();
    expect(pm.childPaneSpecs.size).toBe(0);
  });

  it("registerPaneSpecs is idempotent", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    pm.registerPaneSpecs(specs("a", "b"));
    pm.registerPaneSpecs(specs("a", "b", "c"));
    pm.registerPaneSpecs(specs("a", "b")); // duplicate
    expect(pm.childPaneSpecs.size).toBe(3);
    expect(pm.childPaneSpecs.has("a")).toBe(true);
    expect(pm.childPaneSpecs.has("b")).toBe(true);
    expect(pm.childPaneSpecs.has("c")).toBe(true);
  });

  // ── Injection gate: name validation + role enum ────────────────
  // `PaneSpec.name` lands on the DOM as a Leaflet pane id and CSS class
  // (createPane does both). A third party passing a name outside
  // PANE_NAME_PATTERN would plant an id collision, a compound-selector
  // escape, or a script tag into the map container. Same for `role` —
  // anything outside the enum would silently price as "base" in z
  // arithmetic. Bad specs are skipped (with a warn), not thrown.

  it("registerPaneSpecs skips a spec with an empty name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const map = { getPane: vi.fn(), createPane: vi.fn() };
      const pm = new PaneManager(map);
      pm.registerPaneSpecs(specs("")) as unknown; // empty string
      expect(pm.childPaneSpecs.size).toBe(0);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("registerPaneSpecs skips a spec with a non-string name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const map = { getPane: vi.fn(), createPane: vi.fn() };
      const pm = new PaneManager(map);
      pm.registerPaneSpecs([{ role: "base", order: 0, name: 42 as unknown as string }]);
      expect(pm.childPaneSpecs.size).toBe(0);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("registerPaneSpecs skips a spec with a name outside PANE_NAME_PATTERN", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const map = { getPane: vi.fn(), createPane: vi.fn() };
      const pm = new PaneManager(map);
      pm.registerPaneSpecs(specs("x<script>"));
      expect(pm.childPaneSpecs.size).toBe(0);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("registerPaneSpecs accepts a name that satisfies PANE_NAME_PATTERN", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    pm.registerPaneSpecs(specs("valid-name_123", "another.valid"));
    // Hyphen and underscore are fine; the dot is not. Only the first survives.
    expect(pm.childPaneSpecs.size).toBe(1);
    expect(pm.childPaneSpecs.has("valid-name_123")).toBe(true);
  });

  it("registerPaneSpecs falls back to 'base' role for an unknown role value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const map = { getPane: vi.fn(), createPane: vi.fn() };
      const pm = new PaneManager(map);
      pm.registerPaneSpecs([
        { role: "unknown" as unknown as PaneSpec["role"], order: 0, name: "a" },
      ]);
      expect(pm.childPaneSpecs.size).toBe(1);
      expect(pm.childPaneSpecs.get("a")?.role).toBe("base");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("registerPaneSpecs accepts every legal role", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    pm.registerPaneSpecs([
      { role: "base", order: 0, name: "a" },
      { role: "sub", order: 1, name: "b" },
      { role: "annotation", order: 2, name: "c" },
      { role: "preview", order: 3, name: "d" },
    ]);
    expect(pm.childPaneSpecs.size).toBe(4);
    expect(pm.childPaneSpecs.get("a")?.role).toBe("base");
    expect(pm.childPaneSpecs.get("b")?.role).toBe("sub");
    expect(pm.childPaneSpecs.get("c")?.role).toBe("annotation");
    expect(pm.childPaneSpecs.get("d")?.role).toBe("preview");
  });

  it("reset invalidates the discovery cache", () => {
    // reset bumps the generation: entries computed before it are dropped on
    // their next read rather than cleared eagerly. Assert via the visible
    // contract — a layer whose options changed in the gap comes back with the
    // new name, not the pre-reset cached value.
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = { options: { pane: "a" } } as unknown as L.Layer;
    expect(pm.discoverChildPanes(layer)).toEqual(["a"]);
    layer.options.pane = "b";
    expect(pm.discoverChildPanes(layer)).toEqual(["a"]);
    pm.reset();
    expect(pm.discoverChildPanes(layer)).toEqual(["b"]);
  });

  it("reset(id) keeps its signature and invalidates structure-wide", () => {
    // The stamp argument is retained for the stamp-only callers and ignored on
    // purpose: a repinned subtree can invalidate entries the caller holds no
    // reference to, while over-invalidating costs one extra `forEachLayer`
    // walk — never a wrong answer. `pinTree` uses the same generation bump,
    // so there is no per-node precise delete anywhere.
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const a = { options: { pane: "a" } } as unknown as L.Layer;
    const b = { options: { pane: "b" } } as unknown as L.Layer;
    expect(pm.discoverChildPanes(a)).toEqual(["a"]);
    expect(pm.discoverChildPanes(b)).toEqual(["b"]);
    a.options.pane = "a2";
    b.options.pane = "b2";
    // Both still served from cache — the stamp argument is ignored.
    pm.reset(window.L.stamp({}));
    expect(pm.discoverChildPanes(a)).toEqual(["a2"]);
    expect(pm.discoverChildPanes(b)).toEqual(["b2"]);
  });

  it("discoverChildPanes answers nothing once past the depth cap", () => {
    // The cap is a parameter of a public method, so it is a contract: a caller
    // that already descended too far gets an empty answer instead of a walk.
    // The boundary itself (== cap) still walks.
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = { options: { pane: "ours" } } as unknown as L.Layer;
    const past = CONST.RECURSION.PANE_DEPTH + 1;
    expect(pm.discoverChildPanes(layer, past)).toEqual([]);
    expect(pm.discoverChildPanes(layer, CONST.RECURSION.PANE_DEPTH)).toEqual(["ours"]);
  });

  it("discoverChildPanes reuses the cache until invalidated", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = { options: { pane: "foliplus-measure-graph" } };
    expect(pm.discoverChildPanes(layer)).toEqual(["foliplus-measure-graph"]);
    // Second call must hit the cache — the options change is ignored until reset
    layer.options.pane = "other_pane";
    expect(pm.discoverChildPanes(layer)).toEqual(["foliplus-measure-graph"]);
    // After an invalidation the new pane is observed
    pm.reset(window.L.stamp(layer));
    expect(pm.discoverChildPanes(layer)).toEqual(["other_pane"]);
  });

  it("keeps the discovery cache bounded, evicting the oldest entry", () => {
    // `L.stamp` is never reused, so an uncapped cache would grow with every
    // layer ever asked about and only shrink at teardown. Eviction is oldest-
    // first — the entry least likely to be asked again soon — and the cost of
    // the miss it causes is one extra `forEachLayer` walk, never a wrong answer.
    // Probe the cap behaviorally: after the cap-th+1 write the oldest entry
    // has been dropped, so its owner can now see its own mutation. The newest
    // entries are still served from cache, so their owners still cannot.
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const cap = CONST.CACHE.PANE_DISCOVERY_ENTRIES;
    const layers: L.Layer[] = [];
    for (let i = 0; i < cap; i++) {
      const layer = { options: { pane: "custom" } } as unknown as L.Layer;
      layers.push(layer);
      pm.discoverChildPanes(layer);
    }
    const fresh = { options: { pane: "other" } } as unknown as L.Layer;
    pm.discoverChildPanes(fresh); // triggers the first eviction
    // The oldest entry was dropped — its owner now sees its mutation.
    layers[0].options.pane = "rebuilt";
    expect(pm.discoverChildPanes(layers[0])).toEqual(["rebuilt"]);
    // The newest entries are still cached — their mutations are invisible.
    layers[cap - 1].options.pane = "newer";
    expect(pm.discoverChildPanes(layers[cap - 1])).toEqual(["custom"]);
    expect(pm.discoverChildPanes(fresh)).toEqual(["other"]);
  });

  describe("pinTree", () => {
    const makePath = () => {
      const p = new window.L.Path();
      (p as unknown as { options: Record<string, unknown> }).options = {};
      return p as unknown as L.Path & { options: Record<string, unknown> };
    };

    const makeContainer = (children: L.Layer[]) =>
      ({
        options: {},
        eachLayer: (fn: (c: L.Layer) => void) => children.forEach(fn),
      }) as unknown as L.Layer;

    it("pins a Path leaf to both the pane and its renderer", () => {
      const renderer = { addTo: vi.fn() };
      const map = {
        getPane: vi.fn(() => document.createElement("div")),
        createPane: vi.fn(),
        _paneRenderers: { data: renderer },
      };
      const pm = new PaneManager(map);
      const path = makePath();
      pm.pinTree(path, "data");
      expect(path.options.pane).toBe("data");
      expect(path.options.paneSet).toBe(true);
      expect(path.options.renderer).toBe(renderer);
    });

    it("recurses into a container and pins every child path", () => {
      // A GeoJSON group handed to createLayers used to leave its child paths on
      // the map's default renderer, because only the top node got options.pane.
      // Leaflet ignores a group's pane for its children, so each child has to
      // carry it itself.
      const map = {
        getPane: vi.fn(() => document.createElement("div")),
        createPane: vi.fn(() => document.createElement("div")),
        _paneRenderers: {} as Record<string, unknown>,
      };
      const pm = new PaneManager(map);
      const children = [makePath(), makePath()];
      pm.pinTree(makeContainer(children), "data");
      for (const path of children) {
        expect(path.options.pane).toBe("data");
        expect(path.options.paneSet).toBe(true);
        expect(path.options.renderer).toBeDefined();
      }
    });

    it("pins a non-path leaf to the pane without a renderer", () => {
      const marker = { options: {} } as unknown as L.Layer & {
        options: Record<string, unknown>;
      };
      const map = {
        getPane: vi.fn(() => null),
        createPane: vi.fn(() => document.createElement("div")),
      };
      const pm = new PaneManager(map);
      pm.pinTree(marker, "data");
      expect(marker.options.pane).toBe("data");
      expect(marker.options.renderer).toBeUndefined();
    });

    it("invalidates the discovery cache for every node it pins", () => {
      const map = {
        getPane: vi.fn(() => null),
        createPane: vi.fn(() => document.createElement("div")),
      };
      const pm = new PaneManager(map);
      const child = { options: { pane: "old" } } as unknown as L.Layer;
      const group = {
        options: { pane: "old" },
        eachLayer: (fn: (c: L.Layer) => void) => fn(child),
      } as unknown as L.Layer;
      pm.pinTree(group, "new");
      expect(pm.discoverChildPanes(child)).toEqual(["new"]);
      expect(pm.discoverChildPanes(group)).toEqual(["new"]);
    });

    it("pinTree on one subtree invalidates the entries of every unrelated layer", () => {
      // Pre-fix gate for the generation counter: pinTree used to delete only
      // the entry for the node it pinned. If a caller pinned a subtree it
      // didn't own, entries for unrelated layers the caller held no reference
      // to could stay in the cache and serve stale pane names. Generation
      // bumping fixes that — pinTree's write is a full invalidation, and every
      // unrelated entry is dropped on its next read.
      const map = {
        getPane: vi.fn(() => null),
        createPane: vi.fn(() => document.createElement("div")),
      };
      const pm = new PaneManager(map);
      // Seed layer A's entry.
      const layerA = { options: { pane: "a" } } as unknown as L.Layer;
      expect(pm.discoverChildPanes(layerA)).toEqual(["a"]);
      // Pin an unrelated subtree; its options are already at the target pane,
      // so pinTree walks zero nodes it owns but still bumps the generation.
      const unrelated = { options: { pane: "b" } } as unknown as L.Layer;
      pm.pinTree(unrelated, "newb");
      // Mutate A and assert its next discovery reflects the mutation — on the
      // old per-node-delete policy the entry would have been served stale.
      layerA.options.pane = "a2";
      expect(pm.discoverChildPanes(layerA)).toEqual(["a2"]);
    });
  });

  it("ensureVector pins both renderer and pane on the layer", () => {
    // Contract test: both options.renderer and options.pane must be set on
    // the layer so a later setPane() cannot fall through to Leaflet's
    // default SVG renderer. This is the bug measure's preview stack had.
    const pane = document.createElement("div");
    const renderer = { addTo: vi.fn() };
    const map = {
      getPane: vi.fn(() => pane),
      createPane: vi.fn(),
    };
    const pm = new PaneManager(map);
    // Ensure the renderer is cached before we call ensureVector, so we
    // exercise the pin path (not the create path).
    pm.ensurePane("p", true);
    const layer = { options: {} as Record<string, unknown> } as unknown as L.Path;
    const pinned = pm.ensureVector(layer, "p");
    expect(pinned).toBeDefined();
    expect(layer.options.pane).toBe("p");
    expect(layer.options.renderer).toBe(pinned);
  });

  it("ensureVector still names the pane when no renderer can be built", () => {
    // `getRendererFor` degrades to null instead of throwing mid-map-operation.
    // The pane name must still be written: a Path with no renderer falls back
    // to Leaflet's own renderer *for that pane*, which is the right place to
    // be — and leaving `options.renderer` at a stale renderer would not be.
    const pane = document.createElement("div");
    const map = {
      getPane: vi.fn(() => pane),
      createPane: vi.fn(),
      _paneRenderers: {} as Record<string, unknown>,
    };
    window.L.svg = vi.fn(() => {
      throw new Error("no svg");
    });
    const pm = new PaneManager(map);
    const layer = {
      options: { renderer: { id: "stale" } } as Record<string, unknown>,
    } as unknown as L.Path;
    expect(pm.ensureVector(layer, "p")).toBeNull();
    expect(layer.options.pane).toBe("p");
    expect(layer.options.renderer).toBeUndefined();
  });

  // ── removePane (createCanvas.destroy / private panes) ──

  it("removePane detaches the pane and clears the renderer registry", () => {
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    const renderer = { id: "r" };
    const map = makeMap({ "foliplus-canvas-heat": pane });
    map._paneRenderers = { "foliplus-canvas-heat": renderer };
    const pm = new PaneManager(map);
    pm.registerPaneSpecs(specs("foliplus-canvas-heat"));
    pm.removePane("foliplus-canvas-heat");
    expect(map.removeLayer).toHaveBeenCalledWith(renderer);
    expect(map._panes["foliplus-canvas-heat"]).toBeUndefined();
    expect(map._paneRenderers["foliplus-canvas-heat"]).toBeUndefined();
    expect(pane.parentNode).toBeNull();
    expect(pm.childPaneSpecs.has("foliplus-canvas-heat")).toBe(false);
  });

  it("removePane is a no-op for an unknown pane name", () => {
    const map = makeMap({});
    const pm = new PaneManager(map);
    expect(() => pm.removePane("never-created")).not.toThrow();
    expect(map.removeLayer).not.toHaveBeenCalled();
  });

  it("removePane drops the record of a renderer that is already off the map", () => {
    // The renderer can be gone from the map before teardown reaches here (a
    // tile layer's renderer-less pane, or someone else's removeLayer). Our
    // record still has to be dropped: a pane re-created under the same name
    // would otherwise inherit a renderer the old pane still owns.
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    const renderer = { id: "r" };
    const map = makeMap({ "foliplus-canvas-heat": pane });
    map._paneRenderers = { "foliplus-canvas-heat": renderer };
    map.hasLayer = vi.fn(() => false);
    const pm = new PaneManager(map);
    pm.removePane("foliplus-canvas-heat");
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map._paneRenderers["foliplus-canvas-heat"]).toBeUndefined();
    expect(pane.parentNode).toBeNull();
  });

  it("removePane leaves sibling panes alone", () => {
    const heat = document.createElement("div");
    const other = document.createElement("div");
    document.body.appendChild(heat);
    document.body.appendChild(other);
    const map = makeMap({
      "foliplus-canvas-heat": heat,
      "foliplus-canvas-other": other,
    });
    const pm = new PaneManager(map);
    pm.removePane("foliplus-canvas-heat");
    expect(map._panes["foliplus-canvas-heat"]).toBeUndefined();
    expect(map._panes["foliplus-canvas-other"]).toBe(other);
    expect(other.parentNode).not.toBeNull();
  });

  it("destroy clears the records but leaves the map DOM alone", () => {
    const pane = document.createElement("div");
    const map = makeMap({ "foliplus-pane-1": pane });
    const pm = new PaneManager(map);
    pm.discoverChildPanes({ options: { pane: "a" } } as unknown as L.Layer);
    pm.registerPaneSpecs(specs("foliplus-measure-label"));
    pm.destroy();
    expect(pm.childPaneSpecs.size).toBe(0);
    // LayerManager.destroy() clears the registry without removing the
    // registered layers from the map — they are still live, so the pane DOM
    // must survive them.
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map._panes["foliplus-pane-1"]).toBe(pane);
  });

  // ── pinLateContent (the pin primitive LayerSurface calls for late content) ──

  it("pinLateContent is a no-op for empty input", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    expect(() => pm.pinLateContent([])).not.toThrow();
  });

  it("pinLateContent moves path nodes into the target pane", () => {
    const paneEl = document.createElement("div");
    const container = document.createElement("div");
    const path = document.createElement("path");
    const map = { getPane: vi.fn(() => paneEl), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = {
      getElement: () => path,
      options: {} as Record<string, unknown>,
      eachLayer: undefined,
    };
    Object.setPrototypeOf(layer, new window.L.Path());
    const renderer = { _container: container };
    pm.pinLateContent([{ layer, paneName: "foliplus-measure-graph", renderer }]);
    expect(layer.options.pane).toBe("foliplus-measure-graph");
    expect(layer.options.paneSet).toBe(true);
    expect(path.parentNode).toBe(container);
  });

  it("pinLateContent recurses through LayerGroup subtrees", () => {
    const paneEl = document.createElement("div");
    const container = document.createElement("div");
    const childPath = document.createElement("path");
    const map = { getPane: vi.fn(() => paneEl), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const child = { getElement: () => childPath, options: {} };
    Object.setPrototypeOf(child, new window.L.Path());
    const parent = {
      eachLayer: (cb: (c: unknown) => void) => cb(child),
      options: {},
    };
    const renderer = { _container: container };
    pm.pinLateContent([
      { layer: parent, paneName: "foliplus-measure-graph", renderer },
    ]);
    expect(child.options.pane).toBe("foliplus-measure-graph");
    expect(child.options.paneSet).toBe(true);
    expect(childPath.parentNode).toBe(container);
  });

  it("pinLateContent moves marker icons into the pane", () => {
    const paneEl = document.createElement("div");
    const icon = document.createElement("img");
    const shadow = document.createElement("img");
    const map = { getPane: vi.fn(() => paneEl), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = {
      getElement: () => icon,
      _shadow: shadow,
      options: {},
      eachLayer: undefined,
    };
    // Force instanceof checks by setting prototypes
    Object.setPrototypeOf(layer, new window.L.Marker());
    const renderer = { _container: document.createElement("div") };
    pm.pinLateContent([{ layer, paneName: "foliplus-measure-graph", renderer }]);
    expect(icon.parentNode).toBe(paneEl);
    expect(shadow.parentNode).toBe(paneEl);
  });

  it("pinLateContent batches every marker of one pane into a single append", () => {
    // The second marker against the same target pane is the path where the
    // per-pane group already exists — and it is what proves the batch appends
    // both markers (shadow then icon, per marker) instead of replacing the
    // first one's nodes.
    const paneEl = document.createElement("div");
    const map = { getPane: vi.fn(() => paneEl), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const renderer = { _container: document.createElement("div") };
    const markers = [0, 1].map(() => {
      const icon = document.createElement("img");
      const shadow = document.createElement("img");
      const layer = {
        getElement: () => icon,
        _shadow: shadow,
        options: {},
        eachLayer: undefined,
      };
      Object.setPrototypeOf(layer, new window.L.Marker());
      return { layer, icon, shadow };
    });
    pm.pinLateContent(
      markers.map(({ layer }) => ({
        layer,
        paneName: "foliplus-measure-graph",
        renderer,
      })),
    );
    expect(Array.from(paneEl.children)).toEqual([
      markers[0].shadow,
      markers[0].icon,
      markers[1].shadow,
      markers[1].icon,
    ]);
  });

  it("pinLateContent is idempotent for markers already in the target pane", () => {
    // A reconcile re-runs this after every content change, so a node that is
    // already where it belongs must not be re-appended — appending a node that
    // is already a child re-orders it. A marker with no shadow at all has to
    // survive the same pass.
    const paneEl = document.createElement("div");
    document.body.appendChild(paneEl);
    const map = { getPane: vi.fn(() => paneEl), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const renderer = { _container: document.createElement("div") };

    const icon = document.createElement("img");
    const shadow = document.createElement("img");
    paneEl.append(shadow, icon);
    const inPlace = {
      getElement: () => icon,
      _shadow: shadow,
      options: {},
      eachLayer: undefined,
    };
    Object.setPrototypeOf(inPlace, new window.L.Marker());

    const bareIcon = document.createElement("img");
    const noShadow = {
      getElement: () => bareIcon,
      options: {},
      eachLayer: undefined,
    };
    Object.setPrototypeOf(noShadow, new window.L.Marker());

    pm.pinLateContent([
      { layer: inPlace, paneName: "foliplus-measure-graph", renderer },
      { layer: noShadow, paneName: "foliplus-measure-graph", renderer },
    ]);

    // The settled pair keeps its position; only the shadow-less marker's icon
    // is appended, after it.
    expect(Array.from(paneEl.children)).toEqual([shadow, icon, bareIcon]);
  });

  it("pinLateContent skips layers without a paneName", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = { options: {}, eachLayer: undefined };
    expect(() =>
      pm.pinLateContent([{ layer, paneName: null, renderer: null }]),
    ).not.toThrow();
  });

  it("pinLateContent marks a layer handled even when the renderer container is missing", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = { options: {} as Record<string, unknown>, eachLayer: undefined };
    // A null renderer (e.g. tile layers with a paneName) previously skipped the
    // whole layer without setting options.pane/paneSet, so a dirty surface
    // re-queued it on every reconcile. The options must still be marked handled.
    pm.pinLateContent([{ layer, paneName: "foliplus-measure-graph", renderer: null }]);
    expect(layer.options.pane).toBe("foliplus-measure-graph");
    expect(layer.options.paneSet).toBe(true);
  });
});

describe("dual map isolation", () => {
  // The core/layer foundation must be safe under concurrent multi-map
  // rendering. Every piece of state (paneSpecs, the discovery memo, the
  // instance itself) is per-instance — no module-level singleton is
  // allowed to bleed panes from one map into another. These tests pin
  // that invariant: two independently-constructed instances on two
  // independently-constructed maps stay fully independent.

  it("two independent PaneManager instances do not share childPaneSpecs", () => {
    const mapA = { getPane: vi.fn(), createPane: vi.fn() };
    const mapB = { getPane: vi.fn(), createPane: vi.fn() };
    const pmA = new PaneManager(mapA);
    const pmB = new PaneManager(mapB);
    pmA.registerPaneSpecs(specs("a-only"));
    pmB.registerPaneSpecs(specs("b-only"));
    expect(pmA.childPaneSpecs.has("a-only")).toBe(true);
    expect(pmA.childPaneSpecs.has("b-only")).toBe(false);
    expect(pmB.childPaneSpecs.has("a-only")).toBe(false);
    expect(pmB.childPaneSpecs.has("b-only")).toBe(true);
  });

  it("sweepChildPanes on one instance does not affect the other", () => {
    const mapA = { getPane: vi.fn(), createPane: vi.fn() };
    const mapB = { getPane: vi.fn(), createPane: vi.fn() };
    const pmA = new PaneManager(mapA);
    const pmB = new PaneManager(mapB);
    pmA.registerPaneSpecs(specs("shared", "dropped"));
    pmB.registerPaneSpecs(specs("shared", "kept"));
    // Sweep A so "dropped" is gone; B keeps both because "shared" is still
    // referenced and "kept" was never swept.
    pmA.sweepChildPanes([{ paneSpecs: specs("shared") }]);
    expect(pmA.childPaneSpecs.has("dropped")).toBe(false);
    expect(pmA.childPaneSpecs.has("shared")).toBe(true);
    expect(pmB.childPaneSpecs.has("shared")).toBe(true);
    expect(pmB.childPaneSpecs.has("kept")).toBe(true);
  });

  it("cache invalidation on one instance does not touch the other", () => {
    const mapA = { getPane: vi.fn(), createPane: vi.fn() };
    const mapB = { getPane: vi.fn(), createPane: vi.fn() };
    const pmA = new PaneManager(mapA);
    const pmB = new PaneManager(mapB);
    const layer = { options: { pane: "custom" } } as unknown as L.Layer;
    expect(pmA.discoverChildPanes(layer)).toEqual(["custom"]);
    expect(pmB.discoverChildPanes(layer)).toEqual(["custom"]);
    // Both caches keyed by the same layer stamp — invalidate only A's. B
    // must keep serving its own cached entry even though the layer's options
    // move in the gap.
    pmA.reset(L.stamp(layer));
    layer.options.pane = "changed";
    expect(pmA.discoverChildPanes(layer)).toEqual(["changed"]);
    expect(pmB.discoverChildPanes(layer)).toEqual(["custom"]);
  });
});
