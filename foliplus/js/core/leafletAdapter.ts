// core/leafletAdapter — the only module that reaches into Leaflet's
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
//     `layer._initInteraction`;
//   - a tile layer's URL template: `layer._url`, which CRS detection and the
//     export renderer both need and Leaflet exposes nowhere;
//   - the attribution control's entry table and its redraw hook:
//     `attrCtrl._attributions` / `_update`, read only when Leaflet's public
//     `addAttribution` / `removeAttribution` are missing.
//
// Every such reach in foliplus goes through this module and nowhere else, so a
// Leaflet upgrade is a one-file problem instead of a grep across the tree.
// test/js/core/leafletAdapter.test.ts enforces both halves of that: no other
// production module names one of the fields, and this one still does.
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

/** `_url` is declared on `TileLayer` only, but callers hand over whatever the
 *  map's child registry holds — and they deliberately do not narrow with
 *  `instanceof`, because a registry entry that is not a TileLayer simply has no
 *  URL rather than being a programming error. */
type LayerWithUrl = L.Layer & { _url?: string };

/** The attribution control's two internals, described structurally.
 *
 *  `L.Control.Attribution` cannot be named here as a type: type/global.d.ts
 *  aliases `L.Control` to Leaflet's Control *instance* type, so `L.Control` in a
 *  type position has no `Attribution` member and the annotation fails. A
 *  structural type also keeps the probe's contract readable — the two fields it
 *  touches and nothing else. */
type AttributionInternals = {
  _attributions: Record<string, number>;
  _update: () => void;
};

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

/** A tile layer's URL template, or null when the layer carries none.
 *
 *  Callers must not narrow with `instanceof L.TileLayer` first: a registry
 *  holds whatever the map holds, and an entry that is not a tile layer answers
 *  null rather than requiring the caller to know which of its layers paint
 *  tiles. */
const layerUrl = (layer: L.Layer): string | null =>
  (layer as LayerWithUrl)._url ?? null;

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

/** The attribution control's live entry table, which the caller mutates.
 *
 *  Leaflet's public `addAttribution` / `removeAttribution` are the supported
 *  route and this table is what they write to. It is the only route left when a
 *  build ships without them, which is the only branch that reaches for it — so
 *  an absent table means nothing usable at all and is left to throw, as the
 *  direct read did.
 *
 *  Returned by reference on purpose: the caller deletes and sets entries, the
 *  same way `internalLayers` hands over the map's child registry. */
const attributionEntries = (attrCtrl: AttributionInternals): Record<string, number> =>
  attrCtrl._attributions;

/** Re-run the control's own redraw — the private counterpart of a public-API
 *  edit, which repaints on its own. */
const refreshAttributions = (attrCtrl: AttributionInternals): void =>
  attrCtrl._update();

/** Set the popup close button's `title` (hover tooltip).
 *
 *  Leaflet builds `_closeButton` when `closeButton` is enabled but exposes no
 *  public way to title it. Location markers are the only caller in-tree; they
 *  want a locale-translated hover label on the X. Called after
 *  `bindPopup`/`openPopup` so the popup element exists. Missing button
 *  (closeButton disabled, popup not yet built) is a no-op. */
const setPopupCloseTitle = (popup: L.Popup | undefined | null, title: string): void => {
  const btn = popup?._closeButton;
  if (btn) btn.title = title;
};

/** Bind a map onto a control before a manual `onAdd()`, so `onAdd` sees
 *  `this._map`.
 *
 *  `Control.onAdd` reads `this._map` on entry, but the only public route that
 *  binds it is `addTo()`, which also attaches the returned element to the
 *  map's corner. The caller wants the element back to wrap it in its own DOM,
 *  so it takes `onAdd` off the base and calls it by hand — which needs the
 *  back-reference written first. Not a substitute for `addTo`: this only
 *  primes the field, the caller still owns the element and its attachment.
 *  ScaleControl is the only caller; it builds its own `L.control.scale` and
 *  wraps the result in `.foliplus-scale-wrap`. */
const primeControlMap = (ctrl: L.Control, map: L.Map): void => {
  Reflect.set(ctrl, "_map", map);
};

export {
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
  primeControlMap,
  refreshAttributions,
  reinitInteraction,
  setPopupCloseTitle,
};
