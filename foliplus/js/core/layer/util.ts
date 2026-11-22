// core layer-traversal utilities — pure functions, no DOM / CONFIG.
import * as CONST from "./const.js";
import type {
  LabelAwareLayer,
  LayerCapabilities,
  LayerInfo,
  LayerKind,
} from "./type.js";
import { childrenOf, countChildLayers, walkLeaf } from "./walkLeaf.js";
import {
  internalLayers,
  isGroupLike,
  layerElements,
  layerIcon,
  layerMap,
  reinitInteraction,
} from "#core/leafletAdapter.js";

/** Resolve a layer from the map's internal registry or a window global.
 *  @param {L.Map} map - Leaflet map.
 *  @param {string} id - Layer id.
 *  @returns {Object|null} Leaflet layer. */
const findLayer = (map: L.Map, id: string): L.Layer | null => {
  if (typeof window === "undefined") return null;
  return (internalLayers(map)?.[id] ??
    Reflect.get(window, id) ??
    null) as L.Layer | null;
};

/**
 * Enable or disable interaction on a single (leaf) layer.
 *
 * Leaflet registers a layer's per-element hit targets once, at add time, and
 * only reads options.interactive live for the canvas renderer's hit test:
 *   - SVG paths  → _addPath calls addInteractiveTarget on the path element
 *   - Markers    → _initInteraction calls addInteractiveTarget on the icon
 *   - DivOverlay → onAdd calls addInteractiveTarget on the container
 * Flipping options.interactive alone therefore leaves those elements in
 * map._targets, so their click handlers still fire and the pointer cursor /
 * hover events keep going. Marker._initInteraction is also a no-op when
 * disabling (it early-returns), so the disable side must tear targets down
 * explicitly; the enable side re-runs _initInteraction to restore dragging.
 *
 * This helper sets the option and, for a layer already attached to a map,
 * toggles the `leaflet-interactive` cursor class and the registered hit
 * targets on the layer's icon / SVG path / overlay container. Once a target
 * is unregistered, Leaflet's DOM dispatch (_findEventTargets) falls through
 * to the map, so clicks land on the map as intended while measuring.
 *
 * A layer with no map has never registered targets — setting the option is
 * enough; it is applied the next time the layer is added.
 *
 * Container layers (LayerGroup) carry no interactivity of their own — walk a
 * tree with walkLeaf and apply this per leaf.
 *
 * @param {L.Layer} layer - Leaflet layer.
 * @param {boolean} interactive - Desired interactivity.
 */
const setInteractive = (layer: L.Layer, interactive: boolean): void => {
  const opts = layer.options as L.LayerOptions & { interactive?: boolean };
  if (!opts || opts.interactive === interactive) return;
  opts.interactive = interactive;
  if (!layerMap(layer)) return;

  const els = layerElements(layer);
  const icon = layerIcon(layer);

  if (interactive) {
    // Marker._initInteraction re-adds the icon class, hit target, and any
    // dragging hooks — prefer it for the icon. The explicit pass below covers
    // SVG paths and DivOverlay containers.
    const reinit = reinitInteraction(layer);
    for (const el of els) {
      if (el === icon && reinit) continue;
      el.classList.add("leaflet-interactive");
      layer.addInteractiveTarget(el);
    }
  } else {
    for (const el of els) {
      el.classList.remove("leaflet-interactive");
      layer.removeInteractiveTarget(el);
    }
  }
};

/**
 * Suspend interaction on every interactive leaf of a map and return a
 * restore closure. Centralizes the "exclusive map interaction" policy shared
 * by measure modes and export crop selection: while a component owns the map,
 * clicks must fall through to the map instead of firing feature handlers.
 *
 * Only leaves whose options.interactive is currently true are collected and
 * disabled, so the restore closure re-enables exactly those and leaves
 * everything else (tiles, labels, non-interactive previews) untouched.
 *
 * A `skip` predicate lets a caller exempt some leaves (e.g. edit mode keeps
 * its own measurement layers interactive while suspending everything else).
 *
 * @param {L.Map} map - Leaflet map.
 * @param {Function} [skip] - Optional predicate: leaves it returns true for
 *   are left interactive.
 * @returns {Function} Restore closure re-enabling the disabled leaves.
 */
