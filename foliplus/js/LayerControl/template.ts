// LayerControl DOM template — isolated from logic for maintainability.
// Static HTML is built via innerHTML (see copilot-instructions: "static
// templates use innerHTML"); dynamic/conditional rendering uses dom.el.
import * as Icons from "#common/icon.js";
import * as SVGs from "./icon.js";

/** Build the panel HTML string. */
const panelHTML = (_: (key: string) => string): string => /* html */`
  <div class="foliplus-panel foliplus-ctrl-fold foliplus-layer-ctrl collapsed" id="${CONF.name}_ctrl">
    <button class="foliplus-toggle-btn" title="${_(`${CONF.name}.toggle_title`)}" aria-label="${_(`${CONF.name}.toggle_title`)}">
      ${SVGs.LAYERS}
    </button>
    <div class="foliplus-layer-panel" role="dialog" aria-label="${_(`${CONF.name}.panel_title`)}">
      <div class="foliplus-panel-header" title="${_(`${CONF.name}.close_title`)}">
        <span class="foliplus-header-title">
          <span class="foliplus-header-icon">${SVGs.LAYERS}</span>
          ${_(`${CONF.name}.panel_title`)}
        </span>
        <button class="foliplus-ctrl-btn foliplus-close-btn" title="${_(`${CONF.name}.close_title`)}" aria-label="${_(`${CONF.name}.close_title`)}">
          ${Icons.CLOSE}
        </button>
      </div>
      <div class="foliplus-panel-content"></div>
    </div>
  </div>`;

export { panelHTML };
