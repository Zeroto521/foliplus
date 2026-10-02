// LayerControl UI —Focus-layer overlay (mask / rect / fly-to).
import { HINT_DURATION } from "#core/hint.js";
import {
  FOCUS_Z,
  GROUP,
  type LayerInfo,
  PANE_ROLE,
  focusLayerZ,
  forEachLeaf,
  zFor,
} from "#core/layer/index.js";
import { ensureModes, guardBlocked } from "#core/mode.js";
import { createScopedTranslator } from "#common/locale.js";
import type { RectCorners } from "#common/marqueeShape.js";
import { roundedRectOutline } from "#common/marqueeShape.js";
import * as CONST from "../const.js";
import type { LayerAccess } from "./access.js";
import { applyProjectionAll } from "./apply.js";
import type { FocusStore } from "./focusStore.js";
import { getActiveLayerItem } from "./keyboard.js";
import type { PanelStore } from "./panelStore.js";

const T = createScopedTranslator(CONF);

/** Why a row's focus action is off. Carried as the menu item's title and as
 *  the hint text when a keyboard/double-click path tries to focus a row the
 *  surface cannot focus. `undefined` means focus is available. */
type FocusDisabledReason = "hidden" | "base" | "no_bounds" | undefined;

/** A reason focus is off — every value but "focus is available". */
type FocusDisabled = Exclude<FocusDisabledReason, undefined>;

const FOCUS_DISABLED_LOCALE: Record<FocusDisabled, string> = {
  hidden: "focus_layer_hidden",
  base: "focus_layer_base",
  no_bounds: "focus_layer_no_bounds",
};

/** The locale key explaining `reason`. Both the ⋮ menu item's title and the
 *  hint shown on the keyboard / double-click paths read it, so the two can
 *  never drift apart. */
const focusDisabledLocaleKey = (reason: FocusDisabled): string =>
  FOCUS_DISABLED_LOCALE[reason];

/** Why the ⋮ menu / keyboard / double-click path should not focus `item`.
 *
 *  An unchecked row comes first: it is hidden, so there is nothing to focus
 *  and nothing to style. That check sits ahead of the basemap branches so a
 *  basemap row obeys the same "checked first" rule as every data row — the
 *  branches below only say "no useful extent", which is true whether or not
 *  the row is on, so consulting them first would let an off basemap keep an
 *  enabled Style entry.
 *
 *  Basemaps (no useful extent) and surfaces whose `capabilities.bounds` is
 *  false (no honest carrier to focus on — a MarkerCluster group, a canvas
 *  without a `getBounds` provider, a third-party layer that never advertised
 *  a bounds) are off for focus only. */
const focusDisabledReason = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  item: HTMLElement,
): FocusDisabledReason => {
  const box = item.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  if (box !== null && !box.checked) return "hidden";
  if (item.dataset.layerType === GROUP.BASE) return "base";
  const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
  const layerInfo = la.layerRegistry.get(layerId);
  if (layerInfo && la.surfaceFor(layerInfo).capabilities.bounds === false) {
    return "no_bounds";
  }
  return undefined;
};

/** Show the hint that matches a `focusDisabledReason` value. */
const showFocusDisabledHint = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  reason: FocusDisabled,
): void => {
  la.map.foliplus!.showHint(
    CONF.name,
    T(focusDisabledLocaleKey(reason)),
    HINT_DURATION.SHORT,
  );
};

/** Toggle visibility of the currently focused layer. */
const toggleFocusedLayer = (la: LayerAccess, ps: PanelStore, fs: FocusStore): void => {
  const item = getActiveLayerItem(la, ps, fs);
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
 *    polygon, etc.), `flyTo` the layer center instead of `fitBounds` —
 *    `fitBounds` on a degenerate box has no effect.
 * 4. Draw a dashed rectangle on the exact bounds so the user sees exactly
 *    what "this layer" covers.
 * 5. Highlight the focused layer row with the `foliplus-is-focusing`
 *    class so the list →map linkage is visible.
 * 6. Call `fitBounds` with `padding` and `maxZoom` capped to current +
 *    `FOCUS.MAX_ZOOM_STEP` to avoid satellite-zoom snaps on small features.
 * 7. Auto-cancel on any subsequent map `moveend`/`zoomend` so the rect
 *    doesn't linger while the user navigates elsewhere.
 */
