// LayerControl UI — Layer filter panel.
//
// Opens from the ⋮ menu on a row that declares the filter capability
// (`filterProvider` + `filterSetter`). The panel is a pure view over the
// owner's `LayerFilterModel`: it renders the field, a dual-thumb range
// slider and a live "kept / total" readout, and writes through
// `filterSetter`. The owner (the component that owns the row's unit)
// validates, clamps, re-renders and publishes LAYER_FILTER_CHANGE — the
// panel holds no filter state of its own, so a close/reopen reads back
// exactly what is committed.
//
// "No filter" and "a range equal to the full extent" are the same state:
// the owner collapses a full-range atom to `undefined` (a full-range atom
// would still exclude points missing the field, which is not what dragging
// both thumbs back to the ends means). The Clear button does the same write
// explicitly.
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
  FilterRangeDimension,
  LayerFilter,
  LayerFilterModel,
  LayerInfo,
} from "#core/layer/index.js";
import { createRowPanel } from "#core/leaflet/index.js";
import { isInsideOverlay } from "#core/overlay.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import * as SVGs from "#foliplus/LayerControl/icon.js";
import { Slider, finishSlidersIn } from "#foliplus/LayerControl/slider.js";
import { dom } from "#common/dom.js";
import { formatNumber } from "#common/format.js";
import { displayName } from "../listPanel/rowView.js";
import type { LayerUI } from "../surface.js";
import { closeOverlays } from "../teardown.js";

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

/** The panel's filter atom — the only shape the current renderer emits. */
const atom = (
  field: string,
  range: [number, number],
): { kind: "atom"; field: string; op: "between"; range: [number, number] } => ({
  kind: "atom",
  field,
  op: "between",
  range,
});

/** One rendered panel body. `empty` means the owner reported no filterable
 *  data (no source selected, or no numeric field on the snapshot). */
type FilterRowsView = Extract<FilterView, { kind: "rows" }>;

/** The shared model plus the fields a rows view paints. */
type FilterView =
  | { kind: "empty"; root: HTMLElement }
  | {
      kind: "rows";
      root: HTMLElement;
      model: LayerFilterModel;
      /** The dimension this body renders (the owner's first range dimension). */
      dim: FilterRangeDimension;
      slider: Slider;
      result: HTMLElement;
      clear: HTMLButtonElement;
    };

/** The model's first range dimension, or null when this body cannot render
 *  it. The v2 panel renders one dimension; other kinds get their own body. */
const rangeDimensionOf = (model: LayerFilterModel): FilterRangeDimension | null => {
  const dim = model.dimensions[0];
  return dim?.kind === "range" ? dim : null;
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
}

interface FilterViewHooks {
  write: (filter: LayerFilter) => void;
}

/** The dimension shape the rows were built from. A change here needs a
 *  rebuild (new rail bounds / field / label / step), not just a readout
 *  refresh. */
const sameShape = (a: FilterRangeDimension, b: FilterRangeDimension): boolean =>
  a.kind === b.kind &&
  a.field === b.field &&
  a.label === b.label &&
  a.range[0] === b.range[0] &&
  a.range[1] === b.range[1] &&
  a.step === b.step;

/** The committed range clamped into the dimension's extent, or the full
 *  extent when no range filter is committed. */
const sliderValueOf = (
  dim: FilterRangeDimension,
  filter: LayerFilter,
): [number, number] => {
  if (filter?.kind !== "atom" || !filter.range) {
    return [dim.range[0], dim.range[1]];
  }
  return [
    Math.max(dim.range[0], Math.min(dim.range[1], filter.range[0])),
    Math.max(dim.range[0], Math.min(dim.range[1], filter.range[1])),
  ];
};

/** Pull the view to the owner's current model: live kept/total text and the
 *  committed band (the owner may have clamped it, collapsed it to the full
 *  extent, or cleared it). Called after every write and on every external
 *  LAYER_FILTER_CHANGE. */
const syncView = (ui: LayerUI, view: FilterRowsView, model: LayerFilterModel): void => {
  view.model = model;
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
  const stored = sliderValueOf(view.dim, model.filter);
  const current = view.slider.value;
  if (!Array.isArray(current) || current[0] !== stored[0] || current[1] !== stored[1]) {
    view.slider.setValue(stored, { silent: true });
  }
};

/** The form rows: field / range / result, plus a Clear footer. Same
 *  left-label / right-control vocabulary as the style panel.
 *
 *  Structure note: every row is one
 *  FORM_ROW (fixed 88px label column + one control cell), and a condition
 *  is a row over that same vocabulary. A future Measure enum / multi-
 *  condition UI adds rows here — an atom renderer keyed by `filter_field`
 *  — without changing the panel shell, the footer or the geometry. */
