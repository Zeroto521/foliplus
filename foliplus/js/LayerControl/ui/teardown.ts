// LayerControl UI — Mutual-exclusion overlay teardown.
import { EVENTS } from "#core/event/index.js";
import type { LayerUI } from "./surface.js";

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
 * The close flags stay per-caller and are not normalized: the menu returns
 * focus to the row (a cursor parked on <body> makes Escape unreachable), the
 * panels do not, and a rename commits rather than cancels.
 *
 * Focus is torn down silently — this is a state change triggered by opening
 * something else, not a user action, so no hint. `cancelFocus` keeps its
 * "focus cancelled" hint for the Escape path only.
 *
 * Folium's own overlays are event-driven: each subsystem subscribes to
 * OVERLAY_CLEAR in `bindLayerEvents` and closes itself when it hears the signal.
 * The Leaflet-native sweep (popups + hover tooltips) stays here because
 * Leaflet's own overlays are not foliplus overlays and have no subscribe-able
 * surface of their own. Tooltips get the same treatment as popups: hover-out
 * would hide one, but focus's visibility rule is scoped to the focus class,
 * so a tooltip that survives the sweep would come back to life on hover-out.
 */
const closeOverlays = (ui: LayerUI): void => {
  // The map's own popup, cleared with the foliplus surfaces: it is Leaflet's,
  // so no panel opener ever saw it. No-op when nothing is open.
  ui.c.map.closePopup();
  // A folium GeoJsonPopup binds onto each sublayer (parent.bindPopup in the
  // GeoJson template), not onto map._popup — closePopup above only reaches
  // map-level popups. Sweep the layers so feature-bound popups close too.
  ui.c.map.eachLayer(layer => layer.closePopup?.());
  // Sublayer-bound popups outlive both map-level calls (the factory-bound
  // popup is not the one closePopup tracks, and eachLayer stops at top-level
  // layers). A recursive closePopup over the layer tree was tried and failed
  // in the browser test — the sublayer popup factory is unreachable through
  // Layer.closePopup. DOM sweep is the only measured-effective fallback.
  // Hover tooltips get the same treatment: a residual tooltip at focus time
  // would reappear on hover-out because visibility:hidden only applies while
  // the focus class is on, so clear them before focus activates.
  document.querySelectorAll(".leaflet-popup").forEach(el => el.remove());
  document.querySelectorAll(".leaflet-tooltip").forEach(el => el.remove());
  // Folium's overlay subsystems (menu, attrs, style, rename, focus) each
  // subscribe to this event in bindLayerEvents and close themselves. The caller
  // of closeOverlays is about to open one of them — the matching subscriber
  // sees "I'm not open yet" and is a no-op.
  // Settled: every overlay owner gets the close signal, then the first
  // consumer failure surfaces — one broken panel must not leave another open.
  const failure = ui.events.emitSettled(EVENTS.OVERLAY_CLEAR);
  if (failure) throw failure.error;
};

export { closeOverlays };
