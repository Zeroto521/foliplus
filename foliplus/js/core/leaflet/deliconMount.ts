// Mounting a delete icon — create it, add it to a map or layer tree, and bind
// its click handler. Kept outside delicon.ts: the MeasureControl ui tests mock
// that module and spy `makeDelIcon` / `attachDelClick` to enumerate the ✕ they
// create. A same-module caller resolves those through its local bindings, so
// the spies would see nothing — the composition must cross the module boundary.
import { attachDelClick, bindDelIconToPopup, makeDelIcon } from "./delicon.js";

/**
 * Create, mount, and click-bind a delete icon in one call — the shared
 * "pin ✕" step behind LocateControl, SearchControl and MeasureControl.
 *
 * `mount` is the one thing that differs between callers: Locate/Search mount on
 * the bare map, Measure mounts through the layers API into the node pane.
 * Callers keep the returned marker handle for teardown and drag.
 *
 * `popupMarker` is optional. When given, the ✕ shows while that marker's popup
 * is open and hides when it closes. MeasureControl passes nothing — its ✕ is
 * toggled by the edit overlay, not by the popup lifecycle.
 */
const mountDelIcon = (
  latlng: L.LatLngExpression,
  opts: { title?: string; iconAnchor?: [number, number] },
  mount: (delIcon: L.Marker) => void,
  /** When omitted the icon is created and mounted without a click handler —
   *  callers that wire delete later (MeasureControl circle) stay strictly
   *  equivalent to a bare makeDelIcon + addLayer. */
  onDelete?: () => void,
  popupMarker?: L.Marker | null,
): L.Marker => {
  const delIcon = makeDelIcon(latlng, opts);
  mount(delIcon);
  if (onDelete) attachDelClick(delIcon, onDelete);
  if (popupMarker) bindDelIconToPopup(popupMarker, delIcon);
  return delIcon;
};

export { mountDelIcon };
