import { beforeEach, describe, expect, it, vi } from "vitest";
import { LayerSurface } from "#foliplus/core/layer/LayerSurface.js";
import { PaneManager } from "#foliplus/core/layer/PaneManager.js";
import * as CONST from "#foliplus/core/layer/const.js";
import type { PaneSpec } from "#foliplus/core/layer/type.js";

// Minimal Leaflet shapes: the surface only reads `options`, `eachLayer`
// (containers), `getElement` + `_map` (attached DOM) and the `instanceof`
// identities the pane decision turns on. The move itself lives in
// `PaneManager.pinLateContent`, which reads the same fields.
class Path {
  options: Record<string, unknown> = {};
  _map: unknown = null;
  element: Element | null = null;
  getElement() {
    return this.element;
  }
}

class Polygon {
  options: Record<string, unknown> = {};
}

class Polyline {
  options: Record<string, unknown> = {};
}

class Marker {
  options: Record<string, unknown> = {};
  _map: unknown = null;
  element: HTMLElement | null = null;
  _shadow: HTMLElement | null = null;
  getElement() {
    return this.element;
  }
}

class GridLayer {
  options: Record<string, unknown> = {};
}

class TileLayer extends GridLayer {}

class MarkerClusterGroup {
  options: Record<string, unknown> = {};
}

class ImageOverlay {
  options: Record<string, unknown> = {};
}

/** A container: `eachLayer` is what makes `pinLateContent` recurse instead of
 *  treating it as a leaf. */
class Group {
  options: Record<string, unknown> = {};
  children: unknown[] = [];
  constructor(children: unknown[] = []) {
    this.children = children;
  }
  eachLayer(fn: (child: unknown) => void) {
    this.children.forEach(fn);
  }
  addLayer(layer: unknown) {
    this.children.push(layer);
    return this;
  }
}

let stampId = 0;

/** The pane spec list `createLayers` derives from an ordered name list: the
 *  first name is the base pane, everything after it a `sub`, each one draw
 *  offset above the previous. */
const specs = (...names: string[]): PaneSpec[] =>
  names.map((name, i) => ({ role: i === 0 ? "base" : "sub", order: i, name }));

const makeMap = () => {
  const panes: Record<string, HTMLElement> = {};
  const map = {
    getPane: (name: string) => panes[name] ?? null,
    createPane: (name: string) => {
      const el = document.createElement("div");
      el.classList.add("foliplus-layer-pane");
      panes[name] = el;
      return el;
    },
    hasLayer: () => true,
    removeLayer: vi.fn(),
    _panes: panes,
    _paneRenderers: {} as Record<string, unknown>,
  };
  return { map, panes, host: new PaneManager(map as unknown as L.Map) };
};

beforeEach(() => {
  stampId = 0;
  window.L.svg = vi.fn(() => ({
    addTo: vi.fn(),
    _container: document.createElement("div"),
  }));
  window.L.stamp = vi.fn((obj: { __id?: number }) => (obj.__id ??= ++stampId));
  window.L.Path = Path as unknown as typeof L.Path;
  window.L.Polygon = Polygon as unknown as typeof L.Polygon;
  window.L.Polyline = Polyline as unknown as typeof L.Polyline;
  window.L.Marker = Marker as unknown as typeof L.Marker;
  window.L.GridLayer = GridLayer as unknown as typeof L.GridLayer;
  window.L.TileLayer = TileLayer as unknown as typeof L.TileLayer;
  window.L.MarkerClusterGroup =
    MarkerClusterGroup as unknown as typeof L.MarkerClusterGroup;
  window.L.ImageOverlay = ImageOverlay as unknown as typeof L.ImageOverlay;
  window.L.Renderer = class {} as unknown as typeof L.Renderer;
});

