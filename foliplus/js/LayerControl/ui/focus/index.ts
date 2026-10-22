// LayerControl UI — Focus subsystem entry (lifecycle + row linkage).
// The overlay painting lives in `overlay.ts`, the pane bookkeeping in
// `pane.ts`, the disabled-state hints in `hint.ts`; this file re-exports
// all three so the existing external import surface (`./focus/index.js`)
// stays unchanged.
import { HINT_DURATION } from "#core/hint.js";
import { ensureModes, guardBlocked } from "#core/mode.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import { type ProjectionDelta, applyProjectionAll, emitDeltas } from "../apply.js";
import type { LayerUI } from "../surface.js";
import { closeOverlays } from "../teardown.js";
import { showFocusDisabledHint } from "./hint.js";
import { computeLayerBounds, drawFocusMask, drawFocusRect } from "./overlay.js";
import {
  bringFocusedLayerToFront,
  hideOtherLayers,
  restoreHiddenLayers,
} from "./pane.js";

/** Toggle visibility of the currently focused layer. */
const toggleFocusedLayer = (ui: LayerUI): void => {
  // Through the shell instance, not an import of `listPanel/keyboard.js`:
  // `keyboard.js` imports this file (`../focus/index.js`) for the
  // focus-disabled hints, so a value import back would re-close that cycle.
  const item = ui.activeLayerItem();
  if (!item) return;
  const checkbox = item.querySelector(
    'input[type="checkbox"]',
  ) as HTMLInputElement | null;
  if (!checkbox) return;
  checkbox.checked = !checkbox.checked;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
};

/**
 * Focus the map on a registered layer's bounding box.
 *
 * Best-effort approach:
 * 1. Compute bounds from the layer (fallback: walkLeaf for containers
 *    whose getBounds delegates to children).
 * 2. If the layer is not on the map, bring it on temporarily so the bounds
 *    and the visual highlight are consistent with the user's action.
 * 3. If the bounds area is below MIN_BOUNDS_AREA (single Marker, tiny
 *    polygon, etc.), `flyTo` the layer center instead of `fitBounds` —
 *    `fitBounds` on a degenerate box has no effect.
 * 4. Draw a dashed rectangle on the exact bounds so the user sees exactly
 *    what "this layer" covers.
 * 5. Highlight the focused layer row with the `foliplus-is-focusing`
 *    class so the list → map linkage is visible.
 * 6. Call `fitBounds` with `padding` and `maxZoom` capped to current +
 *    `FOCUS.MAX_ZOOM_STEP` to avoid satellite-zoom snaps on small features.
 * 7. Auto-cancel on any subsequent map `moveend`/`zoomend` so the rect
 *    doesn't linger while the user navigates elsewhere.
 */
