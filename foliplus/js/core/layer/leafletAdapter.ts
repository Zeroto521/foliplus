// core/layer/leafletAdapter — the only module that reaches into Leaflet's
// private surface.
//
// Leaflet keeps everything pane hosting needs off its public interface:
//   - pane teardown: `map._panes` / `map._paneRenderers` (no public API);
//   - the per-pane renderer registry: `map._paneRenderers`, which both
//     `getRenderer` and pane teardown have to agree with;
//   - a renderer's root element: `renderer._container`;
//   - a layer's DOM nodes and map back-reference: `layer._icon` / `_path` /
//     `_container` / `_map` (runtime state, not API);
//   - a marker's drop shadow: `marker._shadow`;
//   - the hook that re-registers a marker's hit target and drag handles:
//     `layer._initInteraction`.
//
// Every such reach in foliplus goes through this module and nowhere else, so a
// Leaflet upgrade is a one-file problem instead of a grep across the tree.
// test/js/core/layer/leafletAdapter.test.ts enforces both halves of that: no
// other production module names one of the fields, and this one still does.
//
// Deliberately absent: anything that merely forwards a public call. `getPane`,
// `createPane` and `getPanes` are Leaflet's own API, so callers use them
// directly — a wrapper here would add a hop without removing a private reach.
//
// Every read is probed rather than assumed: a field a future Leaflet stops
// setting yields null (or an empty list), so version drift degrades — a pane
// left in the DOM, a layer that stops taking the interactive cursor — instead
// of throwing out of the middle of a map operation.

/** The private fields this module reads that Leaflet's public types do carry,
 *  once declared: `_icon` / `_path` / `_container` / `_initInteraction` come
 *  from the `Layer` augmentation in type/global.d.ts. The probes take this
 *  rather than `L.Layer`, so the signature says exactly what they touch and a
 *  caller holding a stub can hand one over without an assertion. */
type LeafInternals = {
  _icon?: HTMLElement;
  _path?: SVGElement;
  _container?: HTMLElement;
  _initInteraction?: () => void;
};

/** The two reaches that cannot be declared anywhere: `_map` is `protected` on
 *  Leaflet's `Layer` and `_shadow` on `Marker`. Making either public in
 *  type/global.d.ts stops `Marker` from being assignable to `Layer` — which
 *  every `map.eachLayer` consumer in the tree depends on — so each probe below
 *  narrows to the one field it reads instead. */
type LayerWithMap = L.Layer & { _map?: L.Map | null };
type MarkerWithShadow = L.Marker & { _shadow?: HTMLElement };

/** A layer-tree node. Leaflet's `Map` and `LayerGroup` key children by
 *  `L.stamp` in `_layers` and enumerate them through `eachLayer`. A
 *  non-Leaflet container — a window global, an ad-hoc registry wrapper — carries
 *  `_layers` without being a LayerGroup at all, which is why this is structural
 *  too. */
type LayerTreeNode = {
  _layers?: Record<string, L.Layer>;
  eachLayer?: (fn: (layer: L.Layer) => void) => void;
};

/** The child registry of a layer-tree node, when it has one. */
const internalLayers = (node: LayerTreeNode): Record<string, L.Layer> | undefined =>
  node._layers;

/** Whether a node enumerates children — through Leaflet's `eachLayer`, or
 *  through the `_layers` registry a wrapper exposes instead. */
const isGroupLike = (node: LayerTreeNode): boolean =>
  typeof node.eachLayer === "function" || Boolean(node._layers);

/** Detach a pane and drop it from Leaflet's registries — the one teardown for a
 *  pane this tree owns.
 *
 *  Three things have to go, in this order:
 *    - the renderer, off the map first. `map.removeLayer` is what unbinds its
 *      map listeners (zoom / moveend / viewreset) and detaches the SVG root;
 *      leaving it registered grows that listener set on every add/remove cycle.
 *    - `_paneRenderers`. `getRenderer` re-adds any renderer it finds off the map,
 *      so a stale entry resurrects a dead renderer into a pane that no longer
 *      belongs to it.
 *    - the pane element and `_panes`, or `getPane` keeps returning a detached
 *      node and `createPane` never rebuilds. */
const destroyPane = (map: L.Map, name: string): void => {
  const renderer = map._paneRenderers?.[name];
  if (renderer && map.hasLayer(renderer)) map.removeLayer(renderer);
  if (map._paneRenderers) delete map._paneRenderers[name];
  map.getPane(name)?.remove();
  if (map._panes) delete map._panes[name];
};