const buildFilterRows = (
  ui: LayerUI,
  hooks: FilterViewHooks,
  model: LayerFilterModel,
  dim: FilterRangeDimension,
): FilterView => {
  // Field row — read-only: the owner picks the dimension label (the numeric
  // field's localized name) and the panel renders it verbatim.
  const fieldRow = dom.el(
    "div",
    { class: CONST.CLASSES.FORM_ROW },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("filter_field")),
    dom.el(
      "div",
      { class: `${CONST.CLASSES.FORM_CONTROL} ${CONST.CLASSES.FILTER_FIELD}` },
      dim.label,
    ),
  );

  // Range row — the shared dual-thumb slider primitive. Initial value: the
  // committed filter clamped into the field's extent, else the full extent
  // (no filter). A degenerate extent (constant field) renders disabled —
  // two movable thumbs over one value would be a lie.
  const host = dom.el("div", { class: CONST.CLASSES.FILTER_SLIDER });
  const slider = new Slider(host, {
    min: dim.range[0],
    max: dim.range[1],
    step: dim.step,
    value: sliderValueOf(dim, model.filter),
    label: ui.T("filter_range"),
    labels: [ui.T("filter_range_min"), ui.T("filter_range_max")],
    values: { min: fmtValue(dim.range[0]), max: fmtValue(dim.range[1]) },
    format: fmtValue,
    // Same appearance as the visible-range slider: a limit dot at each rail
    // end, no middle "current value" dot (a filter has no current readout).
    marks: [
      { at: dim.range[0], tone: "limit" },
      { at: dim.range[1], tone: "limit" },
    ],
    disabled: dim.range[0] === dim.range[1],
    // Live preview and commit go through the same owner write — the owner
    // is idempotent on an unchanged filter, so the second call is a no-op.
    // `write` also refreshes the readout, so the live region never lags the
    // map behind a drag or a keyboard step.
    // The dual-thumb slider always reports a pair; typed as a cast because
    // the shared primitive also serves single-value sliders.
    input: value => hooks.write(atom(dim.field, value as [number, number])),
    change: value => hooks.write(atom(dim.field, value as [number, number])),
  });

  const rangeRow = dom.el(
    "div",
    { class: CONST.CLASSES.FORM_ROW },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("filter_range")),
    dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, host),
  );

  // Result row — announced via aria-live so a drag reads "kept N of M",
  // not two bare numbers.
  const result = dom.el("span", {
    class: CONST.CLASSES.FILTER_RESULT,
    "aria-live": "polite",
  });
  const resultRow = dom.el(
    "div",
    { class: CONST.CLASSES.FORM_ROW },
    dom.el("span", { class: CONST.CLASSES.FORM_LABEL }, ui.T("filter_result_label")),
    dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, result),
  );

  // Clear footer — the explicit reset. Same vocabulary as the style
  // panel's Reset footer.
  const clearBtn = dom.el(
    "button",
    {
      type: "button",
      class: `foliplus-panel-btn ${CONST.CLASSES.FILTER_CLEAR}`,
    },
    ui.T("filter_clear"),
  );
  clearBtn.addEventListener("click", () => hooks.write(undefined));
  const footer = dom.el(
    "div",
    {},
    dom.el("hr", { class: "foliplus-section-divider" }),
    dom.el("div", { class: "foliplus-btn-row" }, clearBtn),
  );

  const view: FilterView = {
    kind: "rows",
    root: dom.el("div", {}, fieldRow, rangeRow, resultRow, footer),
    model,
    dim,
    slider,
    result,
    clear: clearBtn as HTMLButtonElement,
  };
  syncView(ui, view, model);
  return view;
};

/** Empty state: the row declares no filterable data (no source selected,
 *  or no numeric field on the snapshot). The message is the panel's body;
 *  the entry is never silently dead. */
const buildEmptyState = (ui: LayerUI): FilterView => ({
  kind: "empty",
  root: dom.el("div", { class: CONST.CLASSES.FILTER_EMPTY }, ui.T("filter_empty")),
});

/** Swap the panel body, releasing the old slider session first so a drag
 *  that is in flight cannot keep a detached thumb's pointer capture. */
const mountView = (
  ui: LayerUI,
  state: FilterPanelState,
  hooks: FilterViewHooks,
  model: LayerFilterModel | null,
): void => {
  finishSlidersIn(state.content);
  const dim = model ? rangeDimensionOf(model) : null;
  const view =
    model && dim ? buildFilterRows(ui, hooks, model, dim) : buildEmptyState(ui);
  state.view = view;
  state.content.replaceChildren(view.root);
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
  if (!model) {
    if (state.view.kind !== "empty") mountView(ui, state, hooks, null);
    return;
  }
  const dim = rangeDimensionOf(model);
  if (!dim) {
    mountView(ui, state, hooks, model);
    return;
  }
  if (state.view.kind === "rows" && sameShape(state.view.dim, dim)) {
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
  // recorded by the outside handler below — `dragstart` is dispatched on
  // the draggable row, so it cannot answer that.
  panel.addEventListener("mousedown", e => e.stopPropagation());

  item.style.position = "relative";
  item.appendChild(panel);

  // Document capture dismiss (attrs recipe). The control disables click
  // propagation, so bubble-phase mousedown never reaches document — a
  // press on the map or another foliplus control would not close the
  // panel without capture.
  ui.overlayPanel.filterOutsideHandler = (event: MouseEvent) => {
    if (isInsideOverlay(event.target, panel)) {
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
  const item = ui.overlayPanel.activeFilterPanel.item;
  const panel = ui.overlayPanel.activeFilterPanel.panel;
  // A live drag has already produced a value; finish it before the DOM
  // goes, or its change event is lost with the node (style-panel recipe).
  finishSlidersIn(panel);
  panel.remove();
  ui.overlayPanel.activeFilterPanel = null;
  if (setFocus) item.focus();
};

export { closeFilterPanel, isFilterCapable, openFilterPanel };
export type { FilterPanelState };
