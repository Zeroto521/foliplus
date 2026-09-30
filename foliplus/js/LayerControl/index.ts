import { defineControl } from "#core/defineControl.js";
import { createPanelControl } from "#common/panel.js";
import * as SVGs from "./icon.js";
import {
  LayerManager,
  installBringToFrontPatch,
  uninstallBringToFrontPatch,
} from "./manager.js";
import { LayerUI } from "./ui/index.js";

const LayerControl = defineControl<LayerManager>({
  conf: CONF,
  icon: SVGs.LAYERS,
  createManager: env => {
    const manager = new LayerManager(map, env.conf.data as LayerInfo[]);
    manager.ui = new LayerUI(manager);
    return manager;
  },
  buildDOM(this: any) {
    installBringToFrontPatch();
    const { container, panelContent, destroy } = createPanelControl({
      cssClass: "foliplus-layer-ctrl",
      ctrlId: `${this.conf.name}_ctrl`,
      toggleTitle: this.T("toggle_title"),
      toggleSvg: SVGs.LAYERS,
      panelTitle: this.T("panel_title"),
      closeTitle: this.T("close_title"),
      collapseOnOutside: this.conf.collapse_on_outside,
    });

    // The factory's document listeners outlive the MutationObserver when the
    // control is detached but kept around, so hand its unbind to the base
    // class for teardown on remove.
    this.effect(() => destroy);

    this.m.attachUI(panelContent);

    return container;
  },
  destroy(this: any) {
    this.manager?.destroy();
    uninstallBringToFrontPatch();
  },
});

new LayerControl({ position: CONF.position }).addTo(map);
