import { createControlEnv } from "#core/controlEnv.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import { dom } from "#common/dom.js";
import { createScopedTranslator } from "#common/locale.js";
import { bindOutsideCollapse, bindPanelToggle } from "#common/panel.js";
import * as SVGs from "./icon.js";
import { LayerManager, patchBringToFront, unpatchBringToFront } from "./manager.js";
import { panelHTML } from "./template.js";
import { LayerUI } from "./ui/index.js";

createControlEnv(CONF, SVGs.LAYERS);
const T = createScopedTranslator(CONF);

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
    const container = dom.el("div", { class: "leaflet-bar leaflet-control" });
    container.innerHTML = panelHTML(T);

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    bindPanelToggle({
      container: container.querySelector(".foliplus-layer-ctrl") as HTMLElement,
      toggleBtn: ".foliplus-toggle-btn",
      header: ".foliplus-panel-header",
    });

    // Same panel-dismiss contract as the heatmap panel: a click anywhere
    // outside the control collapses it. disableClickPropagation on the
    // container keeps in-panel clicks (including inside selects) from
    // reaching this document-level listener.
    bindOutsideCollapse({
      container: container.querySelector(".foliplus-layer-ctrl") as HTMLElement,
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
