// SearchControl/logic/owned — the registry of map layers the control owns.
//
// The control creates map layers (the result pin and its ✕). Teardown that
// enumerates them by hand is only as complete as the author's memory — the shape
// that left the pin on the map because destroy() never listed it. Every creation
// site registers through `ownLayer`; teardown reclaims the registry, so a layer
// added later is released by construction rather than by remembering a line.

/** The layer slots the control paints into; each holds at most one layer. */
type OwnedSlot = "marker" | "delIcon";

/** Control state the owned-layer helpers read and write. */
interface OwnedLayers {
  /**
   * Registry created by initState(). Optional-typed so the helpers also work
   * on a partially built control (buildDOM() died before initState()) and on
   * logic-level fixtures — the same tolerance finalize() extends to teardown.
   */
  ownedLayers?: Set<L.Layer>;
  marker: L.Marker | null;
  delIcon: L.Marker | null;
}

/** The registry, created on first use for a partially built control. */
const registry = (ctrl: OwnedLayers): Set<L.Layer> => (ctrl.ownedLayers ??= new Set());

/**
 * Register `layer` in `slot`, removing the layer it replaces. Replacement is
 * part of the same call on purpose: a caller cannot create a second pin without
 * retiring the first, so the registry cannot accumulate dead layers.
 */
const ownLayer = <T extends L.Marker>(
  ctrl: OwnedLayers,
  slot: OwnedSlot,
  layer: T,
): T => {
  const previous = ctrl[slot];
  if (previous && previous !== layer) {
    registry(ctrl).delete(previous);
    map.removeLayer(previous);
  }
  ctrl[slot] = layer;
  registry(ctrl).add(layer);
  return layer;
};

/** Remove both marker layers from the map and clear their slots. */
const releaseMarkerLayers = (ctrl: OwnedLayers): void => {
  const owned = registry(ctrl);
  for (const slot of ["marker", "delIcon"] as const) {
    const layer = ctrl[slot];
    if (!layer) continue;
    owned.delete(layer);
    ctrl[slot] = null;
    map.removeLayer(layer);
  }
};

/** Reclaim every layer the control owns; safe on an empty registry. */
const releaseOwnedLayers = (ctrl: OwnedLayers): void => {
  const owned = registry(ctrl);
  for (const layer of owned) map.removeLayer(layer);
  owned.clear();
  ctrl.marker = null;
  ctrl.delIcon = null;
};

export { ownLayer, releaseMarkerLayers, releaseOwnedLayers };
export type { OwnedLayers, OwnedSlot };
