// LayerControl UI — Checkbox / role-toggle visibility.
import {
  type ProjectionBatch,
  type ProjectionDelta,
  type ProjectionDeltaItem,
  applyProjection,
  applyProjectionAll,
  notifyDeltas,
} from "../apply.js";
import { currentOpacity, intentVisibleOf } from "../projection.js";
import { saveState, setVisibleIntent } from "../state.js";
import type { LayerUI } from "../surface.js";
import {
  applyRowView,
  buildRowCell,
  countTooltip,
  writeRoleCount,
  writeTriState,
} from "./rowView.js";
import { ROLE, folderOf, paintsAtZoom } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";

/** The rows of one role, in DOM order. A panel that is gone has none — the
 *  callers are all reconcile paths that run at least once against a torn-down
 *  control (a timer, a queued bulk toggle). */
/** The one rule a group checkbox follows: a press selects every member only
 *  when none is selected; any partial or full selection is cleared. The role
 *  header and the folder header both read it, so an indeterminate box cannot
 *  mean "complete the selection" on one row and "clear it" on the other. */
const toggleTarget = (on: number): boolean => on === 0;

const getLayerItems = (ui: LayerUI, role: string): Element[] => {
  const container = ui.uiContainer;
  if (!container) return [];
  const inGroup =
    role === ROLE.BASE
      ? `[data-layer-type="${ROLE.BASE}"]`
      : `:not([data-layer-type="${ROLE.BASE}"])`;
  // Folder rows and role rows carry .foliplus-layer-item too (per spec §1.2)
  // but are group rows, not leaf layers — LEAF_ITEM excludes both so a role
  // count never counts a group as a layer.
  return Array.from(container.querySelectorAll(`${CONST.SEL.LEAF_ITEM}${inGroup}`));
};

/** Whether a base layer actually paints right now: on the map, inside its own
 *  zoom range, and not fully transparent. This is the observation the
 *  consumers asking "which basemap is on screen?" share — hatch, attribution
 *  and focus each used to assemble a different subset of these four facts. */
const basePaints = (ui: LayerUI, layerInfo: LayerInfo): boolean =>
  paintsAtZoom(ui.c.map, layerInfo.layer ?? ui.c.findLayer(layerInfo)) &&
  currentOpacity(ui, layerInfo) > 0;

/** A′ no-basemap hatch: paint on the map container and swap the role label
 *  to `no_base_map_label` when zero basemaps are visible. The hatch is CSS
 *  `background-image` on the Leaflet container, which ExportControl's
 *  resolveExportBackground deliberately skips (it reads only
 *  `backgroundColor`), so an empty state never reaches an export.
 *
 *  The judge is the paint observation, not the intent flag: a basemap can be
 *  "checked" yet absent from the screen (outside its own `minZoom/maxZoom`,
 *  off the map, or dragged to opacity 0). `intentVisibleOf` alone would name
 *  such a layer visible and keep the hatch off a container that is really
 *  empty. */
const syncNoBasemap = (ui: LayerUI): void => {
  const anyBaseVisible = ui.c.layers.some(
    li => li.role === ROLE.BASE && basePaints(ui, li),
  );
  ui.c.map.getContainer().classList.toggle(CONST.CLASSES.NO_BASE_MAP, !anyBaseVisible);
  // The label lives on the panel, which may not be attached yet when the
  // projection sweep calls this (attachUI wires the container first, but
  // thin stubs and teardown states have none) — the hatch is the contract,
  // the label is a cosmetic companion.
  const label = ui.uiContainer?.querySelector(
    `${CONST.SEL.TOGGLE_ALL}[data-role="${ROLE.BASE}"] ${CONST.SEL.SEPARATOR_LABEL}`,
  );
  if (label) {
    label.textContent = ui.T(anyBaseVisible ? "base_map_label" : "no_base_map_label");
  }
};

