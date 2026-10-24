// LayerControl UI — Layer filter panel (stage 2 pilot).
//
// Opens from the ⋮ menu on a layer row that declares the filter capability
// (`filterProvider` + `filterSetter` — HeatmapControl today). The panel is
// a pure view over the owner's `LayerFilterModel`: it renders the field, a
// dual-thumb range slider and a live "kept / total" readout, and writes
// through `filterSetter`. The owner (the component that owns the row's
// data) validates, clamps, re-renders and publishes LAYER_FILTER_CHANGE —
// the panel holds no filter state of its own, so a close/reopen reads back
// exactly what is committed.
//
// "No filter" and "a range equal to the full extent" are the same state:
// the owner collapses a full-range atom to `undefined` (a full-range atom
// would still exclude points missing the field, which is not what dragging
// both thumbs back to the ends means). The Clear button does the same write
// explicitly.
//
// Panel shell follows `attr.ts` verbatim: `createRowPanel` for the surface,
// capture-phase document mousedown for dismiss (the control disables click
// propagation, so bubble-phase never reaches `document`), and a per-panel
// outside-handler field on `OverlayPanel` so a peer panel can tell the two
// apart.
import type { LayerFilterModel } from "#core/layer/index.js";
import { createRowPanel } from "#core/leaflet/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import * as SVGs from "#foliplus/LayerControl/icon.js";
import { Slider, finishSlidersIn } from "#foliplus/LayerControl/slider.js";
import { dom } from "#common/dom.js";
import { formatNumber } from "#common/format.js";
import { displayName } from "../listPanel/rowView.js";
import type { LayerUI } from "../surface.js";
import { closeOverlays } from "../teardown.js";

/** Format a count for the result readout. `int` keeps the number
 *  locale-agnostic — the readout is a UI fact, not a display value. */
const fmtCount = (n: number): string => formatNumber(n, "comma", "en", 0);

/** Format a slider value: enough decimals for the data's own precision,
 *  with float noise (0.30000000000000004) trimmed. */
const fmtValue = (v: number): string => String(Number(v.toFixed(6)));

/** The row registry entry viewed as a filter-capable component. Null when
 *  the row does not declare the capability (the menu gate already filters
 *  these, but a stale row can reach the panel after a re-registration). */
type FilterCapability = {
  filterProvider: () => LayerFilterModel | null;
  filterSetter: (filter: LayerFilterModel["filter"]) => void;
};

const capabilityOf = (ui: LayerUI, layerId: string): FilterCapability | null => {
  const info = ui.c.layerRegistry.get(layerId);
  if (!info) return null;
  if (typeof info.filterProvider !== "function") return null;
  if (typeof info.filterSetter !== "function") return null;
  return {
    filterProvider: info.filterProvider,
    filterSetter: info.filterSetter,
  };
};

/** The panel's filter atom — the only shape the stage-2 renderer emits. */
const atom = (
  field: string,
  range: [number, number],
): { kind: "atom"; field: string; op: "between"; range: [number, number] } => ({
  kind: "atom",
  field,
  op: "between",
  range,
});

/** Refresh the result readout from the owner's current model, and pull the
 *  slider back to the committed range when the owner changed it (clamped,
 *  collapsed to the full extent, or cleared). Called after every write. */
const refreshResult = (
  ui: LayerUI,
  cap: FilterCapability,
  slider: Slider,
  result: HTMLElement,
  fallbackTotal: number,
): void => {
  const model = cap.filterProvider();
  const kept = model ? model.kept : 0;
  const total = model ? model.total : fallbackTotal;
  result.textContent = ui
    .T("filter_result")
    .replace("{kept}", fmtCount(kept))
    .replace("{total}", fmtCount(total));
  if (!model) return;
  const stored: [number, number] =
    model.filter?.kind === "atom" && model.filter.range
      ? [model.filter.range[0], model.filter.range[1]]
      : [model.range[0], model.range[1]];
  const current = slider.value;
  if (
    Array.isArray(current) &&
    (current[0] !== stored[0] || current[1] !== stored[1])
  ) {
    slider.setValue(stored, { silent: true });
  }
};

