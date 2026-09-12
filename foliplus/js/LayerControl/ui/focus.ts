// LayerControl UI 鈥?Focus-layer overlay (mask / rect / fly-to).
import { HINT_DURATION } from "#core/hint.js";
import { forEachLeaf } from "#core/layer/index.js";
import { ensureModes, guardBlocked } from "#core/mode.js";
import * as CONST from "../const.js";
import type { LayerUI } from "./index.js";
import { T } from "./context.js";

/** Basemaps / color pickers cannot be focused 鈥?hint instead of silence. */
const showBaseFocusHint = (ui: LayerUI): void => {
  ui.m.map.foliplus!.showHint(CONF.name, T("focus_layer_base"), HINT_DURATION.SHORT);
};

/** Every registered layer is linked to a Leaflet layer (findLayer resolvable).
 *  False during the first post-attach pass, when folium layers may not be in
 *  the registry yet. */
/** Focus-layer is disabled for basemaps (no useful extent) and hidden rows
 *  (nothing to show). The 鈰?menu item carries the not-allowed cursor. */
const isFocusLayerDisabled = (ui: LayerUI, item: HTMLElement): boolean => {
  if (item.classList.contains(CONST.CLASSES.COLOR_ITEM)) return true;
  if (item.dataset.layerType === CONST.GROUP.BASE) return true;
  const box = item.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  return box !== null && !box.checked;
};

/** Toggle visibility of the currently focused layer. */
const toggleFocusedLayer = (ui: LayerUI): void => {
  const item = ui.getActiveLayerItem();
  if (!item) return;
  const checkbox = item.querySelector(
    'input[type="checkbox"]',
  ) as HTMLInputElement | null;
  if (!checkbox) return;
  checkbox.checked = !checkbox.checked;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
};

/** Fold or unfold one group. Shared by the pointer (row click) and the
 *  keyboard (Enter / Space over the chevron) so both paths stay in sync. */
/**
 * Focus the map on a registered layer's bounding box.
 *
 * Best-effort approach:
 * 1. Compute bounds from the layer (fallback: forEachLeaf for containers
 *    whose getBounds delegates to children).
 * 2. If the layer is not on the map, bring it on temporarily so the bounds
 *    and the visual highlight are consistent with the user's action.
 * 3. If the bounds area is below MIN_BOUNDS_AREA (single Marker, tiny
 *    polygon, etc.), `flyTo` the layer center instead of `fitBounds` 鈥? *    `fitBounds` on a degenerate box has no effect.
 * 4. Draw a dashed rectangle on the exact bounds so the user sees exactly
 *    what "this layer" covers.
 * 5. Highlight the focused layer row with the `foliplus-layer-focusing`
 *    class so the list 鈫?map linkage is visible.
 * 6. Call `fitBounds` with `padding` and `maxZoom` capped to current +
 *    `FOCUS.MAX_ZOOM_STEP` to avoid satellite-zoom snaps on small features.
 * 7. Auto-cancel on any subsequent map `moveend`/`zoomend` so the rect
 *    doesn't linger while the user navigates elsewhere.
 */
