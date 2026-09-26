// Delegated style panel — for layers that own their style via styleSetters
// (third-party canvas layers: heatmap, measure). Moved verbatim from
// ui/style.ts (34.1). Owns the delegation probe used by the ⋮ menu, and the
// "Label" drawer that layers their own setters alongside LayerControl's
// opacity / zoom-range rows.
import { type LabelStyleValues, renderLabelControls } from "#core/labelControl.js";
import { dom } from "#common/dom.js";
import {
  BORDER_WEIGHT,
  bindLiveColor,
  bindLiveNumber,
  colorInput,
  inlineControls,
  numberInput,
} from "#common/form.js";
import { createRowPanel } from "#common/panel.js";
import * as CONST from "../../const.js";
import * as SVGs from "../../icon.js";
import type { LayerUI } from "../index.js";
import { appendResetFooter, sectionHeading } from "./frame.js";
import { buildOpacityRow, layerCanOpacity } from "./opacity.js";
import { buildZoomRangeRow, canShowZoomRange } from "./zoomRange.js";

/** Whether the layer delegates its style to the drawer via styleSetters
 *  (third-party canvas layers: Heatmap, Measure). The ⋮ menu's Style item
 *  also enables for these. */
const layerHasStyleDelegation = (ui: LayerUI, layerId: string): boolean => {
  const li = ui.m.layerRegistry.get(layerId);
  return !!li?.styleSetters && Object.keys(li.styleSetters).length > 0;
};

/** Build the border-style row for a delegated layer (only HeatmapControl
 *  publishes borderWeight / borderColor today). Shares the color+number
 *  inline chrome with the label color/size row so the drawer stays visually
 *  consistent. Returns null when the layer publishes no border setters. */
const buildBorderRow = (ui: LayerUI, layerId: string): HTMLElement | null => {
  const li = ui.m.layerRegistry.get(layerId);
  const setters = li?.styleSetters;
  if (!setters || (!setters.borderWeight && !setters.borderColor)) return null;

  // Re-read the registry at event time so a layer torn down between open and
  // interaction no-ops (the setter map is gone).
  const entry = () => ui.m.layerRegistry.get(layerId);
  const values = (entry()?.styleProvider?.() ?? {}) as {
    borderWeight?: number;
    borderColor?: string;
  };

  const parts: HTMLElement[] = [];
  if (setters.borderColor) {
    const colorInputEl = colorInput({
      value: values.borderColor,
      ariaLabel: ui._("foliplus.border_color"),
    });
    bindLiveColor(colorInputEl as HTMLInputElement, value =>
      entry()?.styleSetters?.borderColor?.(value),
    );
    parts.push(colorInputEl);
  }
  if (setters.borderWeight) {
    const numberInputEl = numberInput({
      value:
        typeof values.borderWeight === "number"
          ? values.borderWeight
          : BORDER_WEIGHT.DEFAULT,
      min: BORDER_WEIGHT.MIN,
      max: BORDER_WEIGHT.MAX,
      step: BORDER_WEIGHT.STEP,
      ariaLabel: ui._("foliplus.border_weight"),
    });
    bindLiveNumber(numberInputEl as HTMLInputElement, {
      min: BORDER_WEIGHT.MIN,
      max: BORDER_WEIGHT.MAX,
      fallback: BORDER_WEIGHT.DEFAULT,
      onCommit: value => entry()?.styleSetters?.borderWeight?.(value),
    });
    parts.push(numberInputEl);
  }

  return dom.el(
    "div",
    { class: CONST.CLASSES.FORM_ROW },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("border")),
    dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, inlineControls(...parts)),
  );
};

/** Build the style panel DOM for a layer that delegates its style via
 *  styleSetters (third-party canvas layers). Renders only the controls the
 *  component declared. Reset is present only when the layer also supplies
 *  styleDefaults (the Python CONF snapshot). Returns null when the layer has
 *  no delegation (falls through to the annotation panel). */
