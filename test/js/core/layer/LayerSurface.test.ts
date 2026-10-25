import { beforeEach, describe, expect, it, vi } from "vitest";
import { LayerSurface } from "#foliplus/core/layer/LayerSurface.js";
import { PaneManager } from "#foliplus/core/layer/PaneManager.js";
import * as capabilityModule from "#foliplus/core/layer/capability.js";
import * as carrierModule from "#foliplus/core/layer/carrier.js";
import * as CONST from "#foliplus/core/layer/const.js";
import type { PaneSpec } from "#foliplus/core/layer/type.js";
import { CLUSTER_CAPABILITIES, deriveLayerKind } from "#foliplus/core/layer/util.js";

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

/** A pixel-radius leaf — the only carrier of the size axis. `_radius` is the
 *  pixel value `setRadius` writes; the absence of `_mRadius` is what keeps a
 *  metre-radius circle out of the match. */
class CircleMarker {
  options: Record<string, unknown> = {};
  _radius: number;
  constructor(radius = 10) {
    this._radius = radius;
  }
  setRadius(radius: number) {
    this._radius = radius;
    return this;
  }
  getRadius() {
    return this._radius;
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
    const { host } = makeMap();
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
    const { host } = makeMap();
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

  it("skips a declared spec the tree already routes into", () => {
    // `addMissingSpecs` fills the gap the non-declared branches leave (they
    // only walk discovered or synthesized panes) — but a spec whose name is
    // ALREADY booked by discovery must not be double-added: the handle the
    // tree routed into is the one that stands.
    const { host } = makeMap();
    const annName = "foliplus-annotation-a";
    const surface = new LayerSurface(host, {
      id: "a",
      layer: { options: { pane: annName } } as unknown as L.Layer,
      paneSpecs: [{ role: "annotation", order: 1, name: annName }],
    });

    expect(surface.paneNames.filter(name => name === annName)).toHaveLength(1);
  });

  it("resolves the declared base's role by name, not by position", () => {
    // A spec list whose index 0 is NOT the declared pane (an appended label
    // pane arriving first): the base must take its own spec's role — or
    // none — while the extra spec still gets its pane booked. A position-
    // based read would stamp `annotation` onto the base and drop the label
    // pane entirely.
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "a",
      layer: new Path() as unknown as L.Layer,
      paneName: "graph",
      paneSpecs: [
        { role: "annotation", order: 3, name: "foliplus-annotation-a" },
        { role: "sub", order: 1, name: "graph" },
      ],
    });

    expect(surface.paneNames).toEqual(["graph", "foliplus-annotation-a"]);
    expect(surface.panes[0].role).toBe("sub");
    expect(surface.panes[1].role).toBe("annotation");
  });

  it("gives a canvas pane no renderer", () => {
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "heat",
      layer: null,
      paneName: CONST.CANVAS_PANE_PREFIX + "heat",
      canvas: true,
    });
    expect(surface.paneNames).toEqual([CONST.CANVAS_PANE_PREFIX + "heat"]);
    expect(surface.panes[0].renderer).toBeNull();
  });

  it("gives a GridLayer its own synthesized pane — z is per-layer, not shared", () => {
    // First-class basemaps: row order must equal z order across
    // kinds, so a color layer must be able to interleave with two tile
    // layers. A TileLayer that stayed in the shared tilePane could only
    // order itself inside that one stack — retired.
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "tiles",
      layer: new TileLayer() as unknown as L.Layer,
    });
    expect(surface.panes.length).toBe(1);
    expect(surface.synthesizedPaneName).toMatch(/^foliplus-pane-/);
    expect(surface.setZ(600)).toBe(true);
  });

  it("adopts the child panes the layer's own tree names", () => {
    const { panes, host } = makeMap();
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
    const { host } = makeMap();
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
    // The first reconcile grows the shadow pane for the marker-bearing tree —
    // before anything is pinned into it. A marker-bearing layer gets its own
    // shadow pane (role "shadow"), so pane writes reach the marker's full
    // visible DOM — the base pane alone never carried the shadow.
    surface.materialize();
    expect(surface.paneNames).toEqual([
      surface.synthesizedPaneName,
      `${surface.synthesizedPaneName}-shadow`,
    ]);
    expect(surface.panes.map(pane => pane.role)).toEqual(["base", "shadow"]);
    // The shadow pane carries no renderer: nothing routes SVG content there.
    expect(surface.panes[1].renderer).toBeNull();
  });

  it("degrades to the none carrier when the carrier audit finds an escape", () => {
    // Fail closed: a surface that promised pane coverage and then fails the
    // completeness audit must stop promising it (the UI hides the write that
    // would have lied) instead of logging and carrying on.
    const { host } = makeMap();
    const layer = new Group([new Marker()]);
    const surface = new LayerSurface(host, {
      id: "escape",
      layer: layer as unknown as L.Layer,
    });
    surface.materialize();
    expect(surface.capabilities.opacity).toBe("pane");

    const escapeError = new Error("[carrier] IMG paint outside the layer's own panes");
    const assertSpy = vi
      .spyOn(carrierModule, "assertInsideOwnedPanes")
      .mockImplementation(() => {
        throw escapeError;
      });
    surface.markContentDirty();
    surface.materialize();
    assertSpy.mockRestore();

    expect(surface.capabilities.opacity).toBe("none");
    expect(surface.capabilities.relocatable).toBe(false);
  });

  it("logs a carrier escape thrown as a non-Error by its string form", () => {
    // `validateCarrier` catches whatever the audit threw — a third-party
    // audit, or a `throw "..."` in a leaf predicate — so it cannot assume an
    // Error instance. A non-Error has no `message`, and reading it blindly
    // would log `undefined` and lose the one detail that names the escape.
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "escape-str",
      layer: new Group([new Marker()]) as unknown as L.Layer,
    });
    surface.materialize();

    const escape: unknown = "IMG paint outside the layer's own panes";
    const assertSpy = vi
      .spyOn(carrierModule, "assertInsideOwnedPanes")
      .mockImplementation(() => {
        throw escape;
      });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      surface.markContentDirty();
      surface.materialize();
    } finally {
      assertSpy.mockRestore();
    }

    try {
      expect(surface.capabilities.opacity).toBe("none");
      expect(
        errorSpy.mock.calls.some(call => String(call[0]).includes("IMG paint outside")),
      ).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("synthesizes no shadow pane for a layer without markers", () => {
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "plain",
      layer: new Group([new Path()]) as unknown as L.Layer,
    });
    surface.materialize();
    expect(surface.paneNames).toEqual([surface.synthesizedPaneName]);
  });

  it("materializes a declared spec the tree did not discover (annotation pane)", () => {
    // The registration edge appends a `role: "annotation"` spec for layers
    // whose features carry labelable properties; the synthesized branch
    // discovers no such pane from the tree, so `addMissingSpecs` must build
    // it — otherwise the capability is declared and the pane never exists.
    const { panes, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "labelable",
      layer: new Group([new Path()]) as unknown as L.Layer,
      paneSpecs: [{ role: "annotation", order: 1, name: "foliplus-annotation-x" }],
    });
    surface.materialize();

    expect(surface.paneNames).toEqual([
      surface.synthesizedPaneName,
      "foliplus-annotation-x",
    ]);
    expect(surface.panes.map(pane => pane.role)).toEqual(["base", "annotation"]);
    expect(panes["foliplus-annotation-x"]).toBeDefined();
  });

  it("skips a raw paneSpec naming a Leaflet shared pane", () => {
    // A raw registerLayer({ paneSpecs }) can name `overlayPane` as a
    // sub-pane; the admission gate refuses it BEFORE any DOM change — the
    // shared pane never gets the foliplus class or a lease.
    const { panes, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "raw",
      layer: new Path() as unknown as L.Layer,
      paneName: "owned-base",
      paneSpecs: specs("owned-base", "overlayPane"),
    });
    expect(surface.paneNames).toEqual(["owned-base"]);
    expect(panes.overlayPane).toBeUndefined();
  });

  it("reports a spec addMissingSpecs could not book", () => {
    // A spec the constructor route never discovered, naming a pane another
    // surface holds: it must be refused and reported, not declared in
    // capabilities with no pane behind it.
    const { panes, host } = makeMap();
    new LayerSurface(host, {
      id: "owner",
      layer: new Path() as unknown as L.Layer,
      paneName: "held-sub",
    });
    const surface = new LayerSurface(host, {
      id: "target",
      layer: new Path() as unknown as L.Layer,
      paneSpecs: [{ role: "annotation", order: 1, name: "held-sub" }],
    });
    surface.materialize();

    expect(surface.paneNames).toEqual([surface.synthesizedPaneName]);
    expect(surface.panes.map(pane => pane.role)).toEqual(["base"]);
    expect(panes["held-sub"]).toBeDefined();
  });

  it("falls back to a synthesized pane when every discovered pane is refused", () => {
    // A tree whose only child pane is held by another surface would
    // otherwise report pane coverage while holding no base carrier at all.
    const { host } = makeMap();
    new LayerSurface(host, {
      id: "owner",
      layer: { options: { pane: "foliplus-shared" } } as unknown as L.Layer,
      paneName: "foliplus-shared",
    });
    const sharer = { options: { pane: "foliplus-shared" } } as unknown as L.Layer;
    const second = new LayerSurface(host, { id: "sharer", layer: sharer });
    second.materialize();
    // The degraded surface ends up with its own provably exclusive pane.
    expect(second.paneNames).toEqual([second.synthesizedPaneName]);
    expect(second.synthesizedPaneName).toMatch(/^foliplus-pane-/);
  });

  it("skips a discovered child pane that another surface claims", () => {
    // Two trees naming the same child pane: the second surface must leave
    // the name to its first owner instead of co-writing it — the warn names
    // the skip, and the claimed pane stays out of the second pane set.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host } = makeMap();
    const first = new LayerSurface(host, {
      id: "owner",
      layer: { options: { pane: "foliplus-shared" } } as unknown as L.Layer,
      paneName: "foliplus-shared",
    });
    expect(first.paneNames).toContain("foliplus-shared");

    const sharer = {
      options: { pane: "foliplus-shared" },
    } as unknown as L.Layer;
    const second = new LayerSurface(host, { id: "sharer", layer: sharer });
    expect(second.paneNames).not.toContain("foliplus-shared");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("skipped discovered pane"),
    );
    warnSpy.mockRestore();
  });

  it("warns and skips the shadow pane when a declared spec claims its name", () => {
    // A declared pane named `<base>-shadow` (the collision only a caller can
    // manufacture, but a real one): the surface must not double-book the name
    // — the declared pane stands, the marker-shadow synthesis degrades to a
    // warn, and shadows stay on Leaflet's shared shadowPane.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { panes, host } = makeMap();
    const layer = new Group([new Marker()]);
    // Stamp first so the test can predict the synthesized base pane's name.
    const baseName = `foliplus-pane-${window.L.stamp(layer)}`;
    const surface = new LayerSurface(host, {
      id: "claimed",
      layer: layer as unknown as L.Layer,
      paneSpecs: [{ role: "sub", order: 1, name: `${baseName}-shadow` }],
    });
    surface.materialize();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("already claimed by a declared"),
    );
    // The claimed name keeps the declared spec's identity — it is not a
    // shadow pane, so nothing treats it as one.
    expect(
      (surface as unknown as { shadowPaneName: string | null }).shadowPaneName,
    ).toBeNull();
    expect(surface.panes.find(pane => pane.name === `${baseName}-shadow`)?.role).toBe(
      "sub",
    );
    expect(panes[`${baseName}-shadow`]).toBeDefined();
    warnSpy.mockRestore();
  });

  it("never writes pointer-events onto a pane", () => {
    // Whether a pane's content takes a hit is that content's own call:
    // AnnotationCanvas writes `none` on itself, a data canvas is re-enabled by
    // the canvas rule in LayerControl/focus.css. The surface stays out of it.
    const { panes, host } = makeMap();
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
    const { panes, host } = makeMap();
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

  it("leaves the shadow pane unset when another surface holds its lease", () => {
    // A shadow name is not ownership. surface-a owns `baseA-shadow` as its own
    // base pane, so surface-b must not synthesize a shadow there: recording
    // the refused name would land in the marker's `options.shadowPane` and the
    // next `setIcon` would migrate its shadow into a foreign pane (cross-owner
    // DOM move). The booking must stay out of `shadowPaneName`.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { panes, host } = makeMap();
    new LayerSurface(host, {
      id: "a",
      layer: new Path() as unknown as L.Layer,
      paneName: "baseA-shadow",
    }).materialize();

    const marker = new Marker();
    const layer = new Group([marker]);
    const surface = new LayerSurface(host, {
      id: "b",
      layer: layer as unknown as L.Layer,
      paneName: "baseA",
    });
    surface.materialize();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("could not be acquired"),
    );
    expect(
      (surface as unknown as { shadowPaneName: string | null }).shadowPaneName,
    ).toBeNull();
    expect(surface.paneNames).toEqual(["baseA"]);
    // The owner keeps its pane and its lease ...
    expect(panes["baseA-shadow"]).toBeDefined();
    expect(host.canAcquirePane("baseA-shadow", "a")).toBe(true);
    expect(host.canAcquirePane("baseA-shadow", "b")).toBe(false);
    // ... and no marker option points at it.
    expect(marker.options.shadowPane).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("stops promising pane coverage when the fallback pane is refused", () => {
    // The fallback name is stamped from L.stamp, so a refusal means a pane of
    // that exact name already exists and is not provably ours. With no base
    // carrier at all the surface must stop advertising a z / opacity write
    // that would land nowhere: recording the refused name as its carrier used
    // to claim coverage over a pane the surface never held.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host } = makeMap();
    window.L.stamp = vi.fn(() => 1);
    host.ensurePane("foliplus-pane-1", false, "other");

    const surface = new LayerSurface(host, {
      id: "nobody",
      layer: new Group([new Marker()]) as unknown as L.Layer,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("could not create fallback pane"),
    );
    expect(surface.panes).toHaveLength(0);
    expect(surface.synthesizedPaneName).toBeNull();
    expect(surface.capabilities.opacity).toBe("none");
    expect(surface.capabilities.relocatable).toBe(false);
    // The other surface keeps its lease, and the write path answers "no pane
    // here" instead of writing to a name nobody holds.
    expect(host.canAcquirePane("foliplus-pane-1", "other")).toBe(true);
    expect(host.canAcquirePane("foliplus-pane-1", "nobody")).toBe(false);
    expect(surface.setZ(640)).toBe(false);
    expect(surface.setZOverride(8990)).toBe(false);
    warnSpy.mockRestore();
  });
});

describe("LayerSurface.materialize", () => {
  it("routes a declared layer before it joins the map (I1)", () => {
    const { host } = makeMap();
    const layer = new Path();
    const surface = new LayerSurface(host, {
      id: "a",
      layer: layer as unknown as L.Layer,
      paneName: "graph",
    });
    surface.materialize();
    expect(layer.options.pane).toBe("graph");
    expect(layer.options.renderer).toBe(surface.panes[0].renderer);
    expect(surface.materialized).toBe(true);
  });

  it("leaves a declared container's children to the caller's routing", () => {
    // createLayers picks a sub-pane per leaf; pinning the tree here would
    // collapse every leaf onto the base pane.
    const { host } = makeMap();
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
    const { host } = makeMap();
    const child = new Marker();
    const layer = new Group([child]);
    const surface = new LayerSurface(host, {
      id: "plain",
      layer: layer as unknown as L.Layer,
    });
    surface.materialize();
    const pane = surface.synthesizedPaneName!;
    expect(child.options.pane).toBe(pane);
    // A container is not given options.pane — Leaflet ignores a group's pane
    // for its children, which is why the pin walks the tree at all.
    expect(layer.options.pane).toBeUndefined();
    expect(host.discoverChildPanes(layer as unknown as L.Layer)).toEqual([]);
  });

  it("costs nothing once the content has settled", () => {
    // The property the ordering pass depends on: a pass over materialized
    // surfaces writes z and never walks a tree again.
    const { host } = makeMap();
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
    const { host } = makeMap();
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
    const { host } = makeMap();
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
    // Icon into the base pane; shadow into the surface's own shadow pane —
    // one pane handle per element, so opacity / visibility / focus writes
    // cover the marker's full visible DOM. (The shadow used to stay wherever
    // Leaflet put it, which is what left pane opacity writes partial.)
    expect(Array.from(paneEl.children)).toEqual([attached.element]);
    expect(attached._shadow.parentNode).toBe(surface.panes[1].element);
    expect(surface.panes[1].role).toBe("shadow");
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
    const { host } = makeMap();
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

  it("pins a GridLayer into its synthesized pane on materialize", () => {
    // The reconciled write: the layer's DOM ends up in the surface's own
    // pane, which is what makes the ordering ladder (surface.setZ) reach
    // it. Without a pane here, z would live on the shared tilePane's
    // children and two basemaps could not be interleaved with a color.
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "tiles",
      layer: new TileLayer() as unknown as L.Layer,
    });
    const reconcile = vi.spyOn(host, "pinLateContent");
    surface.materialize();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(surface.materialized).toBe(true);
  });
});

describe("LayerSurface.setZ", () => {
  it("writes each pane's z as base + its own order, pane by pane", () => {
    // Three panes (graph, node, label — the shape MeasureControl paints) so the
    // offset is checked for the third pane too, not just the first sub-pane.
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
    expect(surface.setZ(620)).toBe(true);
    expect(panes.graph.style.zIndex).toBe("620");
    expect(panes.node.style.zIndex).toBe("621");
    expect(panes.label.style.zIndex).toBe("622");
  });

  it("writes the synthesized pane's z", () => {
    const { panes, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "plain",
      layer: new Group([new Marker()]) as unknown as L.Layer,
    });
    surface.materialize();
    expect(surface.setZ(640)).toBe(true);
    expect(panes[surface.synthesizedPaneName!].style.zIndex).toBe("640");
    // The shadow pane rides one step below its layer: shadows must paint
    // under their icons by pane ladder, not DOM order (marker icons carry an
    // inline z-index that goes negative near the viewport top).
    expect(panes[`${surface.synthesizedPaneName!}-shadow`].style.zIndex).toBe("639");
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
    // Only reachable when the layer is absent — LayerSurface bails out with an
    // empty panes array. Every kind that has a real layer now gets at least
    // one synthesized pane, including GridLayer (first-class basemaps).
    const { host } = makeMap();
    const surface = new LayerSurface(host, { id: "ghost" } as any);
    expect(surface.panes).toEqual([]);
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
      return z.map(a => z.map(b => Math.sign(a - b)));
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
    const { host } = makeMap();
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

  it("rebuilds when the tree's radius carrier changes", () => {
    // The size capability is baked into the declaration, so a group that later
    // gained a pixel-radius leaf describes a different face — the surface must
    // not keep answering "none" from its first walk.
    const { host } = makeMap();
    const layer = new Group();
    const base = {
      id: "grow",
      layer: layer as unknown as L.Layer,
      paneName: "graph",
      paneSpecs: specs("graph", "label"),
    };
    const surface = new LayerSurface(host, base);
    expect(surface.capabilities.size).toBe(CONST.CAP_TIER.NONE);
    expect(surface.matches(base)).toBe(true);

    layer.addLayer(new CircleMarker());
    expect(surface.matches(base)).toBe(false);

    // And the reverse: a tree that lost its radius leaf stops claiming a
    // capability it no longer has.
    const sized = new LayerSurface(host, base);
    expect(sized.capabilities.size).toBe(CONST.CAP_TIER.NATIVE);
    expect(sized.matches(base)).toBe(true);
    layer.children = [];
    expect(sized.matches(base)).toBe(false);
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

  // ── getBounds comparison compares the declared provider by presence ──────
  // `capabilities.bounds` is derived from the OR of `hasBoundsProvider(layer)`
  // and `opts.getBounds != null`. `matches` must detect when that OR changes:
  //   - A layer with a native `getBounds` always has `capabilities.bounds: true`
  //     regardless of the provider field, so the provider is irrelevant —
  //     reference equality would read "changed" on every fresh arrow.
  //   - A layer without a native `getBounds` (canvas, third-party wrapper)
  //     derives its bounds entirely from the provider, so adding or removing
  //     it changes `capabilities.bounds` and must trigger a rebuild.
  // Presence (`!= null`), not reference — callers hand a fresh arrow each
  // register, and a different arrow for the same shape is not a different face.

  it("compares provider presence even when the layer has its own getBounds", () => {
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
    // Provider added: declaration changed, even though `capabilities.bounds`
    // is already true from the native method.
    expect(surface.matches({ ...base, getBounds: () => null })).toBe(false);
    // Reversed: surface built with a provider, matched without one.
    const withProvider = new LayerSurface(host, { ...base, getBounds: () => null });
    expect(withProvider.matches(base)).toBe(false);
    expect(withProvider.matches({ ...base, getBounds: () => null })).toBe(true);
  });

  it("reports changed when a provider is added to a layer with no native getBounds", () => {
    const { host } = makeMap();
    const layer = { options: {} }; // no getBounds method
    const base = {
      id: "a",
      layer: layer as unknown as L.Layer,
    };
    const surface = new LayerSurface(host, base);
    // No provider → provider added: `capabilities.bounds` false → true.
    expect(surface.matches({ ...base, getBounds: () => null })).toBe(false);
  });

  it("reports changed when a provider is removed from a layer with no native getBounds", () => {
    const { host } = makeMap();
    const layer = { options: {} };
    const base = {
      id: "a",
      layer: layer as unknown as L.Layer,
    };
    const withProvider = new LayerSurface(host, { ...base, getBounds: () => null });
    // Provider → no provider: `capabilities.bounds` true → false.
    expect(withProvider.matches(base)).toBe(false);
  });

  it("reports changed when a canvas surface gains or loses its provider", () => {
    const { host } = makeMap();
    const base = {
      id: "heat",
      layer: null,
      paneName: CONST.CANVAS_PANE_PREFIX + "heat",
      canvas: true,
    };
    const surface = new LayerSurface(host, base);
    // No provider → provider: capabilities.bounds false → true.
    expect(surface.matches({ ...base, getBounds: () => null })).toBe(false);
    // Reversed: provider → no provider.
    const withProvider = new LayerSurface(host, { ...base, getBounds: () => null });
    expect(withProvider.matches(base)).toBe(false);
    // Same provider shape, different ref — not a different face.
    expect(withProvider.matches({ ...base, getBounds: () => null })).toBe(true);
  });
});

describe("LayerSurface carrier audit", () => {
  it("answers every carrier question in one visit at construction", () => {
    // TT-1: the constructor used to walk the tree twice — once for the
    // declaration's migratable flag and once inside `detectCapabilities`.
    // One visit is the floor: every answer comes from the same probe.
    const { host } = makeMap();
    const probeSpy = vi.spyOn(capabilityModule, "probeLayerCarrier");
    try {
      new LayerSurface(host, {
        id: "one-visit",
        layer: new Group([new Path(), new Marker()]) as unknown as L.Layer,
      });
      expect(probeSpy).toHaveBeenCalledTimes(1);
    } finally {
      probeSpy.mockRestore();
    }
  });

  it("reuses the carriage audit across calls with no content change", () => {
    const { host } = makeMap();
    const layer = new Group([new Path(), new Marker()]);
    const surface = new LayerSurface(host, {
      id: "audit",
      layer: layer as unknown as L.Layer,
    });
    const walkSpy = vi.spyOn(carrierModule, "visibleDomOf");
    try {
      surface.materialize();
      const first = walkSpy.mock.calls.length;
      expect(first).toBeGreaterThan(0);

      surface.materialize(); // same content, second
      surface.materialize(); // same content, third
      // Reading the answer does not re-open the walk either.
      void surface.capabilities.opacity;
      void surface.capabilities.fill;

      expect(walkSpy.mock.calls.length).toBe(first);
    } finally {
      walkSpy.mockRestore();
    }
  });
});

describe("LayerSurface.destroy", () => {
  it("releases only the panes it synthesized", () => {
    const { panes, host } = makeMap();
    const synthesized = new LayerSurface(host, {
      id: "plain",
      layer: new Group([new Marker()]) as unknown as L.Layer,
    });
    synthesized.materialize();
    const paneName = synthesized.synthesizedPaneName!;
    synthesized.destroy();
    expect(panes[paneName]).toBeUndefined();
    // The marker-shadow pane is synthesized too — it must go with the base
    // pane, or an unregister/register cycle would leak one per draw.
    expect(panes[`${paneName}-shadow`]).toBeUndefined();

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

  it("leaves the canvas face's pane to the face that retires it", () => {
    // A canvas face books its own pane before the surface does. If
    // `destroy` retired that lease too, the face's own destroy would find
    // nothing to check against and the element would stay on the map with
    // nobody left to take it off — every later `writeZ`, focus and export
    // write aimed at DOM that is already gone. The surface therefore
    // skips the face's pane, and only the face's destroy deletes it.
    const { panes, host } = makeMap();
    const facePane = host.ensurePane("foliplus-canvas-heat", false, "heat").pane;
    expect(facePane).toBe(panes["foliplus-canvas-heat"]);

    const surface = new LayerSurface(host, {
      id: "heat",
      layer: null,
      canvas: true,
      paneName: "foliplus-canvas-heat",
    });
    surface.materialize();
    expect(surface.paneNames).toContain("foliplus-canvas-heat");

    surface.destroy();

    // Element and lease both survived the surface's teardown — the face
    // still holds it, and nobody else may take it.
    expect(panes["foliplus-canvas-heat"]).toBe(facePane);
    expect(host.canAcquirePane("foliplus-canvas-heat", "heat")).toBe(true);
    expect(host.canAcquirePane("foliplus-canvas-heat", "other")).toBe(false);

    // The face's own destroy is the call that takes the element off.
    host.releasePane("foliplus-canvas-heat", "heat", true);
    expect(panes["foliplus-canvas-heat"]).toBeUndefined();
    expect(host.canAcquirePane("foliplus-canvas-heat", "heat")).toBe(true);
  });

  it("neutralises its own state so a retired surface cannot write", () => {
    // Destroy used to retire only the leases. A surface destroyed mid-focus
    // kept `panes` / `baseZ` / `overrideZ` alive, so a restore closure still
    // holding it walked names through `assertOwnedPane` after the lease was
    // already gone and threw — escaping past the focus mask/rect teardown and
    // leaving the map dimmed with no way back. Every write method now guards
    // on the emptied state, so a late call is a no-op instead of an error.
    const { panes, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "late",
      layer: new Group([new Marker()]) as unknown as L.Layer,
    });
    surface.materialize();
    const base = surface.synthesizedPaneName!;
    surface.setZ(640);
    surface.setZOverride(8990);
    expect(panes[base].style.zIndex).toBe("8990");

    const captured = surface.panes;
    surface.destroy();

    // The handle set is emptied in place, so a closure that captured it at
    // focus time sees the same (now empty) array when the surface retires
    // under it.
    expect(captured).toBe(surface.panes);
    expect(captured.length).toBe(0);
    expect(surface.paneNames).toEqual([]);
    expect(surface.synthesizedPaneName).toBeNull();
    // Late writes are no-ops, and none of them throws.
    expect(surface.setZ(640)).toBe(false);
    expect(surface.setZOverride(8990)).toBe(false);
    expect(surface.restoreZ()).toBe(false);
  });

  it("lets a focus-style restore closure finish after destroy without throwing", () => {
    // The shape that actually escaped: `focus/pane.ts` captures `surface.panes`
    // and a `restoreZ` callback when entering focus, and `dismissFocus` runs
    // them after the layer may already be gone.
    const { panes, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "focus",
      layer: new Group([new Marker()]) as unknown as L.Layer,
    });
    surface.materialize();
    const base = surface.synthesizedPaneName!;
    surface.setZ(640);
    surface.setZOverride(8990);

    const captured = surface.panes;
    const restore = () => {
      for (const pane of captured) {
        pane.element.classList.remove("foliplus-focus-glow");
      }
      surface.restoreZ();
    };

    surface.destroy();
    expect(() => restore()).not.toThrow();
    expect(panes[base]).toBeUndefined();
  });

  it("never re-acquires a pane from a write path", () => {
    // The write path holds a handle booked at construction. Calling
    // `ensurePane` here would re-open the admission door on a write, so a
    // retired surface could quietly win its pane back on the next late write
    // instead of being refused.
    const { panes, host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "write",
      layer: new Group([new Marker()]) as unknown as L.Layer,
    });
    surface.materialize();
    const base = surface.synthesizedPaneName!;

    const acquires = vi.spyOn(host, "ensurePane");
    expect(surface.setZ(640)).toBe(true);
    expect(surface.setZOverride(8990)).toBe(true);
    expect(surface.restoreZ()).toBe(true);
    acquires.mockRestore();

    expect(acquires).not.toHaveBeenCalled();
    expect(panes[base].style.zIndex).toBe("640");
    expect(panes[`${base}-shadow`].style.zIndex).toBe("639");
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
    const { host } = makeMap();
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
    const { host } = makeMap();
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
    const { host } = makeMap();
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
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "tiles",
      layer: new GridLayer() as unknown as L.Layer,
    });
    expect(surface.capabilities.opacity).toBe("native");
    expect(surface.capabilities.zoomRange).toBe("native");
    expect(surface.capabilities.relocatable).toBe(true);
  });

  it("reports native opacity but none zoomRange for an ImageOverlay", () => {
    const { host } = makeMap();
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
      zoomRange: "pane",
      // A color face has no features to label — the registration edge never
      // declares the `role: "annotation"` spec for it.
      annotation: "none",
      fill: "native",
      stroke: "none",
      size: "none",
      relocatable: true,
      bounds: false,
      visibility: "pane",
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
    const { host } = makeMap();
    const cluster = new MarkerClusterGroup();
    const surface = new LayerSurface(host, {
      id: "cluster",
      layer: cluster as unknown as L.Layer,
    });
    expect(surface.capabilities.bounds).toBe(false);
  });

  it("reports bounds true for a GridLayer with getBounds", () => {
    const { host } = makeMap();
    const tiles = new GridLayer();
    Object.assign(tiles, { getBounds: vi.fn() });
    const surface = new LayerSurface(host, {
      id: "tiles",
      layer: tiles as unknown as L.Layer,
    });
    expect(surface.capabilities.bounds).toBe(true);
  });

  it("reports bounds false for a GridLayer without getBounds", () => {
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "tiles",
      layer: new GridLayer() as unknown as L.Layer,
    });
    expect(surface.capabilities.bounds).toBe(false);
  });

  it("reports bounds true for an ImageOverlay with getBounds", () => {
    const { host } = makeMap();
    const overlay = new ImageOverlay();
    Object.assign(overlay, { getBounds: vi.fn() });
    const surface = new LayerSurface(host, {
      id: "overlay",
      layer: overlay as unknown as L.Layer,
    });
    expect(surface.capabilities.bounds).toBe(true);
  });

  it("reports bounds false for an ImageOverlay without getBounds", () => {
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "overlay",
      layer: new ImageOverlay() as unknown as L.Layer,
    });
    expect(surface.capabilities.bounds).toBe(false);
  });

  it("reports bounds true for a pane-painted layer with getBounds", () => {
    const { host } = makeMap();
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
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "a",
      layer: new Path() as unknown as L.Layer,
      paneName: "graph",
    });
    expect(surface.capabilities.bounds).toBe(false);
  });

  it("reports bounds true for a canvas surface with a getBounds provider", () => {
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "canvas",
      layer: null,
      canvas: true,
      getBounds: () => null,
    });
    expect(surface.capabilities.bounds).toBe(true);
  });

  it("reports bounds false for a canvas surface without a getBounds provider", () => {
    const { host } = makeMap();
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
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "empty-specs",
      layer: new Path() as unknown as L.Layer,
      paneSpecs: [],
    });
    expect(surface.capabilities.bounds).toBe(false);
  });

  it("reports bounds true when paneSpecs is empty but the layer has getBounds", () => {
    const { host } = makeMap();
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
    const { host } = makeMap();
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
    const { host } = makeMap();
    const path = new Path();
    Object.assign(path, { getBounds: vi.fn() });
    const surface = new LayerSurface(host, {
      id: "bare",
      layer: path as unknown as L.Layer,
    });
    expect(surface.capabilities.bounds).toBe(true);
  });

  it("reports bounds false for a bare layer without getBounds (no declared pane)", () => {
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "bare",
      layer: new Path() as unknown as L.Layer,
    });
    expect(surface.capabilities.bounds).toBe(false);
  });

  it("warns when paneName fails injection safety (covers log.warn)", () => {
    // PANE_NAME_PATTERN is /^[a-zA-Z0-9_-]+$/ — a paneName with a space or
    // special character is rejected, and the surface synthesizes a fallback
    // pane instead. The same degradation now also covers a paneName naming
    // one of Leaflet's shared panes: adopting one would route the layer's
    // z / opacity / focus writes onto a pane every layer draws into.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "inject",
      layer: new Path() as unknown as L.Layer,
      paneName: "bad name with spaces",
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("rejected paneName"));
    // The surface falls back to a synthesized pane.
    expect(surface.synthesizedPaneName).not.toBeNull();

    // The shared-pane rejection goes through the same warn + fallback path.
    warnSpy.mockClear();
    const shared = new LayerSurface(host, {
      id: "shared",
      layer: new Path() as unknown as L.Layer,
      paneName: "overlayPane",
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("rejected paneName"));
    expect(shared.synthesizedPaneName).not.toBeNull();
    expect(shared.paneNames).not.toContain("overlayPane");
    warnSpy.mockRestore();
  });
});

