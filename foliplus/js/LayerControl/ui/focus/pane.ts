// Focus-layer pane bookkeeping: hide every other visible layer while a focus
// is live, lift the focused layer above its peers, and undo both on dismiss.
import {
  GROUP,
  type LayerInfo,
  PANE_ROLE,
  focusLayerZ,
  zFor,
} from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { FinalizeStep } from "#common/finalize.js";
import { basePaints } from "../listPanel/visibility.js";
import { projectLayer } from "../projection.js";
import type { LayerUI } from "../surface.js";

/**
 * Hide every other visible layer so the focused layer stands out.
 * Works alongside the inverse mask (which dims the area outside the
 * bounds). The active basemap (topmost base layer that is effectiveShown)
 * is exempted from this rule and dimmed — other base panes are hidden
 * like data layers. Declarative: one class write on the map container.
 * CSS `.foliplus-is-focus-mode .foliplus-layer-pane:not(.foliplus-focus-pane):not(.foliplus-focus-basemap)`
 * hides every layer pane except the focused one and the active basemap —
 * instead of a JS visibility loop over N panes. Canvas layers (heatmap)
 * live in their own pane, so they are covered by the same rule.
 * `bringFocusedLayerToFront` marks the focused pane with
 * `.foliplus-focus-pane` so it stays visible.
 */
const hideOtherLayers = (ui: LayerUI): void => {
  ui.c.map.getContainer().classList.add(CONST.CLASSES.FOCUS_ACTIVE);

  // Mark the active basemap (topmost base layer that is effectiveShown)
  // so it stays visible and is dimmed. Other base panes are hidden like
  // data layers. Restore functions are stored in focusedPaneRestores so
  // dismissFocus clears the marking.
  //
  // The registry order is topmost-first: `zFor` prices a layer at
  // `base + (count - index) * step`, so a smaller index sits higher in the
  // stack. Iterating forward finds the topmost base first.
  const layers = ui.c.layers;
  for (let i = 0; i < layers.length; i++) {
    const li = layers[i];
    if (li.group !== GROUP.BASE) continue;
    const proj = projectLayer(ui, li);
    // The projection's effectiveShown folds in focus (policy = true), but
    // the author's zoom range and transparency are physical facts focus
    // must not override — a base outside its own min/max zoom paints
    // nothing even while focused, so it cannot be the "active basemap".
    if (!proj.effectiveShown || !basePaints(ui, li)) continue;
    const surface = ui.c.surfaceFor(li);
    if (!surface) continue;
    for (const pane of surface.panes) {
      ui.c.panes.assertOwnedPane(pane.name);
      pane.element.classList.add(CONST.CLASSES.FOCUS_BASEMAP);
    }
    ui.focusController.focusedPaneRestores.push([
      `base-pane:${li.id}`,
      () => {
        for (const pane of surface.panes) {
          pane.element.classList.remove(CONST.CLASSES.FOCUS_BASEMAP);
        }
      },
    ]);
    break; // only the topmost base layer
  }
};

/**
 * Temporarily lift the focused layer's panes above every other layer so the
 * hidden layers stacked above it cannot cover it — a layer at the bottom
 * of the z-order stays hidden even with the boost glow.
 *
 * Every z here comes out of the shared ladder (`core/layer/z`): the focused
 * layer is lifted to `focusLayerZ()`, and the panes that belong above it keep
 * Leaflet's normal order — its own labels, then markers, tooltip and popup.
 * This is also the single O(panes) pass that applies the focused-layer glow
 * (`.foliplus-focus-glow`): by tagging the focused pane (not each leaf
 * element) the accent drop-shadow is applied once per pane, so focusing a
 * dense layer (e.g. thousands of CircleMarkers) stays cheap. Restored on
 * cancel via focusedPaneRestores.
 */
