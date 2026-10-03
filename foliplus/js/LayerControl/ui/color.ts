// LayerControl UI — Solid-color basemap visibility.
// The color basemap is a first-class base-group layer: it owns a dedicated
// pane + canvas (created through `factory.createColor`) so it participates
// in the layer z ladder exactly like tile basemaps. Row order = visual stack
// order — drag the color row above a tile basemap and it covers the tiles;
// below and the tiles cover it. No mutual exclusion: color and tiles are
// coequal, each with its own checkbox and its own pane.
//
// The pane is created lazily on first show so a color that never gets
// checked does not allocate a canvas or a pane in the DOM.
import type { CreateColorAPI } from "#core/layer/index.js";
import * as CONST from "../const.js";
import type { LayerUI } from "./index.js";

const getColorSurface = (ui: LayerUI): CreateColorAPI => {
  if (!ui.colorSurface) {
    const surface = ui.m.createColor({
      id: CONST.SOLID_BASEMAP_ID,
      name: ui.T("color_map_label"),
      color: CONST.COLOR.DEFAULT,
    });
    ui.colorSurface = surface;
    // register() inserts the LayerInfo into the registry. Called after
    // setting ui.colorSurface so a subsequent getColorSurface call (from
    // showSolidBasemap during the register-triggered applyProjection) finds
    // the surface instead of creating a second one.
    surface.register();
  }
  return ui.colorSurface;
};

const showSolidBasemap = (ui: LayerUI, color: string) => {
  ui.currentColor = color;
  const surface = getColorSurface(ui);
  surface.setColor(color);
  surface.setVisible(true);
  // Checking the box is a single user action — order the stack now, so the
  // pane's z lands immediately instead of after the debounce.
  ui.m.enforceOrder();
};

const hideSolidBasemap = (ui: LayerUI) => {
  // The surface is created lazily on first show. An init-time hide
  // (the author default is unchecked) runs before any show, so the
  // surface does not exist yet — nothing to hide, and the pane is not
  // allocated.
  ui.colorSurface?.setVisible(false);
};

/** Reset the colour basemap to its initial state after a delete: null the
 *  surface (so the next show re-allocates it), reset the colour to the
 *  author default, mark the id as hidden so the deletion persists, and
 *  flush. Called only from LayerManager.deleteLayer — the uncheck path
 *  uses `hideSolidBasemap` instead, which keeps the surface allocated so
 *  a re-check is cheap. */
const resetSolidBasemap = (ui: LayerUI) => {
  ui.colorSurface = null;
  ui.currentColor = CONST.COLOR.DEFAULT;
  ui.runtimeStore.setAuthorVisible(CONST.SOLID_BASEMAP_ID, false);
  ui.saveState();
};

export { getColorSurface, showSolidBasemap, hideSolidBasemap, resetSolidBasemap };
