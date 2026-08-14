import { BaseControl } from "#common/BaseControl.js";
import { createIconButton, dom } from "#common/dom.js";
import { createControlEnv } from "#common/guard.js";
import { locateMe } from "./LocateControl.logic.js";

// ── SVG Icons ──
// AMap-style crosshair locate icon (stroke-rendered, inherits common button SVG styles).
const LOCATE = `
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="6"/>
    <circle cx="12" cy="12" r="1.8"/>
    <line x1="12" y1="1.5" x2="12" y2="5"/>
    <line x1="12" y1="19" x2="12" y2="22.5"/>
    <line x1="1.5" y1="12" x2="5" y2="12"/>
    <line x1="19" y1="12" x2="22.5" y2="12"/>
  </svg>`;

const { _ } = createControlEnv(CONF, LOCATE);

// ==================== Control Definition ====================
class LocateControl extends BaseControl {
  declare container: HTMLElement;
  declare marker: L.Marker | null;

  buildDOM() {
    const outer = dom.el("div", { class: "leaflet-bar leaflet-control" });
    const container = dom.el("div", { class: "foliplus-ctrl-fold", parent: outer });
    createIconButton({
      class: "foliplus-tool-btn foliplus-locate-btn",
      title: _(`${CONF.name}.title`),
      ariaLabel: _(`${CONF.name}.title`),
      svg: LOCATE,
      parent: container,
      onclick: event => {
        L.DomEvent.stopPropagation(event);
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
