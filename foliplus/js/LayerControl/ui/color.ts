// LayerControl UI —Solid-color basemap visibility.
// The color basemap is a first-class base-group layer: it owns a dedicated
// pane + canvas (created through `factory.createColor`) so it participates
// in the layer z ladder exactly like tile basemaps. Row order = visual stack
// order — drag the color row above a tile basemap and it covers the tiles;
// below and the tiles cover it. No mutual exclusion: colour and tiles are
// coequal, each with its own checkbox and its own pane.
//
// The pane is created lazily on first show so a colour that never gets
// checked does not allocate a canvas or a pane in the DOM.
import type { CreateColorAPI } from "#core/layer/index.js";
import * as CONST from "../const.js";
import type { LayerUI } from "./index.js";

const getColorSurface = (ui: LayerUI): CreateColorAPI => {
  if (!ui.colorSurface) {
    const surface = ui.m.createColor({
      id: CONST.COLOR.MAP_ID,
      name: ui.T("color_map_label"),
      color: CONST.COLOR.DEFAULT,
    });
    ui.colorSurface = surface;
    // register() inserts the LayerInfo into the registry. Called after
    // setting ui.colorSurface to avoid a recursive call through
    // applyProjection → onToggle → showColorLayer → getColorSurface.
    surface.register();
  }
  return ui.colorSurface;
};

const showColorLayer = (ui: LayerUI, color: string) => {
  ui.currentColor = color;
  const surface = getColorSurface(ui);
  surface.setColor(color);
  surface.setVisible(true);
  ui.m.debouncedEnforce();

  ui.uiContainer
    .querySelector(CONST.SEL.COLOR_ITEM)
    ?.classList.add(CONST.CLASSES.ACTIVE);
};

const hideColorLayer = (ui: LayerUI) => {
  // The surface is created lazily on first show. An init-time hide
  // (the author default is unchecked) runs before any show, so the
  // surface does not exist yet — nothing to hide, and the pane is not
  // allocated.
  ui.colorSurface?.setVisible(false);
  ui.uiContainer
    .querySelector(CONST.SEL.COLOR_ITEM)
    ?.classList.remove(CONST.CLASSES.ACTIVE);
};

export { showColorLayer, hideColorLayer };