describe("LayerSurface pane resolution", () => {
  it("takes the declared pane as base and never synthesizes one", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "a",
      layer: new Path() as unknown as L.Layer,
      paneName: "graph",
    });
    expect(surface.paneNames).toEqual(["graph"]);
    expect(surface.synthesizedPaneName).toBeNull();
    expect(surface.panes[0].role).toBe("base");
    // The base pane carries a renderer: the surface places Path content itself.
    expect(surface.panes[0].renderer).not.toBeNull();
  });

  it("appends sub-panes in declaration order, without a renderer each", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "a",
      layer: new Path() as unknown as L.Layer,
      paneName: "graph",
      paneSpecs: specs("graph", "node", "label"),
    });
    // paneName is also paneSpecs[0]; it must not be listed twice.
    expect(surface.paneNames).toEqual(["graph", "node", "label"]);
    expect(surface.panes.map(p => p.role)).toEqual(["base", "sub", "sub"]);
    // A sub-pane's renderer belongs to the content that routes into it
    // (createLayers' ensureVector): building one here would put an empty
    // full-size <svg> in every label pane.
    expect(surface.panes[1].renderer).toBeNull();
    expect(window.L.svg).toHaveBeenCalledTimes(1);
  });

  it("gives a canvas pane no renderer", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "heat",
      layer: null,
      paneName: CONST.CANVAS_PANE_PREFIX + "heat",
      canvas: true,
    });
    expect(surface.paneNames).toEqual([CONST.CANVAS_PANE_PREFIX + "heat"]);
    expect(surface.panes[0].renderer).toBeNull();
  });

  it("gives a GridLayer no pane at all — it carries its z itself", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "tiles",
      layer: new TileLayer() as unknown as L.Layer,
    });
    expect(surface.panes).toEqual([]);
    expect(surface.synthesizedPaneName).toBeNull();
    expect(surface.setZ(600)).toBe(false);
  });

  it("adopts the child panes the layer's own tree names", () => {
    const { map, panes, host } = makeMap();
    host.registerPaneSpecs(specs("own"));
    const child = new Path();
    child.options.pane = "own";
    const foreign = new Path();
    foreign.options.pane = "foreign";
    const surface = new LayerSurface(host, {
      id: "mixed",
      layer: new Group([child, foreign]) as unknown as L.Layer,
    });
    expect(surface.paneNames).toEqual(["own", "foreign"]);
    expect(surface.synthesizedPaneName).toBeNull();
    // A pane we registered for createLayers already has its renderer; a foreign
    // one is claimed by building one.
    expect(window.L.svg).toHaveBeenCalledTimes(1);
    expect(panes.own).toBeDefined();
    expect(panes.foreign).toBeDefined();
  });

  it("synthesizes a stamp-named pane when the layer declares none", () => {
    const { map, host } = makeMap();
    const layer = new Group([new Marker()]);
    const surface = new LayerSurface(host, {
      id: "plain",
      layer: layer as unknown as L.Layer,
    });
    expect(surface.synthesizedPaneName).toBe(
      `${CONST.FALLBACK_PANE_PREFIX}${window.L.stamp(layer)}`,
    );
    expect(surface.paneNames).toEqual([surface.synthesizedPaneName]);
    expect(surface.panes[0].renderer).not.toBeNull();
  });

  it("never writes pointer-events onto a pane", () => {
    // Whether a pane's content takes a hit is that content's own call:
    // AnnotationCanvas writes `none` on itself, a data canvas is re-enabled by
    // the canvas rule in LayerControl/focus.css. The surface stays out of it.
    const { map, panes, host } = makeMap();
    new LayerSurface(host, {
      id: "mixed",
      layer: new Path() as unknown as L.Layer,
      paneName: "graph",
      paneSpecs: specs("graph", "label"),
    });
    expect(panes.graph.style.pointerEvents).toBe("");
    expect(panes.label.style.pointerEvents).toBe("");
  });

  it("skips a duplicate base pane name in the specs slice", () => {
    // specs("graph","label") with paneName="graph" → the slice(1) loop sees
    // only "label". If someone passes specs("graph","graph"), the second "graph"
    // must not create a second pane with the same name.
    const { map, panes, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "dup",
      layer: new Path() as unknown as L.Layer,
      paneName: "graph",
      paneSpecs: [
        { role: "base", order: 0, name: "graph" },
        { role: "sub", order: 1, name: "graph" },
      ],
    });
    expect(surface.paneNames).toEqual(["graph"]);
    expect(Object.keys(panes).filter(k => k === "graph")).toHaveLength(1);
  });
});

