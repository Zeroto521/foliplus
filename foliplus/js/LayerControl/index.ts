import { createControlEnv } from "#core/controlEnv.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import { createScopedTranslator } from "#common/locale.js";
import { createPanelControl } from "#common/panel.js";
import * as SVGs from "./icon.js";
import { LayerManager, patchBringToFront, unpatchBringToFront } from "./manager.js";
import { LayerUI } from "./ui/index.js";

createControlEnv(CONF, SVGs.LAYERS);
const T = createScopedTranslator(CONF);

// ==================== Manager Factory ====================
// The manager is created lazily on first use and re-created after destroy(),
// so `map.removeControl()` + `map.addControl()` on the same control object
// is re-entrant. Each rendered IIFE gets its own factory (see BaseControl.py).
const createLayerManager = (): LayerManager => {
  const manager = new LayerManager(map, CONF.data as LayerInfo[]);
  manager.ui = new LayerUI(manager);
  return manager;
};

// ==================== Leaflet Control Definition ====================
class LayerControl extends BaseControl {
  manager: LayerManager | null = null;

  constructor(options?: L.ControlOptions) {
    super(options);
  }

  /** Shorthand for manager (creates it on first access). */
  get m(): LayerManager {
    return (this.manager ??= createLayerManager());
  }

  buildDOM() {
    patchBringToFront();
    const { container, panelContent, destroy } = createPanelControl({
      cssClass: "foliplus-layer-ctrl",
      ctrlId: `${CONF.name}_ctrl`,
      toggleTitle: T("toggle_title"),
      toggleSvg: SVGs.LAYERS,
      panelTitle: T("panel_title"),
      closeTitle: T("close_title"),
    });

    // The factory's document listeners outlive the MutationObserver when the
    // control is detached but kept around, so hand its unbind to the base
    // class for teardown on remove.
    this.trackCleanup(destroy);

    this.m.attachUI(panelContent);

    return container;
  }

  /** Never touch `this.m` here: destroy() must not re-create the manager. */
  destroy() {
    this.manager?.destroy();
    this.manager = null;
    unpatchBringToFront();
  }
}

new LayerControl({ position: CONF.position }).addTo(map);