const renderDelegatedStylePanel = (
  ui: LayerUI,
  layerId: string,
): HTMLElement | null => {
  const li = ui.m.layerRegistry.get(layerId);
  const setters = li?.styleSetters;
  if (!setters || Object.keys(setters).length === 0) return null;

  // Both hooks re-read the registry instead of closing over the entry fetched
  // above: re-registering a layer swaps in a fresh LayerInfo object, so a
  // drawer left open across that swap must follow the new entry — and no-op
  // once its setters are gone.
  const entry = () => ui.m.layerRegistry.get(layerId);
  const { root, refresh: baseRefresh } = renderLabelControls({
    styleProvider: () => entry()?.styleProvider?.() as LabelStyleValues | undefined,
    getSetters: () => entry()?.styleSetters ?? {},
    T: ui._,
  });

  // Border row (HeatmapControl only today) — a separate section heading so the
  // drawer's Label vs. component-specific styling reads as two groups.
  let borderRow: HTMLElement | null = null;
  if (setters.borderWeight || setters.borderColor) {
    borderRow = buildBorderRow(ui, layerId);
  }

  // No presentation control at all (a data-only setter such as the
  // aggregation field) means no drawer: the Layer section below is
  // LayerControl-owned, but it is not a reason to open one.
  if (!root.children.length && !borderRow) return null;

  // Refresh label controls and (if present) the border inputs off styleProvider,
  // skipping whatever is under activeElement. Wired in after the border row is
  // attached so the shared root's DOM queries see it.
  ui.styleRefresh = () => {
    baseRefresh();
    if (!borderRow) return;
    const v = entry()?.styleProvider?.() as
      { borderWeight?: number; borderColor?: string } | undefined;
    if (!v) return;
    const colorEl = borderRow.querySelector(
      "input[type=color]",
    ) as HTMLInputElement | null;
    if (colorEl && document.activeElement !== colorEl) {
      if (typeof v.borderColor === "string") colorEl.value = v.borderColor;
    }
    const numEl = borderRow.querySelector(
      "input[type=number]",
    ) as HTMLInputElement | null;
    if (numEl && document.activeElement !== numEl) {
      if (typeof v.borderWeight === "number") numEl.value = String(v.borderWeight);
    }
  };

  // The shared renderer emits controls only, no headings — the panel owns the
  // section split, and the Layer section (border, opacity, zoom range) belongs
  // to LayerControl rather than to the component that delegates its label
  // style. Prepend the label heading so it sits above its controls.
  root.prepend(sectionHeading(ui.T("section_label")));
  // Row-level capability gate (5.4): the opacity row only renders when the
  // surface can honestly carry the write. A layer with `opacity: "none"`
  // (MarkerCluster) would otherwise see a slider that writes nothing but
  // persists the value — a lie that survives reload (6.2). The border row is
  // LayerControl-owned too (its setter lives on styleSetters, not the layer's
  // setStyle), so a third-party layer that publishes only border setters and
  // cannot carry opacity or zoom range still owns the Layer section — otherwise
  // the border row would render orphaned under the label heading.
  if (
    layerCanOpacity(ui, layerId) ||
    canShowZoomRange(ui, layerId) ||
    !!borderRow
  ) {
    root.append(sectionHeading(ui.T("section_layer")));
    if (borderRow) root.append(borderRow);
    if (layerCanOpacity(ui, layerId)) root.append(buildOpacityRow(ui, layerId));
    if (canShowZoomRange(ui, layerId)) root.append(buildZoomRangeRow(ui, layerId));
  }

  const { panel, content } = createRowPanel({
    cssClass: CONST.CLASSES.STYLE_PANEL,
    title: ui.T("style_layer"),
    iconSvg: SVGs.STYLE,
    closeTitle: ui.T("close_title"),
    iconClass: "foliplus-layer-style-icon foliplus-header-icon",
  });
  content.append(root);

  // Reset only when the component published its Python CONF defaults.
  if (li.styleDefaults) appendResetFooter(ui, content);
  return panel;
};

export { buildBorderRow, layerHasStyleDelegation, renderDelegatedStylePanel };