describe("LayerSurface.materialize", () => {
  it("routes a declared layer before it joins the map (I1)", () => {
    const { map, host } = makeMap();
    const layer = new Path();
    const surface = new LayerSurface(host, {
      id: "a",
      layer: layer as unknown as L.Layer,
      paneName: "graph",
    });
    surface.materialize();
    expect(layer.options.pane).toBe("graph");
    expect(layer.options.paneSet).toBe(true);
    expect(layer.options.renderer).toBe(surface.panes[0].renderer);
    expect(surface.materialized).toBe(true);
  });

  it("leaves a declared container's children to the caller's routing", () => {
    // createLayers picks a sub-pane per leaf; pinning the tree here would
    // collapse every leaf onto the base pane.
    const { map, host } = makeMap();
    const child = new Path();
    const group = new Group([child]);
    const surface = new LayerSurface(host, {
      id: "a",
      layer: group as unknown as L.Layer,
      paneName: "graph",
      paneSpecs: specs("graph", "label"),
    });
    surface.materialize();
    expect(group.options.pane).toBe("graph");
    expect(child.options.pane).toBeUndefined();
  });

  it("pins a synthesized surface's whole tree", () => {
    const { map, host } = makeMap();
    const child = new Marker();
    const layer = new Group([child]);
    const surface = new LayerSurface(host, {
      id: "plain",
      layer: layer as unknown as L.Layer,
    });
    surface.materialize();
    const pane = surface.synthesizedPaneName!;
    expect(child.options.pane).toBe(pane);
    expect(child.options.paneSet).toBe(true);
    // A container is not given options.pane — Leaflet ignores a group's pane
    // for its children, which is why the pin walks the tree at all.
    expect(layer.options.pane).toBeUndefined();
    expect(host.discoverChildPanes(layer as unknown as L.Layer)).toEqual([]);
  });

  it("costs nothing once the content has settled", () => {
    // The property the ordering pass depends on: a pass over materialized
    // surfaces writes z and never walks a tree again.
    const { map, host } = makeMap();
    const reconcile = vi.spyOn(host, "pinLateContent");
    const surface = new LayerSurface(host, {
      id: "plain",
      layer: new Group([new Marker()]) as unknown as L.Layer,
    });
    surface.materialize();
    expect(reconcile).toHaveBeenCalledTimes(1);
    surface.materialize();
    surface.materialize();
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("reconciles again once the content is marked dirty", () => {
    const { map, host } = makeMap();
    const reconcile = vi.spyOn(host, "pinLateContent");
    const surface = new LayerSurface(host, {
      id: "plain",
      layer: new Group([new Marker()]) as unknown as L.Layer,
    });
    surface.materialize();
    surface.markContentDirty();
    expect(surface.contentDirty).toBe(true);
    surface.materialize();
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(surface.contentDirty).toBe(false);
  });

  it("pins content that arrives after materialization", () => {
    const { map, host } = makeMap();
    const group = new Group();
    const surface = new LayerSurface(host, {
      id: "plain",
      layer: group as unknown as L.Layer,
    });
    surface.materialize();
    const late = new Marker();
    group.addLayer(late);
    // The manager marks the surface dirty on the layer add; the next pass
    // reconciles and the late marker joins the pane.
    surface.markContentDirty();
    surface.materialize();
    expect(late.options.pane).toBe(surface.synthesizedPaneName);
  });

  it("moves content Leaflet has already attached", () => {
    const { map, host } = makeMap();
    const attached = new Marker();
    attached._map = map;
    attached.element = document.createElement("img");
    attached._shadow = document.createElement("img");
    document.body.append(attached._shadow, attached.element);
    const surface = new LayerSurface(host, {
      id: "plain",
      layer: new Group([attached]) as unknown as L.Layer,
    });
    surface.materialize();
    const paneEl = surface.panes[0].element;
    // Shadow first, then icon — Marker.onAdd's own order.
    expect(Array.from(paneEl.children)).toEqual([attached._shadow, attached.element]);
  });

  it("moves an attached path into the pane's renderer", () => {
    const { map, host } = makeMap();
    const path = new Path();
    path._map = map;
    path.element = document.createElementNS("http://www.w3.org/2000/svg", "path");
    document.body.appendChild(path.element!);
    const surface = new LayerSurface(host, {
      id: "plain",
      layer: new Group([path]) as unknown as L.Layer,
    });
    surface.materialize();
    const renderer = surface.panes[0].renderer as unknown as {
      _container: HTMLElement;
    };
    expect(path.element!.parentNode).toBe(renderer._container);
  });

  it("no-ops when the layer is null (canvas surface)", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "heat",
      layer: null,
      paneName: CONST.CANVAS_PANE_PREFIX + "heat",
      canvas: true,
    });
    // A canvas surface has no layer to pin — materialize is a no-op.
    const reconcile = vi.spyOn(host, "pinLateContent");
    surface.materialize();
    expect(reconcile).not.toHaveBeenCalled();
    expect(surface.materialized).toBe(true);
  });

  it("no-ops when the surface has no panes (GridLayer)", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "tiles",
      layer: new TileLayer() as unknown as L.Layer,
    });
    // A GridLayer paints in tilePane and carries its z itself — no panes,
    // so reconcile has nothing to do.
    const reconcile = vi.spyOn(host, "pinLateContent");
    surface.materialize();
    expect(reconcile).not.toHaveBeenCalled();
    expect(surface.materialized).toBe(true);
  });
});

describe("LayerSurface.setZ", () => {
  it("writes each pane's z as base + its own order, pane by pane", () => {
    // Three panes (graph, node, label — the shape MeasureControl paints) so the
    // offset is checked for the third pane too, not just the first sub-pane.
    const { map, panes, host } = makeMap();
    const declared = specs("graph", "node", "label");
    host.registerPaneSpecs(declared);
    const graph = new Path();
    graph.options.pane = "graph";
    const node = new Path();
    node.options.pane = "node";
    const label = new Path();
    label.options.pane = "label";
    const surface = new LayerSurface(host, {
      id: "a",
      layer: new Group([graph, node, label]) as unknown as L.Layer,
      paneName: "graph",
      paneSpecs: declared,
    });
    expect(surface.setZ(620)).toBe(true);
    expect(panes.graph.style.zIndex).toBe("620");
    expect(panes.node.style.zIndex).toBe("621");
    expect(panes.label.style.zIndex).toBe("622");
  });

  it("writes the synthesized pane's z", () => {
    const { map, panes, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "plain",
      layer: new Group([new Marker()]) as unknown as L.Layer,
    });
    expect(surface.setZ(640)).toBe(true);
    expect(panes[surface.synthesizedPaneName!].style.zIndex).toBe("640");
  });
});

