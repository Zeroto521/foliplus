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
import { childParentId, resolveChild } from "./childRow.js";
import { refreshAllChildRows, refreshChildRows } from "./groupExpand.js";
import { applyRowView, buildRowCell, countTooltip, writeRoleCount } from "./rowView.js";
import { ROLE, folderOf, paintsAtZoom } from "#core/layer/index.js";
import { setCheckboxState, triStateOf } from "#ui/index.js";
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
  // Folder rows and role rows carry .foliplus-layer-item too,
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

  // A bulk toggle cascades to the expanded groups' child rows too: the
  // projection wrote map membership for the groups, and their child rows read
  // that fact directly.
  refreshAllChildRows(ui, role);

  // Persist the hidden-set after bulk toggle (single debounced write for the
  // batch).
  saveState(ui);

  // Reconcile the role's count from intent: every row's intent was just
  // rewritten, so a full scan is correct and cheap here (batch operation).
  syncToggleAll(ui, role);
  syncNoBasemap(ui);
  ui.c.debouncedEnforce();

  announceMoved(ui, moved);
};

/** Announce a batch of projection deltas, in registry order: the caller's loop
 *  may have walked the DOM, which can diverge from the registry on a late
 *  registration, and a subscriber that re-enters during this notify must see
 *  the finished count and hatch.
 *
 *  Order by walking the registry against the Map, not by sorting — a
 *  comparator needs an `indexOf` per call and that is a linear identity scan
 *  of the registry, so sorting pays a full scan for every comparison. The
 *  entry travels with the delta: `notifyDeltas` re-checks the live registry at
 *  delivery, so a layer a subscriber unregistered — or re-registered under the
 *  same id — inside an earlier delivery here is not announced on behalf of
 *  the entry that now holds that id. */
