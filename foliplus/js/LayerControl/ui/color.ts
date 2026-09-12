// LayerControl UI 鈥?Solid-color basemap visibility.
import * as CONST from "../const.js";
import type { LayerUI } from "./index.js";
import { mapContainer } from "./context.js";

const showColorLayer = (ui: LayerUI, color: string) => {
  ui.isColorActive = true;
  ui.currentColor = color;
  mapContainer.style.setProperty("--color-layer-bg", color);
  mapContainer.classList.add(CONST.CLASSES.ACTIVE);

  for (let i = 0; i < ui.m.layers.length; i++) {
    if (ui.m.layers[i].isBase) {
      const bLayer = ui.m.findLayer(ui.m.layers[i]);
      if (bLayer && ui.m.map.hasLayer(bLayer)) ui.m.map.removeLayer(bLayer);
    }
  }

  const tilePane = ui.m.map.getPane("tilePane");
  if (tilePane) tilePane.classList.add("foliplus-layer-tile-hidden");

  const inputs = ui.uiContainer.querySelectorAll(
    `${CONST.SEL.LAYER_ITEM}:not(${CONST.SEL.COLOR_ITEM}) input`,
  ) as NodeListOf<HTMLInputElement>;
  inputs.forEach((input: HTMLInputElement, j: number) => {
    if (ui.m.layers[j]?.isBase) {
      input.checked = false;
      input.closest(CONST.SEL.LAYER_ITEM)?.classList.remove(CONST.CLASSES.ACTIVE);
    }
  });

  const ci = ui.uiContainer.querySelector(
    CONST.SEL.COLOR_INPUT,
  ) as HTMLInputElement | null;
  if (ci) ci.value = color;
  ui.uiContainer
    .querySelector(CONST.SEL.COLOR_ITEM)
    ?.classList.add(CONST.CLASSES.ACTIVE);
  ui.syncToggleAll(CONST.GROUP.BASE);
};

const hideColorLayer = (ui: LayerUI) => {
  ui.isColorActive = false;
  mapContainer.classList.remove(CONST.CLASSES.ACTIVE);
  mapContainer.style.removeProperty("--color-layer-bg");
  const tilePane = ui.m.map.getPane("tilePane");
  if (tilePane) tilePane.classList.remove("foliplus-layer-tile-hidden");
  ui.uiContainer
    .querySelector(CONST.SEL.COLOR_ITEM)
    ?.classList.remove(CONST.CLASSES.ACTIVE);
};

export {
  showColorLayer,
  hideColorLayer,
};