const bringFocusedLayerToFront = (ui: LayerUI, layerInfo: LayerInfo): void => {
  const restores: FinalizeStep[] = [];
  const focusedZ = focusLayerZ();
  const lift = (name: string, el: HTMLElement, z = focusedZ): void => {
    const orig = el.style.zIndex;
    el.style.zIndex = String(z);
    // Mark the focused pane/canvas so the `.foliplus-is-focus-mode` CSS rule
    // (`:not(.foliplus-focus-pane)`) keeps it visible while hiding the rest.
    el.classList.add(CONST.CLASSES.FOCUS_PANE);
    // Glow: applied at pane level (one element), fading in via CSS animation.
    el.classList.add(CONST.CLASSES.FOCUS_GLOW);
    restores.push([
      `lift:${name}`,
      () => {
        el.style.zIndex = orig;
        el.classList.remove(CONST.CLASSES.FOCUS_PANE);
        el.classList.remove(CONST.CLASSES.FOCUS_GLOW);
      },
    ]);
  };

  // Ladder above the raised layer, preserving Leaflet's normal order and staying
  // under the mask. The label pane needs no spot-write here anymore: it is a
  // `role: "annotation"` PaneHandle of the surface, so `setZOverride` below
  // prices it at `focusedZ + 1` through the same `zFor` ladder this used to
  // hand-derive — and its `FOCUS_PANE` mark comes from the same pass (glow
  // stays off it, see there). The rest are Leaflet's own panes, outside the
  // surface's override.
  const liftZ = (name: string, order: number): void => {
    const el = ui.c.map.getPane(name);
    if (!el) return;
    const orig = el.style.zIndex;
    el.style.zIndex = String(zFor({ base: focusedZ, order }));
    restores.push([
      `restore-z:${name}`,
      () => {
        el.style.zIndex = orig;
      },
    ]);
  };
  liftZ("markerPane", 2);
  liftZ("tooltipPane", 3);
  liftZ("popupPane", 4);

  // The surface owns every pane a Leaflet layer paints into, so one call lifts
  // them all and `restoreZ` puts the ordering pass's z back.
  const layer = ui.c.findLayer(layerInfo);
  if (layer) {
    const surface = ui.c.surfaceFor(layerInfo);
    if (surface.setZOverride(focusedZ)) {
      // FOCUS_PANE on every pane — including the label pane, or the
      // focus-hide CSS would swallow the layer's own labels — and the
      // marker-shadow pane, whose shadows belong to the focused layer's
      // spotlight just as much as its icons. The glow stays off the
      // annotation role (text labels are the layer's typography, not its
      // geometry, and a drop-shadow halo on them reads as a second outline
      // over the halo the label paint already carries) and off the shadow
      // role (a filter halo on the shadows would read as a shadow of the
      // shadow).
      const panes = surface.panes;
      for (const pane of panes) {
        pane.element.classList.add(CONST.CLASSES.FOCUS_PANE);
        if (pane.role !== PANE_ROLE.ANNOTATION && pane.role !== PANE_ROLE.SHADOW) {
          pane.element.classList.add(CONST.CLASSES.FOCUS_GLOW);
        }
      }
      restores.push([
        `surface:${layerInfo.id}`,
        () => {
          for (const pane of panes) {
            pane.element.classList.remove(CONST.CLASSES.FOCUS_PANE);
            pane.element.classList.remove(CONST.CLASSES.FOCUS_GLOW);
          }
          surface.restoreZ();
        },
      ]);
    } else {
      // A surface with no pane of its own: fall back to pane discovery.
      // Best-effort — some third-party layers expose children without a pane,
      // and getLayerPanes walks options.pane, so skip the lift if discovery
      // throws (the hide + glow still work without it).
      let names: string[] = [];
      try {
        names = ui.c.getLayerPanes(layer);
      } catch {
        names = [];
      }
      for (const name of names) {
        // Skip only the shared core panes (overlay/marker/tile/...). Per-layer
        // fallback panes are unique and safe to lift — and hideOtherLayers
        // already hides them, so the two must stay symmetric.
        if (ui.c.panes.defaultPanes.has(name)) continue;
        const pane = ui.c.map.getPane(name);
        if (pane) lift(`pane:${name}`, pane);
      }
    }
  } else if (layerInfo.paneName) {
    // Canvas-only layers own a dedicated pane (createCanvas) — lift that, not
    // the raw canvas element, so focus-hide CSS and glow attach to the pane
    // like every other layer. Fall back to the canvas if the pane is missing.
    const canvasPane = ui.c.map.getPane(layerInfo.paneName);
    if (canvasPane) lift(`pane:${layerInfo.paneName}`, canvasPane);
    else if (layerInfo.canvas) lift(`canvas:${layerInfo.id}`, layerInfo.canvas);
  } else if (layerInfo.canvas) {
    lift(`canvas:${layerInfo.id}`, layerInfo.canvas);
  }
  ui.focusController.focusedPaneRestores.push(...restores);
};

/** Remove the container class that hides every non-focused layer. */
const restoreHiddenLayers = (ui: LayerUI): void => {
  ui.c.map.getContainer().classList.remove(CONST.CLASSES.FOCUS_ACTIVE);
};

export { bringFocusedLayerToFront, hideOtherLayers, restoreHiddenLayers };
