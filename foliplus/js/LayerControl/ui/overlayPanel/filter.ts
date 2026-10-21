// LayerControl UI — Layer filter panel (stage 2 pilot).
//
// Opens from the ⋮ menu on a layer row that carries a filterable point
// snapshot (Heatmap pilot: point layers with at least one numeric field).
// Renders a single-field dual-thumb slider on the snapshot's first
// numeric key. The slider writes a `{kind:"atom", op:"between"}` filter
// to `LayerRuntimeStore.filter` and emits `LAYER_FILTER_CHANGE`;
// consumers (today: HeatmapControl) re-run their pipeline off the
// filtered subset.
//
// The filter lives on the layer itself (`layers[id].filter` in stage 3
// via the intent protocol; in stage 2 it stays in the runtime store,
// same shape as `snapshot` / `fields`). Consumers read the *same* store,
// so a filter set here lands on every downstream reader with no second
// write path.
//
// Panel shell follows `attr.ts` verbatim: `createRowPanel` for the
// surface, capture-phase document mousedown for dismiss (the control
// disables click propagation, so bubble-phase never reaches `document`),
// and a per-panel outside-handler field on `OverlayPanel` so a peer
// panel can tell the two apart.
import { EVENTS } from "#core/event/index.js";
import {
  type LayerFilter,
  type LayerSnapshot,
  buildLayerSnapshot,
  select as selectSnapshot,
} from "#core/layer/index.js";
import { createRowPanel } from "#core/leaflet/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import * as SVGs from "#foliplus/LayerControl/icon.js";
import { dom } from "#common/dom.js";
import { formatNumber } from "#common/format.js";
import { SLIDER } from "#common/sliderVocabulary.js";
import { displayName } from "../listPanel/rowView.js";
import type { LayerUI } from "../surface.js";
import { closeOverlays } from "../teardown.js";

/** Format a count for the "kept / total" readout. `int` keeps the number
 *  locale-agnostic — the readout is a UI fact, not a display value. */
const fmtCount = (n: number): string => formatNumber(n, "comma", "en", 0);

/** Refresh the "kept / total" row from a live filter against the snapshot.
 *  `kept` counts points that match; `total` is the snapshot's size —
 *  matches the design's "N of M kept" phrasing. */
const updateCount = (
  count: HTMLElement,
  snapshot: LayerSnapshot,
  filter: LayerFilter,
): void => {
  const kept = selectSnapshot(snapshot, filter).length;
  const total = snapshot.points.length;
  count.textContent = `${fmtCount(kept)} / ${fmtCount(total)}`;
};

/** Open the filter panel for a given layer row. Stage 2 pilot: one field,
 *  one `between` band, driven by a dual-thumb slider. The renderer writes
 *  the same `FilterAtom` shape the AST module owns, so a stage-3 grouped
 *  renderer can consume the same store entry without a data migration. */
