// LayerControl UI — Layer filter panel.
//
// Opens from the ⋮ menu on a row that declares the filter capability
// (`filterProvider` + `filterSetter`). The panel owns the shell, the
// kept/total readout and the Clear footer; the condition itself is delegated
// to a body in `filterBody.js`, one body per dimension. The panel is a pure
// view over the owner's `LayerFilterModel` and writes through
// `filterSetter`. The owner (the component that owns the row's unit)
// validates, clamps, re-renders and publishes LAYER_FILTER_CHANGE — the
// panel holds no filter state of its own, so a close/reopen reads back
// exactly what is committed.
//
// "No filter" and "a range equal to the full extent" are the same state:
// the owner collapses a full-range atom to `undefined` (a full-range atom
// would still exclude points missing the field, which is not what dragging
// both thumbs back to the ends means). The Clear button does the same write
// explicitly. The enum body applies the same rule to an empty value set.
//
// The panel's identity is the registry entry it was opened against, never a
// captured capability function: a same-id re-registration swaps the entry
// (and both functions), so the panel re-resolves by id on every read/write
// and closes itself when the entry it shows is no longer current.
//
// Panel shell follows `attr.ts` verbatim: `createRowPanel` for the surface,
// capture-phase document mousedown for dismiss (the control disables click
// propagation, so bubble-phase never reaches `document`), and a per-panel
// outside-handler field on `OverlayPanel` so a peer panel can tell the two
// apart.
import { EVENTS } from "#core/event/index.js";
import type {
  FilterDimension,
  LayerFilter,
  LayerFilterModel,
  LayerInfo,
} from "#core/layer/index.js";
import { createRowPanel } from "#core/leaflet/index.js";
import { isInsideOverlay } from "#core/overlay.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import * as SVGs from "#foliplus/LayerControl/icon.js";
import { finishSlidersIn } from "#foliplus/LayerControl/slider.js";
import { dom } from "#common/dom.js";
import { formatNumber } from "#common/format.js";
import { displayName } from "../listPanel/rowView.js";
import type { LayerUI } from "../surface.js";
import { closeOverlays } from "../teardown.js";
import { type FilterBody, dimensionShapeKey, renderBody } from "./filterBody.js";

/** Format a count for the result readout: exact, grouped whole numbers
 *  ("2,500"), never a compact abbreviation. The readout answers "how many of
 *  the total survived", so rounding 2,500 to "2.5K" would hide the very
 *  precision it exists to report. The row column keeps the compact rule. */
const fmtCount = (n: number): string => formatNumber(n, "comma", "en", 0);

/** Format a slider value: enough decimals for the data's own precision,
 *  with float noise (0.30000000000000004) trimmed. */
const fmtValue = (v: number): string => String(Number(v.toFixed(6)));

/** The row registry entry viewed as a filter-capable component. */
type FilterCapability = {
  filterProvider: () => LayerFilterModel | null;
  filterSetter: (filter: LayerFilter) => void;
};

type FilterCapableInfo = LayerInfo & FilterCapability;

/** The one capability gate: the ⋮ menu and the panel both ask this, so an
 *  entry that renders an enabled menu item can never open to an empty
 *  panel (and a non-function truthy value cannot pass either). */
const isFilterCapable = (
  info: LayerInfo | null | undefined,
): info is FilterCapableInfo =>
  !!info &&
  typeof info.filterProvider === "function" &&
  typeof info.filterSetter === "function";

const capabilityOf = (ui: LayerUI, layerId: string): FilterCapableInfo | null => {
  const info = ui.c.layerRegistry.get(layerId);
  return isFilterCapable(info) ? info : null;
};

/** One rendered panel body. `empty` means the owner reported no filterable
 *  data (no source selected, or no dimension on the snapshot). */
type FilterRowsView = Extract<FilterView, { kind: "rows" }>;

/** The shared model plus the fields a rows view paints. */
type FilterView =
  | { kind: "empty"; root: HTMLElement }
  | {
      kind: "rows";
      root: HTMLElement;
      model: LayerFilterModel;
      /** The dimension the body renders (the owner's first dimension). */
      dim: FilterDimension;
      /** Signature of the dimension the body was mounted from. */
      shapeKey: string;
      body: FilterBody;
      result: HTMLElement;
      clear: HTMLButtonElement;
    };

/** Everything the panel needs to keep its view and its owner identity in
 *  sync while it is open. Exported for `OverlayPanel`'s state declaration. */
interface FilterPanelState {
  item: HTMLElement;
  panel: HTMLElement;
  layerId: string;
  /** The registry entry the panel was opened against. Re-registration under
   *  the same id replaces the entry object; every read/write compares this
   *  identity so the panel can never write a retired owner. */
  entry: LayerInfo;
  content: HTMLElement;
  view: FilterView;
  /** True while a panel-originated write is in flight — the owner publishes
   *  LAYER_FILTER_CHANGE synchronously from the setter, and that self-signal
   *  must not rebuild the view under the user's pointer. */
  writing: boolean;
  /** A synthetic owner may report several dimensions. The panel renders the
   *  first one; warn once per open panel instead of throwing. */
  multiDimWarned: boolean;
}

