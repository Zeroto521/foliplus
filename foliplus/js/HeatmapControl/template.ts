// HeatmapControl DOM template — isolated from logic for maintainability.
// Static HTML is built via innerHTML; dynamic/conditional rendering uses dom.el.
//
// Key elements use `data-hm-*` attributes so ui.ts can find them via querySelector.
import * as CONST from "./const.js";

/** Build the panel-content HTML string (data section + style section). */
const panelContentHTML = (T: (key: string) => string): string => /* html */ `
<div class="foliplus-heatmap-config-body">
  <div class="foliplus-heatmap-section-heading">
    ${T("section_data")}
  </div>

  <div class="foliplus-heatmap-form-row">
    <label class="foliplus-heatmap-form-label">${T("layer")}</label>
    <div class="foliplus-heatmap-form-control">
      <select class="foliplus-heatmap-form-select" ${CONST.DATA_ATTR.LAYER}></select>
    </div>
  </div>

  <div class="foliplus-heatmap-extra-body hidden" ${CONST.DATA_ATTR.EXTRA_BODY}>

    <div class="foliplus-heatmap-form-row">
      <label class="foliplus-heatmap-form-label">${T("agg_method")}</label>
      <div class="foliplus-heatmap-form-control">
        <select class="foliplus-heatmap-form-select" ${CONST.DATA_ATTR.AGG}>
          <option value="${CONST.AGG.COUNT}">${T("agg_count")}</option>
          <option value="${CONST.AGG.SUM}">${T("agg_sum")}</option>
          <option value="${CONST.AGG.AVG}">${T("agg_avg")}</option>
          <option value="${CONST.AGG.MIN}">${T("agg_min")}</option>
          <option value="${CONST.AGG.MAX}">${T("agg_max")}</option>
        </select>
      </div>
    </div>

    <div class="foliplus-heatmap-form-row foliplus-heatmap-field hidden" ${CONST.DATA_ATTR.FIELD}>
      <label class="foliplus-heatmap-form-label">${T("field")}</label>
      <div class="foliplus-heatmap-form-control">
        <select class="foliplus-heatmap-form-select" ${CONST.DATA_ATTR.FIELD_SELECT}></select>
      </div>
    </div>

    <div class="foliplus-heatmap-section-heading">
      ${T("section_style")}
    </div>

    <div class="foliplus-heatmap-section-block">
      <div class="foliplus-heatmap-form-row">
        <label class="foliplus-heatmap-form-label">${T("class_method")}</label>
        <div class="foliplus-heatmap-form-control foliplus-heatmap-form-inline">
          <select class="foliplus-heatmap-form-select" ${CONST.DATA_ATTR.METHOD}>
            <option value="${CONST.METHOD.JENKS}">${T("jenks")}</option>
            <option value="${CONST.METHOD.QUANTILE}">${T("quantile")}</option>
            <option value="${CONST.METHOD.EQUAL}">${T("equal")}</option>
            <option value="${CONST.METHOD.HEADS}">${T("heads")}</option>
          </select>
          <select class="foliplus-heatmap-form-select foliplus-heatmap-class-select" ${CONST.DATA_ATTR.CLASS_COUNT}>
            <option value="${CONST.CLASS_COUNT.MIN}">${CONST.CLASS_COUNT.MIN}</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
            <option value="6">6</option>
            <option value="7">7</option>
            <option value="8">8</option>
            <option value="${CONST.CLASS_COUNT.MAX}">${CONST.CLASS_COUNT.MAX}</option>
          </select>
        </div>
      </div>

      <div class="foliplus-heatmap-form-row">
        <label class="foliplus-heatmap-form-label">${T("scheme")}</label>
        <div class="foliplus-heatmap-form-control" ${CONST.DATA_ATTR.SCHEME_CTRL}>
          <div class="foliplus-heatmap-scheme-bar" tabindex="0" role="combobox">
            <div class="foliplus-heatmap-scheme-bar-inner"></div>
          </div>
          <select class="hidden" ${CONST.DATA_ATTR.SCHEME_HIDDEN}></select>
        </div>
      </div>

      <div class="foliplus-heatmap-form-row">
        <label class="foliplus-heatmap-form-label">${T("border")}</label>
        <div class="foliplus-heatmap-form-control foliplus-heatmap-form-inline">
          <input class="foliplus-heatmap-color-input" type="color" ${CONST.DATA_ATTR.BORDER_COLOR}>
          <input class="foliplus-heatmap-weight-input" type="number" min="${CONST.BORDER.WEIGHT_MIN}" max="${CONST.BORDER.WEIGHT_MAX}" step="${CONST.BORDER.WEIGHT_STEP}" ${CONST.DATA_ATTR.BORDER_WEIGHT}>
        </div>
      </div>

      <div class="foliplus-heatmap-form-row foliplus-heatmap-section-block-last">
        <label class="foliplus-heatmap-form-label">${T("label")}</label>
        <div class="foliplus-heatmap-form-control">
          <label class="foliplus-heatmap-toggle-switch">
            <input type="checkbox" ${CONST.DATA_ATTR.LABEL_CHK}>
            <span class="foliplus-heatmap-toggle-slider"></span>
          </label>
        </div>
      </div>

    </div>

    <hr class="foliplus-section-divider">

    <div class="foliplus-heatmap-btn-row">
      <button class="foliplus-heatmap-btn foliplus-heatmap-btn-clear" ${CONST.DATA_ATTR.BTN_CLEAR}>${T("clear")}</button>
      <button class="foliplus-heatmap-btn foliplus-heatmap-btn-confirm" ${CONST.DATA_ATTR.BTN_CONFIRM}>${T("confirm")}</button>
    </div>

  </div>
</div>`;

export { panelContentHTML };