const toggleAll = (ui: LayerUI, role: string, newState: boolean) => {
  const items = getLayerItems(ui, role);
  const moved = new Map<string, ProjectionDelta>();
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
    const layerInfo = ui.c.layerRegistry.get(id);
    if (!layerInfo) return;

    // No persist per iteration — schedule a single debounced write after the
    // loop so the debounce timer isn't reset for every layer.
    setVisibleIntent(ui, id, newState, false);
    // The executor is the only writer of map membership for this layer:
    // setVisibleIntent recorded the intent, so the projection's `visible` field
    // now matches the intended state and the diff fires whatever op is
    // needed.
    const delta = applyProjection(ui, id);
    if (delta.wroteVisible || delta.intentMoved) moved.set(id, delta);
    applyRowView(ui, item as HTMLElement, buildRowCell(ui, layerInfo));
  });

  // Persist the hidden-set after bulk toggle (single debounced write for the
  // batch).
  saveState(ui);

  // Reconcile the role's count from intent: every row's intent was just
  // rewritten, so a full scan is correct and cheap here (batch operation).
  syncToggleAll(ui, role);
  syncNoBasemap(ui);
  ui.c.debouncedEnforce();

  // Announce last, in registry order: the loop above walked the DOM, which can
  // diverge from the registry on a late registration, and a subscriber that
  // re-enters during this notify must see the finished count and hatch.
  //
  // Order by walking the registry against the Map, not by sorting — a
  // comparator needs an `indexOf` per call and that is a linear identity scan
  // of the registry, so sorting pays a full scan for every comparison. The
  // entry travels with the delta: `notifyDeltas` re-checks the live registry at
  // delivery, so a layer a subscriber unregistered — or re-registered under the
  // same id — inside an earlier delivery here is not announced on behalf of
  // the entry that now holds that id.
  const announced: ProjectionDeltaItem[] = [];
  for (const layerInfo of ui.c.layers) {
    const delta = moved.get(layerInfo.id);
    if (delta) announced.push({ id: layerInfo.id, delta, entry: layerInfo });
  }
  notifyDeltas(ui, announced);
};

/** Repaint each folder header of one role from its own aggregate: the
 *  tri-state checkbox and the count cell. The folder row is a group row like
 *  the role header, so it reconciles on the same cadence — a member toggled
 *  from anywhere (its own checkbox, the folder checkbox, the role checkbox, a
 *  host `setVisible`) leaves both group rows agreeing with the members. */
const syncFolderRows = (ui: LayerUI, role: string): void => {
  const container = ui.uiContainer;
  if (!container) return;
  const rows = container.querySelectorAll(
    `${CONST.SEL.FOLDER_ROW}[data-role="${role}"]`,
  );
  for (const row of Array.from(rows)) {
    const folderKey = row.getAttribute(CONST.DATA.FOLDER_KEY);
    if (!folderKey) continue;
    const vis = folderVisibility(ui, role, folderKey);
    const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (box) writeTriState(box, vis.total, vis.on);
    row.classList.toggle(CONST.CLASSES.ACTIVE, vis.on > 0);
    writeRoleCount(row, vis.total, vis.on);
  }
};

/** Repaint every group row of one role — the role header and each folder
 *  header — from its own visibility aggregate. One pass, one source: a group
 *  row's checkbox and its count always come from the same aggregate, and a
 *  reconcile point never has to remember which group rows exist. Called only
 *  at reconcile points (attach, insert, delete, reload, bulk toggleAll) — the
 *  single-row click path uses `bumpCheckedCount` + `syncToggleAllFromCount`
 *  to keep the update O(1). */
const syncToggleAll = (ui: LayerUI, role: string) => {
  const row = ui.uiContainer?.querySelector(
    `${CONST.SEL.TOGGLE_ALL}[data-role="${role}"]`,
  );
  if (!row) return;
  const allCb = row.querySelector(
    `[data-role="${CONST.TOGGLE_ALL_ROLE}"]`,
  ) as HTMLInputElement | null;
  if (!allCb) return;
  const items = getLayerItems(ui, role);
  let total = 0;
  let on = 0;
  // Count intent, not the painted box: a row whose checkbox is painted from
  // a stale state must not skew the role state it is about to set.
  for (const item of Array.from(items)) {
    total++;
    const id = item.getAttribute(CONST.DATA.LAYER_ID);
    if (!id) continue;
    const layerInfo = ui.c.layerRegistry.get(id);
    if (!layerInfo) continue;
    if (intentVisibleOf(ui, id)) on++;
  }
  // Tolerate a caller that constructs a thin LayerUI stub without
  // initializing the counter map (tests, late-attached panels).
  ui.listPanel.checkedCount ??= {};
  ui.listPanel.checkedCount[role] = { total, on };
  writeToggleAllCheckbox(ui, allCb, role);
};

/** Write the toggle-all checkbox straight from the cached `checkedCount`.
 *  O(1) — no querySelectorAll scan. Called by `bumpCheckedCount` on the
 *  single-row click path so the tri-state is fresh in the same frame. */