describe("LayerSurface.setZOverride / restoreZ", () => {
  const makeStacked = () => {
    const { panes, host } = makeMap();
    const declared = specs("graph", "node", "label");
    host.registerPaneSpecs(declared);
    const graph = new Path();
    graph.options.pane = "graph";
    const node = new Path();
    node.options.pane = "node";
    const label = new Path();
    label.options.pane = "label";
    const surface = new LayerSurface(host, {
      id: "a",
      layer: new Group([graph, node, label]) as unknown as L.Layer,
      paneName: "graph",
      paneSpecs: declared,
    });
    return { panes, surface };
  };

  it("lifts every pane to base + its own order, so the layer's internal order survives", () => {
    const { panes, surface } = makeStacked();
    surface.setZ(620);
    expect(surface.setZOverride(8990)).toBe(true);
    expect(panes.graph.style.zIndex).toBe("8990");
    expect(panes.node.style.zIndex).toBe("8991");
    expect(panes.label.style.zIndex).toBe("8992");
  });

  it("restores the ordering pass's z, pane by pane", () => {
    const { panes, surface } = makeStacked();
    surface.setZ(620);
    surface.setZOverride(8990);
    expect(surface.restoreZ()).toBe(true);
    expect(panes.graph.style.zIndex).toBe("620");
    expect(panes.node.style.zIndex).toBe("621");
    expect(panes.label.style.zIndex).toBe("622");
  });

  it("restores the panes' pre-lift z when the ordering pass has not written yet", () => {
    const { panes, surface } = makeStacked();
    // PaneManager gave the declared panes their provisional z, so that is what
    // a lift records and restore returns to.
    expect(panes.graph.style.zIndex).toBe("600");
    expect(panes.node.style.zIndex).toBe("601");
    expect(panes.label.style.zIndex).toBe("602");
    expect(surface.setZOverride(8990)).toBe(true);
    expect(surface.restoreZ()).toBe(true);
    expect(panes.graph.style.zIndex).toBe("600");
    expect(panes.node.style.zIndex).toBe("601");
    expect(panes.label.style.zIndex).toBe("602");
  });

  it("keeps the lift while the ordering pass re-runs, then lands on the newer slot", () => {
    const { panes, surface } = makeStacked();
    surface.setZ(620);
    surface.setZOverride(8990);
    surface.setZ(650);
    expect(panes.graph.style.zIndex).toBe("8990");
    expect(surface.restoreZ()).toBe(true);
    expect(panes.graph.style.zIndex).toBe("650");
    expect(panes.node.style.zIndex).toBe("651");
    expect(panes.label.style.zIndex).toBe("652");
  });

  it("ignores a second lift and a restore with nothing lifted", () => {
    const { surface } = makeStacked();
    expect(surface.restoreZ()).toBe(false);
    expect(surface.setZOverride(8990)).toBe(true);
    expect(surface.setZOverride(7000)).toBe(false);
  });

  it("returns false for a surface that paints through no pane of its own", () => {
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "tile",
      layer: new TileLayer() as unknown as L.Layer,
    });
    expect(surface.setZOverride(8990)).toBe(false);
    expect(surface.restoreZ()).toBe(false);
  });

  it("handles restoreZ with zBefore unset (defensive guard)", () => {
    // setZOverride always sets zBefore before overrideZ, so this state is
    // unreachable through the public API. The ?? [] on the loop guards against
    // a future refactor that forgets to set it — it should no-op, not throw.
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "plain",
      layer: new Group([new Marker()]) as unknown as L.Layer,
    });
    const surfaceAny = surface as unknown as Record<string, unknown>;
    surfaceAny.overrideZ = 8990;
    expect(surface.restoreZ()).toBe(true);
    expect(surfaceAny.overrideZ).toBeUndefined();
  });

  it("is a translation, not a re-sort: the panes' relative order holds at both bases", () => {
    // Two sub-panes plus the layer's annotation pane. `writeZ` prices an
    // annotation pane at base + ANNOTATION_Z_OFFSET and ignores its order, so it
    // lands level with a sub-pane; a focus lift must not change that
    // relationship, only the base everything sits at.
    const { panes, host } = makeMap();
    const declared: PaneSpec[] = [
      { role: "base", order: 0, name: "graph" },
      { role: "sub", order: 1, name: "node" },
      { role: "sub", order: 2, name: "label" },
      { role: "annotation", order: 3, name: "ann" },
    ];
    host.registerPaneSpecs(declared);
    const mk = (name: string) => {
      const path = new Path();
      path.options.pane = name;
      return path;
    };
    const surface = new LayerSurface(host, {
      id: "a",
      layer: new Group([
        mk("graph"),
        mk("node"),
        mk("label"),
        mk("ann"),
      ]) as unknown as L.Layer,
      paneName: "graph",
      paneSpecs: declared,
    });
    // The pairwise relation matrix (-1 / 0 / 1) pins the ordering without
    // naming a single value.
    const relations = () => {
      const z = ["graph", "node", "label", "ann"].map(n =>
        Number(panes[n].style.zIndex),
      );
      return z.map((a, i) => z.map((b, j) => Math.sign(a - b)));
    };
    surface.setZ(620);
    const ordered = relations();
    surface.setZOverride(8990);
    expect(panes.graph.style.zIndex).toBe("8990");
    expect(relations()).toEqual(ordered);
    surface.restoreZ();
    expect(relations()).toEqual(ordered);
  });
});

