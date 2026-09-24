// LayerControl UI —Solid-color basemap visibility.
// No mutual exclusion with tile basemaps: colour and tiles are coequal
// first-class layers, each with its own checkbox and its own pane. This file
// only flips the container's background colour and the row's active state;
// it must not remove any other layer from the map or hide Leaflet's shared
// tile panes — those are global side effects that outlive the layer.
import * as CONST from "../const.js";
import type { LayerUI } from "./index.js";

const showColorLayer = (ui: LayerUI, color: string) => {
  ui.isColorActive = true;
  ui.currentColor = color;
  ui.m.map.getContainer().style.setProperty("--color-layer-bg", color);
  ui.m.map.getContainer().classList.add(CONST.CLASSES.ACTIVE);

  const ci = ui.uiContainer.querySelector(
    CONST.SEL.COLOR_INPUT,
  ) as HTMLInputElement | null;
  if (ci) ci.value = color;
  ui.uiContainer
    .querySelector(CONST.SEL.COLOR_ITEM)
    ?.classList.add(CONST.CLASSES.ACTIVE);
};

const hideColorLayer = (ui: LayerUI) => {
  ui.isColorActive = false;
  ui.m.map.getContainer().classList.remove(CONST.CLASSES.ACTIVE);
  ui.m.map.getContainer().style.removeProperty("--color-layer-bg");
  ui.uiContainer
    .querySelector(CONST.SEL.COLOR_ITEM)
    ?.classList.remove(CONST.CLASSES.ACTIVE);
};

export { showColorLayer, hideColorLayer };
