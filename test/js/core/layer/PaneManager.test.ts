import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaneManager } from "#foliplus/core/layer/PaneManager.js";
import * as CONST from "#foliplus/core/layer/const.js";

// Mock L.svg — needed by PaneManager.ensurePane
beforeEach(() => {
  vi.clearAllMocks();
  window.L.svg = vi.fn(() => ({ addTo: vi.fn() }));
  window.L.stamp = vi.fn(obj => obj.__id ?? (obj.__id = ++count));
  window.L.Path = class {};
  window.L.Marker = class {};
});
let count = 0;

// Naming convention: DOM/CSS/named panes use hyphens; internal object keys
// (RENDERER_KEY) keep underscores. See CLAUDE / layer const comments.
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

  it("RENDERER_KEY stays underscored as an internal map key", () => {
    expect(CONST.RENDERER_KEY).toBe("foliplus_renderer_");
  });
});

// Map stub for the fallback-pane tests. Mirrors the two renderer registries
// real Leaflet keeps, both keyed by pane name: foliplus's own key and
// `_paneRenderers`. Pass a distinct leafletRenderer to force them apart.
const makeMap = (
  panes: Record<string, HTMLElement>,
  {
    renderer,
    leafletRenderer,
  }: {
    renderer?: Record<string, unknown>;
    leafletRenderer?: Record<string, unknown>;
  } = {},
) => {
  const map = {
    getPane: vi.fn(name => panes[name] ?? null),
    createPane: vi.fn(),
    removeLayer: vi.fn(),
    hasLayer: vi.fn(() => true),
    _panes: panes,
  };
  for (const [pane, r] of Object.entries(renderer ?? {})) {
    map[`${CONST.RENDERER_KEY}${pane}`] = r;
  }
  if (leafletRenderer) map._paneRenderers = leafletRenderer;
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

  it("getLayerPanes returns fallback pane when registered", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = { options: {} };
    const stamp = 42;
    window.L.stamp = vi.fn(() => stamp);
    pm.fallbackPaneMap.set(stamp, "foliplus-pane-42");
    expect(pm.getLayerPanes(layer)).toEqual(["foliplus-pane-42"]);
  });

  it("getLayerPanes falls back to overlayPane/markerPane by default", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = { options: {} };
    expect(pm.getLayerPanes(layer)).toEqual(["overlayPane", "markerPane"]);
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
    // First creation: graph=BASE, node=BASE+STEP, label=BASE+2*STEP.
    // Re-entry (pane already exists) must NOT touch z-index — bumpPanes
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
    pm.registerSubPanes([
      "foliplus-measure-graph",
      "foliplus-measure-node",
      "foliplus-measure-label",
    ]);

    pm.ensurePane("foliplus-measure-label", false);
    pm.ensurePane("foliplus-measure-node", false);
    pm.ensurePane("foliplus-measure-graph", false);

    const base = CONST.Z_INDEX.BASE;
    const step = Number(CONST.CHILD_PANE_STEP);
    expect(panes["foliplus-measure-graph"]!.style.zIndex).toBe(String(base));
    expect(panes["foliplus-measure-node"]!.style.zIndex).toBe(String(base + step));
    expect(panes["foliplus-measure-label"]!.style.zIndex).toBe(String(base + 2 * step));

    // Simulate bumpPanes overwriting with a higher position-based base.
    panes["foliplus-measure-label"]!.style.zIndex = "622";
    pm.ensurePane("foliplus-measure-label", false);
    expect(panes["foliplus-measure-label"]!.style.zIndex).toBe("622");
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
      "foliplus_renderer_foliplus-measure-graph": renderer,
    };
    const pm = new PaneManager(map);
    const result = pm.ensurePane("foliplus-measure-graph", true);
    expect(window.L.svg).not.toHaveBeenCalled();
    expect(result.renderer).toBe(renderer);
  });

  it("discoverChildPanes filters out default panes", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = {
      options: { pane: "overlayPane" },
    };
    expect(pm.discoverChildPanes(layer)).toEqual([]);
  });

  it("bumpPanes sets z + k * STEP on each sub-pane by its list index", () => {
    const graph = document.createElement("div");
    const label = document.createElement("div");
    const map = {
      getPane: vi.fn(name => (name === "g" ? graph : label)),
      createPane: vi.fn(),
    };
    const pm = new PaneManager(map);
    pm.registerSubPanes(["g", "label"]);
    // A container that advertises both child panes: discoverChildPanes
    // walks `eachLayer` and collects every child's options.pane.
    // The container itself also needs an `options` bag because traverse
    // visits the outer node too (leafOnly=false).
    const layer = {
      options: {},
      eachLayer: (fn: (c: { options: { pane?: string } }) => void) => {
        fn({ options: { pane: "g" } });
        fn({ options: { pane: "label" } });
      },
    } as unknown as L.Layer;
    pm.bumpPanes(layer, 600, ["g", "label"]);
    // base pane at k=0, label pane at k=1 * STEP
    expect(graph.style.zIndex).toBe(String(600 + 0 * Number(CONST.CHILD_PANE_STEP)));
    expect(label.style.zIndex).toBe(String(600 + 1 * Number(CONST.CHILD_PANE_STEP)));
  });

  it("bumpPanes handles three sub-panes with ascending offsets", () => {
    // The whole point of the panes-list refactor is N panes. Exercise a
    // 3-pane layer (graph, node, label — the shape MeasureControl's
    // closed PR #271 wanted) to prove the offset math doesn't have a
    // hard-coded cap.
    const graph = document.createElement("div");
    const node = document.createElement("div");
    const label = document.createElement("div");
    const map = {
      getPane: vi.fn(name => (name === "g" ? graph : name === "n" ? node : label)),
      createPane: vi.fn(),
    };
    const pm = new PaneManager(map);
    pm.registerSubPanes(["g", "n", "label"]);
    const layer = {
      options: {},
      eachLayer: (fn: (c: { options: { pane?: string } }) => void) => {
        fn({ options: { pane: "g" } });
        fn({ options: { pane: "n" } });
        fn({ options: { pane: "label" } });
      },
    } as unknown as L.Layer;
    pm.bumpPanes(layer, 600, ["g", "n", "label"]);
    expect(graph.style.zIndex).toBe(String(600 + 0 * Number(CONST.CHILD_PANE_STEP)));
    expect(node.style.zIndex).toBe(String(600 + 1 * Number(CONST.CHILD_PANE_STEP)));
    expect(label.style.zIndex).toBe(String(600 + 2 * Number(CONST.CHILD_PANE_STEP)));
  });

  it("bumpPanes ignores child panes not in the caller's subPanes list", () => {
    // A foreign pane that a third-party component put on the map: we
    // registered only our two, so the foreign one is left at its own z.
    const ours = document.createElement("div");
    const foreign = document.createElement("div");
    foreign.style.zIndex = "999";
    const map = {
      getPane: vi.fn(name => (name === "ours" ? ours : foreign)),
      createPane: vi.fn(),
    };
    const pm = new PaneManager(map);
    pm.registerSubPanes(["ours"]);
    const layer = {
      options: {},
      eachLayer: (fn: (c: { options: { pane?: string } }) => void) => {
        fn({ options: { pane: "ours" } });
        fn({ options: { pane: "foreign" } });
      },
    } as unknown as L.Layer;
    pm.bumpPanes(layer, 600, ["ours"]);
    expect(ours.style.zIndex).toBe("600");
    expect(foreign.style.zIndex).toBe("999"); // untouched
  });

  it("bumpPanes skips a registered pane this call did not declare", () => {
    // childPanes is per map — every layer's registerSubPanes adds to it — while
    // subPanes is one layer's ordered list. A pane another layer registered,
    // that this layer's tree happens to advertise, must keep its own z: only
    // the panes this call declared get an offset.
    const ours = document.createElement("div");
    const theirs = document.createElement("div");
    theirs.style.zIndex = "777";
    const map = {
      getPane: vi.fn(name => (name === "ours" ? ours : theirs)),
      createPane: vi.fn(),
    };
    const pm = new PaneManager(map);
    pm.registerSubPanes(["ours", "theirs"]);
    const layer = {
      options: {},
      eachLayer: (fn: (c: { options: { pane?: string } }) => void) => {
        fn({ options: { pane: "ours" } });
        fn({ options: { pane: "theirs" } });
      },
    } as unknown as L.Layer;
    pm.bumpPanes(layer, 600, ["ours"]);
    expect(ours.style.zIndex).toBe("600");
    expect(theirs.style.zIndex).toBe("777"); // untouched
  });

  it("reset clears the pane cache", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    pm.paneCache.set(1, ["a"]);
    pm.reset();
    expect(pm.paneCache.size).toBe(0);
  });

  it("reset(id) invalidates only the matching cache entry", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    pm.paneCache.set(1, ["a"]);
    pm.paneCache.set(2, ["b"]);
    pm.reset(1);
    expect(pm.paneCache.has(1)).toBe(false);
    expect(pm.paneCache.get(2)).toEqual(["b"]);
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
    // After a targeted invalidation the new pane is observed
    pm.reset(window.L.stamp(layer));
    expect(pm.discoverChildPanes(layer)).toEqual(["other_pane"]);
  });

  it("sweepChildPanes drops entries no longer referenced", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    pm.registerSubPanes(["keep_label", "drop_label"]);
    pm.sweepChildPanes([{ subPanes: ["keep_label"] }, {}, { subPanes: [] }]);
    expect(pm.childPanes.has("keep_label")).toBe(true);
    expect(pm.childPanes.has("drop_label")).toBe(false);
  });

  it("sweepChildPanes keeps a pane shared by multiple layers", () => {
    // Two layers both use "shared_label" — after sweeping, the pane must
    // stay because it's still referenced by at least one layer.
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    pm.registerSubPanes(["shared_label"]);
    pm.sweepChildPanes([
      { subPanes: ["shared_label"] },
      { subPanes: ["shared_label"] },
    ]);
    expect(pm.childPanes.has("shared_label")).toBe(true);
  });

  it("sweepChildPanes is a no-op when nothing is registered", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    expect(() => pm.sweepChildPanes([{ subPanes: ["phantom"] }])).not.toThrow();
    expect(pm.childPanes.size).toBe(0);
  });

  it("registerSubPanes is idempotent", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    pm.registerSubPanes(["a", "b"]);
    pm.registerSubPanes(["a", "b", "c"]);
    pm.registerSubPanes(["a", "b"]); // duplicate
    expect(pm.childPanes.size).toBe(3);
    expect(pm.childPanes.has("a")).toBe(true);
    expect(pm.childPanes.has("b")).toBe(true);
    expect(pm.childPanes.has("c")).toBe(true);
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

  it("releaseFallbackPane detaches a fallback pane and its renderer", () => {
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    const renderer = {};
    const map = makeMap(
      { "foliplus-pane-1": pane },
      {
        renderer: { "foliplus-pane-1": renderer },
        leafletRenderer: { "foliplus-pane-1": renderer },
      },
    );
    const pm = new PaneManager(map);
    pm.fallbackPaneMap.set(1, "foliplus-pane-1");
    pm.releaseFallbackPane(1);
    expect(map.removeLayer).toHaveBeenCalledWith(renderer);
    expect(map._panes["foliplus-pane-1"]).toBeUndefined();
    expect(pane.parentNode).toBeNull();
    expect(pm.fallbackPaneMap.size).toBe(0);
  });

  it("releaseFallbackPane clears both renderer registries", () => {
    const pane = document.createElement("div");
    const renderer = {};
    // A different object: real Leaflet stores the same renderer in both
    // registries, so sharing it here would make the _paneRenderers assertion
    // implied by the foliplus key assertion.
    const staleRenderer = {};
    const map = makeMap(
      { "foliplus-pane-1": pane },
      {
        renderer: { "foliplus-pane-1": renderer },
        leafletRenderer: { "foliplus-pane-1": staleRenderer },
      },
    );
    const pm = new PaneManager(map);
    pm.fallbackPaneMap.set(1, "foliplus-pane-1");
    pm.releaseFallbackPane(1);
    expect(map[CONST.RENDERER_KEY + "foliplus-pane-1"]).toBeUndefined();
    // getRenderer() re-adds a renderer it finds off the map, so a stale
    // _paneRenderers entry would resurrect the dead renderer.
    expect(map._paneRenderers["foliplus-pane-1"]).toBeUndefined();
  });

  it("releaseFallbackPane leaves other layers' panes alone", () => {
    const paneA = document.createElement("div");
    const paneB = document.createElement("div");
    document.body.appendChild(paneA);
    document.body.appendChild(paneB);
    // Distinct ids: the two stubs would otherwise compare structurally equal
    // and make the "not called with B" assertion vacuous.
    const rendererA = { id: "a" };
    const rendererB = { id: "b" };
    const map = makeMap(
      { "foliplus-pane-a": paneA, "foliplus-pane-b": paneB },
      {
        renderer: { "foliplus-pane-a": rendererA, "foliplus-pane-b": rendererB },
        leafletRenderer: { "foliplus-pane-a": rendererA, "foliplus-pane-b": rendererB },
      },
    );
    const pm = new PaneManager(map);
    pm.fallbackPaneMap.set(1, "foliplus-pane-a");
    pm.fallbackPaneMap.set(2, "foliplus-pane-b");
    pm.releaseFallbackPane(1);
    expect(map.removeLayer).toHaveBeenCalledWith(rendererA);
    expect(map.removeLayer).not.toHaveBeenCalledWith(rendererB);
    expect(map._panes["foliplus-pane-a"]).toBeUndefined();
    expect(map._panes["foliplus-pane-b"]).toBe(paneB);
    // B's renderer must not be detached or dropped from Leaflet's registry.
    expect(map._paneRenderers["foliplus-pane-b"]).toBe(rendererB);
    expect(pm.fallbackPaneMap.size).toBe(1);
  });

  it("releaseFallbackPane is a no-op with no stamp", () => {
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    const renderer = {};
    const map = makeMap(
      { "foliplus-pane-1": pane },
      { renderer: { "foliplus-pane-1": renderer } },
    );
    const pm = new PaneManager(map);
    pm.fallbackPaneMap.set(1, "foliplus-pane-1");
    pm.releaseFallbackPane(null);
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map._panes["foliplus-pane-1"]).toBe(pane);
    expect(pm.fallbackPaneMap.size).toBe(1);
  });

  it("releaseFallbackPane is a no-op when no fallback pane was assigned", () => {
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    const map = makeMap({ "foliplus-pane-1": pane }, { leafletRenderer: {} });
    const pm = new PaneManager(map);
    // No fallbackPaneMap entry (e.g. a layer that uses a named pane instead).
    pm.releaseFallbackPane(1);
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map._panes["foliplus-pane-1"]).toBe(pane);
  });

  it("releaseFallbackPane handles a renderer-less pane (tile layer)", () => {
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    // Tile layers get a fallback pane with needRenderer=false, so there is no
    // foliplus RENDERER_KEY entry to clean — only the pane + Leaflet's own
    // registry.
    const map = makeMap({ "foliplus-pane-1": pane }, { leafletRenderer: {} });
    const pm = new PaneManager(map);
    pm.fallbackPaneMap.set(1, "foliplus-pane-1");
    pm.releaseFallbackPane(1);
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map._panes["foliplus-pane-1"]).toBeUndefined();
    expect(pane.parentNode).toBeNull();
    expect(pm.fallbackPaneMap.size).toBe(0);
  });

  // ── removePane (createCanvas.destroy / private panes) ──

  it("removePane detaches the pane and clears both renderer registries", () => {
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    const renderer = { id: "r" };
    const map = makeMap(
      { "foliplus-canvas-heat": pane },
      {
        renderer: { "foliplus-canvas-heat": renderer },
        leafletRenderer: { "foliplus-canvas-heat": renderer },
      },
    );
    const pm = new PaneManager(map);
    pm.registerSubPanes(["foliplus-canvas-heat"]);
    pm.removePane("foliplus-canvas-heat");
    expect(map.removeLayer).toHaveBeenCalledWith(renderer);
    expect(map._panes["foliplus-canvas-heat"]).toBeUndefined();
    expect(map[`${CONST.RENDERER_KEY}foliplus-canvas-heat`]).toBeUndefined();
    expect(map._paneRenderers["foliplus-canvas-heat"]).toBeUndefined();
    expect(pane.parentNode).toBeNull();
    expect(pm.childPanes.has("foliplus-canvas-heat")).toBe(false);
  });

  it("removePane is a no-op for an unknown pane name", () => {
    const map = makeMap({}, { leafletRenderer: {} });
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
    const map = makeMap(
      { "foliplus-canvas-heat": pane },
      { renderer: { "foliplus-canvas-heat": renderer } },
    );
    map.hasLayer = vi.fn(() => false);
    const pm = new PaneManager(map);
    pm.removePane("foliplus-canvas-heat");
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map[`${CONST.RENDERER_KEY}foliplus-canvas-heat`]).toBeUndefined();
    expect(pane.parentNode).toBeNull();
  });

  it("removePane leaves sibling panes alone", () => {
    const heat = document.createElement("div");
    const other = document.createElement("div");
    document.body.appendChild(heat);
    document.body.appendChild(other);
    const map = makeMap(
      { "foliplus-canvas-heat": heat, "foliplus-canvas-other": other },
      { leafletRenderer: {} },
    );
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
    pm.paneCache.set(1, ["a"]);
    pm.fallbackPaneMap.set(1, "foliplus-pane-1");
    pm.registerSubPanes(["foliplus-measure-label"]);
    pm.destroy();
    expect(pm.paneCache.size).toBe(0);
    expect(pm.fallbackPaneMap.size).toBe(0);
    expect(pm.childPanes.size).toBe(0);
    // LayerManager.destroy() clears the registry without removing the
    // registered layers from the map — they are still live, so the pane DOM
    // must survive them.
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map._panes["foliplus-pane-1"]).toBe(pane);
  });

  it("migrateLayers is a no-op for empty input", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    expect(() => pm.migrateLayers([])).not.toThrow();
  });

  it("migrateLayers moves path nodes into the target pane", () => {
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
    pm.migrateLayers([{ layer, paneName: "foliplus-measure-graph", renderer }]);
    expect(layer.options.pane).toBe("foliplus-measure-graph");
    expect(layer.options.paneSet).toBe(true);
    expect(path.parentNode).toBe(container);
  });

  it("migrateLayers recurses through LayerGroup subtrees", () => {
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
    pm.migrateLayers([{ layer: parent, paneName: "foliplus-measure-graph", renderer }]);
    expect(child.options.pane).toBe("foliplus-measure-graph");
    expect(child.options.paneSet).toBe(true);
    expect(childPath.parentNode).toBe(container);
  });

  it("migrateLayers moves marker icons into the pane", () => {
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
    pm.migrateLayers([{ layer, paneName: "foliplus-measure-graph", renderer }]);
    expect(icon.parentNode).toBe(paneEl);
    expect(shadow.parentNode).toBe(paneEl);
  });

  it("migrateLayers batches every marker of one pane into a single append", () => {
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
    pm.migrateLayers(
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

  it("migrateLayers is idempotent for markers already in the target pane", () => {
    // enforceOrder runs migrateLayers on every pass, so a node that is already
    // where it belongs must not be re-appended — appending a node that is
    // already a child re-orders it. A marker with no shadow at all has to
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

    pm.migrateLayers([
      { layer: inPlace, paneName: "foliplus-measure-graph", renderer },
      { layer: noShadow, paneName: "foliplus-measure-graph", renderer },
    ]);

    // The settled pair keeps its position; only the shadow-less marker's icon
    // is appended, after it.
    expect(Array.from(paneEl.children)).toEqual([shadow, icon, bareIcon]);
  });

  it("migrateLayers skips layers without a paneName", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = { options: {}, eachLayer: undefined };
    expect(() =>
      pm.migrateLayers([{ layer, paneName: null, renderer: null }]),
    ).not.toThrow();
  });

  it("migrateLayers marks a layer handled even when the renderer container is missing", () => {
    const map = { getPane: vi.fn(), createPane: vi.fn() };
    const pm = new PaneManager(map);
    const layer = { options: {} as Record<string, unknown>, eachLayer: undefined };
    // A null renderer (e.g. tile layers with a paneName) previously skipped the
    // whole layer without setting options.pane/paneSet, so the manager re-queued
    // it on every enforceOrder pass. The options must still be marked handled.
    pm.migrateLayers([{ layer, paneName: "foliplus-measure-graph", renderer: null }]);
    expect(layer.options.pane).toBe("foliplus-measure-graph");
    expect(layer.options.paneSet).toBe(true);
  });
});