const focusLayer = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  layerId: string,
) => {
  // Guard: any component holding the map (measuring, exporting, searching,
  // locating) blocks focus. One guard at the entry covers all call sites
  // (double-click, overflow menu, Alt+Enter, Enter) so none of them leak.
  if (guardBlocked(la.map, CONF.name, T("blocked"))) return;

  const layerInfo = la.layerRegistry.get(layerId);
  if (!layerInfo) return;
  const layer = la.findLayer(layerInfo);

  // Hidden layer: nothing to focus on —show a hint instead.
  const itemEl = ps.uiContainer!.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
  ) as HTMLElement | null;
  const checkbox = itemEl?.querySelector(
    'input[type="checkbox"]',
  ) as HTMLInputElement | null;
  if (checkbox && !checkbox.checked) {
    showFocusDisabledHint(la, ps, fs, "hidden");
    return;
  }

  // Bounds come from the Leaflet layer (with a forEachLeaf fallback), or
  // from a canvas layer's getBounds provider (heatmap has no Leaflet layer).
  let bounds: L.LatLngBounds | null = null;
  if (layer) {
    // Ensure the layer is on the map so the rectangle highlight is visible.
    if (!la.map.hasLayer(layer)) la.map.addLayer(layer);
    bounds = computeLayerBounds(la, ps, fs, layer);
  } else if (typeof layerInfo.getBounds === "function") {
    bounds = layerInfo.getBounds();
  }
  // No bounds carrier — the surface said so up front via
  // `capabilities.bounds`. Keyboard / dblclick paths reach this guard
  // without going through `focusDisabledReason`, so the hint is the honest
  // feedback rather than a silent no-op.
  if (!bounds || !bounds.isValid()) {
    showFocusDisabledHint(la, ps, fs, "no_bounds");
    return;
  }

  // Cancel any in-flight focus first.
  dismissFocus(la, ps, fs);

  // Hide every other visible layer so the focused one stands out —including
  // layers that overlap the focused bounds (the mask only dims outside).
  hideOtherLayers(la, ps, fs);
  // Labels of the layers just hidden must leave the screen with them: the
  // canvas draws the spotlighted layer's labels only for the duration.
  la.annotation.setFocusFilter(layerId);
  // Lift it above the hidden peers (so it can't be covered) and apply the
  // accent glow —one O(panes) pass, not a per-leaf-element loop.
  bringFocusedLayerToFront(la, ps, fs, layerInfo);

  // Register LayerControl's own mode for the duration of the focus, BEFORE
  // the fitBounds/flyTo branching. Both paths draw a focus overlay and
  // register the same auto-cancel, so both must hold the mode —a missing
  // setMode on the flyTo path would let export/measure render through a
  // live focus overlay. Cleared on dismissFocus —called by the auto-timeout,
  // the manual cancel, and a subsequent focus (dismissFocus runs at the top
  // of focusLayer).
  const modes = ensureModes(la.map);
  modes.setMode(CONF.name, "focusing");

  // Single-point / tiny bounds →flyTo the center.
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  const area =
    Math.abs(northEast.lat - southWest.lat) * Math.abs(northEast.lng - southWest.lng);
  if (area < CONST.FOCUS.MIN_BOUNDS_AREA) {
    const center = bounds.getCenter();
    const maxZoom = Math.min(
      la.map.getMaxZoom(),
      la.map.getZoom() + CONST.FOCUS.MAX_ZOOM_STEP,
    );
    la.map.flyTo(center, maxZoom, {
      duration: CONST.FOCUS.FIT_DURATION,
    });
    highlightFocusedRow(la, ps, fs, itemEl, layerId);
    registerAutoCancel(la, ps, fs, layerId);
    return;
  }

  drawFocusMask(la, ps, fs, bounds);
  drawFocusRect(la, ps, fs, bounds);
  highlightFocusedRow(la, ps, fs, itemEl, layerId);

  la.map.fitBounds(bounds, {
    animate: true,
    duration: CONST.FOCUS.FIT_DURATION,
    padding: CONST.FOCUS.PADDING,
    maxZoom: Math.min(
      la.map.getMaxZoom(),
      la.map.getZoom() + CONST.FOCUS.MAX_ZOOM_STEP,
    ),
  });

  // Auto-remove focus visuals after the configured duration.
  const ref = fs.focusRect;
  setTimeout(() => {
    if (fs.focusRect === ref) {
      dismissFocus(la, ps, fs);
    }
  }, CONST.FOCUS.RECT_DURATION_MS);

  // One-shot map move/zoom handler that auto-cancels focus when the user
  // starts navigating elsewhere —prevents the rect from lingering.
  registerAutoCancel(la, ps, fs, layerId);
};

