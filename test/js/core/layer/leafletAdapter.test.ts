import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import adapterSource from "#core/layer/leafletAdapter?raw";
import {
  createPane,
  destroyPane,
  getRendererContainer,
  hasAttachedPath,
  internalLayers,
  isGroupLike,
  layerElements,
  layerIcon,
  layerMap,
  mapPaneOf,
  paneOf,
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
const PRIVATE_FIELD_RE = /\._(?:panes|paneRenderers|container|layers|icon|path|map)\b/g;

const STRIP_RE =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

const codeOnly = (src: string): string => src.replace(STRIP_RE, " ");

// The pane/layer surface: everything that hosts, orders or inspects layers.
// core/geo/coord.ts reads a map's child registry too, but for CRS detection
// rather than pane hosting — a different concern with no business importing a
// pane adapter, and it is out of this scan on purpose.
const SURFACE = ["core/layer", "LayerControl"];
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

const surfaceFiles = SURFACE.flatMap(dir => walk(resolve(JS_ROOT, dir)));

describe("leafletAdapter is the only module touching Leaflet privates", () => {
  it("scans a non-trivial layer surface", () => {
    expect(surfaceFiles.length).toBeGreaterThanOrEqual(15);
  });

  it("confines every private-field reach to the adapter", () => {
    const hits = surfaceFiles
      .filter(f => rel(f) !== ADAPTER)
      .map(f => ({ f: rel(f), n: (code(f).match(PRIVATE_FIELD_RE) || []).length }))
      .filter(x => x.n > 0);
    expect(hits, hits.map(h => `${h.f}: ${h.n}`).join("\n")).toEqual([]);
  });

  it("the adapter really holds all of them, so the scan cannot pass vacuously", () => {
    const found = (
      code(resolve(JS_ROOT, "core/layer/leafletAdapter.ts")).match(PRIVATE_FIELD_RE) ||
      []
    ).map(m => m.slice(1));
    expect([...new Set(found)].sort()).toEqual([
      "_container",
      "_icon",
      "_layers",
      "_map",
      "_paneRenderers",
      "_panes",
      "_path",
    ]);
  });
});

// ── The adapter itself ─────────────────────────────────────────
//
// One `as unknown as`, in the `_map` probe: `_map` is `protected` on Leaflet's
// Layer class, so it has no public type and cannot be read through an L.Layer
// declaration at all. The cast narrows to the field being probed rather than
// widening the layer to any, which is what makes it a real cast and not a
// bypass. test/js/tsconfig.test.ts holds the tree's count to this one site.
describe("source pins", () => {
  it("leafletAdapter.ts: one `as unknown as`, in the _map probe", () => {
    expect(adapterSource.match(/as unknown as/g)).toHaveLength(1);
    expect(adapterSource).toContain(
      "layer as unknown as { _map?: L.Map | null })._map",
    );
  });
});

/** A map stub carrying Leaflet's two pane registries. */
const makeMap = (panes: Record<string, HTMLElement> = {}) => ({
  getPane: (name: string) => panes[name] ?? null,
  createPane: (name: string) => (panes[name] = document.createElement("div")),
  getPanes: () => ({ mapPane: panes.mapPane ?? null }),
  _panes: panes as Record<string, HTMLElement> | undefined,
  _paneRenderers: {} as Record<string, unknown> | undefined,
});

describe("paneOf / createPane / mapPaneOf", () => {
  it("paneOf returns the registered element and null for an unknown name", () => {
    const pane = document.createElement("div");
    const map = makeMap({ heat: pane });
    expect(paneOf(map as unknown as L.Map, "heat")).toBe(pane);
    expect(paneOf(map as unknown as L.Map, "nope")).toBeNull();
  });

  it("createPane registers the element so paneOf finds it", () => {
    const map = makeMap();
    const pane = createPane(map as unknown as L.Map, "heat");
    expect(paneOf(map as unknown as L.Map, "heat")).toBe(pane);
  });

  it("mapPaneOf reads the map pane out of the pane registry", () => {
    const mapPane = document.createElement("div");
    const map = makeMap({ mapPane });
    expect(mapPaneOf(map as unknown as L.Map)).toBe(mapPane);
    expect(mapPaneOf(makeMap() as unknown as L.Map)).toBeNull();
  });
});

describe("destroyPane", () => {
  it("detaches the element and clears both registries", () => {
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    const map = makeMap({ heat: pane });
    map._paneRenderers = { heat: { id: "r" } };
    destroyPane(map as unknown as L.Map, "heat");
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
    destroyPane(map as unknown as L.Map, "heat");
    expect(map._panes?.heat).toBeUndefined();
    expect(map._panes?.other).toBe(other);
    expect(other.parentNode).toBe(document.body);
  });

  it("tolerates a map whose registries are absent", () => {
    const map = makeMap();
    map._panes = undefined;
    map._paneRenderers = undefined;
    expect(() => destroyPane(map as unknown as L.Map, "never-created")).not.toThrow();
  });
});

describe("getRendererContainer", () => {
  it("reads the renderer's root element", () => {
    const container = document.createElement("div");
    expect(
      getRendererContainer({ _container: container } as unknown as L.Renderer),
    ).toBe(container);
  });

  it("is null for a null renderer or one with no container", () => {
    expect(getRendererContainer(null)).toBeNull();
    expect(getRendererContainer({} as unknown as L.Renderer)).toBeNull();
  });
});

describe("internalLayers", () => {
  it("reads the child registry of a map or a group", () => {
    const a = { id: "a" };
    expect(internalLayers<{ id: string }>({ _layers: { a } })?.a).toBe(a);
    // An empty registry is still a registry: callers branch on its presence.
    expect(internalLayers({ _layers: {} })).toEqual({});
  });

  it("is undefined for a leaf, null and a primitive", () => {
    expect(internalLayers({})).toBeUndefined();
    expect(internalLayers(null)).toBeUndefined();
    expect(internalLayers("str")).toBeUndefined();
  });
});

describe("isGroupLike", () => {
  it("accepts Leaflet's own eachLayer", () => {
    expect(isGroupLike({ eachLayer: () => {} })).toBe(true);
  });

  it("accepts the child registry a non-Leaflet wrapper carries", () => {
    expect(isGroupLike({ _layers: {} })).toBe(true);
  });

  it("rejects a leaf, null and a primitive", () => {
    expect(isGroupLike({ options: {} })).toBe(false);
    expect(isGroupLike(null)).toBe(false);
    expect(isGroupLike("str")).toBe(false);
  });
});

describe("layerMap / layerIcon / layerElements / hasAttachedPath", () => {
  it("layerMap returns the map a layer is attached to, null when detached", () => {
    const map = {};
    expect(layerMap({ _map: map } as unknown as L.Layer)).toBe(map);
    expect(layerMap({} as L.Layer)).toBeNull();
  });

  it("layerElements collects whichever node the layer type populated", () => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const icon = document.createElement("img");
    expect(layerElements({ _path: path } as unknown as L.Layer)).toEqual([path]);
    expect(layerElements({ _icon: icon } as unknown as L.Layer)).toEqual([icon]);
    expect(layerElements({} as L.Layer)).toEqual([]);
  });

  it("layerIcon is the icon alone, since the caller skips it in the manual pass", () => {
    const icon = document.createElement("img");
    expect(layerIcon({ _icon: icon } as unknown as L.Layer)).toBe(icon);
    expect(layerIcon({} as L.Layer)).toBeNull();
  });

  it("hasAttachedPath is true only while the path element is in the document", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    expect(hasAttachedPath({ _path: el } as unknown as L.Path)).toBe(false);
    document.body.appendChild(el);
    expect(hasAttachedPath({ _path: el } as unknown as L.Path)).toBe(true);
    expect(hasAttachedPath({} as L.Path)).toBe(false);
    expect(hasAttachedPath({ _path: null } as unknown as L.Path)).toBe(false);
  });
});
