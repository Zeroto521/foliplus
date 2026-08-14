import { BaseControl } from "#common/BaseControl.js";
import { dom } from "#common/dom.js";
import { createControlEnv } from "#common/guard.js";
import * as Icons from "#common/icon.js";
import { bindPanelToggle } from "#common/panel.js";
import * as SVGs from "./icon.js";
import {
  LayerManager,
  patchBringToFront,
  unpatchBringToFront,
} from "./manager.js";
import { LayerUI } from "./ui.js";

const { _ } = createControlEnv(CONF, SVGs.LAYERS);

// ==================== Initialize Manager with Data ====================
const layerManager = new LayerManager(map, CONF.data as LayerInfo[]);
layerManager.ui = new LayerUI(layerManager);

// ==================== Leaflet Control Definition ====================
class LayerControl extends BaseControl {
  declare manager: LayerManager;

  constructor(options?: L.ControlOptions) {
    super(options);
    this.manager = layerManager;
  }

  /** Shorthand for manager */
  get m() {
    return this.manager;
  }

  buildDOM() {
    patchBringToFront();
    const container = dom.el("div", {
      class: "leaflet-bar leaflet-control",
    });

    container.innerHTML = `
        <div class="foliplus-panel foliplus-ctrl-fold foliplus-layer-ctrl collapsed"
             id="${CONF.name}_ctrl">
          <button class="foliplus-toggle-btn" title="${_(`${CONF.name}.toggle_title`)}"
                  aria-label="${_(`${CONF.name}.toggle_title`)}">
            ${SVGs.LAYERS}
          </button>
          <div class="foliplus-layer-panel" role="dialog" aria-label="${_(`${CONF.name}.panel_title`)}">
            <div class="foliplus-panel-header" title="${_(`${CONF.name}.close_title`)}">
              <span class="foliplus-header-title">
                <span class="foliplus-header-icon">${SVGs.LAYERS}</span>
                ${_(`${CONF.name}.panel_title`)}
              </span>
              <button class="foliplus-ctrl-btn foliplus-close-btn" title="${_(`${CONF.name}.close_title`)}"
                      aria-label="${_(`${CONF.name}.close_title`)}">
                ${Icons.CLOSE}
              </button>
            </div>
            <div class="foliplus-panel-content"></div>
          </div>
        </div>
      `;

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    bindPanelToggle({
      container: container.querySelector(".foliplus-layer-ctrl") as HTMLElement,
      toggleBtn: ".foliplus-toggle-btn",
      header: ".foliplus-panel-header",
    });

    this.m.attachUI(container.querySelector(".foliplus-panel-content") as HTMLElement);

    return container;
  }

  destroy() {
    this.m.destroy();
    unpatchBringToFront();
  }
}

new LayerControl({ position: CONF.position }).addTo(map);
