// LayerControl UI 鈥?Persisted user state (fold / hidden / names) apply + save.
import { type Debounced, debounce } from "#common/debounce.js";
import * as CONST from "../const.js";
import type { LayerUI } from "./index.js";
import { T } from "./context.js";
import { applyNameProjection } from "./context.js";

/** Load every persisted dimension in one call. */
const loadPersistedState = (ui: LayerUI) => {
  const state = ui.m.persistence.load();
  ui.foldedGroups = state.foldedGroups;
  ui.hiddenIds = state.hiddenIds;
  ui.renamedNames = state.names;
  ui.hiddenHasState = state.hiddenHasState;
};

/** Save fold state to localStorage. */

const saveFoldState = (ui: LayerUI) => {
  ui.m.persistence.saveFoldedGroups(ui.foldedGroups);
};

/** Save hidden-layer ids to localStorage, coalescing rapid calls. */

const saveHiddenIds = (ui: LayerUI) => {
  ui.m.persistence.saveHiddenIds(() => ui.hiddenIds);
};

/**
 * Propagate the user's stored state 鈥?hidden visibility and renames 鈥? * into the registry and the rendered rows.
 *
 * `hiddenIds` and `renamedNames` are the source of truth; the registry's
 * `LayerInfo.visible` / `LayerInfo.name` and the row checkboxes / labels
 * are their projections, refreshed here whenever a row or the registry is
 * rebuilt from a third-party layer's own metadata. Hidden is a same-axis
 * overwrite of `visible`, so it writes straight through; name is a
 * cross-axis projection that must preserve the author's original name, so
 * it goes through `applyNameProjection`, which writes only where the
 * projection still differs 鈥?a repeated pass is therefore a no-op.
 *
 * The sweep also prunes ids whose layers no longer exist so stale
 * persistence doesn't accumulate.
 *
 * @param {string} [id] Restrict to one layer id 鈥?a late-arriving row is
 *   already rendered with the right label, so it only needs its registry
 *   projection; a full sweep would re-rewrite every renamed row for no
 *   gain. Both projections are membership-guarded on this path: the drain
 *   runs for every late registration, so an unhidden layer must not be
 *   hidden and a missing rename must not write undefined.
 */

