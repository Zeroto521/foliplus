// HeatmapControl DOM template — isolated from logic for maintainability.
// Static HTML is built via innerHTML; dynamic/conditional rendering uses dom.el.
//
// Key elements use `data-heatmap-*` attributes so ui.ts can find them via querySelector.
// Form rows, selects, and the toggle reuse the shared common/form.css
// primitives (foliplus-form-*); component-specific controls (scheme bar,
// color/weight inputs) keep their own classes.
import * as CONST from "./const.js";
import { PANEL_CLASS } from "#ui/index.js";

// Template placement decision (#729 review): this template stays
// Heatmap-specific. Only the scheme row's trigger + hidden select are
// picker-owned markup, and Heatmap is still the picker's only consumer, so a
// common template helper would add an abstraction with one caller — and it
// would have to keep this HTML byte-for-byte identical anyway (the Python
// rendering tests pin the rendered panel). Revisit when a second control adopts
// ui/schemePicker; the picker's contract is the trigger element plus an
// optional hidden select passed to createSchemePicker.
/** Build the panel-content HTML string (data rows, then the style rows). */
const panelContentHTML = (T: (key: string) => string): string => /* html */ `
<div class="${CONST.CLASSES.CONFIG_BODY}">
  <div class="${PANEL_CLASS.FORM_ROW}">
    <label class="${PANEL_CLASS.FORM_LABEL}">${T("layer")}</label>
    <div class="${PANEL_CLASS.FORM_CONTROL}">
      <select class="foliplus-input-skin foliplus-form-select" ${CONST.DATA_ATTR.LAYER}></select>
    </div>
  </div>

  <div class="${CONST.CLASSES.EXTRA_BODY} foliplus-hidden" ${CONST.DATA_ATTR.EXTRA_BODY}>

    <div class="${PANEL_CLASS.FORM_ROW}">
      <label class="${PANEL_CLASS.FORM_LABEL}">${T("agg_method")}</label>
      <div class="${PANEL_CLASS.FORM_CONTROL}">
        <select class="foliplus-input-skin foliplus-form-select" ${CONST.DATA_ATTR.AGG}>
          <option value="${CONST.AGG.COUNT}">${T("agg_count")}</option>
          <option value="${CONST.AGG.SUM}">${T("agg_sum")}</option>
          <option value="${CONST.AGG.AVG}">${T("agg_avg")}</option>
          <option value="${CONST.AGG.MIN}">${T("agg_min")}</option>
          <option value="${CONST.AGG.MAX}">${T("agg_max")}</option>
        </select>
      </div>
    </div>

    <!-- Field / Classes / Scheme are built by core/rampForm (shared with
         LayerControl's fill ramp) and mounted here; this template keeps only
         the panel shell + the heatmap-specific Layer/Agg/Clear rows. -->
    <div class="${CONST.CLASSES.SECTION_BLOCK}" ${CONST.DATA_ATTR.RAMP_ROWS}></div>

    <hr class="foliplus-section-divider">

    <div class="${CONST.CLASSES.BTN_ROW}">
      <button class="${PANEL_CLASS.PANEL_BTN} ${CONST.CLASSES.BTN_CLEAR}" ${CONST.DATA_ATTR.BTN_CLEAR}>${T("clear")}</button>
    </div>

  </div>
</div>`;

export { panelContentHTML };