const syncToggleAllFromCount = (ui: LayerUI, role: string): void => {
  const row = ui.uiContainer?.querySelector(
    `${CONST.SEL.TOGGLE_ALL}[data-role="${role}"]`,
  );
  if (!row) return;
  const allCb = row.querySelector(
    `[data-role="${CONST.TOGGLE_ALL_ROLE}"]`,
  ) as HTMLInputElement | null;
  if (!allCb) return;
  writeToggleAllCheckbox(ui, allCb, role);
};

const writeToggleAllCheckbox = (
  ui: LayerUI,
  allCb: HTMLInputElement,
  role: string,
): void => {
  const c = ui.listPanel.checkedCount?.[role] ?? { total: 0, on: 0 };
  // One tri-state writer for every group row: the role header and the folder
  // headers paint checked / indeterminate / aria-checked from the same rule.
  writeTriState(allCb, c.total, c.on);
  allCb.title = ui.T(
    allCb.checked || allCb.indeterminate
      ? "toggle_all_deselect_tooltip"
      : "toggle_all_select_tooltip",
  );
  // The count column is the row's other half of the same aggregate. It used
  // to be written once by the initial render and never again, so a layer
  // registered after that render (the solid basemap registers in the
  // initTypesAndVisibility pass, one tick later) left the count stale —
  // "3" beside four rows. Writing it here keeps it on the same source and
  // the same cadence as the checkbox.
  const row =
    allCb.closest(CONST.SEL.TOGGLE_ALL_ROW) ?? allCb.closest(CONST.SEL.TOGGLE_ALL);
  // The icon wake follows the same aggregate as the checkbox and the count.
  row?.classList.toggle(CONST.CLASSES.ACTIVE, c.on > 0);
  if (row) {
    writeRoleCount(
      row,
      c.total,
      c.on,
      countTooltip(ui, "layers_count_tooltip", c.on, c.total),
    );
  }
  // Every group row of the role repaints on the same cadence: both the O(1)
  // click path and the full rescan funnel through here, so a folder header can
  // never lag the role header it sits under.
  syncFolderRows(ui, role);
};

/** Incrementally update the role's `checkedCount.on` by `delta` (typically
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
const bumpCheckedCount = (ui: LayerUI, role: string, delta: number): void => {
  if (!ui.listPanel.checkedCount?.[role]) {
    syncToggleAll(ui, role);
    return;
  }
  const c = ui.listPanel.checkedCount[role];
  c.on += delta;
  syncToggleAllFromCount(ui, role);
};

/**
 * Apply one layer's visibility, source-agnostic.
 *
 * The panel checkbox has always driven this transition, and that was the only
 * path — there was no way to hide a layer by id from outside the DOM. This
 * takes the same transition on either source (a change event or
 * {@link LayerUI.setVisibleIntent}): map membership, the canvas-only callback, the
 * `visible` flag, the row's checkbox + tooltip + active class, the persisted
 * hidden intent, the role toggle-all, and the debounced z-order enforcement.
 *
 * The user's intent is recorded first, then the executor re-projects — the
 * single writer of map membership for this layer. The old code wrote the
 * mirror flag from two sites (here and the executor), which is what this
 * refactor wanted gone.
 *
 * The tri-state counter is updated incrementally (O(1)) rather than by a
 * full rescan: the rescan is the reconcile path (attach, insert, delete,
 * reload, bulk toggleAll), so a single-row click does not walk every row in
 * the role.
 *
 * `syncNoBasemap` only reads base rows through `basePaints` (paint
 * observation); an overlay toggle cannot change that count, so this path
 * skips it for overlays and only calls it for base rows where the hatch
 * and the role label are the user-visible output.
 *
 * @returns true if the layer id resolved to a registry entry.
 */