const focusLayer = (ui: LayerUI, layerId: string) => {
  // Guard: any component holding the map (measuring, exporting, searching,
  // locating) blocks focus. One guard at the entry covers all call sites
  // (double-click, 鈰?menu, Alt+Enter, Enter) so none of them leak.
  if (guardBlocked(ui.m.map, CONF.name, T("blocked"))) return;

  const layerInfo = ui.m.layerRegistry.get(layerId);
  if (!layerInfo) return;
  const layer = ui.m.findLayer(layerInfo);

  // Hidden layer: nothing to focus on 鈥?show a hint instead.
  const itemEl = ui.uiContainer.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
  ) as HTMLElement | null;
  const checkbox = itemEl?.querySelector(
    'input[type="checkbox"]',
  ) as HTMLInputElement | null;
  if (checkbox && !checkbox.checked) {
    ui.m.map.foliplus!.showHint(
      CONF.name,
      T("focus_layer_hidden"),
      HINT_DURATION.SHORT,
    );
    return;
  }

  // Bounds come from the Leaflet layer (with a forEachLeaf fallback), or
  // from a canvas layer's getBounds provider (heatmap has no Leaflet layer).
  let bounds: L.LatLngBounds | null = null;
  if (layer) {
    // Ensure the layer is on the map so the rectangle highlight is visible.
    if (!ui.m.map.hasLayer(layer)) ui.m.map.addLayer(layer);
    bounds = computeLayerBounds(ui, layer);
  } else if (typeof layerInfo.getBounds === "function") {
    bounds = layerInfo.getBounds();
  }
  if (!bounds || !bounds.isValid()) return;

  // Cancel any in-flight focus first.
  dismissFocus(ui);

  // Hide every other visible layer so the focused one stands out 鈥?including
  // layers that overlap the focused bounds (the mask only dims outside).
  hideOtherLayers(ui);
  // Lift it above the hidden peers (so it can't be covered) and apply the
  // accent glow 鈥?one O(panes) pass, not a per-leaf-element loop.
  bringFocusedLayerToFront(ui, layer, layerInfo.canvas ?? null);

  // Register LayerControl's own mode for the duration of the focus, BEFORE
  // the fitBounds/flyTo branching. Both paths draw a focus overlay and
  // register the same auto-cancel, so both must hold the mode 鈥?a missing
  // setMode on the flyTo path would let export/measure render through a
  // live focus overlay. Cleared on dismissFocus 鈥?called by the auto-timeout,
  // the manual cancel, and a subsequent focus (dismissFocus runs at the top
  // of focusLayer).
  ensureModes(ui.m.map).setMode(CONF.name, "focusing");

  // Single-point / tiny bounds 鈫?flyTo the center.
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  const area =
    Math.abs(northEast.lat - southWest.lat) * Math.abs(northEast.lng - southWest.lng);
  if (area < CONST.FOCUS.MIN_BOUNDS_AREA) {
    const center = bounds.getCenter();
    const maxZoom = Math.min(
      ui.m.map.getMaxZoom(),
      ui.m.map.getZoom() + CONST.FOCUS.MAX_ZOOM_STEP,
    );
    ui.m.map.flyTo(center, maxZoom, {
      duration: CONST.FOCUS.FIT_DURATION,
    });
    highlightFocusedRow(ui, itemEl, layerId);
    registerAutoCancel(ui, layerId);
    return;
  }

  drawFocusMask(ui, bounds);
  drawFocusRect(ui, bounds);
  highlightFocusedRow(ui, itemEl, layerId);

  ui.m.map.fitBounds(bounds, {
    animate: true,
    duration: CONST.FOCUS.FIT_DURATION,
    padding: CONST.FOCUS.PADDING,
    maxZoom: Math.min(
      ui.m.map.getMaxZoom(),
      ui.m.map.getZoom() + CONST.FOCUS.MAX_ZOOM_STEP,
    ),
  });

  // Auto-remove focus visuals after the configured duration.
  const ref = ui.focusRect;
  setTimeout(() => {
    if (ui.focusRect === ref) {
      dismissFocus(ui);
    }
  }, CONST.FOCUS.RECT_DURATION_MS);

  // One-shot map move/zoom handler that auto-cancels focus when the user
  // starts navigating elsewhere 鈥?prevents the rect from lingering.
  registerAutoCancel(ui, layerId);
};

/** Return true if a focus animation is currently active. */
const isFocusing = (ui: LayerUI): boolean => {
  return ui.focusRect != null || ui.focusingLayerId != null;
};

/** Cancel an in-flight focus: remove rect + mask + row highlight. */
const cancelFocus = (ui: LayerUI): void => {
  dismissFocus(ui);
  ui.m.map.foliplus!.showHint(CONF.name, T("focus_cancelled"), HINT_DURATION.SHORT);
};

/** Internal: tear down focus visuals + state (no hint). */
const dismissFocus = (ui: LayerUI): void => {
  // Release LayerControl's focus mode so other components' primary actions
  // (export, measure) are unblocked. Idempotent: safe to call even when
  // no focus was active; setMode(null) writes a null entry that the
  // interaction lock treats as inactive, emitting a MODE_CHANGE to recompute.
  ensureModes(ui.m.map).setMode(CONF.name, null);
  clearAutoCancel(ui);
  clearFocusedRowHighlight(ui);
  restoreHiddenLayers(ui);
  for (const restore of ui.focusedPaneRestores) restore();
  ui.focusedPaneRestores = [];

  if (ui.focusRect) {
    ui.m.map.removeLayer(ui.focusRect);
    ui.focusRect = null;
  }

  if (ui.focusMask) {
    ui.m.map.removeLayer(ui.focusMask);
    ui.focusMask = null;
  }
  // Tear down the SVG renderer too. Reusing it across focuses left the
  // previous focus's mask/rect paths in the SVG even after removeLayer,
  // so focusing layer A then B showed two boxes (stale A mask + new B
  // mask) with inverted dimming. A fresh renderer per focus is cheap and
  // guarantees a clean slate.
  if (ui.focusRenderer) {
    ui.m.map.removeLayer(ui.focusRenderer);
    ui.focusRenderer = null;
  }

  ui.focusingLayerId = null;
};