/** Return true if a focus animation is currently active. */
const isFocusing = (la: LayerAccess, ps: PanelStore, fs: FocusStore): boolean => {
  return fs.focusRect != null || fs.focusingLayerId != null;
};

/** Cancel an in-flight focus: remove rect + mask + row highlight. */
const cancelFocus = (la: LayerAccess, ps: PanelStore, fs: FocusStore): void => {
  dismissFocus(la, ps, fs);
  la.map.foliplus!.showHint(CONF.name, T("focus_cancelled"), HINT_DURATION.SHORT);
};

/** Internal: tear down focus visuals + state (no hint). */
const dismissFocus = (la: LayerAccess, ps: PanelStore, fs: FocusStore): void => {
  // Release LayerControl's focus mode so other components' primary actions
  // (export, measure) are unblocked. `ensureModes` is idempotent per map but
  // has a first-call side effect — it installs the per-map `unload` cleanup
  // (`map.on('unload', manager.clear)`). A no-op teardown (unbindEvents →
  // dismissFocus on a never-focused control) must not trigger that install,
  // otherwise the first removeControl would leave a residual `unload` handler
  // on the map. Guard with `isFocusing` so setMode(null) is only invoked
  // when `focusLayer` actually registered the mode.
  if (isFocusing(la, ps, fs)) {
    const modes = ensureModes(la.map);
    modes.setMode(CONF.name, null);
  }
  clearAutoCancel(la, ps, fs);
  clearFocusedRowHighlight(la, ps, fs);
  restoreHiddenLayers(la, ps, fs);
  la.annotation.setFocusFilter(null);
  for (const restore of fs.focusedPaneRestores) restore();
  fs.focusedPaneRestores = [];

  if (fs.focusRect) {
    la.map.removeLayer(fs.focusRect);
    fs.focusRect = null;
  }

  if (fs.focusMask) {
    la.map.removeLayer(fs.focusMask);
    fs.focusMask = null;
  }
  // Tear down the SVG renderer too. Reusing it across focuses left the
  // previous focus's mask/rect paths in the SVG even after removeLayer,
  // so focusing layer A then B showed two boxes (stale A mask + new B
  // mask) with inverted dimming. A fresh renderer per focus is cheap and
  // guarantees a clean slate.
  if (fs.focusRenderer) {
    la.map.removeLayer(fs.focusRenderer);
    fs.focusRenderer = null;
  }

  fs.focusingLayerId = null;
  // Focus suspends inRange for its duration: with focus gone, the focused
  // layer's effective-shown falls back to intent && inRange. If its range
  // still excludes the current zoom, the executor removes it from the map —
  // the "unfocus returns it to hidden" half of the focus gate.
  applyProjectionAll(la, ps, fs);
};

/**
 * Hide every other visible layer so the focused layer stands out.
 * Works alongside the inverse mask (which dims the basemap + everything
 * outside the bounds). The basemap (tilePane) has no `foliplus-layer-pane`
 * class, so it is naturally excluded and keeps the spatial context.
 *
 * Declarative: one class write on the map container. CSS
 * `.foliplus-is-focus-mode .foliplus-layer-pane:not(.foliplus-focus-pane)`
 * hides every layer pane except the focused one —instead of a JS
 * visibility loop over N panes. Canvas layers (heatmap) live in their own
 * pane, so they are covered by the same rule. `bringFocusedLayerToFront`
 * marks the focused pane with `foliplus-focus-pane` so it stays visible.
 */
const hideOtherLayers = (la: LayerAccess, ps: PanelStore, fs: FocusStore): void => {
  la.map.getContainer().classList.add(CONST.CLASSES.FOCUS_ACTIVE);
};

/**
 * Temporarily lift the focused layer's pane above every other layer so the
 * hidden layers stacked above it cannot cover it —a layer at the bottom
 * of the z-order stays hidden even with the boost glow.
 *
 * This is the single O(panes) pass that also applies the focused-layer glow
 * (`.foliplus-focus-glow`): by tagging the focused pane (not each leaf
 * element) the accent drop-shadow is applied once per pane, so focusing a
 * dense layer (e.g. thousands of CircleMarkers) stays cheap. Restored on
 * cancel via focusedPaneRestores.
 */