interface FilterViewHooks {
  write: (filter: LayerFilter | undefined) => void;
}

/** The body deps: the panel's translator, its write bridge and its number
 *  formatters. The body never reads the registry itself. */
const bodyDeps = (
  ui: LayerUI,
  hooks: FilterViewHooks,
): Parameters<typeof renderBody>[2] => ({
  T: ui.T,
  write: hooks.write,
  formatCount: fmtCount,
  formatValue: fmtValue,
});

/** Pull the shared readout to the owner's current model: live kept/total text
 *  and the Clear state. Called after every write and on every external
 *  LAYER_FILTER_CHANGE, so the live region never lags the map. */
const syncReadout = (
  ui: LayerUI,
  view: FilterRowsView,
  model: LayerFilterModel,
): void => {
  const pct = model.total > 0 ? Math.round((model.kept / model.total) * 100) : 0;
  // Result readout: percentage first, then the kept / total pair in the
  // owner's unit as exact grouped integers ("42% (2,500 of 6,000) kept") —
  // unlike the row column's compact form. One sentence carries the whole
  // fact — there is no second ratio track.
  view.result.textContent = ui
    .T("filter_result")
    .replace("{pct}", String(pct))
    .replace("{kept}", fmtCount(model.kept))
    .replace("{total}", fmtCount(model.total));
  // Clear is the only footer action and it is live: disabled exactly when
  // there is nothing to clear (the owner reports no committed filter).
  view.clear.disabled = !model.filter;
  view.clear.setAttribute("aria-disabled", model.filter ? "false" : "true");
  view.clear.title = model.filter
    ? ui.T("filter_clear_tooltip")
    : ui.T("filter_clear_disabled");
};

/** Push the owner's current model into the open view: the condition control
 *  and the shared readout. */
const syncView = (ui: LayerUI, view: FilterRowsView, model: LayerFilterModel): void => {
  view.model = model;
  view.body.sync(model);
  syncReadout(ui, view, model);
};

/** Result row — announced via aria-live so a drag reads "kept N of M", not
 *  two bare numbers. The panel owns it, not the condition body: every
 *  dimension kind reports through the same readout. */
const buildResultRow = (ui: LayerUI): { row: HTMLElement; result: HTMLElement } => {
  const result = dom.el("span", {
    class: CONST.CLASSES.FILTER_RESULT,
    "aria-live": "polite",
  });
  const row = dom.el(
    "div",
    { class: CONST.CLASSES.FORM_ROW },
    dom.el("span", { class: CONST.CLASSES.FORM_LABEL }, ui.T("filter_result_label")),
    dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, result),
  );
  return { row, result };
};

/** Clear footer — the explicit reset. Same vocabulary as the style panel's
 *  Reset footer. It is the only footer action: the panel is live, so a Done
 *  button would only duplicate a close. */
const buildFooter = (
  ui: LayerUI,
  hooks: FilterViewHooks,
): { footer: HTMLElement; clear: HTMLButtonElement } => {
  const clear = dom.el(
    "button",
    {
      type: "button",
      class: `foliplus-panel-btn ${CONST.CLASSES.FILTER_CLEAR}`,
    },
    ui.T("filter_clear"),
  ) as HTMLButtonElement;
  clear.addEventListener("click", () => hooks.write(undefined));
  const footer = dom.el(
    "div",
    {},
    dom.el("hr", { class: "foliplus-section-divider" }),
    dom.el("div", { class: "foliplus-btn-row" }, clear),
  );
  return { footer, clear };
};

/** Empty state: the row declares no filterable data (no source selected,
 *  or no dimension on the snapshot). The message is the panel's body; the
 *  entry is never silently dead. */
const buildEmptyState = (ui: LayerUI): FilterView => ({
  kind: "empty",
  root: dom.el("div", { class: CONST.CLASSES.FILTER_EMPTY }, ui.T("filter_empty")),
});

/** Swap the panel body, releasing the old condition control first so a drag
 *  that is in flight cannot keep a detached thumb's pointer capture. */
