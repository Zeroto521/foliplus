// Delegated style panel — for layers that own their style via styleSetters
// (third-party canvas layers: heatmap, measure). Moved verbatim from
// ui/style.ts. Owns the delegation probe used by the ⋮ menu, and the
// "Label" drawer that layers their own setters alongside LayerControl's
// opacity / zoom-range rows.
import { type LabelStyleValues, renderLabelControls } from "#core/labelControl.js";
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
  const { root, refresh } = renderLabelControls({
    styleProvider: () => entry()?.styleProvider?.() as LabelStyleValues | undefined,
    getSetters: () => entry()?.styleSetters ?? {},
    T: ui._,
  });
  // No presentation control at all (a data-only setter such as the
  // aggregation field) means no drawer: the Layer section below is
  // LayerControl-owned, but it is not a reason to open one.
  if (!root.children.length) return null;
  ui.styleRefresh = refresh;

  // The shared renderer emits controls only, no headings — the panel owns the
  // section split, and the Layer section (opacity) belongs to LayerControl
  // rather than to the component that delegates its label style.
  root.prepend(sectionHeading(ui.T("section_label")));
  // Row-level capability gate (5.4): the opacity row only renders when the
  // surface can honestly carry the write. A layer with `opacity: "none"`
  // (MarkerCluster) would otherwise see a slider that writes nothing but
  // persists the value — a lie that survives reload (6.2).
  if (layerCanOpacity(ui, layerId) || canShowZoomRange(ui, layerId)) {
    root.append(sectionHeading(ui.T("section_layer")));
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

export { layerHasStyleDelegation, renderDelegatedStylePanel };