const openFilterPanel = (ui: LayerUI, item: HTMLElement): void => {
  closeOverlays(ui);

  const layerId = item.getAttribute(CONST.DATA.LAYER_ID) ?? "";
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return;
  const layer = layerInfo.layer;
  if (!layer) return;

  // Snapshot is built lazily and cached on the runtime row; the fields
  // cache is invalidated at the same points (label.ts `invalidateFields`
  // also drops the snapshot).
  let snapshot = ui.runtimeStore.getSnapshot(layerId);
  if (!snapshot) {
    snapshot = buildLayerSnapshot(layer, ui.log);
    ui.runtimeStore.setSnapshot(layerId, snapshot);
  }

  const numericField = snapshot.numericFields[0];
  const range: readonly [number, number] = numericField
    ? (snapshot.ranges[numericField] ?? [0, 0])
    : [0, 0];

  const initialFilter: LayerFilter = numericField
    ? {
        kind: "atom",
        field: numericField,
        op: "between",
        range: [range[0], range[1]],
      }
    : undefined;

  const initialRange: [number, number] =
    initialFilter?.kind === "atom" && initialFilter.range
      ? [initialFilter.range[0], initialFilter.range[1]]
      : [range[0], range[1]];

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

  // Build the row (empty state, or the slider row) inside content.
  const buildRow = (): HTMLElement => {
    if (!numericField) {
      return dom.el("div", { class: CONST.CLASSES.FILTER_EMPTY }, ui.T("filter_empty"));
    }
    const [lo0, hi0] = initialRange;

    const fill = dom.el("div", {
      class: `${SLIDER.FILL} ${CONST.CLASSES.FILTER_FILL}`,
      style: "left:0;right:0",
    });
    const dot = (suffix: string): HTMLElement =>
      dom.el("span", {
        class:
          `${SLIDER.DOT} ${SLIDER.DOT}${suffix}` +
          ` ${CONST.CLASSES.FILTER_DOT} ${CONST.CLASSES.FILTER_DOT}${suffix}`,
      });
    const minInput = dom.el("input", {
      type: "range",
      class: CONST.CLASSES.FILTER_MIN,
      min: String(range[0]),
      max: String(range[1]),
      step: "any",
      value: String(lo0),
      "aria-label": ui.T("filter_range_min"),
    }) as HTMLInputElement;
    const maxInput = dom.el("input", {
      type: "range",
      class: CONST.CLASSES.FILTER_MAX,
      min: String(range[0]),
      max: String(range[1]),
      step: "any",
      value: String(hi0),
      "aria-label": ui.T("filter_range_max"),
    }) as HTMLInputElement;
    const track = dom.el(
      "div",
      { class: `${SLIDER.RAIL} ${CONST.CLASSES.FILTER_TRACK}` },
      fill,
      dot("-min"),
      dot("-max"),
      minInput,
      maxInput,
    );
    const values = dom.el(
      "div",
      { class: `${SLIDER.VALUES} ${CONST.CLASSES.FILTER_VALUES}` },
      dom.el("span", {}, fmtCount(range[0])),
      dom.el("span", {}, fmtCount(range[1])),
    );
    const control = dom.el(
      "div",
      { class: `${SLIDER.ROOT} ${CONST.CLASSES.FILTER_ROW}` },
      track,
      values,
    );

    const label = dom.el(
      "div",
      { class: CONST.CLASSES.FORM_ROW },
      dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("filter_field")),
      dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, numericField),
    );
    const count = dom.el("div", { class: "foliplus-filter-count" });
    updateCount(count, snapshot, initialFilter);

    // Live pass: clamp [lo, hi] into the snapshot's bounds, invert on
    // inversion, write to runtime store, emit the change, update the
    // count row. The consumer reads the store, not the payload, so the
    // payload is a signal, not a data pipe — same contract as
    // LAYER_INTENT_CHANGE's id-only sibling.
    const live = (rawLo: number, rawHi: number): void => {
      let lo = Math.max(range[0], Math.min(range[1], rawLo));
      let hi = Math.max(range[0], Math.min(range[1], rawHi));
      if (lo > hi) [lo, hi] = [hi, lo];
      minInput.value = String(lo);
      maxInput.value = String(hi);
      const total = range[1] - range[0];
      const loPct = total > 0 ? ((lo - range[0]) / total) * 100 : 0;
      const hiPct = total > 0 ? ((hi - range[0]) / total) * 100 : 100;
      fill.style.left = `${loPct}%`;
      fill.style.right = `calc(100% - ${hiPct}%)`;
      const filter: LayerFilter = {
        kind: "atom",
        field: numericField,
        op: "between",
        range: [lo, hi],
      };
      ui.runtimeStore.setFilter(layerId, filter);
      ui.events.emit(EVENTS.LAYER_FILTER_CHANGE, { id: layerId, filter });
      updateCount(count, snapshot, filter);
    };

    minInput.addEventListener("input", e => {
      live(Number((e.target as HTMLInputElement).value), Number(maxInput.value));
    });
    maxInput.addEventListener("input", e => {
      live(Number(minInput.value), Number((e.target as HTMLInputElement).value));
    });

    return dom.el("div", {}, label, control, count);
  };

  content.appendChild(buildRow());

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
  ui.overlayPanel.activeFilterPanel.panel.remove();
  ui.overlayPanel.activeFilterPanel = null;
  if (setFocus) item.focus();
};

export { openFilterPanel, closeFilterPanel };
