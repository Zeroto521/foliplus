// LayerControl UI —Solid-color basemap visibility.
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
import { createScopedTranslator } from "#common/locale.js";
import * as CONST from "../const.js";
import type { LayerAccess } from "./access.js";
import type { FocusStore } from "./focusStore.js";
import type { PanelStore } from "./panelStore.js";

const T = createScopedTranslator(CONF);

const getColorSurface = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
): CreateColorAPI => {
  if (!ps.colorSurface) {
    const surface = la.createColor({
      id: CONST.SOLID_BASEMAP_ID,
      name: T("color_map_label"),
      color: CONST.COLOR.DEFAULT,
    });
    ps.colorSurface = surface;
    // register() inserts the LayerInfo into the registry. Called after
    // setting ps.colorSurface so a subsequent getColorSurface call (from
    // showSolidBasemap during the register-triggered applyProjection) finds
    // the surface instead of creating a second one.
    surface.register();
  }
  return ps.colorSurface;
};

const showSolidBasemap = (
  la: LayerAccess,
  ps: PanelStore,
  fs: FocusStore,
  color: string,
) => {
  ps.currentColor = color;
  const surface = getColorSurface(la, ps, fs);
  surface.setColor(color);
  surface.setVisible(true);
  // Checking the box is a single user action — order the stack now, so the
  // pane's z lands immediately instead of after the debounce.
  la.enforceOrder();
};

const hideSolidBasemap = (la: LayerAccess, ps: PanelStore, fs: FocusStore) => {
  // The surface is created lazily on first show. An init-time hide
  // (the author default is unchecked) runs before any show, so the
  // surface does not exist yet — nothing to hide, and the pane is not
  // allocated.
  ps.colorSurface?.setVisible(false);
};

export { getColorSurface, showSolidBasemap, hideSolidBasemap };