/**
 * Temporarily lift the focused layer's panes above every other layer so the
 * hidden layers stacked above it cannot cover it —a layer at the bottom
 * of the z-order stays hidden even with the boost glow.
 *
 * Every z here comes out of the shared ladder (`core/layer/z`): the focused
 * layer is lifted to `focusLayerZ()`, and the panes that belong above it keep
 * Leaflet's normal order —its own labels, then markers, tooltip and popup.
 * This is also the single O(panes) pass that applies the focused-layer glow
 * (`.foliplus-focus-glow`): by tagging the focused pane (not each leaf
 * element) the accent drop-shadow is applied once per pane, so focusing a
 * dense layer (e.g. thousands of CircleMarkers) stays cheap. Restored on
 * cancel via focusedPaneRestores.
 */
const bringFocusedLayerToFront = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  layerInfo: LayerInfo,
): void => {
  const restores: Array<() => void> = [];
  const focusedZ = focusLayerZ();
  const lift = (el: HTMLElement, z = focusedZ, glow = true): void => {
    const orig = el.style.zIndex;
    el.style.zIndex = String(z);
    // Mark the focused pane/canvas so the `.foliplus-is-focus-mode` CSS rule
    // (`:not(.foliplus-focus-pane)`) keeps it visible while hiding the rest.
    el.classList.add(CONST.CLASSES.FOCUS_PANE);
    // Glow: applied at pane level (one element), fading in via CSS animation.
    if (glow) el.classList.add(CONST.CLASSES.FOCUS_GLOW);
    restores.push(() => {
      el.style.zIndex = orig;
      el.classList.remove(CONST.CLASSES.FOCUS_PANE);
      el.classList.remove(CONST.CLASSES.FOCUS_GLOW);
    });
  };

  // Ladder above the raised layer, preserving Leaflet's normal order and staying
  // under the mask. The label pane needs no spot-write here anymore: it is a
  // `role: "annotation"` PaneHandle of the surface, so `setZOverride` below
  // prices it at `focusedZ + 1` through the same `zFor` ladder this used to
  // hand-derive — and its `FOCUS_PANE` mark comes from the same pass (glow
  // stays off it, see there). The rest are Leaflet's own panes, outside the
  // surface's override.
  const liftZ = (name: string, order: number): void => {
    const el = la.map.getPane(name);
    if (!el) return;
    const orig = el.style.zIndex;
    el.style.zIndex = String(zFor({ base: focusedZ, order }));
    restores.push(() => {
      el.style.zIndex = orig;
    });
  };
  liftZ("markerPane", 2);
  liftZ("tooltipPane", 3);
  liftZ("popupPane", 4);

  // The surface owns every pane a Leaflet layer paints into, so one call lifts
  // them all and `restoreZ` puts the ordering pass's z back.
  const layer = la.findLayer(layerInfo);
  if (layer) {
    const surface = la.surfaceFor(layerInfo);
    if (surface.setZOverride(focusedZ)) {
      // FOCUS_PANE on every pane — including the label pane, or the
      // focus-hide CSS would swallow the layer's own labels. The glow stays
      // off the annotation role: text labels are the layer's typography, not
      // its geometry, and a drop-shadow halo on them reads as a second outline
      // over the halo the label paint already carries.
      const panes = surface.panes;
      for (const pane of panes) {
        pane.element.classList.add(CONST.CLASSES.FOCUS_PANE);
        if (pane.role !== PANE_ROLE.ANNOTATION) {
          pane.element.classList.add(CONST.CLASSES.FOCUS_GLOW);
        }
      }
      restores.push(() => {
        for (const pane of panes) {
          pane.element.classList.remove(CONST.CLASSES.FOCUS_PANE);
          pane.element.classList.remove(CONST.CLASSES.FOCUS_GLOW);
        }
        surface.restoreZ();
      });
    } else {
      // A surface with no pane of its own: fall back to pane discovery.
      // Best-effort —some third-party layers expose children without a pane,
      // and getLayerPanes walks options.pane, so skip the lift if discovery
      // throws (the hide + glow still work without it).
      let names: string[] = [];
      try {
        names = la.getLayerPanes(layer);
      } catch {
        names = [];
      }
      for (const name of names) {
        // Skip only the shared core panes (overlay/marker/tile/...). Per-layer
        // fallback panes are unique and safe to lift —and hideOtherLayers
        // already hides them, so the two must stay symmetric.
        if (la.panes.defaultPanes.has(name)) continue;
        const pane = la.map.getPane(name);
        if (pane) lift(pane);
      }
    }
  } else if (layerInfo.paneName) {
    // Canvas-only layers own a dedicated pane (createCanvas) — lift that, not
    // the raw canvas element, so focus-hide CSS and glow attach to the pane
    // like every other layer. Fall back to the canvas if the pane is missing.
    const canvasPane = la.map.getPane(layerInfo.paneName);
    if (canvasPane) lift(canvasPane);
    else if (layerInfo.canvas) lift(layerInfo.canvas);
  } else if (layerInfo.canvas) {
    lift(layerInfo.canvas);
  }
  fs.focusedPaneRestores = restores;
};