describe("LayerSurface.matches", () => {
  it("is true only for the same layer object and the same declaration", () => {
    const { map, host } = makeMap();
    const layer = new Group();
    const surface = new LayerSurface(host, {
      id: "a",
      layer: layer as unknown as L.Layer,
      paneName: "graph",
      paneSpecs: specs("graph", "label"),
    });
    const base = {
      id: "a",
      layer: layer as unknown as L.Layer,
      paneName: "graph",
      paneSpecs: specs("graph", "label"),
    };
    expect(surface.matches(base)).toBe(true);
    expect(surface.matches({ ...base, layer: new Group() as unknown as L.Layer })).toBe(
      false,
    );
    expect(surface.matches({ ...base, paneName: "other" })).toBe(false);
    expect(surface.matches({ ...base, paneSpecs: specs("graph") })).toBe(false);
    // A declaration that names no panes at all, and one that names the same
    // number but not the same panes.
    expect(surface.matches({ ...base, paneSpecs: undefined })).toBe(false);
    expect(surface.matches({ ...base, paneSpecs: specs("graph", "other") })).toBe(
      false,
    );
    // Same names, but a different role on the second pane.
    expect(
      surface.matches({
        ...base,
        paneSpecs: [
          { ...base.paneSpecs[0] },
          { ...base.paneSpecs[1], role: "annotation" },
        ],
      }),
    ).toBe(false);
  });

  it("treats a changed fill as the same face — a repaint, not a rebuild", () => {
    const { host } = makeMap();
    const base = {
      id: "solid",
      layer: null,
      paneName: CONST.COLOR_PANE_PREFIX + "solid",
      canvas: true,
      color: "#000000",
    };
    const surface = new LayerSurface(host, base);
    expect(surface.matches(base)).toBe(true);
    expect(surface.matches({ ...base, color: "#ffffff" })).toBe(true);
  });

  it("treats the color going away as a different face (both directions)", () => {
    // `zoomRange: "none"` is the color the color branch buys. If a re-register
    // that drops the fill matched the old face, a real canvas would inherit a
    // capability it does not have — the pane would keep answering "no range"
    // after the map could hide it again. Presence is the invariant, not value.
    const { host } = makeMap();
    const color = {
      id: "solid",
      layer: null,
      paneName: CONST.COLOR_PANE_PREFIX + "solid",
      canvas: true,
      color: "#000000",
    };
    const surface = new LayerSurface(host, color);
    expect(surface.matches({ ...color, color: null })).toBe(false);
    expect(surface.matches({ ...color, color: undefined })).toBe(false);

    const bare = new LayerSurface(host, { ...color, color: undefined });
    expect(bare.matches({ ...color, color: undefined })).toBe(true);
    expect(bare.matches(color)).toBe(false);
  });

  // ── getBounds comparison uses `hasBoundsProvider` (the same source
  // `detectCapabilities.bounds` reads from) rather than the captured
  // `spec.getBounds` field ─────────────────────────────────────────
  // The declaration's `spec.getBounds` records what the caller handed in, not
  // whether the surface actually exposes bounds — a layer that carries its own
  // `getBounds()` gets `capabilities.bounds: true` regardless. Comparing the
  // two fields by presence conflates "declared provider" with "layer's own
  // method" and reads "changed" on every native-layer re-registration that
  // drops or adds a provider, rebuilding a face that does not need rebuilding.
  // `matches` must go through `hasBoundsProvider` on both sides so the
  // comparison mirrors the derivation `capabilities.bounds` uses.

  it("compares bounds presence by the layer's own getBounds (bare layer, no native method)", () => {
    // A layer with no native getBounds: `hasBoundsProvider` is false on every
    // side, so a declared provider is present or absent the same way on both
    // sides regardless. Reference equality would read "changed" on every pass
    // because callers hand a fresh arrow each register — presence is the
    // invariant.
    const { host } = makeMap();
    const layer = new Path();
    const base = {
      id: "a",
      layer: layer as unknown as L.Layer,
      paneName: "graph",
    };
    const surface = new LayerSurface(host, base);
    expect(surface.matches(base)).toBe(true);
    expect(surface.matches({ ...base, getBounds: () => null })).toBe(true);
    expect(surface.matches({ ...base, getBounds: undefined })).toBe(true);

    // The provider is compared by reference — a different arrow is not a
    // different face.
    const withArrow = new LayerSurface(host, { ...base, getBounds: () => null });
    expect(withArrow.matches({ ...base, getBounds: () => null })).toBe(true);
  });

  it("ignores the caller's provider for a layer that carries its own getBounds", () => {
    // The layer's own method is the same source on both sides — presence is
    // true for any caller's arrow, so adding or dropping a provider does not
    // read "changed". Re-registering the same native layer with or without a
    // provider is a repaint, not a rebuild; `capabilities.bounds` answers true
    // on every branch.
    const { host } = makeMap();
    const layer = new Path();
    Object.assign(layer, { getBounds: vi.fn() });
    const base = {
      id: "a",
      layer: layer as unknown as L.Layer,
      paneName: "graph",
    };
    const surface = new LayerSurface(host, base);
    expect(surface.matches(base)).toBe(true);
    expect(surface.matches({ ...base, getBounds: () => null })).toBe(true);
    expect(surface.matches({ ...base, getBounds: undefined })).toBe(true);

    // The reversed registration reads the same way: adding a provider to a
    // surface that was built with a declared one does not change the face.
    const withProvider = new LayerSurface(host, { ...base, getBounds: () => null });
    expect(withProvider.matches(base)).toBe(true);
    expect(withProvider.matches({ ...base, getBounds: () => null })).toBe(true);
  });

  it("compares a canvas surface's provider against itself (no layer, no native source)", () => {
    // `canvas: true` with `layer: null` means no native `getBounds` exists; the
    // same-source check reads false on every side regardless of the declared
    // provider. Reference equality would have read "changed" on every fresh
    // arrow — presence is the invariant, not the value or the ref.
    const { host } = makeMap();
    const base = {
      id: "heat",
      layer: null,
      paneName: CONST.CANVAS_PANE_PREFIX + "heat",
      canvas: true,
    };
    const surface = new LayerSurface(host, base);
    expect(surface.matches(base)).toBe(true);
    expect(surface.matches({ ...base, getBounds: () => null })).toBe(true);
    expect(surface.matches({ ...base, getBounds: undefined })).toBe(true);
    expect(surface.matches({ ...base, getBounds: null })).toBe(true);
  });
});