/** The form rows: field / range / result, plus a Clear footer. Same
 *  left-label / right-control vocabulary as the style panel. */
const buildFilterRows = (
  ui: LayerUI,
  cap: FilterCapability,
  model: LayerFilterModel,
): HTMLElement => {
  // Field row — read-only: the owner picks the field (first numeric key of
  // the snapshot); a field picker is a later stage.
  const fieldRow = dom.el(
    "div",
    { class: CONST.CLASSES.FORM_ROW },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("filter_field")),
    dom.el(
      "div",
      { class: `${CONST.CLASSES.FORM_CONTROL} ${CONST.CLASSES.FILTER_FIELD}` },
      model.field,
    ),
  );

  // Range row — the shared dual-thumb slider primitive. Initial value: the
  // committed filter clamped into the field's extent, else the full extent
  // (no filter). A degenerate extent (constant field) renders disabled —
  // two movable thumbs over one value would be a lie.
  const host = dom.el("div", { class: CONST.CLASSES.FILTER_SLIDER });
  const initial: [number, number] =
    model.filter?.kind === "atom" && model.filter.range
      ? [
          Math.max(model.range[0], Math.min(model.range[1], model.filter.range[0])),
          Math.max(model.range[0], Math.min(model.range[1], model.filter.range[1])),
        ]
      : [model.range[0], model.range[1]];
  const slider = new Slider(host, {
    min: model.range[0],
    max: model.range[1],
    step: model.step,
    value: initial,
    label: ui.T("filter_range"),
    labels: [ui.T("filter_range_min"), ui.T("filter_range_max")],
    values: { min: fmtValue(model.range[0]), max: fmtValue(model.range[1]) },
    format: fmtValue,
    disabled: model.range[0] === model.range[1],
    // Live preview and commit go through the same owner write — the owner
    // is idempotent on an unchanged filter, so the second call is a no-op.
    input: value => {
      if (Array.isArray(value)) cap.filterSetter(atom(model.field, value));
    },
    change: value => {
      if (Array.isArray(value)) cap.filterSetter(atom(model.field, value));
    },
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
  clearBtn.addEventListener("click", () => {
    cap.filterSetter(undefined);
    refreshResult(ui, cap, slider, result, model.total);
  });
  const footer = dom.el(
    "div",
    {},
    dom.el("hr", { class: "foliplus-section-divider" }),
    dom.el("div", { class: "foliplus-btn-row" }, clearBtn),
  );

  refreshResult(ui, cap, slider, result, model.total);

  return dom.el("div", {}, fieldRow, rangeRow, resultRow, footer);
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

  // With the capability the panel is a live view; without it the empty
  // state explains why the entry was clickable anyway (a stale row).
  const model = cap?.filterProvider() ?? null;
  content.appendChild(
    cap && model ? buildFilterRows(ui, cap, model) : buildEmptyState(ui),
  );

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
    const t = event.target as HTMLElement | null;
    if (!t || typeof t.closest !== "function") {
      closeFilterPanel(ui, false);
      return;
    }
    if (t.closest(`.${CONST.CLASSES.FILTER_PANEL}`)) {
      ui.listPanel.pressInPanel = true;
      return;
    }
    ui.listPanel.pressInPanel = false;
    closeFilterPanel(ui, false);
  };
  document.addEventListener("mousedown", ui.overlayPanel.filterOutsideHandler, true);

  ui.overlayPanel.activeFilterPanel = { item, panel, layerId };
};

/** Empty state: the row declares no filterable data (no source selected,
 *  or no numeric field on the snapshot). The message is the panel's body;
 *  the entry is never silently dead. */
const buildEmptyState = (ui: LayerUI): HTMLElement =>
  dom.el("div", { class: CONST.CLASSES.FILTER_EMPTY }, ui.T("filter_empty"));

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

export { openFilterPanel, closeFilterPanel };
