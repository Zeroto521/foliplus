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
 * The popup is Leaflet's, not foliplus's. A feature-bound popup (folium's
 * GeoJsonPopup) is invisible to every panel opener, so it outlived a focus and
 * sat on top of the spotlight. Closing it here lifts the clearing from
 * "foliplus surfaces are mutually exclusive" to "one map overlay at a time".
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
  finishRename(ui);
  closeMoreMenu(ui, true);
  closeAttrsPanel(ui, false);
  closeStylePanel(ui, false);
  dismissFocus(ui);
};

export { closeOverlays };
