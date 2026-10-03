// LayerControl UI —Mutual-exclusion overlay teardown.
import { EVENTS } from "#core/event/index.js";
import type { LayerUI } from "./index.js";

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
 *
 * Folium's own overlays are event-driven: each subsystem subscribes to
 * OVERLAY_CLEAR in `bindEvents` and closes itself when it hears the signal.
 * The map-popup sweep stays here because Leaflet popups are not a foliplus
 * overlay and have no subscribe-able surface of their own.
 */
const closeOverlays = (ui: LayerUI): void => {
  // The map's own popup, cleared with the foliplus surfaces: it is Leaflet's,
  // so no panel opener ever saw it. No-op when nothing is open.
  ui.m.map.closePopup();
  // A folium GeoJsonPopup binds onto each sublayer (parent.bindPopup in the
  // GeoJson template), not onto map._popup — closePopup above only reaches
  // map-level popups. Sweep the layers so feature-bound popups close too.
  ui.m.map.eachLayer(layer => layer.closePopup?.());
  // Sublayer-bound popups outlive both map-level calls (the factory-bound
  // popup is not the one closePopup tracks, and eachLayer stops at top-level
  // layers). A recursive closePopup over the layer tree was tried and failed
  // in the browser test — the sublayer popup factory is unreachable through
  // Layer.closePopup. DOM sweep is the only measured-effective fallback.
  document.querySelectorAll(".leaflet-popup").forEach(el => el.remove());
  // Folium's overlay subsystems (menu, attrs, style, rename, focus) each
  // subscribe to this event in bindEvents and close themselves. The caller
  // of closeOverlays is about to open one of them — the matching subscriber
  // sees "I'm not open yet" and is a no-op.
  ui.events.emit(EVENTS.OVERLAY_CLEAR, { reason: "open" });
};

export { closeOverlays };