const mountView = (
  ui: LayerUI,
  state: FilterPanelState,
  hooks: FilterViewHooks,
  model: LayerFilterModel | null,
): void => {
  finishSlidersIn(state.content);
  if (state.view.kind === "rows") state.view.body.destroy();
  const dim = model?.dimensions[0] ?? null;
  if (!model || !dim) {
    state.view = buildEmptyState(ui);
    state.content.replaceChildren(state.view.root);
    return;
  }
  const body = renderBody(dim, model, bodyDeps(ui, hooks));
  const resultRow = buildResultRow(ui);
  const { footer, clear } = buildFooter(ui, hooks);
  const root = dom.el("div", {}, body.root, resultRow.row, footer);
  const view: FilterView = {
    kind: "rows",
    root,
    model,
    dim,
    shapeKey: dimensionShapeKey(dim),
    body,
    result: resultRow.result,
    clear,
  };
  state.view = view;
  state.content.replaceChildren(root);
  syncView(ui, view, model);
};

/** Re-read the panel's model from the owner and reconcile the view. The
 *  caller has already verified the registry entry identity. */
const reconcile = (
  ui: LayerUI,
  state: FilterPanelState,
  hooks: FilterViewHooks,
  cap: FilterCapability,
): void => {
  const model = cap.filterProvider();
  const dim = model?.dimensions[0] ?? null;
  if (!model || !dim) {
    // Nothing filterable: keep an already-mounted empty body instead of
    // rebuilding it on every owner signal.
    if (state.view.kind !== "empty") mountView(ui, state, hooks, null);
    return;
  }
  if (model.dimensions.length > 1 && !state.multiDimWarned) {
    state.multiDimWarned = true;
    ui.log.warn(
      `filter owner "${state.layerId}" reports ${model.dimensions.length} dimensions; rendering only the first`,
    );
  }
  if (state.view.kind === "rows" && state.view.shapeKey === dimensionShapeKey(dim)) {
    syncView(ui, state.view, model);
    return;
  }
  mountView(ui, state, hooks, model);
};

/** Resolve the capability for a live read/write — by id, against the entry
 *  the panel was opened for. Null means the row was re-registered or lost the
 *  capability while the panel was open; the caller closes the surface. */
const resolveCapability = (
  ui: LayerUI,
  state: FilterPanelState,
): FilterCapableInfo | null => {
  const info = ui.c.layerRegistry.get(state.layerId);
  if (!info || info !== state.entry) return null;
  return isFilterCapable(info) ? info : null;
};

/** Subscribe the open panel to owner changes:
 *  - LAYER_FILTER_CHANGE → re-read the model (external clear, revalidation on
 *    content change, another capability caller);
 *  - LAYER_ITEM_UPDATED / REFRESHED → close when the same id now resolves to
 *    a different registry entry, so a stale panel cannot keep showing (or
 *    writing) the retired owner.
 *  Returns the combined unsubscribe, stored on `OverlayPanel`. */
const subscribeFilterSignals = (
  ui: LayerUI,
  state: FilterPanelState,
  hooks: FilterViewHooks,
): (() => void) => {
  const refresh = (): void => {
    // Our own write already reconciled; rebuilding here would drop the
    // slider session mid-drag.
    if (state.writing) return;
    const cap = resolveCapability(ui, state);
    if (!cap) {
      closeFilterPanel(ui, false);
      return;
    }
    reconcile(ui, state, hooks, cap);
  };
  const onEntrySignal = ({ id }: { id: string }): void => {
    if (id !== state.layerId) return;
    const current = ui.c.layerRegistry.get(id);
    if (current !== state.entry) closeFilterPanel(ui, false);
  };
  // Component-owned rows (Heatmap today) clear via LAYER_DELETED instead of
  // unregistering, and the event lands *before* the entry is pruned — so the
  // identity check cannot answer it, the id match must.
  const onDeleted = ({ id }: { id: string }): void => {
    if (id === state.layerId) closeFilterPanel(ui, false);
  };
  const unsubs = [
    ui.events.on(EVENTS.LAYER_FILTER_CHANGE, ({ id }) => {
      if (id === state.layerId) refresh();
    }),
    ui.events.on(EVENTS.LAYER_ITEM_UPDATED, onEntrySignal),
    ui.events.on(EVENTS.LAYER_ITEM_REFRESHED, onEntrySignal),
    ui.events.on(EVENTS.LAYER_ITEM_REMOVED, onEntrySignal),
    ui.events.on(EVENTS.LAYER_DELETED, onDeleted),
  ];
  return () => unsubs.forEach(off => off());
};