/** Remove the container class that hides every non-focused layer. */
const restoreHiddenLayers = (la: LayerAccess, ps: PanelStore, fs: FocusStore): void => {
  la.map.getContainer().classList.remove(CONST.CLASSES.FOCUS_ACTIVE);
};

/**
 * Compute a layer's geographic bounds. Third-party layers may be custom
 * L.Layer subclasses without a getBounds() method; fall back to summing the
 * bounds of the layer's leaf nodes so focus still works for them.
 */
const computeLayerBounds = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  layer: L.Layer,
): L.LatLngBounds | null => {
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
 * Draw an inverse mask that dims everything outside the focused bounds —
 * the same "inside highlighted / outside dimmed" spotlight as the export
 * crop box. The mask is a polygon of the visible view with the layer bounds
 * as a hole, rendered in a high-z pane above the layer panes but below the
 * focus rectangle, so the focused layer inside the hole stays bright.
 */
const drawFocusMask = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  bounds: L.LatLngBounds,
): void => {
  const map = la.map;

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
  if (!fs.focusRenderer) {
    const { pane } = la.panes.ensurePane(CONST.FOCUS_PANE, false);
    pane.classList.add(CONST.CLASSES.FOCUS_PANE);
    pane.style.zIndex = String(FOCUS_Z.overlay);
    fs.focusRenderer = L.svg({ pane: CONST.FOCUS_PANE });
    fs.focusRenderer.addTo(map);
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

  fs.focusMask = L.polygon([outer, hole], {
    className: "foliplus-focus-mask",
    fillColor: "#000000",
    fillOpacity: CONST.FOCUS.MASK_OPACITY,
    stroke: false,
    interactive: false,
    renderer: fs.focusRenderer,
  });
  map.addLayer(fs.focusMask);
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
const drawFocusRect = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  bounds: L.LatLngBounds,
): void => {
  const map = la.map;

  fs.focusRect = L.polygon(roundedRectPoints(bounds), {
    className: "foliplus-focus-rect",
    fill: false,
    interactive: false,
    renderer: fs.focusRenderer ?? undefined,
  });
  map.addLayer(fs.focusRect);
};

/** Register a one-shot moveend/zoomend handler that auto-cancels focus. */
const registerAutoCancel = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  layerId: string,
): void => {
  fs.focusingLayerId = layerId;
  const handler = () => {
    if (fs.focusingLayerId !== layerId) return;
    // Grace period: the fitBounds/flyTo animation fires moveend/zoomend on
    // completion, which should NOT auto-cancel. Any move/zoom *after* the
    // grace window is a deliberate user action →cancel.
    setTimeout(() => {
      if (fs.focusingLayerId === layerId) {
        dismissFocus(la, ps, fs);
      }
    }, CONST.FOCUS.RECT_DURATION_MS * 0.3);
  };
  fs.onFocusMapMove = () => handler();
  la.map.on("moveend", fs.onFocusMapMove);
  la.map.on("zoomend", fs.onFocusMapMove);
};

/** Remove the map move/zoom auto-cancel handlers. */
const clearAutoCancel = (la: LayerAccess, ps: PanelStore, fs: FocusStore): void => {
  if (fs.onFocusMapMove) {
    la.map.off("moveend", fs.onFocusMapMove);
    la.map.off("zoomend", fs.onFocusMapMove);
    fs.onFocusMapMove = null;
  }
};

/** Highlight the layer row that is being focused (list →map linkage). */
const highlightFocusedRow = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  itemEl: HTMLElement | null,
  layerId: string,
): void => {
  clearFocusedRowHighlight(la, ps, fs);
  if (!itemEl) return;
  itemEl.classList.add(CONST.CLASSES.FOCUSING);
  fs.focusingLayerId = layerId;
};

/** Remove the `foliplus-is-focusing` class from the active row. */
const clearFocusedRowHighlight = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
): void => {
  const prev = ps.uiContainer!.querySelector(`.${CONST.CLASSES.FOCUSING}`);
  prev?.classList.remove(CONST.CLASSES.FOCUSING);
};

export {
  focusDisabledLocaleKey,
  focusDisabledReason,
  showFocusDisabledHint,
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
