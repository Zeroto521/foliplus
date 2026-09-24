// LayerControl UI —Checkbox / group-toggle visibility.
import { type Debounced, debounce } from "#common/debounce.js";
import * as CONST from "../const.js";
import { applyProjection, applyProjectionAll } from "./apply.js";
import { hideColorLayer, showColorLayer } from "./color.js";
import type { LayerUI } from "./index.js";
import { applyRowView, buildRowCell, rowChecked } from "./rowView.js";
import { saveState, syncHiddenId } from "./state.js";

const getLayerItems = (ui: LayerUI, group: string): NodeListOf<Element> => {
  return ui.uiContainer.querySelectorAll(
    `${CONST.SEL.LAYER_ITEM}${group === CONST.GROUP.BASE ? `[data-layer-type="${CONST.GROUP.BASE}"]` : `:not([data-layer-type="${CONST.GROUP.BASE}"]):not(${CONST.SEL.COLOR_ITEM})`}`,
  );
};

/** A′ no-basemap hatch: paint on the map container and swap the group label
 *  to `no_base_map_label` when zero basemaps are visible. The hatch is CSS
 *  `background-image` on the Leaflet container, which ExportControl's
 *  resolveExportBackground deliberately skips (it reads only
 *  `backgroundColor`), so an empty state never reaches an export. */
const syncNoBasemap = (ui: LayerUI): void => {
  const anyBaseVisible = ui.m.layers.some(li => li.isBase && li.visible);
  ui.m.map.getContainer().classList.toggle(
    CONST.CLASSES.NO_BASE_MAP,
    !anyBaseVisible,
  );
  const label = ui.uiContainer.querySelector(
    `${CONST.SEL.TOGGLE_ALL}[data-group="${CONST.GROUP.BASE}"] ${CONST.SEL.SEP_LABEL}`,
  );
  if (label) {
    label.textContent = ui.T(
      anyBaseVisible ? "base_map_label" : "no_base_map_label",
    );
  }
};

const toggleAll = (ui: LayerUI, group: string, newState: boolean) => {
  const items = getLayerItems(ui, group);
  items.forEach((item: Element) => {
    const checkbox = item.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    if (!checkbox) return;
    // The row carries the identity (data-layer-id): a late registration lands
    // where its stored slot puts it, so the DOM order can diverge from the
    // registry and an index-based lookup would silently toggle a neighbour.
    const id = item.getAttribute(CONST.DATA.LAYER_ID);
    if (!id) return;
    const layerInfo = ui.m.layerRegistry.get(id);
    if (!layerInfo) return;

    // No persist per iteration —schedule a single debounced write after the
    // loop so the debounce timer isn't reset for every layer.
    syncHiddenId(ui, id, !newState, false);
    // The executor is the only writer of `layerInfo.visible` and the map's
    // membership for this layer: syncHiddenId recorded the intent, so the
    // projection's `visible` field now matches the intended state and the
    // diff fires whatever op is needed.
    applyProjection(ui, id);
    applyRowView(ui, item as HTMLElement, buildRowCell(ui, layerInfo));
  });

  // Persist the hidden-set after bulk toggle (single debounced write for the
  // batch).
  saveState(ui);

  syncToggleAll(ui, group);
  syncNoBasemap(ui);
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
  // Count intent, not the painted box: a row whose checkbox is painted from
  // a stale state must not skew the group state it is about to set.
  const checkedCount = Array.from(items).filter((item: Element) => {
    const id = item.getAttribute(CONST.DATA.LAYER_ID);
    const layerInfo = id ? ui.m.layerRegistry.get(id) : undefined;
    return layerInfo ? rowChecked(ui, layerInfo) : false;
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
 * The user's intent is recorded first, then the executor re-projects — the
 * single writer of `layerInfo.visible` and of map membership for this layer.
 * The old code wrote `visible` from two sites (here and the executor), which
 * is what this refactor wanted gone.
 *
 * @returns true if the layer id resolved to a registry entry.
 */
const applyVisibility = (ui: LayerUI, id: string, visible: boolean): boolean => {
  const layerInfo = ui.m.layerRegistry.get(id);
  if (!layerInfo) return false;
  const item = ui.uiContainer?.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`,
  ) as HTMLElement | null;

  syncHiddenId(ui, id, !visible);
  applyProjection(ui, id);

  // Paint last: the cell reads the intent this transition just recorded.
  if (item) applyRowView(ui, item, buildRowCell(ui, layerInfo));

  syncToggleAll(ui, layerInfo.isBase ? CONST.GROUP.BASE : CONST.GROUP.OVERLAY);
  syncNoBasemap(ui);
  ui.m.debouncedEnforce();

  // A basemap switch changes the map's min/max zoom without firing zoomend,
  // so re-evaluate effective shown across every layer and refresh the open
  // panel's row.
  if (layerInfo.isBase) {
    applyProjectionAll(ui);
    ui.styleZoomEndHandler?.();
  }

  return true;
};

const handleChange = (ui: LayerUI, event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.classList.contains(CONST.CLASSES.COLOR_INPUT)) {
    showColorLayer(ui, target.value);
    syncToggleAll(ui, CONST.GROUP.BASE);
    ui.m.enforceOrder();
    return;
  }
  if (target.tagName.toLowerCase() !== "input" || target.type !== "checkbox") return;

  // The row carries the identity: data-layer-id, not a positional index —a
  // late registration can sit anywhere in the DOM, so an index-based lookup
  // would apply the click to a neighbour's layer.
  const row = target.closest(CONST.SEL.LAYER_ITEM);
  const id = row?.getAttribute(CONST.DATA.LAYER_ID);
  if (!id) return;
  applyVisibility(ui, id, target.checked);
};

const handleInput = (ui: LayerUI, event: Event) => {
  if ((event.target as HTMLElement).classList.contains(CONST.CLASSES.COLOR_INPUT)) {
    showColorLayer(ui, (event.target as HTMLInputElement).value);
  }
};

export {
  getLayerItems,
  toggleAll,
  syncToggleAll,
  syncNoBasemap,
  applyVisibility,
  handleChange,
  handleInput,
};