/**
 * Hide every other visible layer so the focused layer stands out.
 * Works alongside the inverse mask (which dims the basemap + everything
 * outside the bounds). The basemap (tilePane) has no `foliplus-layer-pane`
 * class, so it is naturally excluded and keeps the spatial context.
 *
 * Declarative: one class write on the map container. CSS
 * `.foliplus-focus-active .foliplus-layer-pane:not(.foliplus-focus-pane)`
 * hides every layer pane except the focused one 鈥?instead of a JS
 * visibility loop over N panes. `bringFocusedLayerToFront` marks the
 * focused pane(s)/canvas with `foliplus-focus-pane` so they stay visible.
 */
const hideOtherLayers = (ui: LayerUI): void => {
  ui.m.map.getContainer().classList.add(CONST.CLASSES.FOCUS_ACTIVE);
};

/**
 * Temporarily lift the focused layer's pane above every other layer so the
 * hidden layers stacked above it cannot cover it 鈥?a layer at the bottom
 * of the z-order stays hidden even with the boost glow. Canvas layers
 * (heatmap) have no pane; their canvas element's z-index is lifted instead.
 *
 * This is the single O(panes) pass that also applies the focused-layer glow
 * (`.foliplus-focus-glow`): by tagging the focused pane (not each leaf
 * element) the accent drop-shadow is applied once per pane, so focusing a
 * dense layer (e.g. thousands of CircleMarkers) stays cheap. Restored on
 * cancel via focusedPaneRestores.
 */
const bringFocusedLayerToFront = ( ui: LayerUI, layer: L.Layer | null, canvas: HTMLCanvasElement | null, ): void => {
  const restores: Array<() => void> = [];
  const lift = (el: HTMLElement): void => {
    const orig = el.style.zIndex;
    el.style.zIndex = String(CONST.FOCUS.PANE_Z - CONST.FOCUS.FOCUSED_Z_GAP);
    // Mark the focused pane/canvas so the `.foliplus-focus-active` CSS rule
    // (`:not(.foliplus-focus-pane)`) keeps it visible while hiding the rest.
    el.classList.add(CONST.CLASSES.FOCUS_PANE);
    // Glow: applied at pane level (one element), fading in via CSS animation.
    el.classList.add(CONST.CLASSES.FOCUS_GLOW);
    restores.push(() => {
      el.style.zIndex = orig;
      el.classList.remove(CONST.CLASSES.FOCUS_PANE);
      el.classList.remove(CONST.CLASSES.FOCUS_GLOW);
    });
  };

  if (canvas) {
    lift(canvas);
  } else if (layer) {
    // Best-effort: some third-party layers expose children without a pane
    // (getLayerPanes walks options.pane), so skip the lift if discovery
    // throws 鈥?the hide + glow still work without it.
    let panes: string[] = [];
    try {
      panes = ui.m.getLayerPanes(layer);
    } catch {
      panes = [];
    }
    for (const name of panes) {
      // Skip only the shared core panes (overlay/marker/tile/...). Per-layer
      // fallback panes are unique and safe to lift 鈥?and hideOtherLayers
      // already hides them, so the two must stay symmetric.
      if (ui.m.panes.defaultPanes.has(name)) continue;
      const pane = ui.m.map.getPane(name);
      if (pane) lift(pane);
    }
  }
  ui.focusedPaneRestores = restores;
};

/** Remove the container class that hides every non-focused layer. */
const restoreHiddenLayers = (ui: LayerUI): void => {
  ui.m.map.getContainer().classList.remove(CONST.CLASSES.FOCUS_ACTIVE);
};

/**
 * Compute a layer's geographic bounds. Third-party layers may be custom
 * L.Layer subclasses without a getBounds() method; fall back to summing the
 * bounds of the layer's leaf nodes so focus still works for them.
 */
const computeLayerBounds = (ui: LayerUI, layer: L.Layer): L.LatLngBounds | null => {
  const withBounds = layer as L.Layer & { getBounds?: () => L.LatLngBounds };
  if (typeof withBounds.getBounds === "function") {
    const b = withBounds.getBounds();
    if (b && b.isValid()) return b;
  }
  const acc = L.latLngBounds([]);
  let hasLeaf = false;
  forEachLeaf(layer, leaf => {
    const lb = (leaf as L.Layer & { getBounds?: () => L.LatLngBounds }).getBounds?.();
    if (lb && lb.isValid()) {
      acc.extend(lb);
      hasLeaf = true;
    }
  });
  return hasLeaf ? acc : null;
};