describe("LayerSurface.destroy", () => {
  it("releases only the pane it synthesized", () => {
    const { map, panes, host } = makeMap();
    const synthesized = new LayerSurface(host, {
      id: "plain",
      layer: new Group([new Marker()]) as unknown as L.Layer,
    });
    synthesized.materialize();
    const paneName = synthesized.synthesizedPaneName!;
    synthesized.destroy();
    expect(panes[paneName]).toBeUndefined();

    const declared = new LayerSurface(host, {
      id: "a",
      layer: new Path() as unknown as L.Layer,
      paneName: "graph",
    });
    declared.materialize();
    declared.destroy();
    // A declared pane survives: the same id must be registrable again without
    // rebuilding its panes.
    expect(panes.graph).toBeDefined();
  });
});

describe("LayerSurface.geometryType / invalidate", () => {
  it("returns null for a surface with no layer, and caches that answer", () => {
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "heat",
      layer: null,
      paneName: CONST.CANVAS_PANE_PREFIX + "heat",
      canvas: true,
    });
    expect(surface.geometryType()).toBeNull();
    expect(surface.geometryType()).toBeNull();
  });

  it("reports a Polygon group as polygon", () => {
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "poly",
      layer: new Group([new Polygon()]) as unknown as L.Layer,
    });
    expect(surface.geometryType()).toBe(CONST.GEOM_TYPE.POLYGON);
  });

  it("reuses the cached answer — content changes do not leak through until invalidate", () => {
    // The group holds a polygon; clear its children so a fresh probe would
    // return EMPTY. geometryType() still yields the cached polygon — that is
    // what makes invalidate() the only entry point for the manager to force
    // a re-probe when createLayers clears or re-fills a group at runtime.
    const { host } = makeMap();
    const group = new Group([new Polygon()]);
    const surface = new LayerSurface(host, {
      id: "cached",
      layer: group as unknown as L.Layer,
    });
    expect(surface.geometryType()).toBe(CONST.GEOM_TYPE.POLYGON);
    group.children = [];
    expect(surface.geometryType()).toBe(CONST.GEOM_TYPE.POLYGON);
    group.children = [];
    expect(surface.geometryType()).toBe(CONST.GEOM_TYPE.POLYGON);
  });

  it("invalidate drops the cache so the next read re-probes the current layer", () => {
    const { host } = makeMap();
    const group = new Group([new Polygon()]);
    const surface = new LayerSurface(host, {
      id: "reprobe",
      layer: group as unknown as L.Layer,
    });
    expect(surface.geometryType()).toBe(CONST.GEOM_TYPE.POLYGON);
    group.children = [];
    expect(surface.geometryType()).toBe(CONST.GEOM_TYPE.POLYGON);
    surface.invalidate();
    expect(surface.geometryType()).toBe(CONST.GEOM_TYPE.EMPTY);
  });

  it("invalidate is a no-op when the cache is already empty", () => {
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "empty",
      layer: null,
      paneName: CONST.CANVAS_PANE_PREFIX + "empty",
      canvas: true,
    });
    expect(() => surface.invalidate()).not.toThrow();
    expect(surface.geometryType()).toBeNull();
  });
});

