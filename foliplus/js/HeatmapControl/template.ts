// HeatmapControl DOM template — isolated from logic for maintainability.
// Static HTML is built via innerHTML; dynamic/conditional rendering uses dom.el.
//
// Key elements use `data-hm-*` attributes so ui.ts can find them via querySelector.

/** Build the panel-content HTML string (data section + style section). */
const panelContentHTML = (_: (key: string) => string): string => /* html */ `
<div class="foliplus-heatmap-config-body">

  <div class="foliplus-heatmap-section-heading">
    ${_(`${CONF.name}.section_data`)}
  </div>

  <div class="foliplus-heatmap-form-row">
    <label class="foliplus-heatmap-form-label">${_(`${CONF.name}.layer`)}</label>
    <div class="foliplus-heatmap-form-control">
      <select class="foliplus-heatmap-form-select" data-hm-layer></select>
    </div>
  </div>

  <div class="foliplus-heatmap-extra-body hidden" data-hm-extra-body>

    <div class="foliplus-heatmap-form-row">
      <label class="foliplus-heatmap-form-label">${_(`${CONF.name}.agg_method`)}</label>
      <div class="foliplus-heatmap-form-control">
        <select class="foliplus-heatmap-form-select" data-hm-agg>
          <option value="count">${_(`${CONF.name}.agg_count`)}</option>
          <option value="sum">${_(`${CONF.name}.agg_sum`)}</option>
          <option value="avg">${_(`${CONF.name}.agg_avg`)}</option>
          <option value="min">${_(`${CONF.name}.agg_min`)}</option>
          <option value="max">${_(`${CONF.name}.agg_max`)}</option>
        </select>
      </div>
    </div>

    <div class="foliplus-heatmap-form-row foliplus-heatmap-field hidden" data-hm-field>
      <label class="foliplus-heatmap-form-label">${_(`${CONF.name}.field`)}</label>
      <div class="foliplus-heatmap-form-control">
        <select class="foliplus-heatmap-form-select" data-hm-field-select></select>
      </div>
    </div>

    <div class="foliplus-heatmap-section-heading">
      ${_(`${CONF.name}.section_style`)}
    </div>

    <div class="foliplus-heatmap-section-block">

      <div class="foliplus-heatmap-form-row">
        <label class="foliplus-heatmap-form-label">${_(`${CONF.name}.class_method`)}</label>
        <div class="foliplus-heatmap-form-control foliplus-heatmap-form-inline">
          <select class="foliplus-heatmap-form-select" data-hm-method>
            <option value="jenks">${_(`${CONF.name}.jenks`)}</option>
            <option value="quantile">${_(`${CONF.name}.quantile`)}</option>
            <option value="equal">${_(`${CONF.name}.equal`)}</option>
            <option value="heads">${_(`${CONF.name}.heads`)}</option>
          </select>
          <select class="foliplus-heatmap-form-select foliplus-heatmap-class-select" data-hm-class-count>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
            <option value="6">6</option>
            <option value="7">7</option>
            <option value="8">8</option>
            <option value="9">9</option>
          </select>
        </div>
      </div>

      <div class="foliplus-heatmap-form-row">
        <label class="foliplus-heatmap-form-label">${_(`${CONF.name}.scheme`)}</label>
        <div class="foliplus-heatmap-form-control" data-hm-scheme-ctrl>
          <div class="foliplus-heatmap-scheme-bar" tabindex="0" role="combobox">
            <div class="foliplus-heatmap-scheme-bar-inner"></div>
          </div>
          <select class="hidden" data-hm-scheme-hidden></select>
        </div>
      </div>

      <div class="foliplus-heatmap-form-row">
        <label class="foliplus-heatmap-form-label">${_(`${CONF.name}.border`)}</label>
        <div class="foliplus-heatmap-form-control foliplus-heatmap-form-inline">
          <input class="foliplus-heatmap-color-input" type="color" data-hm-border-color>
          <input class="foliplus-heatmap-weight-input" type="number" min="0" max="10" step="0.5" data-hm-border-weight>
        </div>
      </div>

      <div class="foliplus-heatmap-form-row foliplus-heatmap-section-block-last">
        <label class="foliplus-heatmap-form-label">${_(`${CONF.name}.label`)}</label>
        <div class="foliplus-heatmap-form-control">
          <label class="foliplus-heatmap-toggle-switch">
            <input type="checkbox" data-hm-label-chk>
            <span class="foliplus-heatmap-toggle-slider"></span>
          </label>
        </div>
      </div>

    </div>

    <hr class="foliplus-section-divider">

    <div class="foliplus-heatmap-btn-row">
      <button class="foliplus-heatmap-btn foliplus-heatmap-btn-clear" data-hm-btn-clear>${_(`${CONF.name}.clear`)}</button>
      <button class="foliplus-heatmap-btn foliplus-heatmap-btn-confirm" data-hm-btn-confirm>${_(`${CONF.name}.confirm`)}</button>
    </div>

  </div>
</div>`;

export { panelContentHTML };
