import { dom } from "../common/dom.js";
import { requireRuntime } from "../common/guard.js";
import * as Icons from "../common/icon.js";
import { createTranslator } from "../common/locale.js";
import { bindPanelToggle } from "../common/panel.js";
import * as SVGs from "./LayerControl.icon.js";
import {
  LayerManager,
  patchBringToFront,
  unpatchBringToFront,
} from "./LayerControl.manager.js";
import { LayerUI } from "./LayerControl.ui.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
requireRuntime(CONF.name);

const foliplus = window.foliplus;
const _ = createTranslator(CONF);

foliplus.registerHintIcon(CONF.name, SVGs.LAYERS);

// ==================== Initialize Manager with Data ====================
const initialData = CONF.initialData;

const layerManager = new LayerManager(map, initialData);
layerManager.ui = new LayerUI(layerManager);

// ==================== Leaflet Control Definition ====================
class LayerControl extends L.Control {
  constructor(options) {
    super(options);
    this.manager = layerManager;
  }

  onAdd() {
    patchBringToFront();
    const container = dom.el("div", {
      class: "leaflet-bar leaflet-control",
    });

    container.innerHTML = `
        <div class="foliplus-panel foliplus-ctrl-fold foliplus-layer-ctrl collapsed"
             id="LayerControl_ctrl">
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
      container: container.querySelector(".foliplus-layer-ctrl"),
      toggleBtn: ".foliplus-toggle-btn",
      header: ".foliplus-panel-header",
    });

    this.manager.attachUI(container.querySelector(".foliplus-panel-content"));

    return container;
  }

  onRemove() {
    this.manager.destroy();
    unpatchBringToFront();
  }
}

new LayerControl({ position: CONF.position }).addTo(map);
