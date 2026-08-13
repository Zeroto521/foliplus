import { BaseControl } from "#common/BaseControl.js";
import { createIconButton, dom } from "#common/dom.js";
import { createControlEnv } from "#common/guard.js";
import { CLASSES } from "./LocateControl.const.js";
import * as SVGs from "./LocateControl.icon.js";
import { locateMe } from "./LocateControl.logic.js";

const { _ } = createControlEnv(CONF, SVGs.LOCATE);

// ==================== Control Definition ====================
class LocateControl extends BaseControl {
  declare container: HTMLElement;
  declare marker: L.Marker | null;

  buildDOM() {
    const outer = dom.el("div", {
      class: "leaflet-bar leaflet-control",
    });
    const btn = createIconButton({
      class: CLASSES.BTN,
      title: _(`${CONF.name}.title`),
      ariaLabel: _(`${CONF.name}.title`),
      svg: SVGs.LOCATE,
      parent: outer,
      onclick: e => {
        L.DomEvent.stopPropagation(e);
        locateMe(this);
      },
    });

    L.DomEvent.disableClickPropagation(outer);
    L.DomEvent.disableScrollPropagation(outer);
    this.container = outer;
    return outer;
  }

  destroy() {
    if (this.marker) map.removeLayer(this.marker);
    this.marker = null;
  }
}

new LocateControl({ position: CONF.position }).addTo(map);
