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
// Anchoring: four branches, each deliberately narrow rather than one wide
// pattern that would match loosely inside strings.
//
//   1. Dot-anchored — `layer._map`. These eleven names are generic enough that
//      a bare word would false-positive (`_update`, `_path`, `_map`).
//   2. Bare pane-registry names — `_panes`, `_paneRenderers`. Distinctive enough
//      to match without an anchor, which is what catches `map["_panes"]` and
//      `const { _panes } = map`.
//   3. String-keyed — `map["_map"]`, `Reflect.set(x, "_map", v)`,
//      `Object.getOwnPropertyDescriptor(m, "_layers")`. The quotes confine the
//      match to a key, and the required trailing `]` or `,` keeps out a string
//      that merely *contains* the name: `"type_color_map"` fails because the
//      quote is not immediately before `_map`, and
//      `getOwnPropertyDescriptor(api, "layers")` fails because there is no
//      leading underscore.
//   4. Bare token in a declaration destructuring — `const { _map } = layer`,
//      `const { _layers: ls } = m`. Anchored on a declaration keyword, not on
//      `{`: a bare `{ _name` also matches a *type* property
//      (`type X = L.Layer & { _map?: L.Map | null }`), which declares a field
//      instead of reaching one — six such sites live in this module alone and
//      would fail the scan.
//
// Still not caught, and worth knowing: a pattern element after another
// (`const { a, _map } = m`), a parameter destructure (`function f({ _map })`),
// a key held in a variable (`const k = "_map"; map[k]`), and a key used in any
// position other than the three examples above (`const k = "_map"` alone).
//
// `this.` is excluded by lookbehind, because the reach this module owns is one
// that goes *inward* at another object's private field. `this._map` in
// BaseControl.ts and ScaleControl/index.ts is Leaflet's own field on the
// L.Control subclass they *are* (set by Control.addTo) — their own state, not
// an inward reach. The `\b` is what makes the exclusion tight: bare
// `(?<!this)` would also exempt `_this._map`, where `_this` is `this` held
// under another name and the field is reached *through* it — an inward reach
// all the same. Only the dot-anchored branch carries the lookbehind, so a
// further hop (`this.foo._map`) is still caught.
//
// Comments are stripped before matching, so the prose above and in the sources
// may name the fields freely; that is where the why lives. String literals are
// deliberately NOT stripped: branch 3 reads them, so removing the literals
// would hide the `["_map"]` form it exists to catch. `"type_color_map"` and
// `${position}_container` still do not match — the anchors are what exclude
// them, not the stripping.
//
// The field list is reused by branches 1, 3 and 4, so the pattern is built
// rather than written as a literal. The quote class is a plain template
// literal, because a backtick cannot appear inside a raw one.
const FIELD_NAMES =
  "attributions|closeButton|container|icon|initInteraction|layers|map|path|shadow|update|url";
const QUOTES = `['"\`]`;

const PRIVATE_FIELD_RE = new RegExp(
  String.raw`(?<!\bthis)\._(?:${FIELD_NAMES})\b` +
    String.raw`|\b_(?:panes|paneRenderers)\b` +
    `|${QUOTES}_(?:${FIELD_NAMES})${QUOTES}(?=[\\],)])` +
    String.raw`|\b(?:const|let|var)\s*\{\s*_(?:${FIELD_NAMES})\b`,
  "g",
);

const COMMENT_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

const codeOnly = (src: string): string => src.replace(COMMENT_RE, " ");