const suspendMapInteractions = (
  map: L.Map,
  skip?: (leaf: L.Layer) => boolean,
): (() => void) => {
  const disabled: L.Layer[] = [];
  map.eachLayer(top => {
    walkLeaf(top, leaf => {
      if (skip?.(leaf)) return;
      const opts = leaf.options as L.LayerOptions & { interactive?: boolean };
      if (opts?.interactive) disabled.push(leaf);
    });
  });
  disabled.forEach(leaf => setInteractive(leaf, false));
  return () => disabled.forEach(leaf => setInteractive(leaf, true));
};

/** Detect the geometry type of a layer tree.
 *  Ignores isLabel leaves — type represents the data geometry, never labels.
 *  @param {L.Layer} layer - Leaflet layer.
 *  @returns {string} Geometry type constant from GEOM_TYPE. */
const getGeometryType = (layer: L.Layer): string => {
  const leaves: L.Layer[] = [];
  walkLeaf(layer, l => leaves.push(l));

  let hasData = false; // any non-label leaf — labels are not data geometry
  let hasPoly = false;
  let hasLine = false;
  let hasPoint = false;
  for (const leaf of leaves) {
    // Labels are non-geometry nodes — same rule as countFeatureGeometry.
    if ((leaf as LabelAwareLayer).isLabel) continue;
    hasData = true;
    if (leaf instanceof L.Polygon) hasPoly = true;
    else if (leaf instanceof L.Polyline) hasLine = true;
    // Marker / CircleMarker need a .feature envelope to be "structured,
    // downstream-consumable point data" (extractPoints / Heatmap / export
    // all gate on .feature). A plain folium.Marker() is a geometric point —
    // countFeatureGeometry counts it — but without that envelope it is not
    // consumable point data, so we don't mark it as point here.
    else if (leaf instanceof L.CircleMarker || leaf instanceof L.Marker) {
      if (leaf.feature) hasPoint = true;
    }
  }
  // Empty container or all-label layer → no data geometry.
  if (!hasData) return CONST.GEOM_TYPE.EMPTY;
  if (!hasPoly && !hasLine && !hasPoint) return CONST.GEOM_TYPE.UNKNOWN;
  const typeCount = Number(hasPoly) + Number(hasLine) + Number(hasPoint);
  if (typeCount > 1) return CONST.GEOM_TYPE.UNKNOWN;
  return hasPoly
    ? CONST.GEOM_TYPE.POLYGON
    : hasLine
      ? CONST.GEOM_TYPE.LINE
      : CONST.GEOM_TYPE.POINT;
};

/** The structural shape a container exposes: a child registry (Leaflet's
 *  `_layers` object, read through the adapter's own `internalLayers`) or the
 *  add/remove pair a group owns. */
type ContainerLike = L.Layer & {
  addLayer?: (layer: L.Layer) => unknown;
  getLayers?: () => L.Layer[];
  eachLayer?: (fn: (layer: L.Layer) => void) => void;
};

/** Whether a layer is a container of other layers.
 *
 *  A container is a group-like node that OWNS a child registry — a real
 *  Leaflet LayerGroup / FeatureGroup (or a folium FeatureGroup), recognised by
 *  its `_layers` object or add/remove pair. A leaf stand-in that happens to
 *  carry `eachLayer` (a Polygon stand-in, a marker with a stray method) is not
 *  a container.
 *
 *  A real L.FeatureGroup (L.featureGroup / a folium FeatureGroup) is always
 *  a container — even when its direct children carry `.feature` envelopes
 *  (feature leaves), the GeoJSON shape fallback below would wrongly exclude
 *  such a group, so the canonical class branch wins first.
 *
 *  One deliberate exclusion keeps the probe honest: L.GeoJSON extends
 *  L.FeatureGroup extends L.LayerGroup, so a naive `eachLayer` probe would
 *  mislabel EVERY GeoJSON row as a container — a GeoJSON layer is data, not a
 *  folder of sub-layers. The exclusion prefers `instanceof L.GeoJSON` (the
 *  canonical check) and falls back to the GeoJSON shape (every direct child
 *  carries a `feature` envelope) when the class identity is unavailable.
 *
 *  @param {L.Layer} layer - Leaflet layer (container or leaf).
 *  @returns {boolean} Whether the layer is a user-facing container. */
