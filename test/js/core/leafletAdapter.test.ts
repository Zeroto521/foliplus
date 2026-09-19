import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import adapterSource from "#core/leafletAdapter?raw";
import * as adapter from "#foliplus/core/leafletAdapter.js";
import {
  attributionEntries,
  destroyPane,
  getRendererContainer,
  getRendererFor,
  hasAttachedPath,
  internalLayers,
  isGroupLike,
  layerElements,
  layerIcon,
  layerMap,
  layerUrl,
  markerShadow,
  moveIntoPane,
  refreshAttributions,
  reinitInteraction,
} from "#foliplus/core/leafletAdapter.js";

// `getRendererFor` builds an SVG renderer; the shared Leaflet mock carries no
// `svg` factory because no other module in this file needs one.
beforeEach(() => {
  window.L.svg = vi.fn(() => ({ addTo: vi.fn() }));
});

// ── Static guard: the named private surface ─────────────────────
//
// Leaflet exposes no API for pane teardown, for a renderer's root element, or
// for a layer's DOM nodes — so those reaches cannot be eliminated, only
// confined. Confining them to one module is what makes a Leaflet upgrade a
// single-file problem, and this scan is what keeps them confined.
//
// WHAT THIS COVERS — exactly these thirteen field names, and nothing else:
//   _panes, _paneRenderers              (pane registry: adapter-owned)
//   _container, _icon, _initInteraction, _layers, _map, _path, _shadow
//                                       (leaf + renderer internals: adapter-owned)
//   _url                                (tile URL template: adapter-owned)
//   _attributions, _update              (attribution control: adapter-owned)
//   _closeButton                        (popup close button: counted exception)
// It is not a claim about "every private reach". Fields outside this set —
// `Marker._latlng`, anything a future Leaflet adds — are simply not watched.
// Widening the set is the way to widen the guard.
//
// Anchoring: most names are matched only after a dot, because they are generic
// enough that a bare word would false-positive (`_update`, `_path`, `_map`).
// The two pane-registry names are distinctive enough to match without one, so
// `map["_panes"]` and `const { _panes } = map` are caught as well. Not caught,
// and worth knowing: a *string-keyed* read of a dot-anchored name — the shape
// ScaleControl uses for `_map` (`Reflect.set(scaleCtrl, "_map", …)`). That is
// a known, deliberate exception: it writes a field Leaflet would have set for
// it, on an object this tree created itself, and it is a string key so the dot
// anchor never sees it.
//
// `this.` is excluded by lookbehind, because the reach this module owns is one
// that goes *inward* at another object's private field. `this._map` in
// BaseControl.ts and ScaleControl/index.ts is Leaflet's own field on the
// L.Control subclass they *are* (set by Control.addTo) — their own state, not
// an inward reach. Only the dot-anchored branch carries the lookbehind; the
// lookbehind excludes the dot immediately following `this.`, so `this.foo._map`
// is still caught.
//
// Comments are stripped before matching, so the prose above and in the sources
// may name the fields freely; that is where the why lives. String literals are
// deliberately NOT stripped: the dot anchor already keeps `"type_color_map"`
// and `${position}_container` from matching, and removing the literals would
// hide the `["_panes"]` form the bare alternative exists to catch.
const PRIVATE_FIELD_RE =
  /(?<!this)\._(?:attributions|closeButton|container|icon|initInteraction|layers|map|path|shadow|update|url)\b|\b_(?:panes|paneRenderers)\b/g;

const COMMENT_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

const codeOnly = (src: string): string => src.replace(COMMENT_RE, " ");

// Reaches this module deliberately does not own, counted rather than ignored so
// a *new* one in any of these files still fails. The single surviving entry is
// a layering decision, not a judgement about whether the field is Leaflet's:
//   - common/dom.ts titles a popup's close button through `_closeButton`. The
//     probe could live here, but common/ never imports from #core/ (core does
//     the importing; no common file reaches up today), so routing that reach
//     through this module would invert the layering — and there was a prior
//     incident of a common→core inversion to unwind. The popup-title logic
//     arguably does not belong in common/ at all; it is marker/popup business,
//     not a generic DOM utility. Moving it is a separate step, and the probe
//     comes with it.
const OUT_OF_CHARTER = [{ f: "common/dom.ts", n: 1 }] as const;

