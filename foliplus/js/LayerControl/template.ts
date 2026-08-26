// LayerControl DOM template — isolated from logic for maintainability.
// Static HTML is built via innerHTML (see copilot-instructions: "static
// templates use innerHTML"); dynamic/conditional rendering uses dom.el.
import * as Icons from "#common/icon.js";
import * as SVGs from "./icon.js";

/** Build the panel HTML string. */
import { createScopedTranslator } from "#common/locale.js";

const panelHTML = (): string => {
  const T = createScopedTranslator(CONF);
  return /* html */ `
  <div class="foliplus-panel foliplus-ctrl-fold foliplus-layer-ctrl collapsed" id="${CONF.name}_ctrl">
    <button class="foliplus-toggle-btn" title="${T("toggle_title")}" aria-label="${T("toggle_title")}">
      ${SVGs.LAYERS}
    </button>
    <div class="foliplus-layer-panel" role="dialog" aria-label="${T("panel_title")}">
      <div class="foliplus-panel-header" title="${T("close_title")}">
        <span class="foliplus-header-title">
          <span class="foliplus-header-icon">${SVGs.LAYERS}</span>
          ${T("panel_title")}
        </span>
        <button class="foliplus-ctrl-btn foliplus-close-btn" title="${T("close_title")}" aria-label="${T("close_title")}">
          ${Icons.CLOSE}
        </button>
      </div>
      <div class="foliplus-panel-content"></div>
    </div>
  </div>`;
};

export { panelHTML };
