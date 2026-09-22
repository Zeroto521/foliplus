// LayerControl UI —Solid-color basemap visibility.
import * as CONST from "../const.js";
import type { LayerUI } from "./index.js";

const showColorLayer = (ui: LayerUI, color: string) => {
  ui.isColorActive = true;
  ui.currentColor = color;
  ui.m.map.getContainer().style.setProperty("--color-layer-bg", color);
  ui.m.map.getContainer().classList.add(CONST.CLASSES.ACTIVE);

  for (let i = 0; i < ui.m.layers.length; i++) {
    if (ui.m.layers[i].isBase) {
      const bLayer = ui.m.findLayer(ui.m.layers[i]);
      if (bLayer && ui.m.map.hasLayer(bLayer)) ui.m.map.removeLayer(bLayer);
    }
  }

  const tilePane = ui.m.map.getPane("tilePane");
  if (tilePane) tilePane.classList.add("foliplus-layer-tile-hidden");

  // Resolve each base row by data-layer-id, not by DOM position: a late
  // registration can land anywhere in the panel, so a positional read would
  // clear a neighbour's checkbox and leave the real base row checked.
  for (const layerInfo of ui.m.layers) {
    if (!layerInfo.isBase) continue;
    const item = ui.uiContainer.querySelector(
      `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerInfo.id)}"]`,
    ) as HTMLElement | null;
    if (!item) continue;
    const input = item.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (input) input.checked = false;
    item.classList.remove(CONST.CLASSES.ACTIVE);
  }

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
  ui.m.map.getContainer().classList.remove(CONST.CLASSES.ACTIVE);
  ui.m.map.getContainer().style.removeProperty("--color-layer-bg");
  const tilePane = ui.m.map.getPane("tilePane");
  if (tilePane) tilePane.classList.remove("foliplus-layer-tile-hidden");
  ui.uiContainer
    .querySelector(CONST.SEL.COLOR_ITEM)
    ?.classList.remove(CONST.CLASSES.ACTIVE);
};

export { showColorLayer, hideColorLayer };