const isContainerLayer = (layer: L.Layer): layer is ContainerLike => {
  if (!isGroupLike(layer)) return false;
  // A real container enumerates children through Leaflet's child registry
  // (the _layers object) or the add/remove pair. A leaf stand-in that happens
  // to carry eachLayer (a Polygon stand-in in tests, a marker with a stray
  // method) is NOT a container — it has no child registry to own.
  const c = layer as Partial<ContainerLike>;
  // The child-registry read is the adapter's own reach (internalLayers), so
  // this module never touches a Leaflet private field directly.
  const hasChildRegistry =
    internalLayers(layer) !== undefined ||
    typeof c.addLayer === "function" ||
    typeof c.getLayers === "function";
  if (!hasChildRegistry) return false;
  // GeoJSON is a data layer with a group shape (FeatureGroup -> LayerGroup); it
  // owns no sub-layers, so a naive eachLayer probe would mislabel EVERY
  // GeoJSON row as a container. instanceof L.GeoJSON is the canonical check;
  // the guard keeps a jsdom mock L (no GeoJSON class) from throwing.
  // A real L.FeatureGroup (not a GeoJSON data layer) is always a user-facing
  // container — a folium FeatureGroup groups sub-layers even when its direct
  // children carry .feature envelopes (feature leaves). The GeoJSON shape
  // fallback below would wrongly exclude such a group, so the canonical class
  // branch wins first. Guarded because jsdom mocks L without the FeatureGroup
  // class (layerGroup is a factory there).
  if (
    typeof L.FeatureGroup === "function" &&
    layer instanceof (L.FeatureGroup as new () => L.Layer) &&
    !(
      typeof L.GeoJSON === "function" &&
      layer instanceof (L.GeoJSON as new () => L.Layer)
    )
  ) {
    return true;
  }
  if (
    typeof L.GeoJSON === "function" &&
    layer instanceof (L.GeoJSON as new () => L.Layer)
  ) {
    return false;
  }
  // A GeoJSON layer whose class identity is unavailable (foreign bundle,
  // jsdom mock) is recognised by its shape: every direct child carries a
  // GeoJSON feature envelope. A user FeatureGroup children (plain markers /
  // paths) carry none, so the two cannot be confused.
  const children = childrenOf(layer);
  if (children.length > 0 && children.every(child => child && "feature" in child)) {
    return false;
  }
  return true;
};

/** Whether a registry entry renders as a container ROW.
 *
 *  Row semantics — the type glyph, the count column, and whether the style and
 *  filter panels are available — belong to the entry, not to the Leaflet class
 *  alone. A logical layer can be backed by a group and still be data:
 *  MeasureControl and HeatmapControl both register an L.layerGroup with a
 *  `featureCountProvider`, and their count is provider-driven rather than a
 *  sub-layer census. `isContainerLayer` answers the geometry question (is this
 *  a group?); this answers the row question, so the provider exception lives
 *  here once instead of being re-derived at every call site.
 *
 *  @param {LayerInfo|null|undefined} layerInfo - Registry entry behind the row.
 *  @param {L.Layer|null|undefined} layer - Leaflet layer behind the entry.
 *  @returns {boolean} Whether the row is a container row. */
const isContainerRow = (
  layerInfo: LayerInfo | null | undefined,
  layer: L.Layer | null | undefined,
): boolean =>
  Boolean(
    layer && layerInfo && !layerInfo.featureCountProvider && isContainerLayer(layer),
  );

/** Count a container's DIRECT children (its own sub-layers, not deep leaves).
 *  @param {L.Layer} layer - Leaflet container.
 *  @returns {number} Number of direct children. */
const countChildLayersOf = (layer: L.Layer): number => countChildLayers(layer);
/** Count a container's DIRECT children currently added to the map (visible
 *  sub-layers). A direct child is counted only when the map still owns it
 *  (map.hasLayer(child)); a child removed from the map is not a visible
 *  sub-layer even though it remains in the container's registry.
 *  @param {L.Layer} layer - Leaflet container.
 *  @param {L.Map} map - Leaflet map (owner of the membership fact).
 *  @returns {number} Number of direct children on the map. */