// Reaches this module deliberately does not own, counted rather than ignored so
// a *new* one in any of these files still fails. Neither entry is a judgement
// about whether the field is Leaflet's:
//   - common/dom.ts titles a popup's close button through `_closeButton`. The
//     probe could live here, but common/ never imports from #core/ (core does
//     the importing; no common file reaches up today), so routing that reach
//     through this module would invert the layering — and there was a prior
//     incident of a common→core inversion to unwind. The popup-title logic
//     arguably does not belong in common/ at all; it is marker/popup business,
//     not a generic DOM utility. Moving it is a separate step, and the probe
//     comes with it.
//   - ScaleControl/index.ts primes `_map` onto the control it built itself —
//     `Reflect.set(L.control.scale(…), "_map", this._map)` — so `onAdd` sees a
//     map already bound. That is a write on a self-created object, not a read
//     of another object's private field. It is exactly the string-keyed shape
//     branch 3 exists to catch, which is why it is now counted here rather
//     than remaining invisible to the scan.
const OUT_OF_CHARTER = [
  { f: "common/dom.ts", n: 1 },
  { f: "ScaleControl/index.ts", n: 1 },
] as const;

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
    // Branch 2: distinctive enough to match bare, which is what catches a
    // string key or a destructuring of them.
    expect(matched("map._panes")).toEqual(["_panes"]);
    expect(matched("map._paneRenderers")).toEqual(["_paneRenderers"]);
    expect(matched('map["_panes"]')).toEqual(["_panes"]);
    expect(matched("const { _panes } = map")).toEqual(["_panes"]);
    expect(matched("_this._panes")).toEqual(["_panes"]);
    // False friends the anchors keep out.
    expect(matched('"type_color_map"')).toEqual([]);
    expect(matched("type_color_map")).toEqual([]);
    expect(matched("${position}_container")).toEqual([]);
  });

  it("catches a string-keyed reach, and not a name that merely looks like one", () => {
    const matched = (src: string) => src.match(PRIVATE_FIELD_RE) ?? [];
    expect(matched('map["_map"]')).toEqual(['"_map"']);
    expect(matched("map['_layers']")).toEqual(["'_layers'"]);
    // The shape ScaleControl uses for `_map` — now visible, so it is counted in
    // OUT_OF_CHARTER rather than slipping past the scan.
    expect(matched('Reflect.set(scaleCtrl, "_map", value)')).toEqual(['"_map"']);
    expect(matched('Object.getOwnPropertyDescriptor(m, "_layers")')).toEqual([
      '"_layers"',
    ]);
    // Branch 3 has no `this.` lookbehind: a further hop is still an inward
    // reach, regardless of how the key is quoted.
    expect(matched('this.foo["_map"]')).toEqual(['"_map"']);
    expect(matched("this.foo[`_map`]")).toEqual(["`_map`"]);
    // False friends. Both occur in the production tree.
    expect(matched('Object.getOwnPropertyDescriptor(api, "layers")')).toEqual([]);
    expect(matched('T("map")')).toEqual([]);
    expect(matched('"type_color_map"')).toEqual([]);
    expect(matched('"${position}_container"')).toEqual([]);
    // Residual gap: a key held in a variable, or in a value position.
    expect(matched('const k = "_map"; map[k]')).toEqual([]);
  });

  it("catches a bare token in a destructuring, not a type declaration of one", () => {
    const matched = (src: string) => src.match(PRIVATE_FIELD_RE) ?? [];
    expect(matched("const { _map } = layer")).toEqual(["const { _map"]);
    expect(matched("const { _layers: ls } = m")).toEqual(["const { _layers"]);
    expect(matched("let { _icon } = node")).toEqual(["let { _icon"]);
    // A type member declares the same name and is not a reach. This is why the
    // branch is anchored on a declaration keyword rather than on `{` — the
    // adapter alone holds six of them.
    expect(matched("type X = L.Layer & { _map?: L.Map | null }")).toEqual([]);
    expect(matched("type T = {\n  _layers?: Record<string, L.Layer>;\n}")).toEqual([]);
    // Residual gaps, documented above: another element first, or a parameter.
    expect(matched("const { a, _map } = m")).toEqual([]);
    expect(matched("function f({ _map }) {}")).toEqual([]);
  });

  it("excludes only `this._map`, because that is Leaflet's own field", () => {
    const matched = (src: string) => src.match(PRIVATE_FIELD_RE) ?? [];
    expect(matched("this._map")).toEqual([]);
    expect(matched("ensureEvents(this._map)")).toEqual([]);
    // A further hop is still an inward reach.
    expect(matched("this.foo._map")).toEqual(["._map"]);
    expect(matched("layer._map")).toEqual(["._map"]);
    // So is `this` held under another name: same private field, reached through
    // the alias. `\b` is what keeps the exclusion to the identifier alone.
    expect(matched("_this._map")).toEqual(["._map"]);
    expect(matched("const _this = this; _this._map")).toEqual(["._map"]);
    expect(matched("window._this._map")).toEqual(["._map"]);
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