const focusLayer = (ui: LayerUI, layerId: string) => {
  // Guard: any component holding the map (measuring, exporting, searching,
  // locating) blocks focus. One guard at the entry covers all call sites
  // (double-click, overflow menu, Alt+Enter, Enter) so none of them leak.
  if (guardBlocked(ui.c.map, ui.config.name, ui.T("blocked"))) return;

  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return;
  const layer = ui.c.findLayer(layerInfo);

  // Hidden layer: nothing to focus on — show a hint instead.
  const itemEl = ui.uiContainer.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
  ) as HTMLElement | null;
  const checkbox = itemEl?.querySelector(
    'input[type="checkbox"]',
  ) as HTMLInputElement | null;
  if (checkbox && !checkbox.checked) {
    showFocusDisabledHint(ui, "hidden");
    return;
  }

  // Bounds come from the Leaflet layer (with a walkLeaf fallback), or
  // from a canvas layer's getBounds provider (heatmap has no Leaflet layer).
  let bounds: L.LatLngBounds | null = null;
  // A layer the policy pulled off (a zoom sweep, an unchecked-by-policy row)
  // rejoins the map so the rectangle highlight is visible. That add is a real
  // membership change; its delta is collected here and announced with the rest
  // of the focus round, once the focus state is fully established.
  const rejoined: Array<{
    id: string;
    delta: ProjectionDelta;
    entry: LayerInfo;
  }> = [];
  let rejoinedLayer: L.Layer | null = null;
  if (layer) {
    // Ensure the layer is on the map so the rectangle highlight is visible.
    if (!ui.c.map.hasLayer(layer)) {
      ui.c.map.addLayer(layer);
      rejoinedLayer = layer;
      rejoined.push({
        id: layerInfo.id,
        delta: { wroteVisible: true, intentMoved: false },
        entry: layerInfo,
      });
    }
    bounds = computeLayerBounds(layer);
  } else if (typeof layerInfo.getBounds === "function") {
    bounds = layerInfo.getBounds();
  }
  // No bounds carrier — the surface said so up front via
  // `capabilities.bounds`. Keyboard / dblclick paths reach this guard
  // without going through `focusDisabledReason`, so the hint is the honest
  // feedback rather than a silent no-op. Whatever we re-added above goes back
  // the way we found it, so a rejected focus leaves no membership change (and
  // no announce) behind.
  if (!bounds?.isValid()) {
    if (rejoinedLayer) ui.c.map.removeLayer(rejoinedLayer);
    showFocusDisabledHint(ui, "no_bounds");
    return;
  }

  // Clear the competing overlays now that every guard above has passed — a
  // rejected focus (blocked map, unknown id, hidden row, no bounds) must not
  // clear what the user left open. It tears focus down silently, where
  // cancelFocus would flash "Focus cancelled" before every focus.
  closeOverlays(ui);

  // Hide every other visible layer so the focused one stands out — including
  // layers that overlap the focused bounds (the mask only dims outside).
  hideOtherLayers(ui);
  // Labels of the layers just hidden must leave the screen with them: the
  // canvas draws the spotlighted layer's labels only for the duration.
  ui.c.annotation.setFocusFilter(layerId);
  // Lift it above the hidden peers (so it can't be covered) and apply the
  // accent glow — one O(panes) pass, not a per-leaf-element loop.
  bringFocusedLayerToFront(ui, layerInfo);

  // Register LayerControl's own mode for the duration of the focus, BEFORE
  // the fitBounds/flyTo branching. Both paths draw a focus overlay and
  // register the same auto-cancel, so both must hold the mode — a missing
  // setMode on the flyTo path would let export/measure render through a
  // live focus overlay. Cleared on dismissFocus — called by the auto-timeout,
  // the manual cancel, and a subsequent focus (closeOverlays runs first).
  const modes = ensureModes(ui.c.map);
  modes.setMode(ui.config.name, "focusing");

  // Seed `focusingLayerId` before the projection sweep so `projectLayer` sees
  // the focus immediately — registerAutoCancel below would otherwise set it
  // only after the fitBounds/flyTo branches, which would let the sweep fall
  // through on a half-transparent target. The redundant write there is
  // idempotent. `applyProjectionAll` lands the focused layer's opacity=1
  // override (see projection.ts); zoom-range's `focusingLayerId != null`
  // policy is driven by the same flag, so this one sweep is a no-op for the
  // layers it already covers.
  ui.focusController.focusingLayerId = layerId;
  // Collect the settled round: the sweep lands the focused layer's opacity
  // override and the policy changes, but nothing announces yet — the notify
  // waits for the branch below to finish the focus visuals (rect/mask/highlight
  // + auto-cancel), so a subscriber that re-enters and cancels is not undone
  // by the frames the outer call has not drawn yet.
  const swept = applyProjectionAll(ui);
  const announceFocus = (): void => emitDeltas(ui, [...rejoined, ...swept]);

  // Single-point / tiny bounds → flyTo the center.
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  const area =
    Math.abs(northEast.lat - southWest.lat) * Math.abs(northEast.lng - southWest.lng);
  if (area < CONST.FOCUS.MIN_BOUNDS_AREA) {
    const center = bounds.getCenter();
    const maxZoom = Math.min(
      ui.c.map.getMaxZoom(),
      ui.c.map.getZoom() + CONST.FOCUS.MAX_ZOOM_STEP,
    );
    ui.c.map.flyTo(center, maxZoom, {
      duration: CONST.FOCUS.FIT_DURATION,
    });
    highlightFocusedRow(ui, itemEl, layerId);
    registerAutoCancel(ui, layerId);
    announceFocus();
    return;
  }

  drawFocusMask(ui, bounds);
  drawFocusRect(ui, bounds);
  highlightFocusedRow(ui, itemEl, layerId);

  ui.c.map.fitBounds(bounds, {
    animate: true,
    duration: CONST.FOCUS.FIT_DURATION,
    padding: CONST.FOCUS.PADDING,
    maxZoom: Math.min(
      ui.c.map.getMaxZoom(),
      ui.c.map.getZoom() + CONST.FOCUS.MAX_ZOOM_STEP,
    ),
  });

  // Auto-remove focus visuals after the configured duration.
  const ref = ui.focusController.focusRect;
  setTimeout(() => {
    if (ui.focusController.focusRect === ref) {
      dismissFocus(ui);
    }
  }, CONST.FOCUS.RECT_DURATION_MS);

  // One-shot map move/zoom handler that auto-cancels focus when the user
  // starts navigating elsewhere — prevents the rect from lingering.
  registerAutoCancel(ui, layerId);
  announceFocus();
};

/** Return true if a focus animation is currently active. */
const isFocusing = (ui: LayerUI): boolean => {
  return (
    ui.focusController.focusRect != null || ui.focusController.focusingLayerId != null
  );
};

/** Cancel an in-flight focus: remove rect + mask + row highlight. */
const cancelFocus = (ui: LayerUI): void => {
  dismissFocus(ui);
  ui.c.map.foliplus!.showHint(
    ui.config.name,
    ui.T("focus_cancelled"),
    HINT_DURATION.SHORT,
  );
};