describe("kind declaration (cluster / tile|vector)", () => {
  it("declared kind:cluster matches the duck-typed cluster capability tier", () => {
    const { host } = makeMap();
    const cluster = new MarkerClusterGroup();
    const ducked = new LayerSurface(host, {
      id: "duck",
      layer: cluster as unknown as L.Layer,
    });
    const declared = new LayerSurface(host, {
      id: "declared",
      layer: cluster as unknown as L.Layer,
      kind: "cluster",
    });
    // Equivalence: declaration and derivation land in the same honest tier.
    expect(declared.capabilities.opacity).toBe("none");
    expect(declared.capabilities.zoomRange).toBe("none");
    expect(declared.capabilities.relocatable).toBe(false);
    expect(declared.capabilities.bounds).toBe(false);
    expect(declared.capabilities.visibility).toBe("native");
    expect(declared.capabilities.opacity).toBe(ducked.capabilities.opacity);
    expect(declared.capabilities.zoomRange).toBe(ducked.capabilities.zoomRange);
    expect(declared.capabilities.relocatable).toBe(ducked.capabilities.relocatable);
    expect(declared.capabilities.bounds).toBe(ducked.capabilities.bounds);
    expect(declared.capabilities.visibility).toBe(ducked.capabilities.visibility);
    expect(declared.capabilities.fill).toBe(ducked.capabilities.fill);
    expect(declared.capabilities.stroke).toBe(ducked.capabilities.stroke);
  });

  it("CLUSTER_CAPABILITIES is the named honest tier", () => {
    expect(CLUSTER_CAPABILITIES).toEqual({
      fill: "none",
      stroke: "none",
      size: "none",
      opacity: "none",
      zoomRange: "none",
      visibility: "native",
      relocatable: false,
      bounds: false,
    });
  });

  it("deriveLayerKind: GridLayer is tile, Path/Marker is vector", () => {
    expect(
      deriveLayerKind({ id: "t", layer: new GridLayer() as unknown as L.Layer } as any),
    ).toBe("tile");
    expect(
      deriveLayerKind({ id: "v", layer: new Path() as unknown as L.Layer } as any),
    ).toBe("vector");
    expect(
      deriveLayerKind({ id: "m", layer: new Marker() as unknown as L.Layer } as any),
    ).toBe("vector");
    expect(
      deriveLayerKind({ id: "g", layer: new Group([]) as unknown as L.Layer } as any),
    ).toBe("vector");
  });

  it("deriveLayerKind: declared kind wins; solid/canvas/custom from declaration shape", () => {
    expect(
      deriveLayerKind({
        id: "x",
        layer: new Path() as unknown as L.Layer,
        kind: "cluster",
      } as any),
    ).toBe("cluster");
    expect(deriveLayerKind({ id: "s", layer: null, color: "#000" } as any)).toBe(
      "solid",
    );
    expect(deriveLayerKind({ id: "c", layer: null, canvas: true } as any)).toBe(
      "canvas",
    );
    expect(deriveLayerKind({ id: "u", layer: null, custom: {} } as any)).toBe("custom");
    // Pending Leaflet-layer registration is NOT custom (see hasUnresolvedLayers).
    expect(deriveLayerKind({ id: "p", layer: null } as any)).toBe("vector");
    // L.LayerGroup is a vector-family container.
    (window as { L: Record<string, unknown> }).L.LayerGroup = Group;
    expect(
      deriveLayerKind({ id: "g2", layer: new Group([]) as unknown as L.Layer } as any),
    ).toBe("vector");
  });

  it("kind:custom surface reports the honest none tier", () => {
    const { host } = makeMap();
    const surface = new LayerSurface(host, {
      id: "third",
      layer: null,
      kind: "custom",
      custom: { paint() {} },
    });
    expect(surface.capabilities.opacity).toBe("none");
    expect(surface.capabilities.visibility).toBe("none");
    expect(surface.capabilities.bounds).toBe(false);
  });
});
