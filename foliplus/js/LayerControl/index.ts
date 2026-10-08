import { defineControl } from "#core/defineControl.js";
import { createPanelControl } from "#core/leaflet/index.js";
import {
  LayerController,
  installBringToFrontPatch,
  uninstallBringToFrontPatch,
} from "./controller.js";
import * as SVGs from "./icon.js";
import { LayerUI } from "./ui/index.js";

const LayerControl = defineControl<LayerController>({
  config: CONFIG,
  icon: SVGs.ICON_LAYERS,
  createManager: env => {
    const manager = new LayerController(map, env.config.data as LayerInfo[], {
      T: env.T,
      log: env.log,
    });
    manager.ui = new LayerUI(manager, { T: env.T, _: env._ });
    return manager;
  },
  buildDOM(this: any) {
    installBringToFrontPatch();
    const { container, panelContent, destroy } = createPanelControl({
      cssClass: "foliplus-layer-ctrl",
      ctrlId: `${this.config.name}_ctrl`,
      toggleTitle: this.T("toggle_title"),
      toggleSvg: SVGs.ICON_LAYERS,
      panelTitle: this.T("panel_title"),
      closeTitle: this.T("close_title"),
      collapseOnOutside: this.config.collapse_on_outside,
    });

    // The factory's document listeners outlive the MutationObserver when the
    // control is detached but kept around, so hand its unbind to the base
    // class for teardown on remove.
    this.effect(() => destroy);

    this.mgr.attachUI(panelContent);

    return container;
  },
  destroy(this: any) {
    this.manager?.destroy();
    uninstallBringToFrontPatch();
  },
});

new LayerControl({ position: CONFIG.position }).addTo(map);