const applyVisibility = (ui: LayerUI, id: string, visible: boolean): boolean => {
  const layerInfo = ui.c.layerRegistry.get(id);
  if (!layerInfo) return false;
  const item = ui.uiContainer?.querySelector(
    `[${CONST.DATA.LAYER_ID}="${CSS.escape(id)}"]`,
  ) as HTMLElement | null;

  const oldChecked = intentVisibleOf(ui, id);
  setVisibleIntent(ui, id, visible);
  const ownDelta = applyProjection(ui, id);

  // Paint after the projection lands: the cell reads the intent this
  // transition just recorded.
  if (item) applyRowView(ui, item, buildRowCell(ui, layerInfo));

  // Incremental tri-state: O(1) count update rather than a full rescan.
  const newChecked = intentVisibleOf(ui, id);
  const role = layerInfo.role;
  const delta = newChecked === oldChecked ? 0 : newChecked ? 1 : -1;
  bumpCheckedCount(ui, role, delta);

  // Overlay toggles cannot change the visible-basemap count (syncNoBasemap
  // only reads `role === ROLE.BASE`), so skip for overlay: the call was pure O(n) waste
  // on the click hot path. Base toggles still call it synchronously — the
  // hatch and the role label are user-visible, cannot be deferred.
  if (layerInfo.role === ROLE.BASE) syncNoBasemap(ui);

  // Base check/uncheck changes the attribution table immediately: Leaflet's
  // layeradd/layerremove fires addAttribution/removeAttribution synchronously,
  // so a debounced syncAttribution would let the intermediate state (both
  // bases' attrs, or a lingering removed base's attr) render for ~50ms — a
  // visible flicker. Sync the attribution table right after the check state
  // is updated, before debouncedEnforce re-prices z-order.
  if (layerInfo.role === ROLE.BASE) ui.c.syncAttribution();

  ui.c.debouncedEnforce();

  // A basemap switch changes the map's min/max zoom without firing zoomend,
  // so re-evaluate effective shown across every layer and refresh the open
  // panel's row.
  let swept: ProjectionBatch = [];
  if (layerInfo.role === ROLE.BASE) {
    swept = applyProjectionAll(ui);
    ui.overlayPanel.styleZoomEndHandler?.();
  }

  // Announce last — the row paint, the tri-state count, the basemap hatch and
  // the attribution table are all settled, so a subscriber that re-enters here
  // sees the finished panel. The own-layer delta goes out before the sweep's:
  // it is the layer the user acted on, and the sweep's own entry for it is
  // empty (the first pass above already wrote its baseline). One operation, not
  // two calls: a consumer that throws on the own layer must not strand the
  // sweep's layers, whose baselines are already committed and would never
  // announce again on a retry.
  notifyDeltas(ui, [{ id: layerInfo.id, delta: ownDelta, entry: layerInfo }, ...swept]);

  return true;
};

/** The visibility aggregate of one folder: `{ total, on }` across its live
 *  members in `role`. The folder row's checkbox and count are both driven by
 *  this single aggregate (spec §1.2/§4.7), so a role count and a folder
 *  count can never disagree about a member. */
const folderVisibility = (
  ui: LayerUI,
  role: string,
  folderKey: string,
): { total: number; on: number } => {
  const layout = ui.c.folderLayoutView;
  let total = 0;
  let on = 0;
  for (const info of ui.c.layerRegistry.items) {
    if (info.role !== role) continue;
    if (folderOf(layout, info) !== folderKey) continue;
    total += 1;
    if (intentVisibleOf(ui, info.id)) on += 1;
  }
  return { total, on };
};

/** Set every live member of one folder visible/hidden. One write per layer
 *  (persist=false) then one save + rebuild, mirroring toggleAll's bulk path. */
const setFolderVisible = (
  ui: LayerUI,
  role: string,
  folderKey: string,
  visible: boolean,
): void => {
  for (const info of ui.c.layerRegistry.items) {
    if (info.role !== role) continue;
    if (folderOf(ui.c.folderLayoutView, info) !== folderKey) continue;
    setVisibleIntent(ui, info.id, visible, false);
  }
  saveState(ui);
  ui.reindexAfterMove();
};

const handleChange = (ui: LayerUI, event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.tagName.toLowerCase() !== "input" || target.type !== "checkbox") return;
  // A folder row's checkbox is a group toggle for every member: the folder
  // row has no data-layer-id (it is a group row, not a leaf), so the layer
  // change path below would no-op. Climb to the folder row by its key.
  const folderRow = target.closest(CONST.SEL.FOLDER_ROW) as HTMLElement | null;
  if (folderRow) {
    const fk = folderRow.getAttribute(CONST.DATA.FOLDER_KEY);
    const role = folderRow.getAttribute(CONST.DATA.ROLE) ?? "";
    if (fk && role) {
      const vis = folderVisibility(ui, role, fk);
      setFolderVisible(ui, role, fk, toggleTarget(vis.on));
    }
    return;
  }

  // The row carries the identity: data-layer-id, not a positional index — a
  // late registration can sit anywhere in the DOM, so an index-based lookup
  // would apply the click to a neighbor's layer.
  const row = target.closest(CONST.SEL.LAYER_ITEM);
  const id = row?.getAttribute(CONST.DATA.LAYER_ID);
  if (!id) return;
  applyVisibility(ui, id, target.checked);
};

export {
  getLayerItems,
  toggleTarget,
  toggleAll,
  syncToggleAll,
  syncToggleAllFromCount,
  bumpCheckedCount,
  basePaints,
  syncNoBasemap,
  applyVisibility,
  handleChange,
};