const applyUserState = (ui: LayerUI, id?: string) => {
  const registry = ui.m.layerRegistry;
  const container = ui.uiContainer;

  if (id) {
    const layerInfo = registry.get(id);
    if (!layerInfo) return; // stale id 鈥?pruned by persistence on save
    // Both projections are membership-guarded 鈥?this path runs for every
    // late registration, including layers the user never touched. A layer
    // that was never hidden must not be hidden, and a missing rename is a
    // no-op rather than a write of undefined over the registry's own name.
    if (ui.hiddenIds.has(id)) ui.applyHiddenStateOne(layerInfo);
    if (id in ui.renamedNames) {
      applyNameProjection(layerInfo, null, ui.renamedNames[id]);
    }
    return;
  }

  // The registry is the sweep, not `hiddenIds`: a layer the user left
  // visible is absent from `hiddenIds` by design, so iterating that set
  // alone can never reach it and the hide half of the round trip has no
  // inverse. Walking the registry asserts every layer's map membership
  // against the persisted intent; the color basemap has no registry entry,
  // so its rename still comes from `renamedNames`.
  const ids = new Set([
    ...ui.m.layers.map(li => li.id),
    ...ui.hiddenIds,
    ...Object.keys(ui.renamedNames),
  ]);
  for (const layerId of ids) {
    if (layerId in ui.renamedNames) {
      if (layerId === CONST.COLOR.MAP_ID) {
        // The color basemap has no registry entry 鈥?only its row label.
        applyNameProjection(
          null,
          container?.querySelector(
            `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
          ) as HTMLElement | null,
          ui.renamedNames[layerId],
        );
        continue;
      }
      const layerInfo = registry.get(layerId);
      if (!layerInfo) continue; // stale id 鈥?pruned by persistence on save
      applyNameProjection(
        layerInfo,
        container?.querySelector(
          `[${CONST.DATA.LAYER_ID}="${CSS.escape(layerId)}"]`,
        ) as HTMLElement | null,
        ui.renamedNames[layerId],
      );
    }
    const layerInfo = registry.get(layerId);
    if (!layerInfo) continue; // stale id 鈥?pruned by persistence on save
    if (ui.hiddenIds.has(layerId)) ui.applyHiddenOne(layerInfo, layerId);
    else if (ui.hiddenHasState) ui.applyVisibleStateOne(layerInfo);
  }

  // Prune ids whose layers are gone for good, so stale persistence does not
  // accumulate. Live means "in the registry or still queued in
  // pendingRegistrations" 鈥?attachUI drains that queue before this sweep, so
  // neither implies a layer that will come back. The cost is a third-party
  // layer hidden and re-registered on a later activation: it re-enters
  // visible rather than coming back hidden. Keeping such ids would make the
  // prune a no-op and let the set grow without bound.
  //
  // Persisted, because only the live ids are written back: the write can
  // never drop an id that still resolves to a layer, so nothing is lost even
  // though this runs before initLayerItem has corrected any checkbox.
  const pending = new Set(ui.m.pendingRegistrations.map(li => li.id));
  const stillPresent = (layerId: string) =>
    registry.get(layerId) != null || pending.has(layerId);
  const gone = [...ui.hiddenIds].filter(layerId => !stillPresent(layerId));
  if (gone.length > 0) {
    ui.hiddenIds = new Set([...ui.hiddenIds].filter(layerId => stillPresent(layerId)));
    ui.hiddenHasState = true;
    ui.saveHiddenIds();
  }
};

/**
 * Apply one hidden id: remove the layer from the map, fire the toggle
 * callback (so callback-only canvas/heatmap layers hide themselves), and
 * sync the row's checkbox and tooltip.
 */

const applyHiddenOne = (ui: LayerUI, layerInfo: LayerInfo, id: string) => {
  const container = ui.uiContainer;
  const item = container
    ? container.querySelector(`[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`)
    : null;
  const checkbox = item?.querySelector(
    'input[type="checkbox"]',
  ) as HTMLInputElement | null;

  ui.applyHiddenStateOne(layerInfo);

  if (checkbox) {
    checkbox.checked = false;
    checkbox.title = T("select_tooltip");
  }
  item?.classList.remove(CONST.CLASSES.ACTIVE);
};

/**
 * Hide one layer without touching its row 鈥?the map removal, the callback
 * for canvas-only layers, and the registry's `visible` flag.
 *
 * Split from {@link LayerUI.applyHiddenOne} because the registry projection
 * must run before the row is rendered: a late registration gets its
 * projection via {@link LayerUI.applyUserState}(id) before its row lands in
 * the DOM, so a callback-only layer hidden that way would otherwise stay
 * "visible" until the next full sweep and re-enter the map.
 */

const applyHiddenStateOne = (ui: LayerUI, layerInfo: LayerInfo) => {
  const layer = ui.m.findLayer(layerInfo);

  // Callback-only layers (canvas) have no Leaflet layer to remove 鈥?fire
  // the toggle callback so the canvas itself hides.
  if (!layer && layerInfo.onToggle) layerInfo.onToggle(false);
  else if (layer && ui.m.map.hasLayer(layer)) ui.m.map.removeLayer(layer);

  layerInfo.visible = false;
};

/**
 * Bring one layer back on to the map 鈥?the inverse of
 * {@link LayerUI.applyHiddenStateOne}.
 *
 * Needed because folium renders a `show=False` layer absent from the map
 * and nothing else ever puts it back. On reload such a layer is correctly
 * *absent* from `hiddenIds` (the user did not hide it), so the hide sweep
 * leaves it alone 鈥?and the map comes up with the author's default rather
 * than the user's last choice. This closes that half of the round trip.
 *
 * `addLayer` is a no-op when the layer is already on the map, so the sweep
 * can call this for every unhidden layer without re-adding the layers
 * folium already placed. Callback-only layers (canvas) have no Leaflet
 * layer to add, so they get the callback instead.
 */

const applyVisibleStateOne = (ui: LayerUI, layerInfo: LayerInfo) => {
  const layer = ui.m.findLayer(layerInfo);

  if (!layer && layerInfo.onToggle) layerInfo.onToggle(true);
  else if (layer && !ui.m.map.hasLayer(layer)) ui.m.map.addLayer(layer);

  layerInfo.visible = true;
};

/**
 * Rebuild {@link LayerUI.hiddenIds} from the rendered rows, making the set
 * absolute instead of "ids the user toggled".
 *
 * A layer the author declared `show=False` is off the map and absent from
 * `hiddenIds`, so checking it on calls `hiddenIds.delete(id)` on an id that
 * was never added and leaves the set unchanged. Every subsequent toggle then
 * differs from the author's defaults by zero entries, so the saved set cannot
 * distinguish "user hid this" from "author hid this" and a reload restores the
 * author's `show=False` instead of the user's choice. Reading the rows closes
 * that gap.
 *
 * Runs once, straight after the first
 * {@link LayerUI.initTypesAndVisibility} pass has corrected every checkbox
 * from `map.hasLayer()`. That pass repeats on fold-toggle, and only ids
 * already in the registry are considered, so the set never acquires a stale
 * id and no later pass writes again.
 *
 * It writes only when the set actually changed. On an unchanged load -- the
 * common case, where the user comes back and sees the author's defaults -- a
 * write would replace a previously saved set with the current one, which
 * still holds ids this map no longer registers. Those ids had been pruned
 * before the rows rendered, so this would be a write that drops saved state
 * the user made. Skipping keeps the load read-only.
 */

const reconcileHiddenIds = (ui: LayerUI) => {
  const container = ui.uiContainer;
  if (!container) return;

  // Additions only. A row can read as checked while its id sits in hiddenIds
  // -- initLayerItem derives the checkbox from map.hasLayer(), so any map
  // that still reports membership (stale state, a stub in tests) makes the
  // row disagree with the set applyUserState() just built. Deleting here
  // would then discard state the user persisted, so the disagreement is
  // trusted in one direction only. Removal belongs to the change paths, where
  // a user actually acted: handleChange, syncAllChecked, deselectAllBaseMaps.
  let changed = false;
  for (const li of ui.m.layers) {
    const item = container.querySelector(
      `[${CONST.DATA.LAYER_ID}="${CSS.escape(li.id)}"]`,
    ) as HTMLElement | null;
    const checkbox = item?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    if (!checkbox || checkbox.checked || ui.hiddenIds.has(li.id)) continue;
    ui.hiddenIds.add(li.id);
    changed = true;
  }
  if (changed) {
    ui.hiddenHasState = true;
    ui.saveHiddenIds();
  }
};

/** Save user-assigned names, coalescing rapid calls. */

const saveNamesState = (ui: LayerUI) => {
  ui.m.persistence.saveNames(() => ui.renamedNames);
};

/** Full re-scan of every row (used on attach/fold-toggle). Idempotent 鈥? *  re-run on each CONTROL_ATTACHED so late-registering components are
 *  folded in. Marks the panel ready for tests/consumers. */

/**
 * Update the persisted hidden set for a layer toggle.
 * @param {boolean} persist - When false (bulk updates like toggleAll), the
 *   caller schedules a single save after the loop instead of resetting the
 *   debounce timer for every layer.
 */
const syncHiddenId = ( ui: LayerUI, id: string, hidden: boolean, persist: boolean = true, ) => {
  if (hidden) ui.hiddenIds.add(id);
  else ui.hiddenIds.delete(id);
  // The first change is what turns author defaults into the user's state.
  // Until it has happened the visibility key does not exist, so the unhide
  // half of the sweep must stay off or an empty saved set would override the
  // author's `show=False` on the next load.
  ui.hiddenHasState = true;
  if (persist) ui.saveHiddenIds();
};

/** Get all keyboard-navigable rows: layer items and toggle-all rows, in DOM
 *  order. The color item is excluded (it is a picker, not a layer).
 *
 *  Enumerates the row elements themselves, not their checkboxes. The old
 *  checkbox-first traversal silently dropped any row without a checkbox, so
 *  arrow-key navigation and Tab order could disagree about which rows exist.
 *  Rows are selected by class rather than `[tabindex]` because the inline
 *  rename input is also `tabindex=0` and is not a navigable row. */

export {
  loadPersistedState,
  saveFoldState,
  saveHiddenIds,
  applyUserState,
  applyHiddenOne,
  applyHiddenStateOne,
  applyVisibleStateOne,
  reconcileHiddenIds,
  saveNamesState,
  syncHiddenId,
};
