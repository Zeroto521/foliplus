// MeasureControl ui/ shared helper — z-order re-sorting, node/label lookup, edit-overlay click routing, and segment-label collision registration.
import * as CONST from "../const.js";
import type { MeasureManager } from "../manager.js";
import * as Util from "../util.js";

/**
 * Re-order layers so they render in the correct z-order.
 * Removes and re-adds each collection in sequence.
 */
const resortLayers = (layers: CreateLayersAPI, ...collections: L.Layer[][]): void => {
  collections.forEach(c => c.forEach(l => layers.removeLayer(l)));
  collections.forEach(c => c.forEach(l => layers.addLayer(l)));
};

/**
 * Bind a click handler that opens the edit overlay, unless the click landed on
 * the layer's own ✕ handle (attachDelClick handles deletion there, so opening
 * the overlay would fight it).
 */
const bindOpenOverlay = (
  layer: L.Layer,
  openOverlay: (event: L.LeafletMouseEvent) => void,
): void => {
  layer.on("click", (event: L.LeafletMouseEvent) => {
    const t = Util.getEventTarget(event);
    if (t?.closest?.(CONST.SEL.DEL_ICON)) return;
    openOverlay(event);
  });
};

/** Handle returned by bindNodeDrag — enable/disable + unbind a node drag. */
interface DragBind {
  setEnabled: (enabled: boolean) => void;
  cleanup: () => void;
}

/** Index of `target` in `points` (exact lat/lng match, with float tolerance).
 *  Nodes are created at point coordinates and moved in lockstep with them, so
 *  a tight tolerance is safe and avoids matching a nearby-but-different node. */
const findPointIndex = (points: L.LatLng[], target: L.LatLng): number => {
  return points.findIndex(
    (p: L.LatLng) =>
      Math.abs(p.lat - target.lat) < 1e-9 && Math.abs(p.lng - target.lng) < 1e-9,
  );
};

/**
 * Track a mutable set of segment labels in the collision planner. `refresh()`
 * re-issues the registrations so they cover exactly the current set — a deleted
 * inner node splices the segLabels array, and a registration left over from a
 * removed marker would point at a dead chip. Returns the unregister function
 * the caller's dispose runs.
 *
 * `priority` may vary per index: distance mode's final label also carries the
 * cumulative total, which must out-rank a plain segment in a collision.
 *
 * Shared by distance and polygon: both recreate their segment labels on every
 * relabel (drag, node delete), which is what makes re-registration necessary.
 */
const bindSegmentLabels = (
  mgr: MeasureManager,
  segLabels: L.Marker[],
  priority: (index: number) => number = () => CONST.LABEL_PRIORITY.SEGMENT,
): (() => void) => {
  let unregisters: Array<() => void> = [];
  const refresh = () => {
    unregisters.forEach(f => f());
    unregisters = segLabels.map((label, i) => mgr.registerLabel(label, priority(i)));
  };
  refresh();
  return () => {
    unregisters.forEach(f => f());
    unregisters = [];
  };
};

export { bindOpenOverlay, bindSegmentLabels, findPointIndex, resortLayers };
export type { DragBind };
