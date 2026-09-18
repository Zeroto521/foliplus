// core/layer/leafletAdapter — the only module that reaches into Leaflet's
// private fields.
//
// Leaflet keeps three things pane hosting needs off its public interface:
//   - removing a pane from the registries `getPane` / `getRenderer` read back
//     (`map._panes`, `map._paneRenderers`) — no public teardown exists;
//   - a renderer's root element (`renderer._container`), which `L.Renderer`
//     does not declare;
//   - a layer's DOM nodes and map back-reference (`layer._icon` / `_path` /
//     `_container` / `_map`), which are runtime state, not API.
//
// Every such reach in foliplus goes through this module and nowhere else, so a
// Leaflet upgrade is a one-file problem instead of a grep across the tree.
// test/js/core/layer/leafletAdapter.test.ts enforces that by scanning
// core/layer and LayerControl for the field names.
//
// Every read is probed rather than assumed: a field a future Leaflet stops
// setting yields null (or an empty list), so version drift degrades — a pane
// left in the DOM, a layer that stops taking the interactive cursor — instead
// of throwing out of the middle of a map operation.

/** A pane element by name, or null when the map has no such pane. */
const paneOf = (map: L.Map, name: string): HTMLElement | null =>
  map.getPane(name) ?? null;

/** Register a new pane under `name` and return its element. Callers probe
 *  `paneOf` first — Leaflet's `createPane` overwrites an existing entry. */
const createPane = (map: L.Map, name: string): HTMLElement => map.createPane(name);

/** The map pane: the transformed container every overlay rides in. Read
 *  through `getPanes()` rather than the name literal so a caller that swaps
 *  the registry (tests, embeds) keeps working. */
const mapPaneOf = (map: L.Map): HTMLElement | null => map.getPanes().mapPane ?? null;

/** Detach a pane and drop it from Leaflet's registries.
 *
 *  Both have to be cleared or the pane comes back: `getPane` would keep
 *  returning the detached node, and Leaflet's `getRenderer` re-adds any
 *  renderer it finds off the map, resurrecting a dead renderer into a pane
 *  that no longer belongs to it. */
const destroyPane = (map: L.Map, name: string): void => {
  if (map._paneRenderers) delete map._paneRenderers[name];
  paneOf(map, name)?.remove();
  if (map._panes) delete map._panes[name];
};

/** A renderer's root element — the `<svg>` / `<canvas>` holding its shapes.
 *  `_container` is Leaflet's own field, so reading it needs a narrow cast
 *  rather than a widening of the renderer to `any`. */
const getRendererContainer = (renderer: L.Renderer | null): HTMLElement | null =>
  (renderer as (L.SVG & { _container?: HTMLElement }) | null)?._container ?? null;

/** The child registry of a layer-tree node. Leaflet's `Map` and `LayerGroup`
 *  both key children by `L.stamp` here; a non-Leaflet container (a window
 *  global or an ad-hoc registry wrapper) may carry one too, which is why this
 *  is a probe on `unknown` rather than a typed member access. */
const internalLayers = <T>(container: unknown): Record<string, T> | undefined =>
  (container as { _layers?: Record<string, T> } | null | undefined)?._layers;

/** Whether `x` enumerates children — through Leaflet's `eachLayer`, or through
 *  the `_layers` registry a wrapper may expose instead. */
const isGroupLike = (x: unknown): boolean => {
  const group = x as L.LayerGroup | null | undefined;
  return typeof group?.eachLayer === "function" || Boolean(internalLayers(x));
};

/** The map a layer is attached to, or null while it is off the map.
 *
 *  `_map` is `protected` on Leaflet's `Layer` class, so it has no public type
 *  at all and cannot be read through an `L.Layer` declaration. The double
 *  assertion narrows to the single field being probed rather than laundering
 *  the whole layer through `any` — see test/js/tsconfig.test.ts, which holds
 *  the tree's double-assertion count to this one site. */
const layerMap = (layer: L.Layer): L.Map | null =>
  (layer as unknown as { _map?: L.Map | null })._map ?? null;

/** A marker's icon element, or null. Kept apart from `layerElements` because
 *  `setInteractive` re-runs the marker's own `_initInteraction` for this node
 *  and must skip it in the manual class / hit-target pass. */
const layerIcon = (layer: L.Layer): HTMLElement | null => layer._icon ?? null;

/** Whether a Path still has its element in the document.
 *
 *  `bringToFront` moves that element inside its parent, so it throws when the
 *  layer was detached between the caller's decision and the call — which the
 *  z-order pass does (it briefly removes layers from the map) and a concurrent
 *  mousemove can still reach. */
const hasAttachedPath = (layer: L.Path): boolean => !!layer._path?.parentNode;

/** The DOM nodes a leaf draws itself with — marker icon, SVG path, DivOverlay
 *  container. A given layer populates exactly one of them.
 *
 *  `_path` is an `SVGElement`, but every caller treats the result as a generic
 *  element (classList + Leaflet hit targets), which is what the predicate
 *  narrows to. */
const layerElements = (layer: L.Layer): HTMLElement[] =>
  [layerIcon(layer), layer._path, layer._container].filter(
    (el): el is HTMLElement => !!el,
  );

export {
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
};
