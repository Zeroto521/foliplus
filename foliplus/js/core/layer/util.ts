// core layer-traversal utilities — pure functions, no DOM / CONFIG.
import {
  internalLayers,
  layerElements,
  layerIcon,
  layerMap,
  reinitInteraction,
} from "../leafletAdapter.js";
import * as CONST from "./const.js";
import type { LabelAwareLayer, LayerCapabilities, LayerKind } from "./type.js";
import { walkLeaf } from "./walkLeaf.js";

/** Resolve a layer from the map's internal registry or a window global.
 *  @param {L.Map} map - Leaflet map.
 *  @param {string} id - Layer id.
 *  @returns {Object|null} Leaflet layer. */
const findLayer = (map: L.Map, id: string): L.Layer | null => {
  if (typeof window === "undefined") return null;
  return (internalLayers(map)?.[id] ||
    Reflect.get(window, id) ||
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

/** Honest capability profile for `kind: "cluster"`. Named so the UI and the
 *  regression suite share one answer: cluster icons live in the shared
 *  `markerPane` (opacity/zoomRange/bounds have no honest carrier), but the
 *  group itself is an `L.Layer` so visibility is still map membership. */
const CLUSTER_CAPABILITIES: Omit<LayerCapabilities, "annotation"> = {
  fill: CONST.CAP_TIER.NONE,
  stroke: CONST.CAP_TIER.NONE,
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
  setInteractive,
  suspendMapInteractions,
  getGeometryType,
  countFeatureGeometry,
};