const countVisibleChildLayers = (layer: L.Layer, map: L.Map): number => {
  // The child enumeration is walkLeaf's childrenOf — the same read
  // countChildLayers uses, so "how many children" and "how many are visible"
  // can never disagree about what a child is.
  if (typeof map.hasLayer !== "function") return 0;
  let visible = 0;
  for (const child of childrenOf(layer)) {
    if (map.hasLayer(child)) visible++;
  }
  return visible;
};

/** Count geometric features in a layer tree.
 *  Counts geometry-producing leaves (Polygon / Polyline / CircleMarker / Marker).
 *  A plain L.Marker without .feature (e.g. folium.Marker()) still counts as a
 *  point feature.  Excludes label layers and non-geometric nodes.
 *  @param {L.Layer} layer - Leaflet layer (container or leaf).
 *  @returns {number} Number of geometric features. */
const countFeatureGeometry = (layer: L.Layer): number => {
  let count = 0;
  walkLeaf(layer, (leaf: L.Layer) => {
    if ((leaf as LabelAwareLayer).isLabel) return;
    if (leaf instanceof L.Polygon) count++;
    else if (leaf instanceof L.Polyline) count++;
    else if (leaf instanceof L.CircleMarker) count++;
    else if (leaf instanceof L.Marker) count++;
  });
  return count;
};

/**
 * Build a predicate matching leaves whose `options.pane` is one of `panes`.
 * Used as a `suspendMapInteractions` skip so a component can keep its own
 * layers interactive (e.g. edit mode's measurements) while suspending every
 * other layer. The pane list is supplied by the caller, keeping this helper
 * component-agnostic.
 */
const isLayerInPanes = (panes: readonly string[]): ((leaf: L.Layer) => boolean) => {
  return (leaf: L.Layer) => {
    const opts = leaf.options as { pane?: string } | undefined;
    return !!opts?.pane && panes.includes(opts.pane);
  };
};

/** Whether the layer actually paints at the map's current zoom.
 *
 *  `GridLayer._setView` sets `_tileZoom = undefined` when the zoom falls
 *  outside the layer's own `options.minZoom/maxZoom`, so it builds no tile —
 *  yet `map.hasLayer()` still reports true. Consumers answering "is this
 *  layer visible?" must fold both facts in, or they name a layer the screen
 *  does not show. Layers without `minZoom/maxZoom` skip the range check.
 *
 *  Scope: Leaflet only applies the min/max zoom gate to **GridLayer**
 *  descendants (TileLayer, WMS, ImageOverlay, etc.). `L.Path` / `L.Marker`
 *  and other vector layers declare `maxZoom` but still render at any zoom —
 *  using this predicate for them would produce false negatives (e.g. labels
 *  vanishing at zoom levels where the vector layer is clearly on screen).
 *  Callers must be in a tile-layer context.
 */
const paintsAtZoom = (map: L.Map, layer: L.Layer | null | undefined): boolean => {
  if (!layer || !map.hasLayer(layer)) return false;
  const opts = (layer.options ?? {}) as { minZoom?: number; maxZoom?: number };
  const z = map.getZoom();
  if (typeof opts.minZoom === "number" && z < opts.minZoom) return false;
  if (typeof opts.maxZoom === "number" && z > opts.maxZoom) return false;
  return true;
};

/** Honest capability profile for `kind: "cluster"`. Named so the UI and the
 *  regression suite share one answer: cluster icons live in the shared
 *  `markerPane` (opacity/zoomRange/bounds have no honest carrier), but the
 *  group itself is an `L.Layer` so visibility is still map membership. */