/** Relocate a layer to a pane by remove + re-add, re-pinning its renderer.
 *
 *  `options.pane` is read at `map.addLayer`, so a layer already on the map can
 *  only change panes by being removed and re-added. It re-pins
 *  `options.renderer` through {@link getRendererFor} so a Path lands in the new
 *  pane's renderer rather than the one its old pane still holds — which is the
 *  private half, and what makes this more than a hop over Leaflet's public API.
 *
 *  No consumer in R3; the first one arrives with the content-source hook (R6b),
 *  which is where a pane change while the layer is attached becomes
 *  reachable. */
const moveIntoPane = (map: L.Map, layer: L.Layer, paneName: string): void => {
  const attached = map.hasLayer(layer);
  if (attached) map.removeLayer(layer);
  layer.options.pane = paneName;
  if (layer instanceof L.Path) {
    layer.options.renderer = getRendererFor(map, paneName) ?? undefined;
  }
  if (attached) map.addLayer(layer);
};

/** The SVG renderer a pane's Path layers must be pinned to, created on demand.
 *
 *  Leaflet's `_paneRenderers` is both the lookup and the record: `getRenderer`
 *  hands a Path with no `options.renderer` whatever that registry holds for the
 *  pane, so a renderer missing from it lets Leaflet build a **second** `<svg>`
 *  inside the same pane. Registering ours there is what keeps one pane to one
 *  renderer.
 *
 *  @returns the pane's renderer, or null when it has none and none could be
 *    built (the caller then leaves the layer on Leaflet's default renderer). */
const getRendererFor = (map: L.Map, name: string): L.SVG | null => {
  const existing = map._paneRenderers?.[name];
  if (existing) return existing as L.SVG;
  try {
    const renderer = L.svg({ pane: name });
    renderer.addTo(map);
    if (map._paneRenderers) map._paneRenderers[name] = renderer;
    return renderer;
  } catch {
    return null;
  }
};

/** A renderer's root element — the `<svg>` / `<canvas>` holding its shapes. */
const getRendererContainer = (renderer: LeafInternals | null): HTMLElement | null =>
  renderer?._container ?? null;

/** The map a layer is attached to, or null while it is off the map. */
const layerMap = (layer: L.Layer): L.Map | null => (layer as LayerWithMap)._map ?? null;

/** A marker's icon element, or null. Kept apart from `layerElements` because
 *  `setInteractive` re-runs the marker's own interaction setup for this node and
 *  must skip it in the manual class / hit-target pass. */
const layerIcon = (layer: LeafInternals): HTMLElement | null => layer._icon ?? null;

/** The DOM nodes a leaf draws itself with — marker icon, SVG path, DivOverlay
 *  container. A given layer populates exactly one of them.
 *
 *  `_path` is an `SVGElement`, but every caller treats the result as a generic
 *  element (classList + Leaflet hit targets), which is what the predicate
 *  narrows to. */
const layerElements = (layer: LeafInternals): HTMLElement[] =>
  [layerIcon(layer), layer._path, layer._container].filter(
    (el): el is HTMLElement => !!el,
  );

/** Whether a Path still has its element in the document.
 *
 *  `bringToFront` moves that element inside its parent, so it throws when the
 *  layer was detached between the caller's decision and the call — which the
 *  z-order pass does (it briefly removes layers from the map) and a concurrent
 *  mousemove can still reach. */
const hasAttachedPath = (layer: LeafInternals): boolean => !!layer._path?.parentNode;

/** A marker's shadow element, or null. Migrating a marker moves the shadow
 *  alongside its icon, and `eachLayer` never surfaces it. */
const markerShadow = (marker: L.Marker): HTMLElement | null =>
  (marker as MarkerWithShadow)._shadow ?? null;

/** Re-run a marker's own interaction setup: `Marker._initInteraction` re-adds
 *  the icon class, the hit target and the dragging hooks, and early-returns when
 *  the layer is being turned non-interactive.
 *
 *  @returns whether the layer has the hook, so the caller can skip its manual
 *  pass on the icon instead of registering the same target twice. */
const reinitInteraction = (layer: LeafInternals): boolean => {
  const reinit = layer._initInteraction;
  if (typeof reinit !== "function") return false;
  reinit.call(layer);
  return true;
};

export {
  destroyPane,
  getRendererContainer,
  getRendererFor,
  hasAttachedPath,
  internalLayers,
  isGroupLike,
  layerElements,
  layerIcon,
  layerMap,
  markerShadow,
  moveIntoPane,
  reinitInteraction,
};
