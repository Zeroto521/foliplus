// LayerControl UI —Checkbox / group-toggle visibility.
import { type Debounced, debounce } from "#common/debounce.js";
import * as CONST from "../const.js";
import { T } from "./context.js";
import type { LayerUI } from "./index.js";

const getLayerItems = (ui: LayerUI, group: string): NodeListOf<Element> => {
  return ui.uiContainer.querySelectorAll(
    `${CONST.SEL.LAYER_ITEM}${group === CONST.GROUP.BASE ? `[data-layer-type="${CONST.GROUP.BASE}"]` : `:not([data-layer-type="${CONST.GROUP.BASE}"]):not(${CONST.SEL.COLOR_ITEM})`}`,
  );
};

const toggleAll = (ui: LayerUI, group: string, newState: boolean) => {
  const items = ui.getLayerItems(group);
  items.forEach((item: Element) => {
    const checkbox = item.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    if (!checkbox) return;
    const idx = parseInt(checkbox.dataset.index ?? "", 10);
    if (isNaN(idx) || idx < 0 || idx >= ui.m.layers.length) return;
    const layerInfo = ui.m.layers[idx];
    const layer = ui.m.findLayer(layerInfo);

    checkbox.checked = newState;
    checkbox.title = T(newState ? "deselect_tooltip" : "select_tooltip");
    if (newState) item.classList.add(CONST.CLASSES.ACTIVE);
    else item.classList.remove(CONST.CLASSES.ACTIVE);

    if (layer) newState ? ui.m.map.addLayer(layer) : ui.m.map.removeLayer(layer);
    if (newState && layer) layer.options.paneSet = false;
    if (layerInfo.onToggle) layerInfo.onToggle(newState);
    ui.syncVisibility(layerInfo, layer, newState);
    // No persist per iteration —schedule a single debounced write after the
    // loop so the debounce timer isn't reset for every layer.
    ui.syncHiddenId(layerInfo.id, !newState, false);
  });

  // Persist hidden-set after bulk toggle (single debounced write for the batch).
  ui.saveHiddenIds();

  if (group === CONST.GROUP.BASE && !newState) {
    ui.hideColorLayer();
    ui.showColorLayer(ui.currentColor);
  } else if (group === CONST.GROUP.BASE && newState) ui.hideColorLayer();

  ui.syncToggleAll(group);
  ui.m.debouncedEnforce();
};

const syncToggleAll = (ui: LayerUI, group: string) => {
  const row = ui.uiContainer.querySelector(
    `${CONST.SEL.TOGGLE_ALL}[data-group="${group}"]`,
  );
  if (!row) return;
  const allCb = row.querySelector(
    '[data-role="toggle-all"]',
  ) as HTMLInputElement | null;
  if (!allCb) return;
  const items = ui.getLayerItems(group);
  const checkedCount = Array.from(items).filter((item: Element) => {
    const checkbox = item.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    return checkbox && checkbox.checked;
  }).length;
  const allChecked = items.length > 0 && checkedCount === items.length;
  const noneChecked = checkedCount === 0;
  allCb.checked = allChecked;
  allCb.indeterminate = !allChecked && !noneChecked;
  allCb.title = T(
    allChecked || allCb.indeterminate
      ? "toggle_all_deselect_tooltip"
      : "toggle_all_select_tooltip",
  );
};

const syncVisibility = (
  ui: LayerUI,
  layerInfo: LayerInfo,
  layer: L.Layer | null,
  fallback: boolean,
) => {
  layerInfo.visible = layer ? ui.m.map.hasLayer(layer) : fallback;
  return layerInfo.visible;
};

const handleChange = (ui: LayerUI, event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.classList.contains(CONST.CLASSES.COLOR_INPUT)) {
    ui.deselectAllBaseMaps(-1);
    ui.showColorLayer(target.value);
    ui.syncToggleAll(CONST.GROUP.BASE);
    ui.m.enforceOrder();
    return;
  }
  if (target.tagName.toLowerCase() !== "input" || target.type !== "checkbox") return;

  const idx = parseInt(target.dataset.index ?? "", 10);
  if (isNaN(idx) || idx < 0 || idx >= ui.m.layers.length) return;
  const layerInfo = ui.m.layers[idx];
  const layer = ui.m.findLayer(layerInfo);
  const item = target.closest(CONST.SEL.LAYER_ITEM);

  if (layerInfo.isBase) ui.hideColorLayer();
  if (layer) {
    target.checked ? ui.m.map.addLayer(layer) : ui.m.map.removeLayer(layer);
  }
  if (target.checked && layer) layer.options.paneSet = false;
  if (item) {
    target.checked
      ? item.classList.add(CONST.CLASSES.ACTIVE)
      : item.classList.remove(CONST.CLASSES.ACTIVE);
  }

  target.title = T(target.checked ? "deselect_tooltip" : "select_tooltip");

  if (layerInfo.onToggle) layerInfo.onToggle(target.checked);
  ui.syncVisibility(layerInfo, layer, target.checked);
  ui.syncHiddenId(layerInfo.id, !target.checked);

  ui.syncToggleAll(layerInfo.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY);
  ui.m.debouncedEnforce();
};

const handleInput = (ui: LayerUI, event: Event) => {
  if ((event.target as HTMLElement).classList.contains(CONST.CLASSES.COLOR_INPUT)) {
    ui.showColorLayer((event.target as HTMLInputElement).value);
  }
};

/**
 * Update the persisted hidden set for a layer toggle.
 * @param {boolean} persist - When false (bulk updates like toggleAll), the
 *   caller schedules a single save after the loop instead of resetting the
 *   debounce timer for every layer.
 */

export {
  getLayerItems,
  toggleAll,
  syncToggleAll,
  syncVisibility,
  handleChange,
  handleInput,
};