const CLUSTER_CAPABILITIES: Omit<LayerCapabilities, "label"> = {
  fill: CONST.CAP_TIER.NONE,
  stroke: CONST.CAP_TIER.NONE,
  size: CONST.CAP_TIER.NONE,
  // Icon is "none" for the same reason opacity is: cluster bubbles live in
  // the shared `markerPane` and never enter `eachLayer`, so a per-leaf
  // `setIcon` write would change the individual markers but not the cluster
  // bubbles — half the layer. Do not "fix" this to "native".
  icon: CONST.CAP_TIER.NONE,
  iconColor: CONST.CAP_TIER.NONE,
  markerColor: CONST.CAP_TIER.NONE,
  opacity: CONST.CAP_TIER.NONE,
  zoomRange: CONST.CAP_TIER.NONE,
  visibility: CONST.CAP_TIER.NATIVE,
  relocatable: false,
  bounds: false,
};

/** The MarkerCluster plugin's group — **kind derivation only**. Capability
 *  dispatch goes through `kind: "cluster"` + `CLUSTER_CAPABILITIES`, not
 *  through this probe; callers should declare `kind: "cluster"`.
 *
 *  Two tells: the plugin attaches `_topClusterLevel`, and (when loaded) the
 *  group is an `L.MarkerClusterGroup`. Why the honest tier drops opacity:
 *  `eachLayer` reaches the individual markers, but the cluster icons live in
 *  the shared `markerPane` and never enter `eachLayer` — a pane write would
 *  fade the leaves and not the clusters (half the layer). */
const isMarkerCluster = (layer: L.Layer): boolean => {
  const ctor = (window.L as { MarkerClusterGroup?: unknown })?.MarkerClusterGroup;
  if (
    typeof ctor === "function" &&
    layer instanceof (ctor as new (...args: never[]) => unknown)
  ) {
    return true;
  }
  return !!(layer as L.Layer & { _topClusterLevel?: unknown })._topClusterLevel;
};

/** Whether the layer is a tile-family GridLayer (TileLayer is a subclass). */
const isTileFamily = (layer: L.Layer): boolean =>
  typeof L.GridLayer !== "undefined" && layer instanceof L.GridLayer;

/** Whether the layer is in the Path/Marker vector family (or a container of
 *  them). Same probe family as capability detection — not a new duck type. */
const isVectorFamily = (layer: L.Layer): boolean => {
  if (typeof L.Path !== "undefined" && layer instanceof L.Path) return true;
  if (typeof L.Marker !== "undefined" && layer instanceof L.Marker) return true;
  if (typeof L.LayerGroup !== "undefined" && layer instanceof L.LayerGroup) {
    return true;
  }
  return false;
};

/** Derive `kind` when the caller did not declare one.
 *
 *  `tile | vector` comes from the Leaflet layer family (GridLayer/TileLayer vs
 *  Path/Marker/LayerGroup) — the same probe family as capabilities. MarkerCluster
 *  may derive `"cluster"` so a folium plugin group still lands in the honest
 *  capability tier; callers should declare `kind: "cluster"` explicitly. */
const deriveLayerKind = (opts: {
  kind?: LayerKind;
  color?: string | null;
  custom?: unknown;
  canvas?: boolean;
  layer?: L.Layer | null;
}): LayerKind => {
  if (opts.kind) return opts.kind;
  if (opts.color != null) return CONST.KIND.SOLID;
  if (opts.custom !== undefined) return CONST.KIND.CUSTOM;
  if (opts.canvas && !opts.layer) return CONST.KIND.CANVAS;
  const layer = opts.layer;
  if (layer && isMarkerCluster(layer)) return CONST.KIND.CLUSTER;
  if (layer && isTileFamily(layer)) return CONST.KIND.TILE;
  if (layer && isVectorFamily(layer)) return CONST.KIND.VECTOR;
  if (layer) return CONST.KIND.VECTOR;
  // No layer and no explicit non-layer carrier: a pending Leaflet-layer
  // registration (folium script-stream). NOT "custom" — that kind means an
  // explicit no-carrier third-party payload and would hide the entry from
  // `hasUnresolvedLayers`.
  return CONST.KIND.VECTOR;
};

export {
  CLUSTER_CAPABILITIES,
  deriveLayerKind,
  findLayer,
  isLayerInPanes,
  paintsAtZoom,
  setInteractive,
  suspendMapInteractions,
  getGeometryType,
  countFeatureGeometry,
  isContainerLayer,
  isContainerRow,
  countChildLayersOf,
  countVisibleChildLayers,
};
