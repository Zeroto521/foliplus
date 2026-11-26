// core/layer/interaction — turn per-leaf hit targets on or off for one leaf or a whole map.
//
// Leaflet registers a layer's hit targets once, at add time, so flipping
// options.interactive alone leaves them in map._targets. These two helpers own
// the add/remove half a live toggle needs.
import { walkLeaf } from "./walkLeaf.js";
import {
  layerElements,
  layerIcon,
  layerMap,
  reinitInteraction,
} from "#core/leafletAdapter.js";

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

export { setInteractive, suspendMapInteractions };
