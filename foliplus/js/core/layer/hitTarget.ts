// core/layer/hitTarget — who owns a layer's Leaflet hit-target registration.
//
// Leaflet registers a hit target once, at add time (`_addPath` for SVG paths,
// `_initInteraction` for markers, `onAdd` for overlays), and only the canvas
// renderer reads `options.interactive` live. setInteractive owns both halves of
// a live toggle: the option, and the add/remove of the target plus the
// `leaflet-interactive` cursor class. Flipping the option alone leaves a layer
// clickable after the UI says it is not.
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

export { setInteractive };
