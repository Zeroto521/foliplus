import { defineControl } from "#core/defineControl.js";
import { createPanelControl } from "#core/leaflet/index.js";
import type { LayerData } from "#foliplus/config-schema.js";
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
    // The registry seed is the CONF row plus the two author-payload fields.
    // They are read through `LayerData` (the schema type) rather than trusted
    // through the `LayerInfo` cast below: the cast erases the bridge, so a
    // payload Python ships but the schema does not declare arrives as
    // `undefined` with tsc silent — which is exactly what happened to
    // `fillAuthor` before #804 declared it. The cast stays because a CONF row
    // is a registration seed, not a full registry record: the registry derives
    // kind, carrier, panes and the rest.
    const seed = (env.config.data ?? []).map((row: LayerData[number]) => ({
      ...row,
      fillAuthor: row.fillAuthor ?? null,
      zoomRange: row.zoomRange ?? null,
    }));
    const manager = new LayerController(map, seed as LayerInfo[], {
      T: env.T,
      log: env.log,
    });
    manager.ui = new LayerUI(manager, { T: env.T, _: env._, log: env.log });
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
