// LayerControl UI —Checkbox / group-toggle visibility.
import { type Debounced, debounce } from "#common/debounce.js";
import * as CONST from "../const.js";
import { hideColorLayer, showColorLayer } from "./color.js";
import type { LayerUI } from "./index.js";
import { saveHiddenIds, syncHiddenId } from "./state.js";

const getLayerItems = (ui: LayerUI, group: string): NodeListOf<Element> => {
  return ui.uiContainer.querySelectorAll(
    `${CONST.SEL.LAYER_ITEM}${group === CONST.GROUP.BASE ? `[data-layer-type="${CONST.GROUP.BASE}"]` : `:not([data-layer-type="${CONST.GROUP.BASE}"]):not(${CONST.SEL.COLOR_ITEM})`}`,
  );
};

const toggleAll = (ui: LayerUI, group: string, newState: boolean) => {
  const items = getLayerItems(ui, group);
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
    checkbox.title = ui.T(newState ? "deselect_tooltip" : "select_tooltip");
    if (newState) item.classList.add(CONST.CLASSES.ACTIVE);
    else item.classList.remove(CONST.CLASSES.ACTIVE);

    if (layer) newState ? ui.m.map.addLayer(layer) : ui.m.map.removeLayer(layer);
    if (newState && layer) layer.options.paneSet = false;
    if (layerInfo.onToggle) layerInfo.onToggle(newState);
    syncVisibility(ui, layerInfo, layer, newState);
    // No persist per iteration —schedule a single debounced write after the
    // loop so the debounce timer isn't reset for every layer.
    syncHiddenId(ui, layerInfo.id, !newState, false);
  });

  // Persist hidden-set after bulk toggle (single debounced write for the batch).
  saveHiddenIds(ui);

  if (group === CONST.GROUP.BASE && !newState) {
    hideColorLayer(ui);
    showColorLayer(ui, ui.currentColor);
  } else if (group === CONST.GROUP.BASE && newState) hideColorLayer(ui);

  syncToggleAll(ui, group);
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
  const items = getLayerItems(ui, group);
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
  allCb.title = ui.T(
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

/**
 * Apply one layer's visibility, source-agnostic.
 *
 * The panel checkbox has always driven this transition, and that was the only
 * path — there was no way to hide a layer by id from outside the DOM. This
 * takes the same transition on either source (a change event or
 * {@link LayerUI.setVisible}): map membership, the canvas-only callback, the
 * `visible` flag, the row's checkbox + tooltip + active class, the persisted
 * hidden set, the group toggle-all, and the debounced z-order enforcement.
 *
 * @returns true if the layer id resolved to a registry entry.
 */
const applyVisibility = (
  ui: LayerUI,
  id: string,
  visible: boolean,
): boolean => {
  const layerInfo = ui.m.layerRegistry.get(id);
  if (!layerInfo) return false;
  const layer = ui.m.findLayer(layerInfo);
  const item = ui.uiContainer?.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`,
  ) as HTMLElement | null;
  const checkbox = item?.querySelector(
    'input[type="checkbox"]',
  ) as HTMLInputElement | null;

  if (layerInfo.isBase) hideColorLayer(ui);
  if (layer) {
    visible ? ui.m.map.addLayer(layer) : ui.m.map.removeLayer(layer);
  }
  if (visible && layer) layer.options.paneSet = false;
  if (checkbox) {
    checkbox.checked = visible;
    checkbox.title = ui.T(visible ? "deselect_tooltip" : "select_tooltip");
  }
  item?.classList.toggle(CONST.CLASSES.ACTIVE, visible);

  if (layerInfo.onToggle) layerInfo.onToggle(visible);
  syncVisibility(ui, layerInfo, layer, visible);
  syncHiddenId(ui, layerInfo.id, !visible);

  syncToggleAll(ui, layerInfo.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY);
  ui.m.debouncedEnforce();
  return true;
};

const handleChange = (ui: LayerUI, event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.classList.contains(CONST.CLASSES.COLOR_INPUT)) {
    ui.deselectAllBaseMaps(-1);
    showColorLayer(ui, target.value);
    syncToggleAll(ui, CONST.GROUP.BASE);
    ui.m.enforceOrder();
    return;
  }
  if (target.tagName.toLowerCase() !== "input" || target.type !== "checkbox") return;

  const idx = parseInt(target.dataset.index ?? "", 10);
  if (isNaN(idx) || idx < 0 || idx >= ui.m.layers.length) return;
  applyVisibility(ui, ui.m.layers[idx].id, target.checked);
};

const handleInput = (ui: LayerUI, event: Event) => {
  if ((event.target as HTMLElement).classList.contains(CONST.CLASSES.COLOR_INPUT)) {
    showColorLayer(ui, (event.target as HTMLInputElement).value);
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
  applyVisibility,
  handleChange,
  handleInput,
};
