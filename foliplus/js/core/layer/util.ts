// core layer-traversal utilities — pure functions, no DOM / CONF.
import * as CONST from "./const.js";
import type { LabelAwareLayer } from "./type.js";

/** Resolve a layer from the map's internal registry or a window global.
 *  @param {Object} map - Leaflet map.
 *  @param {string} id - Layer id.
 *  @returns {Object|null} Leaflet layer. */
const findLayer = (map: L.Map, id: string): L.Layer | null => {
  if (typeof window === "undefined") return null;
  return ((map._layers && map._layers[id]) ||
    Reflect.get(window, id) ||
    null) as L.Layer | null;
};

/** Depth-limited walk over a layer tree, invoking fn per visited node.
 *  Prefer eachLayer (Leaflet's own recursion) over _layers — that keeps
 *  nested groups like mainLayer → [graph, label] traversed correctly.
 *  The _layers branch is a fallback for non-Leaflet containers (window
 *  globals and ad-hoc registry wrappers) that don't implement eachLayer.
 */
const traverse = (
  layer: L.Layer,
  fn: (layer: L.Layer) => void,
  depth = 0,
  leafOnly = false,
) => {
  if (!layer || depth > CONST.RECURSION.LAYER_DEPTH) return;
  const container = layer as L.LayerGroup;
  const isContainer = typeof container.eachLayer === "function";
  if (!leafOnly) fn(layer);
  if (isContainer) container.eachLayer(c => traverse(c, fn, depth + 1, leafOnly));
  else if (container._layers) {
    for (const k in container._layers) {
      if (Object.hasOwn(container._layers, k))
        traverse(container._layers[k], fn, depth + 1, leafOnly);
    }
  } else if (leafOnly) fn(layer);
};

/** Iterate every leaf node (no intermediate containers) of a layer tree. */
const forEachLeaf = (layer: L.Layer, fn: (layer: L.Layer) => void, depth = 0) => {
  traverse(layer, fn, depth, true);
};

/** Iterate every node (containers + leaves) of a layer tree. */
const forEachLayer = (layer: L.Layer, fn: (layer: L.Layer) => void, depth = 0) => {
  traverse(layer, fn, depth, false);
};

/**
 * Enable or disable interaction on a single (leaf) layer.
 *
 * Leaflet registers a layer's per-element hit targets once, at add time, and
 * only reads options.interactive live for the canvas renderer's hit test:
 *   - SVG paths  → _addPath calls addInteractiveTarget(_path)
 *   - Markers    → _initInteraction calls addInteractiveTarget(_icon)
 *   - DivOverlay → onAdd calls addInteractiveTarget(_container)
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
 * A layer without _map has never registered targets — setting the option is
 * enough; it is applied the next time the layer is added.
 *
 * Container layers (LayerGroup) carry no interactivity of their own — walk a
 * tree with forEachLeaf and apply this per leaf.
 *
 * @param {Object} layer - Leaflet layer.
 * @param {boolean} interactive - Desired interactivity.
 */
const setInteractive = (layer: L.Layer, interactive: boolean): void => {
  const opts = layer.options as L.LayerOptions & { interactive?: boolean };
  if (!opts || opts.interactive === interactive) return;
  opts.interactive = interactive;
  // _map is `protected` in @types/leaflet, so read it through a narrow cast.
  if (!(layer as unknown as { _map?: L.Map })._map) return;

  const els = [layer._icon, layer._path, layer._container].filter(
    (el): el is HTMLElement => !!el,
  );

  if (interactive) {
    // Marker._initInteraction re-adds the icon class, hit target, and any
    // dragging hooks — prefer it for the icon. The explicit pass below covers
    // SVG paths (layer._path) and DivOverlay containers (layer._container).
    if (typeof layer._initInteraction === "function") layer._initInteraction();
    for (const el of els) {
      if (el === layer._icon && typeof layer._initInteraction === "function") {
        continue;
      }
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
 * @param {Object} map - Leaflet map.
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
    forEachLeaf(top, leaf => {
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
 *  @param {Object} layer - Leaflet layer.
 *  @returns {string} Geometry type constant from GEOM_TYPE. */
const getGeometryType = (layer: L.Layer): string => {
  const leaves: L.Layer[] = [];
  forEachLeaf(layer, l => leaves.push(l));

  let hasData = false; // any non-label leaf — labels are not data geometry
  let hasPoly = false,
    hasLine = false,
    hasPoint = false;
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
 *  @param {Object} layer - Leaflet layer (container or leaf).
 *  @returns {number} Number of geometric features. */
const countFeatureGeometry = (layer: L.Layer): number => {
  let count = 0;
  forEachLeaf(layer, (leaf: L.Layer) => {
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

export {
  findLayer,
  forEachLayer,
  forEachLeaf,
  isLayerInPanes,
  setInteractive,
  suspendMapInteractions,
  getGeometryType,
  countFeatureGeometry,
};
