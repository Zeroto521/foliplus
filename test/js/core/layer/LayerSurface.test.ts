import { beforeEach, describe, expect, it, vi } from "vitest";
import { LayerSurface } from "#foliplus/core/layer/LayerSurface.js";
import { PaneManager } from "#foliplus/core/layer/PaneManager.js";
import * as CONST from "#foliplus/core/layer/const.js";

// Minimal Leaflet shapes: the surface only reads `options`, `eachLayer`
// (containers), `getElement` + `_map` (attached DOM) and the `instanceof`
// identities the pane decision turns on. The move itself lives in
// `PaneManager.migrateLayers`, which reads the same fields.
class Path {
  options: Record<string, unknown> = {};
  _map: unknown = null;
  element: HTMLElement | null = null;
  getElement() {
    return this.element;
  }
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

/** A container: `eachLayer` is what makes `migrateLayers` recurse instead of
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
  window.L.Marker = Marker as unknown as typeof L.Marker;
  window.L.GridLayer = GridLayer as unknown as typeof L.GridLayer;
  window.L.TileLayer = TileLayer as unknown as typeof L.TileLayer;
  window.L.Renderer = class {} as unknown as typeof L.Renderer;
});

describe("LayerSurface pane resolution", () => {
  it("takes the declared pane as base and never synthesizes one", () => {
    const { map, host } = makeMap();
    const surface = new LayerSurface(map as unknown as L.Map, host, {
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
    const surface = new LayerSurface(map as unknown as L.Map, host, {
      id: "a",
      layer: new Path() as unknown as L.Layer,
      paneName: "graph",
      subPanes: ["graph", "node", "label"],
    });
    // paneName is also subPanes[0]; it must not be listed twice.
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
    const surface = new LayerSurface(map as unknown as L.Map, host, {
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
    const surface = new LayerSurface(map as unknown as L.Map, host, {
      id: "tiles",
      layer: new TileLayer() as unknown as L.Layer,
    });
    expect(surface.panes).toEqual([]);
    expect(surface.synthesizedPaneName).toBeNull();
    expect(surface.setZ(600)).toBe(false);
  });

  it("adopts the child panes the layer's own tree names", () => {
    const { map, panes, host } = makeMap();
    host.registerSubPanes(["own"]);
    const child = new Path();
    child.options.pane = "own";
    const foreign = new Path();
    foreign.options.pane = "foreign";
    const surface = new LayerSurface(map as unknown as L.Map, host, {
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
    const surface = new LayerSurface(map as unknown as L.Map, host, {
      id: "plain",
      layer: layer as unknown as L.Layer,
    });
    expect(surface.synthesizedPaneName).toBe(
      `${CONST.FALLBACK_PANE_PREFIX}${window.L.stamp(layer)}`,
    );
    expect(surface.paneNames).toEqual([surface.synthesizedPaneName]);
    expect(surface.panes[0].renderer).not.toBeNull();
  });
});

describe("LayerSurface.materialize", () => {
  it("routes a declared layer before it joins the map (I1)", () => {
    const { map, host } = makeMap();
    const layer = new Path();
    const surface = new LayerSurface(map as unknown as L.Map, host, {
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
    const surface = new LayerSurface(map as unknown as L.Map, host, {
      id: "a",
      layer: group as unknown as L.Layer,
      paneName: "graph",
      subPanes: ["graph", "label"],
    });
    surface.materialize();
    expect(group.options.pane).toBe("graph");
    expect(child.options.pane).toBeUndefined();
  });

  it("pins a synthesized surface's whole tree", () => {
    const { map, host } = makeMap();
    const child = new Marker();
    const layer = new Group([child]);
    const surface = new LayerSurface(map as unknown as L.Map, host, {
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
    const reconcile = vi.spyOn(host, "migrateLayers");
    const surface = new LayerSurface(map as unknown as L.Map, host, {
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
    const reconcile = vi.spyOn(host, "migrateLayers");
    const surface = new LayerSurface(map as unknown as L.Map, host, {
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
    const surface = new LayerSurface(map as unknown as L.Map, host, {
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
    const surface = new LayerSurface(map as unknown as L.Map, host, {
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
    document.body.appendChild(path.element);
    const surface = new LayerSurface(map as unknown as L.Map, host, {
      id: "plain",
      layer: new Group([path]) as unknown as L.Layer,
    });
    surface.materialize();
    const renderer = surface.panes[0].renderer as unknown as {
      _container: HTMLElement;
    };
    expect(path.element.parentNode).toBe(renderer._container);
  });
});

describe("LayerSurface.setZ", () => {
  it("writes the base z and steps each sub-pane above it", () => {
    const { map, panes, host } = makeMap();
    host.registerSubPanes(["graph", "label"]);
    const graph = new Path();
    graph.options.pane = "graph";
    const label = new Path();
    label.options.pane = "label";
    const surface = new LayerSurface(map as unknown as L.Map, host, {
      id: "a",
      layer: new Group([graph, label]) as unknown as L.Layer,
      paneName: "graph",
      subPanes: ["graph", "label"],
    });
    expect(surface.setZ(620)).toBe(true);
    expect(panes.graph.style.zIndex).toBe("620");
    expect(panes.label.style.zIndex).toBe(String(620 + Number(CONST.CHILD_PANE_STEP)));
  });

  it("writes the synthesized pane's z", () => {
    const { map, panes, host } = makeMap();
    const surface = new LayerSurface(map as unknown as L.Map, host, {
      id: "plain",
      layer: new Group([new Marker()]) as unknown as L.Layer,
    });
    expect(surface.setZ(640)).toBe(true);
    expect(panes[surface.synthesizedPaneName!].style.zIndex).toBe("640");
  });
});

describe("LayerSurface.matches", () => {
  it("is true only for the same layer object and the same declaration", () => {
    const { map, host } = makeMap();
    const layer = new Group();
    const surface = new LayerSurface(map as unknown as L.Map, host, {
      id: "a",
      layer: layer as unknown as L.Layer,
      paneName: "graph",
      subPanes: ["graph", "label"],
    });
    const base = {
      id: "a",
      layer: layer as unknown as L.Layer,
      paneName: "graph",
      subPanes: ["graph", "label"],
    };
    expect(surface.matches(base)).toBe(true);
    expect(surface.matches({ ...base, layer: new Group() as unknown as L.Layer })).toBe(
      false,
    );
    expect(surface.matches({ ...base, paneName: "other" })).toBe(false);
    expect(surface.matches({ ...base, subPanes: ["graph"] })).toBe(false);
  });
});

describe("LayerSurface.destroy", () => {
  it("releases only the pane it synthesized", () => {
    const { map, panes, host } = makeMap();
    const synthesized = new LayerSurface(map as unknown as L.Map, host, {
      id: "plain",
      layer: new Group([new Marker()]) as unknown as L.Layer,
    });
    synthesized.materialize();
    const paneName = synthesized.synthesizedPaneName!;
    synthesized.destroy();
    expect(panes[paneName]).toBeUndefined();

    const declared = new LayerSurface(map as unknown as L.Map, host, {
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
