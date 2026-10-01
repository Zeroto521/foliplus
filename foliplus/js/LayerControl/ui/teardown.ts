// LayerControl UI —Mutual-exclusion overlay teardown.
import { closeAttrsPanel } from "./attr.js";
import { dismissFocus } from "./focus.js";
import type { LayerUI } from "./index.js";
import { closeMoreMenu } from "./menu.js";
import { finishRename } from "./rename.js";
import { closeStylePanel } from "./style/index.js";

/**
 * Tear down every surface that competes for the same spot: the map's own
 * popup, the overflow menu, the two floating panels, the inline rename input,
 * and the map-wide focus spotlight. Focus counts as an overlay — it is a
 * full-screen map state, so opening a panel must release it, and focusing a
 * layer must drop the panels.
 *
 * The popup is Leaflet's, not foliplus's, and it has two shapes: `map._popup`
 * (a map-level popup, closed by `map.closePopup()`) and layer-bound popups —
 * folium's GeoJsonPopup binds onto each sublayer via `parent.bindPopup`, so
 * `closePopup()` alone misses them. A feature-bound popup sat on top of the
 * focus spotlight because no panel opener ever saw it; clearing both shapes
 * here lifts the contract from "foliplus surfaces are mutually exclusive" to
 * "one map overlay at a time".
 *
 * Called by every entry that opens one of these surfaces, after its own guards
 * have passed — a rejected call must not clear what the user left open — so the
 * "close whatever else is open" list lives here rather than as a per-caller
 * hand-written list (which is how focus-layer slipped out of the set: it was
 * a map state, not a floating panel, so no openAttrsPanel saw it).
 *
 * The close flags stay per-caller and are not normalised: the menu returns
 * focus to the row (a cursor parked on <body> makes Escape unreachable), the
 * panels do not, and a rename commits rather than cancels.
 *
 * Focus is torn down silently — this is a state change triggered by opening
 * something else, not a user action, so no hint. `cancelFocus` keeps its
 * "focus cancelled" hint for the Escape path only.
 */
const closeOverlays = (ui: LayerUI): void => {
  // The map's own popup, cleared with the foliplus surfaces: it is Leaflet's,
  // so no panel opener ever saw it. No-op when nothing is open.
  ui.m.map.closePopup();
  // folium GeoJsonPopup binds onto each sublayer via a parent.bindPopup
  // factory, so map.closePopup() (which tracks map._popup) misses them.
  // Walk the layer tree: close each top-level layer's popup, then each
  // sublayer's, so Leaflet closes the popups and clears its internal state.
  ui.m.map.eachLayer(top => {
    top.closePopup?.();
    const group = top as unknown as L.LayerGroup;
    if (typeof group.eachLayer === "function") {
      group.eachLayer(sl => sl.closePopup?.());
    }
  });
  finishRename(ui);
  closeMoreMenu(ui, true);
  closeAttrsPanel(ui, false);
  closeStylePanel(ui, false);
  // Only when a focus is actually live: dismissFocus ends in applyProjectionAll,
  // an O(layers) sweep that belongs to the paths that had a focus to tear down,
  // not to every open. Guarded here rather than inside dismissFocus so the
  // Escape and unbindEvents callers keep clearing unconditionally.
  if (ui.isFocusing()) dismissFocus(ui);
};

export { closeOverlays };