const announceMoved = (ui: LayerUI, moved: Map<string, ProjectionDelta>): void => {
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
const syncFolderRows = (
  ui: LayerUI,
  role: string,
  aggregates?: RoleAggregates,
): void => {
  const container = ui.uiContainer;
  if (!container) return;
  const rows = container.querySelectorAll(
    `${CONST.SEL.FOLDER_ROW}[data-role="${role}"]`,
  );
  if (rows.length === 0) return;
  const agg = aggregates ?? roleAggregates(ui, role);
  for (const row of Array.from(rows)) {
    const folderKey = row.getAttribute(CONST.DATA.FOLDER_KEY);
    if (!folderKey) continue;
    const vis = agg.folders.get(folderKey) ?? { total: 0, on: 0 };
    const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
    // Same single tri-state paint the creation path used (now the shared
    // ui/checkbox primitive), so an in-place refresh cannot drift from a
    // freshly built header.
    if (box) setCheckboxState(box, triStateOf(vis.total, vis.on));
    row.classList.toggle(CONST.CLASSES.ACTIVE, vis.on > 0);
    writeRoleCount(row, vis.total, vis.on);
  }
};

/** Repaint every group row of one role — the role header and each folder
 *  header — from one visibility aggregate. One pass, one source: a group row's
 *  checkbox and its count always come from the same table, so a folder header
 *  can never disagree with the role header it sits under.
 *
 *  Called at every reconcile point, including the single-row click path. The
 *  aggregate is one compact registry loop; a cached copy of it would be a
 *  second source that can drift, and it would not save the loop anyway — the
 *  folder rows need the same table. */
const syncToggleAll = (ui: LayerUI, role: string) => {
  const row = ui.uiContainer?.querySelector(
    `${CONST.SEL.TOGGLE_ALL}[data-role="${role}"]`,
  );
  if (!row) return;
  const allCb = row.querySelector(
    `[data-role="${CONST.TOGGLE_ALL_ROLE}"]`,
  ) as HTMLInputElement | null;
  if (!allCb) return;
  writeToggleAllCheckbox(ui, allCb, role, roleAggregates(ui, role));
};

const writeToggleAllCheckbox = (
  ui: LayerUI,
  allCb: HTMLInputElement,
  role: string,
  c: RoleAggregates,
): void => {
  // One tri-state writer for every group row: the role header and the folder
  // headers paint checked / indeterminate / aria-checked from the same rule
  // (the shared ui/checkbox primitive's setCheckboxState).
  setCheckboxState(allCb, triStateOf(c.total, c.on));
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
  // Every group row of the role repaints on the same cadence: both the click
  // path and the full rescan funnel through here, so a folder header can never
  // lag the role header it sits under.
  syncFolderRows(ui, role, c);
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

  setVisibleIntent(ui, id, visible);
  const ownDelta = applyProjection(ui, id);

  // Paint after the projection lands: the cell reads the intent this
  // transition just recorded.
  if (item) applyRowView(ui, item, buildRowCell(ui, layerInfo));
  // A container's own toggle cascades to its children's map membership; the
  // child rows are not registry rows, so repaint them from that fact here.
  refreshChildRows(ui, id);

  // One aggregate pass repaints the role header and every folder row of the
  // role from the same table. The old path kept a cached count and nudged it
  // by ±1, which was a second source for the same number — and it did not save
  // the registry loop, because the folder rows need the aggregate anyway.
  syncToggleAll(ui, layerInfo.role);

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

/** One role's visibility aggregates: the role total plus a per-folder map.
 *  Produced once per reconcile point and threaded down to every consumer
 *  (role header, folder rows) so a single click
 *  never recomputes the same table. */
type RoleAggregates = {
  total: number;
  on: number;
  folders: Map<string, { total: number; on: number }>;
};

/** One role's visibility aggregates in a single pass: the role total plus a
 *  per-folder map. Every group row of the role — the header and each folder
 *  header — reads this one table, so a click repaints F rows for O(L) work
 *  instead of F scans of L layers. The folder row's checkbox and count come
 *  from the same entry, so a role count and a folder count can never disagree
 *  about a member. */
const roleAggregates = (ui: LayerUI, role: string): RoleAggregates => {
  const layout = ui.c.folderLayoutView;
  const folders = new Map<string, { total: number; on: number }>();
  let total = 0;
  let on = 0;
  for (const info of ui.c.layerRegistry.items) {
    if (info.role !== role) continue;
    total += 1;
    const visible = intentVisibleOf(ui, info.id);
    if (visible) on += 1;
    const key = folderOf(layout, info);
    if (!key) continue;
    const agg = folders.get(key) ?? { total: 0, on: 0 };
    agg.total += 1;
    if (visible) agg.on += 1;
    folders.set(key, agg);
  }
  return { total, on, folders };
};

/** Set every live member of one folder visible/hidden. The same incremental
 *  path as toggleAll — one intent write per layer (persist=false), one
 *  projection apply, one row repaint — then one save and a reconcile of the
 *  two group rows. A full list rebuild here would throw away the DOM the
 *  gesture is anchored to and repaint every row of the role for a change that
 *  touched one folder. */
const setFolderVisible = (
  ui: LayerUI,
  role: string,
  folderKey: string,
  visible: boolean,
): void => {
  const layout = ui.c.folderLayoutView;
  const moved = new Map<string, ProjectionDelta>();
  for (const info of ui.c.layerRegistry.items) {
    if (info.role !== role) continue;
    if (folderOf(layout, info) !== folderKey) continue;
    setVisibleIntent(ui, info.id, visible, false);
    const delta = applyProjection(ui, info.id);
    if (delta.wroteVisible || delta.intentMoved) moved.set(info.id, delta);
    const row = ui.uiContainer?.querySelector<HTMLElement>(
      `${CONST.SEL.LAYER_ITEM}[${CONST.DATA.LAYER_ID}="${info.id}"]`,
    );
    if (row) applyRowView(ui, row, buildRowCell(ui, info));
  }
  // Folder-wide hides cascade to the groups' child rows the same way the role
  // toggle-all does.
  refreshAllChildRows(ui, role);
  saveState(ui);
  // One aggregate pass for the whole tail: the role header and every folder
  // row repaint from this table.
  syncToggleAll(ui, role);
  syncNoBasemap(ui);
  ui.c.debouncedEnforce();
  announceMoved(ui, moved);
};

const handleChange = (ui: LayerUI, event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.tagName.toLowerCase() !== "input" || target.type !== "checkbox") return;
  // A child row's checkbox talks to the map directly: the child is not a
  // registry row (no LayerInfo), so the layer-change path below would no-op.
  // The row id is parentId::stamp; resolve the parent and the child.
  const childRow = target.closest(CONST.SEL.LAYER_ITEM) as HTMLElement | null;
  const childId = childRow?.getAttribute(CONST.DATA.LAYER_ID);
  if (childId?.includes("::")) {
    // A child id is a chain (outer::inner::leaf): the immediate parent is the
    // last segment, so a nested child toggles its own container, not the root.
    const child = resolveChild(ui, childParentId(childId), childId);
    if (child && ui.c.map) {
      if (target.checked) ui.c.map.addLayer(child);
      else ui.c.map.removeLayer(child);
    }
    return;
  }

  // A folder row's checkbox is a group toggle for every member: the folder
  // row has no data-layer-id (it is a group row, not a leaf), so the layer
  // change path below would no-op. Climb to the folder row by its key.
  const folderRow = target.closest(CONST.SEL.FOLDER_ROW) as HTMLElement | null;
  if (folderRow) {
    const fk = folderRow.getAttribute(CONST.DATA.FOLDER_KEY);
    const role = folderRow.getAttribute(CONST.DATA.ROLE) ?? "";
    if (fk && role) {
      const vis = roleAggregates(ui, role).folders.get(fk) ?? { total: 0, on: 0 };
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

export type { RoleAggregates };
export {
  getLayerItems,
  roleAggregates,
  toggleTarget,
  toggleAll,
  syncToggleAll,
  basePaints,
  syncNoBasemap,
  applyVisibility,
  handleChange,
};
