// Focus-layer overlay painting: bounds computation with a leaf-fallback for
// third-party layers, the inverse mask that dims everything outside the
// focused bounds, and the accent marching-ants rectangle hugging the shadow
// edge. Both overlays ride the same SVG renderer so they share a pane.
import { FOCUS_Z, PANE_OWNER, walkLeaf } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { type RectCorners, roundedRectOutline } from "#common/marqueeShape.js";
import type { LayerUI } from "../surface.js";

/**
 * Compute a layer's geographic bounds. Third-party layers may be custom
 * L.Layer subclasses without a getBounds() method; fall back to summing the
 * bounds of the layer's leaf nodes so focus still works for them.
 */
const computeLayerBounds = (layer: L.Layer): L.LatLngBounds | null => {
  const withBounds = layer as L.Layer & { getBounds?: () => L.LatLngBounds };
  if (typeof withBounds.getBounds === "function") {
    const b = withBounds.getBounds();
    if (b?.isValid()) return b;
  }
  const acc = L.latLngBounds([]);
  let hasLeaf = false;
  walkLeaf(layer, leaf => {
    const lb = (leaf as L.Layer & { getBounds?: () => L.LatLngBounds }).getBounds?.();
    if (lb?.isValid()) {
      acc.extend(lb);
      hasLeaf = true;
    }
  });
  return hasLeaf ? acc : null;
};

/**
 * Draw an inverse mask that dims everything outside the focused bounds —
 * the same "inside highlighted / outside dimmed" spotlight as the export
 * crop box. The mask is a polygon of the visible view with the layer bounds
 * as a hole, rendered in a high-z pane above the layer panes but below the
 * focus rectangle, so the focused layer inside the hole stays bright.
 */
const drawFocusMask = (ui: LayerUI, bounds: L.LatLngBounds): void => {
  const map = ui.c.map;

  // Shared SVG renderer + pane for the mask and rectangle. The pane goes
  // through PaneManager.ensurePane (the one entry every owned pane uses) so
  // it carries the `foliplus-layer-pane` base class like every other pane;
  // the `.foliplus-focus-pane` exclusion tag keeps the spotlight pane visible
  // while the `.foliplus-is-focus-mode` rule hides every other layer pane.
  // The tag names pane identity ("not another layer's pane"), not focus state,
  // so it is permanent and never removed — the focused layer's own panes take
  // the same class transiently via bringFocusedLayerToFront /
  // focusedPaneRestores, and one selector covers both. Coupling it to the
  // renderer's lifecycle (add on focus, remove on dismiss) would open a window
  // where a stale `.foliplus-is-focus-mode` hides the mask.
  // The overlay pane isn't in childPaneSpecs, so ensurePane skips its
  // provisional-z branch; we pin FOCUS_Z.overlay here (idempotent).
  if (!ui.focusController.focusRenderer) {
    const { pane } = ui.c.panes.ensurePane(CONST.FOCUS_PANE, false, PANE_OWNER.FOCUS);
    if (!pane) return;
    pane.classList.add(CONST.CLASSES.FOCUS_PANE);
    pane.style.zIndex = String(FOCUS_Z.overlay);
    ui.focusController.focusRenderer = L.svg({ pane: CONST.FOCUS_PANE });
    ui.focusController.focusRenderer.addTo(map);
  }

  // Outer ring: the Web-Mercator world envelope. The mask is drawn once
  // before fitBounds/flyTo runs; using the pre-animation viewport (the old
  // `.pad(1)`) left bright strips around a zoom-out — the ring stopped at
  // the old boundary and the new viewport bled through. A world envelope
  // covers every viewport at every zoom, and the SVG renderer clips the
  // off-screen excess for free.
  const outer: L.LatLngExpression[] = [
    L.latLng(-85.05, -180),
    L.latLng(85.05, -180),
    L.latLng(85.05, 180),
    L.latLng(-85.05, 180),
  ];
  // Hole: the layer bounds (the focused layer lives inside it, so it stays
  // bright while everything else is dimmed by the mask).
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const hole: L.LatLngExpression[] = [
    sw,
    L.latLng(ne.lat, sw.lng),
    ne,
    L.latLng(sw.lat, ne.lng),
  ];

  ui.focusController.focusMask = L.polygon([outer, hole], {
    className: "foliplus-focus-mask",
    fillColor: "#000000",
    fillOpacity: CONST.FOCUS.MASK_OPACITY,
    stroke: false,
    interactive: false,
    renderer: ui.focusController.focusRenderer,
  });
  map.addLayer(ui.focusController.focusMask);
};

/** Rounded-corner rectangle outline (latlng). Shared fillet math — corners
 *  map to axis-generic {u=lng, v=lat} and back, so focus and the geometry
 *  bbox read one marquee language. */
const roundedRectPoints = (bounds: L.LatLngBounds, f = 0.03): L.LatLng[] => {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const corners: RectCorners = [
    { u: sw.lng, v: ne.lat },
    { u: ne.lng, v: ne.lat },
    { u: ne.lng, v: sw.lat },
    { u: sw.lng, v: sw.lat },
  ];
  return roundedRectOutline(corners, f).map(p => L.latLng(p.v, p.u));
};

/** Draw the focus rectangle as accent marching ants, rounded like the other
 *  marquees. Same bounds as the mask hole — the marquee hugs the shadow edge. */
const drawFocusRect = (ui: LayerUI, bounds: L.LatLngBounds): void => {
  const map = ui.c.map;

  ui.focusController.focusRect = L.polygon(roundedRectPoints(bounds), {
    className: "foliplus-focus-rect",
    fill: false,
    interactive: false,
    renderer: ui.focusController.focusRenderer ?? undefined,
  });
  map.addLayer(ui.focusController.focusRect);
};

export { computeLayerBounds, drawFocusMask, drawFocusRect };