describe("LayerSurface capabilities", () => {
  it("reports opacity none for a MarkerClusterGroup layer", () => {
    const { map, host } = makeMap();
    const cluster = new MarkerClusterGroup();
    const surface = new LayerSurface(host, {
      id: "cluster",
      layer: cluster as unknown as L.Layer,
    });
    expect(surface.capabilities.opacity).toBe("none");
    expect(surface.capabilities.zoomRange).toBe("none");
    expect(surface.capabilities.relocatable).toBe(false);
  });

  it("instanceof false: L.MarkerClusterGroup is a function but layer is not an instance", () => {
    const { map, host } = makeMap();
    const saved = (window.L as { MarkerClusterGroup?: unknown }).MarkerClusterGroup;
    const Ctor = function NotCluster() {} as unknown as new (
      ...args: never[]
    ) => unknown;
    (window.L as { MarkerClusterGroup?: unknown }).MarkerClusterGroup = Ctor;
    const layer = new Path() as unknown as L.Layer;
    const surface = new LayerSurface(host, {
      id: "plain",
      layer,
    });
    expect(surface.capabilities.opacity).not.toBe("none");
    (window.L as { MarkerClusterGroup?: unknown }).MarkerClusterGroup = saved;
  });

  it("fallback: _topClusterLevel is falsy when L.MarkerClusterGroup is undefined", () => {
    const { map, host } = makeMap();
    const saved = (window.L as { MarkerClusterGroup?: unknown }).MarkerClusterGroup;
    (window.L as { MarkerClusterGroup?: unknown }).MarkerClusterGroup = undefined;
    const layer = new Path() as unknown as L.Layer;
    const surface = new LayerSurface(host, {
      id: "plain2",
      layer,
    });
    expect(surface.capabilities.opacity).not.toBe("none");
    (window.L as { MarkerClusterGroup?: unknown }).MarkerClusterGroup = saved;
  });

  it("reports native opacity and native zoomRange for a GridLayer", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "tiles",
      layer: new GridLayer() as unknown as L.Layer,
    });
    expect(surface.capabilities.opacity).toBe("native");
    expect(surface.capabilities.zoomRange).toBe("native");
    expect(surface.capabilities.relocatable).toBe(true);
  });

  it("reports native opacity but none zoomRange for an ImageOverlay", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "overlay",
      layer: new ImageOverlay() as unknown as L.Layer,
    });
    expect(surface.capabilities.opacity).toBe("native");
    expect(surface.capabilities.zoomRange).toBe("none");
    expect(surface.capabilities.relocatable).toBe(true);
  });

  it("derives the color face's capabilities and pane from its declaration", () => {
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "solid",
      layer: null,
      paneName: CONST.COLOR_PANE_PREFIX + "solid",
      canvas: true,
      color: "#000000",
    });
    expect(surface.capabilities).toEqual({
      opacity: "pane",
      zoomRange: "none",
      relocatable: true,
      bounds: false,
    });
    // The declared color pane is taken as base — no synthesis, and no SVG
    // renderer, since a flat fill has no vectors to render into.
    expect(surface.paneNames).toEqual([CONST.COLOR_PANE_PREFIX + "solid"]);
    expect(surface.panes[0].role).toBe("base");
    expect(surface.panes[0].renderer).toBeNull();
    expect(surface.synthesizedPaneName).toBeNull();
  });

  it("keeps the canvas zoom range when no fill is declared", () => {
    // The contrast that makes the color branch worth having: same pane shape,
    // same `canvas` flag, only the fill decides. Without it the pane answers
    // "the map can hide me by zoom", which a basemap must not.
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "heat",
      layer: null,
      paneName: CONST.CANVAS_PANE_PREFIX + "heat",
      canvas: true,
    });
    expect(surface.capabilities.zoomRange).toBe("pane");
  });

  // ── bounds: static capability declaration ───────────────────────
  // bounds answers "can this surface be asked for a geographic extent to
  // focus on?" — a yes/no that the UI uses to disable the ⋮ menu's focus
  // action rather than let a click land as a silent no-op. Each branch
  // below is a different reason for yes / no.

  it("reports bounds false for a MarkerClusterGroup (no honest carrier)", () => {
    const { map, host } = makeMap();
    const cluster = new MarkerClusterGroup();
    const surface = new LayerSurface(host, {
      id: "cluster",
      layer: cluster as unknown as L.Layer,
    });
    expect(surface.capabilities.bounds).toBe(false);
  });

  it("reports bounds true for a GridLayer with getBounds", () => {
    const { map, host } = makeMap();
    const tiles = new GridLayer();
    Object.assign(tiles, { getBounds: vi.fn() });
    const surface = new LayerSurface(host, {
      id: "tiles",
      layer: tiles as unknown as L.Layer,
    });
    expect(surface.capabilities.bounds).toBe(true);
  });

  it("reports bounds false for a GridLayer without getBounds", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "tiles",
      layer: new GridLayer() as unknown as L.Layer,
    });
    expect(surface.capabilities.bounds).toBe(false);
  });

  it("reports bounds true for an ImageOverlay with getBounds", () => {
    const { map, host } = makeMap();
    const overlay = new ImageOverlay();
    Object.assign(overlay, { getBounds: vi.fn() });
    const surface = new LayerSurface(host, {
      id: "overlay",
      layer: overlay as unknown as L.Layer,
    });
    expect(surface.capabilities.bounds).toBe(true);
  });

  it("reports bounds false for an ImageOverlay without getBounds", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "overlay",
      layer: new ImageOverlay() as unknown as L.Layer,
    });
    expect(surface.capabilities.bounds).toBe(false);
  });

  it("reports bounds true for a pane-painted layer with getBounds", () => {
    const { map, host } = makeMap();
    const path = new Path();
    Object.assign(path, { getBounds: vi.fn() });
    const surface = new LayerSurface(host, {
      id: "a",
      layer: path as unknown as L.Layer,
      paneName: "graph",
    });
    expect(surface.capabilities.bounds).toBe(true);
  });

  it("reports bounds false for a pane-painted layer without getBounds", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "a",
      layer: new Path() as unknown as L.Layer,
      paneName: "graph",
    });
    expect(surface.capabilities.bounds).toBe(false);
  });

  it("reports bounds true for a canvas surface with a getBounds provider", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "canvas",
      layer: null,
      canvas: true,
      getBounds: () => null,
    });
    expect(surface.capabilities.bounds).toBe(true);
  });

  it("reports bounds false for a canvas surface without a getBounds provider", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "canvas",
      layer: null,
      canvas: true,
    });
    expect(surface.capabilities.bounds).toBe(false);
  });

  it("reports bounds false when paneSpecs is an empty array (partial branch)", () => {
    // Covers the `opts.paneSpecs && opts.paneSpecs.length > 0` condition where
    // paneSpecs is truthy (non-null) but empty — the short-circuit does NOT
    // fire, and the code falls through to the `if (layer)` branch.
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "empty-specs",
      layer: new Path() as unknown as L.Layer,
      paneSpecs: [],
    });
    expect(surface.capabilities.bounds).toBe(false);
  });

  it("reports bounds true when paneSpecs is empty but the layer has getBounds", () => {
    const { map, host } = makeMap();
    const path = new Path();
    Object.assign(path, { getBounds: vi.fn() });
    const surface = new LayerSurface(host, {
      id: "empty-specs-bounds",
      layer: path as unknown as L.Layer,
      paneSpecs: [],
    });
    expect(surface.capabilities.bounds).toBe(true);
  });

  it("reports bounds false when there is no layer and no canvas", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "empty",
      layer: null,
    });
    expect(surface.capabilities.bounds).toBe(false);
  });

  it("reports bounds true for a bare layer with getBounds (no declared pane)", () => {
    // A non-grid, non-native layer with no paneName/paneSpecs/canvas: the
    // surface synthesizes a fallback pane, and bounds is decided by the
    // layer's own getBounds method (not opts.getBounds, which is undefined).
    const { map, host } = makeMap();
    const path = new Path();
    Object.assign(path, { getBounds: vi.fn() });
    const surface = new LayerSurface(host, {
      id: "bare",
      layer: path as unknown as L.Layer,
    });
    expect(surface.capabilities.bounds).toBe(true);
  });

  it("reports bounds false for a bare layer without getBounds (no declared pane)", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "bare",
      layer: new Path() as unknown as L.Layer,
    });
    expect(surface.capabilities.bounds).toBe(false);
  });

  it("warns when paneName fails injection safety (covers log.warn)", () => {
    // PANE_NAME_PATTERN is /^[a-zA-Z0-9_-]+$/ — a paneName with a space or
    // special character is rejected, and the surface synthesizes a fallback
    // pane instead. The log.warn at line 121 fires only for this path.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "inject",
      layer: new Path() as unknown as L.Layer,
      paneName: "bad name with spaces",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("rejected paneName for injection safety"),
    );
    // The surface falls back to a synthesized pane.
    expect(surface.synthesizedPaneName).not.toBeNull();
    warnSpy.mockRestore();
  });
});
