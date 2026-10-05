// LayerControl UI — Checkbox / group-toggle visibility.
import { GROUP } from "#core/layer/index.js";
import * as CONST from "../const.js";
import { applyProjection, applyProjectionAll } from "./apply.js";
import type { LayerUI } from "./index.js";
import { intentVisibleOf } from "./projection.js";
import { applyRowView, buildRowCell } from "./rowView.js";
import { saveState, setVisible } from "./state.js";

const getLayerItems = (ui: LayerUI, group: string): NodeListOf<Element> => {
  return ui.uiContainer.querySelectorAll(
    `${CONST.SEL.LAYER_ITEM}${group === GROUP.BASE ? `[data-layer-type="${GROUP.BASE}"]` : `:not([data-layer-type="${GROUP.BASE}"])`}`,
  );
};

/** A′ no-basemap hatch: paint on the map container and swap the group label
 *  to `no_base_map_label` when zero basemaps are visible. The hatch is CSS
 *  `background-image` on the Leaflet container, which ExportControl's
 *  resolveExportBackground deliberately skips (it reads only
 *  `backgroundColor`), so an empty state never reaches an export. */
const syncNoBasemap = (ui: LayerUI): void => {
  const anyBaseVisible = ui.m.layers.some(li => {
    if (li.group !== GROUP.BASE) return false;
    if (!intentVisibleOf(ui, li.id)) return false;
    // Effective visibility: intent alone isn't enough — a basemap with
    // `opacity = 0` is visually empty too, so the hatch should still show.
    // `li.opacity` is written by the executor on every opacity change and
    // is undefined until the first write (freshly registered layers), so
    // `?? 1` treats "no override yet" as fully opaque.
    return (li.opacity ?? 1) > 0;
  });
  ui.m.map.getContainer().classList.toggle(CONST.CLASSES.NO_BASE_MAP, !anyBaseVisible);
  const label = ui.uiContainer.querySelector(
    `${CONST.SEL.TOGGLE_ALL}[data-group="${GROUP.BASE}"] ${CONST.SEL.SEPARATOR_LABEL}`,
  );
  if (label) {
    label.textContent = ui.T(anyBaseVisible ? "base_map_label" : "no_base_map_label");
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
    // registry and an index-based lookup would silently toggle a neighbor.
    const id = item.getAttribute(CONST.DATA.LAYER_ID);
    if (!id) return;
    const layerInfo = ui.m.layerRegistry.get(id);
    if (!layerInfo) return;

    // No persist per iteration — schedule a single debounced write after the
    // loop so the debounce timer isn't reset for every layer.
    setVisible(ui, id, newState, false);
    // The executor is the only writer of map membership for this layer:
    // setVisible recorded the intent, so the projection's `visible` field
    // now matches the intended state and the diff fires whatever op is
    // needed.
    applyProjection(ui, id);
    applyRowView(ui, item as HTMLElement, buildRowCell(ui, layerInfo));
  });

  // Persist the hidden-set after bulk toggle (single debounced write for the
  // batch).
  saveState(ui);

  // Reconcile the group's count from intent: every row's intent was just
  // rewritten, so a full scan is correct and cheap here (batch operation).
  syncToggleAll(ui, group);
  syncNoBasemap(ui);
  ui.m.debouncedEnforce();
};

/** Full rescan that populates `ui.checkedCount[group]` from the DOM + intent,
 *  then writes the toggle-all checkbox off the fresh count. Called only at
 *  reconcile points (attach, insert, delete, reload, bulk toggleAll) — the
 *  single-row click path uses `bumpCheckedCount` + `syncToggleAllFromCount`
 *  to keep the update O(1). */
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
  let total = 0;
  let on = 0;
  // Count intent, not the painted box: a row whose checkbox is painted from
  // a stale state must not skew the group state it is about to set.
  for (const item of Array.from(items)) {
    total++;
    const id = item.getAttribute(CONST.DATA.LAYER_ID);
    if (!id) continue;
    const layerInfo = ui.m.layerRegistry.get(id);
    if (!layerInfo) continue;
    if (intentVisibleOf(ui, id)) on++;
  }
  // Tolerate a caller that constructs a thin LayerUI stub without
  // initializing the counter map (tests, late-attached panels).
  ui.checkedCount ??= {};
  ui.checkedCount[group] = { total, on };
  writeToggleAllCheckbox(ui, allCb, group);
};

/** Write the toggle-all checkbox straight from the cached `checkedCount`.
 *  O(1) — no querySelectorAll scan. Called by `bumpCheckedCount` on the
 *  single-row click path so the tri-state is fresh in the same frame. */
const syncToggleAllFromCount = (ui: LayerUI, group: string): void => {
  const row = ui.uiContainer.querySelector(
    `${CONST.SEL.TOGGLE_ALL}[data-group="${group}"]`,
  );
  if (!row) return;
  const allCb = row.querySelector(
    '[data-role="toggle-all"]',
  ) as HTMLInputElement | null;
  if (!allCb) return;
  writeToggleAllCheckbox(ui, allCb, group);
};