/** Internal: tear down focus visuals + state (no hint). */
const dismissFocus = (ui: LayerUI): void => {
  // Release LayerControl's focus mode so other components' primary actions
  // (export, measure) are unblocked. `ensureModes` is idempotent per map but
  // has a first-call side effect — it installs the per-map `unload` cleanup
  // (`map.on('unload', manager.clear)`). A no-op teardown (unbindEvents →
  // dismissFocus on a never-focused control) must not trigger that install,
  // otherwise the first removeControl would leave a residual `unload` handler
  // on the map. Guard with `isFocusing` so setMode(null) is only invoked
  // when `focusLayer` actually registered the mode.
  if (isFocusing(ui)) {
    const modes = ensureModes(ui.c.map);
    modes.setMode(ui.config.name, null);
  }
  clearAutoCancel(ui);
  clearFocusedRowHighlight(ui);
  restoreHiddenLayers(ui);
  ui.c.annotation.setFocusFilter(null);
  for (const restore of ui.focusController.focusedPaneRestores) restore();
  ui.focusController.focusedPaneRestores = [];

  if (ui.focusController.focusRect) {
    ui.c.map.removeLayer(ui.focusController.focusRect);
    ui.focusController.focusRect = null;
  }

  if (ui.focusController.focusMask) {
    ui.c.map.removeLayer(ui.focusController.focusMask);
    ui.focusController.focusMask = null;
  }
  // Tear down the SVG renderer too. Reusing it across focuses left the
  // previous focus's mask/rect paths in the SVG even after removeLayer,
  // so focusing layer A then B showed two boxes (stale A mask + new B
  // mask) with inverted dimming. A fresh renderer per focus is cheap and
  // guarantees a clean slate.
  if (ui.focusController.focusRenderer) {
    ui.c.map.removeLayer(ui.focusController.focusRenderer);
    ui.focusController.focusRenderer = null;
  }

  ui.focusController.focusingLayerId = null;
  // Focus suspends inRange for its duration: with focus gone, the focused
  // layer's effective-shown falls back to intent && inRange. If its range
  // still excludes the current zoom, the executor removes it from the map —
  // the "unfocus returns it to hidden" half of the focus gate. Last step of
  // the teardown: the sweep, then one announcement per moved layer.
  emitDeltas(ui, applyProjectionAll(ui));
};

/** Register a one-shot moveend/zoomend handler that auto-cancels focus. */
const registerAutoCancel = (ui: LayerUI, layerId: string): void => {
  ui.focusController.focusingLayerId = layerId;
  const handler = () => {
    if (ui.focusController.focusingLayerId !== layerId) return;
    // Grace period: the fitBounds/flyTo animation fires moveend/zoomend on
    // completion, which should NOT auto-cancel. Any move/zoom *after* the
    // grace window is a deliberate user action → cancel.
    setTimeout(() => {
      if (ui.focusController.focusingLayerId === layerId) {
        dismissFocus(ui);
      }
    }, CONST.FOCUS.RECT_DURATION_MS * 0.3);
  };
  ui.focusController.onFocusMapMove = () => handler();
  ui.c.map.on("moveend", ui.focusController.onFocusMapMove);
  ui.c.map.on("zoomend", ui.focusController.onFocusMapMove);
};

/** Remove the map move/zoom auto-cancel handlers. */
const clearAutoCancel = (ui: LayerUI): void => {
  if (ui.focusController.onFocusMapMove) {
    ui.c.map.off("moveend", ui.focusController.onFocusMapMove);
    ui.c.map.off("zoomend", ui.focusController.onFocusMapMove);
    ui.focusController.onFocusMapMove = null;
  }
};

/** Highlight the layer row that is being focused (list → map linkage). */
const highlightFocusedRow = (
  ui: LayerUI,
  itemEl: HTMLElement | null,
  layerId: string,
): void => {
  clearFocusedRowHighlight(ui);
  if (!itemEl) return;
  itemEl.classList.add(CONST.CLASSES.FOCUSING);
  ui.focusController.focusingLayerId = layerId;
};

/** Remove the `foliplus-is-focusing` class from the active row. */
const clearFocusedRowHighlight = (ui: LayerUI): void => {
  const prev = ui.uiContainer.querySelector(`.${CONST.CLASSES.FOCUSING}`);
  prev?.classList.remove(CONST.CLASSES.FOCUSING);
};

export {
  cancelFocus,
  dismissFocus,
  focusLayer,
  highlightFocusedRow,
  isFocusing,
  registerAutoCancel,
  toggleFocusedLayer,
};
export {
  focusDisabledLocaleKey,
  focusDisabledReason,
  showFocusDisabledHint,
} from "./hint.js";
export { bringFocusedLayerToFront } from "./pane.js";
export { computeLayerBounds, drawFocusMask, drawFocusRect } from "./overlay.js";
export { FocusController } from "./focusController.js";
export { bindGeometryFocusMarquee } from "./focusMarquee.js";