const ADAPTER = "foliplus/js/core/leafletAdapter.ts";

const REPO_ROOT = process.cwd();
const JS_ROOT = resolve(REPO_ROOT, "foliplus/js");

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
};

const rel = (p: string) => p.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");
const code = (p: string) => codeOnly(readFileSync(p, "utf-8"));

const adapterPath = resolve(JS_ROOT, "core/leafletAdapter.ts");
const sources = walk(JS_ROOT);

describe("leafletAdapter is the only module touching the named Leaflet privates", () => {
  it("scans a non-trivial production tree", () => {
    expect(sources.length).toBeGreaterThanOrEqual(80);
  });

  it("confines every named reach to the adapter or to a counted exception", () => {
    const allowances = new Map(
      OUT_OF_CHARTER.map(({ f, n }) => [`foliplus/js/${f}`, n]),
    );
    const problems: string[] = [];
    for (const file of sources) {
      const name = rel(file);
      if (name === ADAPTER) continue;
      const found = (code(file).match(PRIVATE_FIELD_RE) || []).length;
      const allowed = allowances.get(name) ?? 0;
      if (found > allowed) {
        problems.push(
          `${name}: ${found}${allowed ? ` > ${allowed}` : " (no allowance)"}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it("every counted exception is still exactly as large as recorded", () => {
    // An allowance that outlives its reach would quietly cover the next one.
    for (const { f, n } of OUT_OF_CHARTER) {
      expect(code(resolve(JS_ROOT, f)).match(PRIVATE_FIELD_RE) || [], f).toHaveLength(
        n,
      );
    }
  });

  it("the adapter really holds all of them, so the scan cannot pass vacuously", () => {
    // A match is either `._icon` (dot-anchored) or `_panes` (bare alternative).
    const found = (code(adapterPath).match(PRIVATE_FIELD_RE) || []).map(m =>
      m.replace(/^\./, ""),
    );
    // Sorted by code unit, which is why _paneRenderers precedes _panes and
    // _update precedes _url (the deciding character is p, then r).
    expect([...new Set(found)].sort()).toEqual([
      "_attributions",
      "_container",
      "_icon",
      "_initInteraction",
      "_layers",
      "_map",
      "_paneRenderers",
      "_panes",
      "_path",
      "_shadow",
      "_update",
      "_url",
    ]);
  });

  it("matches the pane registry through both anchors, and no false friend", () => {
    const matched = (src: string) => src.match(PRIVATE_FIELD_RE) ?? [];
    expect(matched("map._panes")).toEqual(["_panes"]);
    expect(matched("map._paneRenderers")).toEqual(["_paneRenderers"]);
    // The bare alternative is why a string key or a destructuring is caught.
    expect(matched('map["_panes"]')).toEqual(["_panes"]);
    expect(matched("const { _panes } = map")).toEqual(["_panes"]);
    // False friends the dot anchor already keeps out — which is why stripping
    // string literals would earn nothing.
    expect(matched('"type_color_map"')).toEqual([]);
    expect(matched("type_color_map")).toEqual([]);
    expect(matched("${position}_container")).toEqual([]);
    // The documented boundary: a string-keyed read of a dot-anchored name is
    // not detected (ScaleControl reaches `_map` exactly this way).
    expect(matched('Reflect.set(scaleCtrl, "_map", value)')).toEqual([]);
    // Own field, excluded by lookbehind.
    expect(matched("this._map")).toEqual([]);
    expect(matched("ensureEvents(this._map)")).toEqual([]);
    // ...but only the dot immediately after `this`. A further hop is still an
    // inward reach, so the lookbehind is 4 characters, not 5.
    expect(matched("this.foo._map")).toEqual(["._map"]);
    expect(matched("layer._map")).toEqual(["._map"]);
  });
});

// ── The adapter itself ─────────────────────────────────────────
//
// `_map` is `protected` on Leaflet's Layer and `_shadow` on Marker. Neither can
// be declared in type/global.d.ts — a public declaration of either stops Marker
// from being assignable to Layer, which every `map.eachLayer` consumer in the
// tree depends on — so each probe narrows to the one field it reads. `_url`
// is the third: it is declared on TileLayer, but the probes take the whole
// layer tree. That is the whole type-system cost of this module, and it is
// held here.
describe("source pins", () => {
  it("narrows to a private field three times, never through `unknown`", () => {
    expect(adapterSource).not.toMatch(/\bas\s+(unknown|any)\b/);
    expect(adapterSource.match(/as [A-Z]\w+/g)).toEqual([
      "as LayerWithMap",
      "as LayerWithUrl",
      "as MarkerWithShadow",
    ]);
  });

  it("imports nothing, so it can hold no state and form no cycle", () => {
    expect(adapterSource).not.toMatch(/^\s*import\b/m);
  });

  it("exports the private reaches and the relocation primitives, never a bare public hop", () => {
    // A forwarder over Leaflet's public API would add a call without removing a
    // private reach. `destroyPane` and `getRendererFor` are here because both
    // have to agree with `_paneRenderers`; `moveIntoPane` is here because it
    // re-pins `options.renderer` through that registry (and is the single
    // remove+add point). `setPaneZ` and the like stay out: a plain DOM write is
    // exactly the hop this charter refuses.
    expect(Object.keys(adapter).sort()).toEqual([
      "attributionEntries",
      "destroyPane",
      "getRendererContainer",
      "getRendererFor",
      "hasAttachedPath",
      "internalLayers",
      "isGroupLike",
      "layerElements",
      "layerIcon",
      "layerMap",
      "layerUrl",
      "markerShadow",
      "moveIntoPane",
      "refreshAttributions",
      "reinitInteraction",
    ]);
  });
});

/** A map stub carrying the two pane registries and the layer membership the
 *  pane teardown needs. */
const makeMap = (panes: Record<string, HTMLElement> = {}) => ({
  getPane: (name: string) => panes[name],
  createPane: (name: string) => (panes[name] = document.createElement("div")),
  hasLayer: () => true,
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  _panes: panes as Record<string, HTMLElement> | undefined,
  _paneRenderers: {} as Record<string, unknown> | undefined,
});

/** A stub for the two probes whose parameter is Leaflet's own type. Their field
 *  is `protected`, so the shape cannot be written as an object literal — the
 *  stub is built instead, and the probe only ever reads the field it names. */
const leafStub = (fields: object) => Object.assign(Object.create(null), fields);

describe("destroyPane", () => {
  it("detaches the element and clears both registries", () => {
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    const map = makeMap({ heat: pane });
    map._paneRenderers = { heat: { id: "r" } };
    destroyPane(map as L.Map, "heat");
    expect(pane.parentNode).toBeNull();
    expect(map._panes?.heat).toBeUndefined();
    // getRenderer() re-adds a renderer it finds off the map, so a stale entry
    // would resurrect the dead renderer into the removed pane.
    expect(map._paneRenderers?.heat).toBeUndefined();
  });

  it("unbinds a live renderer before dropping its record", () => {
    // `map.removeLayer` is what unbinds the renderer's map listeners
    // (zoom / moveend / viewreset) and detaches its SVG root — leaving it
    // registered grows that listener set on every add/remove cycle.
    const renderer = { id: "r" };
    const map = makeMap();
    map._paneRenderers = { heat: renderer };
    destroyPane(map as L.Map, "heat");
    expect(map.removeLayer).toHaveBeenCalledWith(renderer);
  });

  it("leaves a sibling pane registered and attached", () => {
    const heat = document.createElement("div");
    const other = document.createElement("div");
    document.body.append(heat, other);
    const map = makeMap({ heat, other });
    destroyPane(map as L.Map, "heat");
    expect(map._panes?.heat).toBeUndefined();
    expect(map._panes?.other).toBe(other);
    expect(other.parentNode).toBe(document.body);
  });

  it("tolerates a map whose registries are absent", () => {
    const map = makeMap();
    map._panes = undefined;
    map._paneRenderers = undefined;
    expect(() => destroyPane(map as L.Map, "never-created")).not.toThrow();
  });
});

describe("getRendererFor", () => {
  it("adopts the renderer Leaflet already registered for the pane", () => {
    const existing = { id: "r" };
    const map = makeMap();
    map._paneRenderers = { p: existing };
    expect(getRendererFor(map as unknown as L.Map, "p")).toBe(existing);
    expect(window.L.svg).not.toHaveBeenCalled();
  });

  it("builds one and registers it under the pane name", () => {
    const map = makeMap();
    const built = getRendererFor(map as unknown as L.Map, "p");
    expect(window.L.svg).toHaveBeenCalledWith({ pane: "p" });
    expect(map._paneRenderers?.p).toBe(built);
    expect((built as unknown as { addTo: unknown }).addTo).toBeDefined();
  });

  it("degrades to null when the renderer cannot be built", () => {
    const map = makeMap();
    window.L.svg = vi.fn(() => {
      throw new Error("no svg");
    });
    expect(getRendererFor(map as unknown as L.Map, "p")).toBeNull();
  });
});

describe("moveIntoPane", () => {
  it("re-pins a Path's renderer to the target pane before re-adding", () => {
    // The private half: `options.pane` alone would leave the Path on the
    // renderer its *old* pane still holds.
    const map = makeMap();
    window.L.Path = class {
      options: Record<string, unknown> = { pane: "old", renderer: { id: "stale" } };
    } as unknown as typeof L.Path;
    const layer = new window.L.Path();
    map.hasLayer = () => false;
    moveIntoPane(map as unknown as L.Map, layer as unknown as L.Layer, "new");
    expect(layer.options.pane).toBe("new");
    expect(map._paneRenderers?.new).toBe(layer.options.renderer);
  });

  it("removes and re-adds a layer that is already on the map", () => {
    const map = makeMap();
    const order: string[] = [];
    map.hasLayer = () => true;
    map.removeLayer = () => {
      order.push("remove");
      return map;
    };
    map.addLayer = () => {
      order.push("add");
      return map;
    };
    const layer = { options: {} } as unknown as L.Layer;
    moveIntoPane(map as unknown as L.Map, layer, "p");
    // options.pane is read at `addLayer`, so it has to be written in between.
    expect(order).toEqual(["remove", "add"]);
    expect(layer.options.pane).toBe("p");
  });

  it("leaves a detached layer detached", () => {
    const map = makeMap();
    map.hasLayer = () => false;
    const layer = { options: {} } as unknown as L.Layer;
    moveIntoPane(map as unknown as L.Map, layer, "p");
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(layer.options.pane).toBe("p");
  });

  it("drops a stale renderer when no replacement can be built", () => {
    // `getRendererFor` degrades to null. A Path must then fall back to
    // Leaflet's own renderer for the new pane rather than keep pointing at the
    // old pane's.
    const map = makeMap();
    window.L.Path = class {
      options: Record<string, unknown> = { pane: "old", renderer: { id: "stale" } };
    } as unknown as typeof L.Path;
    window.L.svg = vi.fn(() => {
      throw new Error("no svg");
    });
    map.hasLayer = () => false;
    const layer = new window.L.Path();
    moveIntoPane(map as unknown as L.Map, layer as unknown as L.Layer, "new");
    expect(layer.options.pane).toBe("new");
    expect(layer.options.renderer).toBeUndefined();
  });
});

describe("internalLayers", () => {
  it("reads the child registry of a map or a group", () => {
    const a = {};
    expect(internalLayers({ _layers: { a } })).toEqual({ a });
    // An empty registry is still a registry: callers branch on its presence.
    expect(internalLayers({ _layers: {} })).toEqual({});
  });

  it("is undefined for a node without one", () => {
    // The node itself is guaranteed by the caller; the field is what is probed.
    expect(internalLayers({})).toBeUndefined();
    expect(internalLayers({ _layers: undefined })).toBeUndefined();
  });
});

describe("isGroupLike", () => {
  it("accepts Leaflet's own eachLayer", () => {
    expect(isGroupLike({ eachLayer: () => {} })).toBe(true);
  });

  it("accepts the child registry a non-Leaflet wrapper carries", () => {
    expect(isGroupLike({ _layers: {} })).toBe(true);
  });

  it("rejects a leaf that carries neither", () => {
    expect(isGroupLike({ options: {} })).toBe(false);
    expect(isGroupLike({})).toBe(false);
  });
});

describe("getRendererContainer", () => {
  it("reads the renderer's root element", () => {
    const container = document.createElement("div");
    expect(getRendererContainer({ _container: container })).toBe(container);
  });

  it("is null for a null renderer or one with no container", () => {
    expect(getRendererContainer(null)).toBeNull();
    expect(getRendererContainer({})).toBeNull();
  });
});

describe("layerIcon / layerElements", () => {
  it("layerElements collects whichever node the layer type populated", () => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const icon = document.createElement("img");
    expect(layerElements({ _path: path })).toEqual([path]);
    expect(layerElements({ _icon: icon })).toEqual([icon]);
    expect(layerElements({})).toEqual([]);
  });

  it("layerIcon is the icon alone, since the caller skips it in the manual pass", () => {
    const icon = document.createElement("img");
    expect(layerIcon({ _icon: icon })).toBe(icon);
    expect(layerIcon({})).toBeNull();
  });
});

describe("hasAttachedPath", () => {
  it("is true only while the path element is in the document", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    expect(hasAttachedPath({ _path: el })).toBe(false);
    document.body.appendChild(el);
    expect(hasAttachedPath({ _path: el })).toBe(true);
    expect(hasAttachedPath({})).toBe(false);
  });
});

describe("reinitInteraction", () => {
  it("calls the hook with the layer as its receiver", () => {
    // Leaflet's _initInteraction reads the layer off `this`, so a detached call
    // would register the hit target on nothing.
    const seen: unknown[] = [];
    const marker = {
      _initInteraction() {
        seen.push(this);
      },
    };
    expect(reinitInteraction(marker)).toBe(true);
    expect(seen).toEqual([marker]);
  });

  it("reports false when the layer has no hook, without throwing", () => {
    expect(reinitInteraction({})).toBe(false);
  });
});

describe("layerMap / markerShadow / layerUrl", () => {
  it("layerMap returns the map a layer is attached to, null when detached", () => {
    const map = { id: "map" };
    expect(layerMap(leafStub({ _map: map }))).toBe(map);
    expect(layerMap(leafStub({}))).toBeNull();
  });

  it("markerShadow returns the shadow element, null when the marker has none", () => {
    const shadow = document.createElement("img");
    expect(markerShadow(leafStub({ _shadow: shadow }))).toBe(shadow);
    expect(markerShadow(leafStub({}))).toBeNull();
  });

  it("layerUrl returns the tile URL template, null for a layer that has none", () => {
    // The probe takes the whole tree rather than narrowing with instanceof: a
    // registry holds whatever the map holds, and a non-tile entry answers null.
    expect(layerUrl(leafStub({ _url: "https://x/{z}/{y}/{x}.png" }))).toBe(
      "https://x/{z}/{y}/{x}.png",
    );
    expect(layerUrl(leafStub({}))).toBeNull();
    expect(layerUrl(leafStub({ options: {} }))).toBeNull();
  });
});

describe("attributionEntries / refreshAttributions", () => {
  it("hands over the control's own table by reference", () => {
    // Mutation must land in the control, so this is a live handover, not a copy.
    const table = { Leaflet: 1 };
    const ctrl = leafStub({ _attributions: table, _update: () => {} });
    const entries = attributionEntries(ctrl);
    expect(entries).toBe(table);
    entries["tile"] = 1;
    expect(ctrl._attributions).toEqual({ Leaflet: 1, tile: 1 });
  });

  it("refreshAttributions calls the control's own redraw", () => {
    const update = vi.fn();
    const ctrl = leafStub({ _attributions: {}, _update: update });
    refreshAttributions(ctrl);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
