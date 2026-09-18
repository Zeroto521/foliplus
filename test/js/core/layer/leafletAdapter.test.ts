import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import adapterSource from "#core/layer/leafletAdapter?raw";
import * as adapter from "#foliplus/core/layer/leafletAdapter.js";
import {
  destroyPane,
  getRendererContainer,
  hasAttachedPath,
  internalLayers,
  isGroupLike,
  layerElements,
  layerIcon,
  layerMap,
  markerShadow,
  reinitInteraction,
} from "#foliplus/core/layer/leafletAdapter.js";

// ── Static guard: the privileged surface ────────────────────────
//
// Leaflet exposes no API for pane teardown, for a renderer's root element, or
// for a layer's DOM nodes — so those reaches cannot be eliminated, only
// confined. Confining them to one module is what makes a Leaflet upgrade a
// single-file problem, and this scan is what keeps them confined: no module of
// the layer surface may name one of the fields itself.
//
// Both halves are asserted: the surface stays clean AND the adapter still holds
// the fields, so a typo in the pattern cannot make this pass vacuously.
//
// The scan runs on code with comments and string literals stripped:
//   - comments may name the fields freely — that is where the why lives, and a
//     guard that forbade it would push the explanation out of the file it
//     belongs to;
//   - string literals hold false friends the names would otherwise match
//     (`"type_color_map"`, `${position}_container`).
// A private field reached from inside a template substitution would be missed;
// nothing in the tree does that, and the alternative is a TS parse here.
const PRIVATE_FIELD_RE =
  /\._(?:panes|paneRenderers|container|layers|icon|path|map|shadow|initInteraction)\b/g;

const STRIP_RE =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

const codeOnly = (src: string): string => src.replace(STRIP_RE, " ");

// Every production module is scanned, not just the layer surface: a reach into
// `layer._icon` from some other control is exactly what this guard is for, and
// a directory list would have to be widened by hand to notice one.
//
// Three reaches outside this module's charter are counted rather than ignored,
// so a *new* one in any of those files still fails:
//   - core/geo/coord.ts reads a map's child registry to find the tile layers of
//     the current basemap — CRS detection, a different concern that has no
//     business importing a pane adapter;
//   - BaseControl.ts and ScaleControl/index.ts use `this._map`, which is
//     Leaflet's own field on the L.Control subclass they *are* (set by
//     Control.addTo), not an inward reach into another object's internals.
const OUT_OF_CHARTER = [
  { f: "core/geo/coord.ts", n: 1 },
  { f: "BaseControl.ts", n: 3 },
  { f: "ScaleControl/index.ts", n: 3 },
] as const;

const ADAPTER = "foliplus/js/core/layer/leafletAdapter.ts";

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

const adapterPath = resolve(JS_ROOT, "core/layer/leafletAdapter.ts");
const sources = walk(JS_ROOT);

describe("leafletAdapter is the only module touching Leaflet privates", () => {
  it("scans a non-trivial production tree", () => {
    expect(sources.length).toBeGreaterThanOrEqual(80);
  });

  it("confines every private-field reach to the adapter", () => {
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
    const found = (code(adapterPath).match(PRIVATE_FIELD_RE) || []).map(m =>
      m.slice(1),
    );
    // Sorted by code unit, which is why _paneRenderers precedes _panes.
    expect([...new Set(found)].sort()).toEqual([
      "_container",
      "_icon",
      "_initInteraction",
      "_layers",
      "_map",
      "_paneRenderers",
      "_panes",
      "_path",
      "_shadow",
    ]);
  });
});

// ── The adapter itself ─────────────────────────────────────────
//
// `_map` is `protected` on Leaflet's Layer and `_shadow` on Marker. Neither can
// be declared in type/global.d.ts — a public declaration of either stops Marker
// from being assignable to Layer, which every `map.eachLayer` consumer in the
// tree depends on — so each probe narrows to the one field it reads. That is
// the whole type-system cost of this module, and it is held here.
describe("source pins", () => {
  it("narrows to a protected field twice, never through `unknown`", () => {
    expect(adapterSource).not.toMatch(/\bas\s+(unknown|any)\b/);
    expect(adapterSource.match(/as [A-Z]\w+/g)).toEqual([
      "as LayerWithMap",
      "as MarkerWithShadow",
    ]);
  });

  it("imports nothing, so it can hold no state and form no cycle", () => {
    expect(adapterSource).not.toMatch(/^\s*import\b/m);
  });

  it("exports only reaches, never a hop over Leaflet's public API", () => {
    // getPane / createPane / getPanes are Leaflet's own; a wrapper for them
    // would add a call without removing a private reach.
    expect(Object.keys(adapter).sort()).toEqual([
      "destroyPane",
      "getRendererContainer",
      "hasAttachedPath",
      "internalLayers",
      "isGroupLike",
      "layerElements",
      "layerIcon",
      "layerMap",
      "markerShadow",
      "reinitInteraction",
    ]);
  });
});

/** A map stub carrying the two pane registries `destroyPane` clears. */
const makeMap = (panes: Record<string, HTMLElement> = {}) => ({
  getPane: (name: string) => panes[name],
  createPane: (name: string) => (panes[name] = document.createElement("div")),
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

describe("layerMap / markerShadow", () => {
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
});