/** Open the filter panel for a given layer row. */
const openFilterPanel = (ui: LayerUI, item: HTMLElement): void => {
  closeOverlays(ui);

  const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return;
  const cap = capabilityOf(ui, layerId);

  // The row's title names the layer; the dialog itself is named by what
  // the surface is, so a screen reader announces the panel, not the layer
  // twice — same convention `attr.ts` follows.
  const { panel, header, content } = createRowPanel({
    cssClass: CONST.CLASSES.FILTER_PANEL,
    title: displayName(ui, layerId) || layerId,
    ariaLabel: ui.T("filter_layer"),
    iconSvg: SVGs.ICON_FILTER,
    closeTitle: ui.T("close_title"),
    iconClass: `${CONST.CLASSES.FILTER_ICON} foliplus-header-icon`,
  });

  const state: FilterPanelState = {
    item,
    panel,
    layerId,
    entry: layerInfo,
    content,
    view: buildEmptyState(ui),
    writing: false,
    multiDimWarned: false,
  };
  content.appendChild(state.view.root);

  const hooks: FilterViewHooks = {
    write: filter => {
      const live = resolveCapability(ui, state);
      if (!live) {
        closeFilterPanel(ui, false);
        return;
      }
      state.writing = true;
      try {
        live.filterSetter(filter);
      } finally {
        state.writing = false;
      }
      // The owner may have retired itself synchronously (a reset inside the
      // setter closes this panel through LAYER_FILTER_CHANGE → no, the
      // signal is suppressed while writing, so re-check here).
      if (ui.overlayPanel.activeFilterPanel !== state) return;
      const after = resolveCapability(ui, state);
      if (!after) {
        closeFilterPanel(ui, false);
        return;
      }
      reconcile(ui, state, hooks, after);
    },
  };

  // Render the owner's current model (empty state when the owner reports no
  // filterable data — a stale row that still reached the panel).
  if (cap) reconcile(ui, state, hooks, cap);

  // Header click dismisses, matching `attr.ts` — the × sits inside the
  // header, so one listener covers both.
  header.addEventListener("click", () => closeFilterPanel(ui, true));

  // The panel sits inside a draggable layer row: a press on the panel
  // must neither start a row drag nor inherit `user-select: none`. The
  // mousedown is stopped here (the row's own handlers live on the
  // container), and which side of the panel the press landed on is
  // recorded by the outside handler below — `dragstart` is dispatched on the
  // draggable row, so it cannot answer that.
  panel.addEventListener("mousedown", e => e.stopPropagation());

  // The enum popup is the topmost layer: Escape while it is open closes the
  // popup first, wherever focus sits inside the panel (an option, the trigger
  // or the footer). The container's own Escape handler closes the surface, and
  // it only runs once no popup is left.
  panel.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    const current = ui.overlayPanel.activeFilterPanel;
    if (current?.view.kind !== "rows") return;
    if (!current.view.body.dismissTransient(panel, true)) return;
    event.preventDefault();
    event.stopPropagation();
  });

  item.style.position = "relative";
  item.appendChild(panel);

  // Document capture dismiss (attrs recipe). The control disables click
  // propagation, so bubble-phase mousedown never reaches document — a
  // press on the map or another foliplus control would not close the
  // panel without capture.
  ui.overlayPanel.filterOutsideHandler = (event: MouseEvent) => {
    const current = ui.overlayPanel.activeFilterPanel;
    const target = event.target;
    const inside = isInsideOverlay(target, panel);
    // A press that dismisses the enum popup is consumed: the popup is the
    // topmost layer, so the panel itself stays open (the next outside press
    // dismisses the surface).
    if (
      target instanceof Element &&
      current?.view.kind === "rows" &&
      current.view.body.dismissTransient(target)
    ) {
      ui.listPanel.pressInPanel = inside;
      return;
    }
    if (inside) {
      ui.listPanel.pressInPanel = true;
      return;
    }
    ui.listPanel.pressInPanel = false;
    closeFilterPanel(ui, false);
  };
  document.addEventListener("mousedown", ui.overlayPanel.filterOutsideHandler, true);

  ui.overlayPanel.activeFilterPanel = state;
  ui.overlayPanel.filterUnsubscribe = subscribeFilterSignals(ui, state, hooks);
};

/** Close the filter panel. `setFocus = true` returns focus to the row. */
const closeFilterPanel = (ui: LayerUI, setFocus: boolean): void => {
  if (ui.overlayPanel.filterOutsideHandler) {
    document.removeEventListener(
      "mousedown",
      ui.overlayPanel.filterOutsideHandler,
      true,
    );
    ui.overlayPanel.filterOutsideHandler = null;
  }
  if (ui.overlayPanel.filterUnsubscribe) {
    ui.overlayPanel.filterUnsubscribe();
    ui.overlayPanel.filterUnsubscribe = null;
  }
  ui.listPanel.pressInPanel = false;
  if (!ui.overlayPanel.activeFilterPanel) return;
  const state = ui.overlayPanel.activeFilterPanel;
  const { item, panel } = state;
  // A live drag has already produced a value; finish it before the DOM
  // goes, or its change event is lost with the node (style-panel recipe).
  finishSlidersIn(panel);
  if (state.view.kind === "rows") state.view.body.destroy();
  panel.remove();
  ui.overlayPanel.activeFilterPanel = null;
  if (setFocus) item.focus();
};

export { closeFilterPanel, isFilterCapable, openFilterPanel };
export type { FilterPanelState };