/**
 * Draw an inverse mask that dims everything outside the focused bounds 鈥? * the same "inside highlighted / outside dimmed" spotlight as the export
 * crop box. The mask is a polygon of the visible view with the layer bounds
 * as a hole, rendered in a high-z pane above the layer panes but below the
 * focus rectangle, so the focused layer inside the hole stays bright.
 */
const drawFocusMask = (ui: LayerUI, bounds: L.LatLngBounds): void => {
  const map = ui.m.map;

  // Shared SVG renderer + pane for the mask and rectangle.
  if (!ui.focusRenderer) {
    let pane = map.getPane(CONST.FOCUS_PANE);
    if (!pane) {
      pane = map.createPane(CONST.FOCUS_PANE);
      pane.style.zIndex = String(CONST.FOCUS.PANE_Z);
    }
    ui.focusRenderer = L.svg({ pane: CONST.FOCUS_PANE });
    ui.focusRenderer.addTo(map);
  }

  // Outer ring: the visible view bounds, padded so the dim covers the
  // viewport (a little pan during the fitBounds animation stays covered).
  const view = map.getBounds().pad(1);
  const outer: L.LatLngExpression[] = [
    view.getSouthWest(),
    view.getNorthWest(),
    view.getNorthEast(),
    view.getSouthEast(),
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

  ui.focusMask = L.polygon([outer, hole], {
    className: "foliplus-focus-mask",
    fillColor: "#000000",
    fillOpacity: CONST.FOCUS.MASK_OPACITY,
    stroke: false,
    interactive: false,
    renderer: ui.focusRenderer,
  });
  map.addLayer(ui.focusMask);
};

/** Draw the dashed focus rectangle (border only, no fill). */
const drawFocusRect = (ui: LayerUI, bounds: L.LatLngBounds): void => {
  const map = ui.m.map;

  ui.focusRect = L.rectangle(bounds, {
    className: "foliplus-focus-rect",
    fill: false,
    interactive: false,
    renderer: ui.focusRenderer ?? undefined,
  });
  map.addLayer(ui.focusRect);
};

/** Register a one-shot moveend/zoomend handler that auto-cancels focus. */
const registerAutoCancel = (ui: LayerUI, layerId: string): void => {
  ui.focusingLayerId = layerId;
  const handler = () => {
    if (ui.focusingLayerId !== layerId) return;
    // Grace period: the fitBounds/flyTo animation fires moveend/zoomend on
    // completion, which should NOT auto-cancel. Any move/zoom *after* the
    // grace window is a deliberate user action 鈫?cancel.
    setTimeout(() => {
      if (ui.focusingLayerId === layerId) {
        dismissFocus(ui);
      }
    }, CONST.FOCUS.RECT_DURATION_MS * 0.3);
  };
  ui.onFocusMapMove = () => handler();
  ui.m.map.on("moveend", ui.onFocusMapMove);
  ui.m.map.on("zoomend", ui.onFocusMapMove);
};

/** Remove the map move/zoom auto-cancel handlers. */
const clearAutoCancel = (ui: LayerUI): void => {
  if (ui.onFocusMapMove) {
    ui.m.map.off("moveend", ui.onFocusMapMove);
    ui.m.map.off("zoomend", ui.onFocusMapMove);
    ui.onFocusMapMove = null;
  }
};

/** Highlight the layer row that is being focused (list 鈫?map linkage). */
const highlightFocusedRow = ( ui: LayerUI, itemEl: HTMLElement | null, layerId: string, ): void => {
  clearFocusedRowHighlight(ui);
  if (!itemEl) return;
  itemEl.classList.add(CONST.CLASSES.FOCUSING);
  ui.focusingLayerId = layerId;
};

/** Remove the `foliplus-layer-focusing` class from the active row. */
const clearFocusedRowHighlight = (ui: LayerUI): void => {
  const prev = ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSING}`);
  prev?.classList.remove(CONST.CLASSES.FOCUSING);
};

export {
  showBaseFocusHint,
  isFocusLayerDisabled,
  toggleFocusedLayer,
  focusLayer,
  isFocusing,
  cancelFocus,
  dismissFocus,
  hideOtherLayers,
  bringFocusedLayerToFront,
  restoreHiddenLayers,
  computeLayerBounds,
  drawFocusMask,
  drawFocusRect,
  registerAutoCancel,
  clearAutoCancel,
  highlightFocusedRow,
  clearFocusedRowHighlight,
};