const writeToggleAllCheckbox = (
  ui: LayerUI,
  allCb: HTMLInputElement,
  group: string,
): void => {
  const c = ui.checkedCount?.[group] ?? { total: 0, on: 0 };
  const allChecked = c.total > 0 && c.on === c.total;
  const noneChecked = c.on === 0;
  allCb.checked = allChecked;
  allCb.indeterminate = !allChecked && !noneChecked;
  allCb.title = ui.T(
    allChecked || allCb.indeterminate
      ? "toggle_all_deselect_tooltip"
      : "toggle_all_select_tooltip",
  );
};

/** Incrementally update the group's `checkedCount.on` by `delta` (typically
 *  +1 or -1 for a single-row toggle), then refresh the toggle-all checkbox
 *  off the fresh count. O(1) per call — the hot path `applyVisibility`
 *  uses this instead of the full rescan.
 *
 *  If the counter is not yet populated (first access before the attach-time
 *  `initTypesAndVisibility` has fired its setTimeout(0)), fall back to a
 *  full `syncToggleAll` rescan: the rescan reads the current intent, which
 *  already reflects the transition this caller just recorded, so no delta
 *  needs applying. After the first reconcile the counter is populated and
 *  every later call is O(1). */
const bumpCheckedCount = (ui: LayerUI, group: string, delta: number): void => {
  if (!ui.checkedCount?.[group]) {
    syncToggleAll(ui, group);
    return;
  }
  const c = ui.checkedCount[group];
  c.on += delta;
  syncToggleAllFromCount(ui, group);
};

/**
 * Apply one layer's visibility, source-agnostic.
 *
 * The panel checkbox has always driven this transition, and that was the only
 * path — there was no way to hide a layer by id from outside the DOM. This
 * takes the same transition on either source (a change event or
 * {@link LayerUI.setVisible}): map membership, the canvas-only callback, the
 * `visible` flag, the row's checkbox + tooltip + active class, the persisted
 * hidden intent, the group toggle-all, and the debounced z-order enforcement.
 *
 * The user's intent is recorded first, then the executor re-projects — the
 * single writer of map membership for this layer. The old code wrote the
 * mirror flag from two sites (here and the executor), which is what this
 * refactor wanted gone.
 *
 * The tri-state counter is updated incrementally (O(1)) rather than by a
 * full rescan: the rescan is the reconcile path (attach, insert, delete,
 * reload, bulk toggleAll), so a single-row click does not walk every row in
 * the group.
 *
 * `syncNoBasemap` only reads `group === GROUP.BASE && intent`; an overlay toggle cannot
 * change the visible-basemap count, so this path skips it for overlays and
 * only calls it for base rows where the hatch and the group label are the
 * user-visible output.
 *
 * @returns true if the layer id resolved to a registry entry.
 */
const applyVisibility = (ui: LayerUI, id: string, visible: boolean): boolean => {
  const layerInfo = ui.m.layerRegistry.get(id);
  if (!layerInfo) return false;
  const item = ui.uiContainer?.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`,
  ) as HTMLElement | null;

  const oldChecked = intentVisibleOf(ui, id);
  setVisible(ui, id, visible);
  applyProjection(ui, id);

  // Paint last: the cell reads the intent this transition just recorded.
  if (item) applyRowView(ui, item, buildRowCell(ui, layerInfo));

  // Incremental tri-state: O(1) count update rather than a full rescan.
  const newChecked = intentVisibleOf(ui, id);
  const group = layerInfo.group;
  const delta = newChecked === oldChecked ? 0 : newChecked ? 1 : -1;
  bumpCheckedCount(ui, group, delta);

  // Overlay toggles cannot change the visible-basemap count (syncNoBasemap
  // only reads `group === GROUP.BASE`), so skip for overlay: the call was pure O(n) waste
  // on the click hot path. Base toggles still call it synchronously — the
  // hatch and the group label are user-visible, cannot be deferred.
  if (layerInfo.group === GROUP.BASE) syncNoBasemap(ui);

  ui.m.debouncedEnforce();

  // A basemap switch changes the map's min/max zoom without firing zoomend,
  // so re-evaluate effective shown across every layer and refresh the open
  // panel's row.
  if (layerInfo.group === GROUP.BASE) {
    applyProjectionAll(ui);
    ui.styleZoomEndHandler?.();
  }

  return true;
};

const handleChange = (ui: LayerUI, event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.tagName.toLowerCase() !== "input" || target.type !== "checkbox") return;

  // The row carries the identity: data-layer-id, not a positional index — a
  // late registration can sit anywhere in the DOM, so an index-based lookup
  // would apply the click to a neighbor's layer.
  const row = target.closest(CONST.SEL.LAYER_ITEM);
  const id = row?.getAttribute(CONST.DATA.LAYER_ID);
  if (!id) return;
  applyVisibility(ui, id, target.checked);
};

const handleInput = () => {};

export {
  getLayerItems,
  toggleAll,
  syncToggleAll,
  syncToggleAllFromCount,
  bumpCheckedCount,
  syncNoBasemap,
  applyVisibility,
  handleChange,
  handleInput,
};
