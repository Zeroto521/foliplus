// test/js/control/LayerControl/ui/style/apply.fixture — shared stubs for the apply aspect suites.
import { installLeafletGlobals } from "./fixture.js";
import { vi } from "vitest";

// The carrier contract promises pane coverage only for layers whose leaves
// the migrator can relocate (Path / Marker / GridLayer / ImageOverlay). These
// executor tests exercise the pane write, so their stand-in layers declare
// the Path family identity instead of staying anonymous objects.
export const paneCapableLayer = (extra: Record<string, unknown> = {}): L.Layer => {
  const layer = { options: {}, ...extra } as unknown as L.Layer;
  Object.setPrototypeOf(layer, new window.L.Path());
  return layer;
};

// ────────────────────────────────────────────────────────────────────────
// Gate: the executor must not let a derived dimension authorize
// display. Only user intent (or the author's declared default) determines
// map membership; effective = intent && policy, so a derived dimension
// (focus, zoom range) can only pull a layer off the map — never push one
// onto it.
//
// This is the quickstart regression: folium ships a `show=False`
// layer off the map, no user override has been recorded, and the first
// projection must leave it alone. Before the fix the executor saw
// effective moving false → true and wrote visible=true, adding the layer to
// the map while the checkbox stayed unchecked.
// ────────────────────────────────────────────────────────────────────────

/** A bare map mock with `hasLayer → false` — the folium `show=False` boot
 *  state: the layer exists in the registry but was never added to the map. */
export const makeOffMapFixture = () => {
  installLeafletGlobals();
  const container = document.createElement("div");
  document.body.appendChild(container);

  const layer = paneCapableLayer();
  const map = {
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
    invalidateSize: vi.fn(),
    hasLayer: vi.fn(() => false),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    getZoom: vi.fn(() => 5),
    getMaxZoom: vi.fn(() => 18),
    getMinZoom: vi.fn(() => 0),
    options: { maxZoom: 18 },
    getBounds: vi.fn(() => ({
      pad: vi.fn(),
      getSouthWest: () => ({ lat: 20, lng: 90 }),
      getNorthWest: () => ({ lat: 50, lng: 90 }),
      getNorthEast: () => ({ lat: 50, lng: 120 }),
      getSouthEast: () => ({ lat: 20, lng: 120 }),
    })),
    getContainer: vi.fn(() => container),
    getPane: vi.fn(() => {
      const p = document.createElement("div");
      p.style.zIndex = "0";
      return p;
    }),
    getPanes: vi.fn(() => ({ mapPane: null })),
    createPane: vi.fn(() => {
      const p = document.createElement("div");
      p.style.zIndex = "0";
      return p;
    }),
    _container: container,
    _layers: {},
    attributionControl: { _attributions: {}, _update: vi.fn() },
    foliplus: { hint: { set: vi.fn(), clear: vi.fn(), registerIcon: vi.fn() } },
  } as any;

  return { container, layer, map };
};

/** A map where `hasLayer → true` for every layer — the folium `show=True`
 *  boot state, so the executor's baseline is on-map and a stored zoom
 *  range excludes the current zoom immediately. */
export const makeOnMapFixture = () => {
  const { layer, ...rest } = makeOffMapFixture();
  const map = {
    ...rest.map,
    hasLayer: vi.fn(() => true),
  } as any;
  return { container: rest.container, layer, map };
};

/** The role header's tri-state as the panel paints it. The panel keeps no
 *  separate counter: the header checkbox IS the aggregate, so reading it is
 *  reading the same number the user sees. */
export const headerState = (root: ParentNode, role: string) => {
  const row = root.querySelector(`.foliplus-layer-toggle-all[data-role="${role}"]`);
  const cb = row?.querySelector('[data-role="toggle-all"]') as HTMLInputElement | null;
  return {
    checked: cb?.checked ?? null,
    indeterminate: cb?.indeterminate ?? null,
  };
};

// ────────────────────────────────────────────────────────────────────────
// Nested groups: the executor removes the WHOLE group in one call and lets
// Leaflet cascade, so a grandchild leaves the map with its parent. A future
// change that switches the group-row write to a per-child walk (the #1284
// container-expand shape) would leave grandchildren on the map while the
// parent checkbox reads unchecked — this pins the cascade.
// ────────────────────────────────────────────────────────────────────────

/** A membership-tracking map that emulates Leaflet's recursive cascade:
 *  removing a container removes every descendant it owns. */
export const makeCascadeMap = () => {
  installLeafletGlobals();
  const members = new Set<unknown>();
  const parents = new Map<unknown, unknown[]>();
  const map = {
    on: vi.fn(),
    off: vi.fn(),
    eachLayer: vi.fn(),
    invalidateSize: vi.fn(),
    hasLayer: vi.fn((l: unknown) => members.has(l)),
    addLayer: vi.fn((l: any) => {
      members.add(l);
      for (const kid of parents.get(l) ?? []) map.addLayer(kid);
    }),
    removeLayer: vi.fn((l: any) => {
      members.delete(l);
      for (const kid of parents.get(l) ?? []) map.removeLayer(kid);
    }),
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    getZoom: vi.fn(() => 5),
  };
  return {
    map,
    register: (parent: unknown, kids: unknown[]) => parents.set(parent, kids),
  };
};

/** A group node exposing its kids through eachLayer (Leaflet LayerGroup shape). */
export const cascadeGroup = (kids: unknown[]) => ({
  options: {},
  eachLayer: (fn: (c: unknown) => void) => {
    for (const k of kids) fn(k);
  },
});
