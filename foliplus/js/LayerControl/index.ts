import { createControlEnv } from "#core/controlEnv.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import { createScopedTranslator } from "#common/locale.js";
import { createPanelControl } from "#common/panel.js";
import * as SVGs from "./icon.js";
import { LayerManager, patchBringToFront, unpatchBringToFront } from "./manager.js";
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
    const { container, panelContent } = createPanelControl({
      cssClass: "foliplus-layer-ctrl",
      ctrlId: `${CONF.name}_ctrl`,
      toggleTitle: T("toggle_title"),
      toggleSvg: SVGs.LAYERS,
      panelTitle: T("panel_title"),
      closeTitle: T("close_title"),
    });

    this.m.attachUI(panelContent);

    return container;
  }

  destroy() {
    this.m.destroy();
    unpatchBringToFront();
  }
}

new LayerControl({ position: CONF.position }).addTo(map);
