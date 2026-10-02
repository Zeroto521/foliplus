import { defineControl } from "#core/defineControl.js";
import { ensureHint } from "#core/hint.js";
import { createIconButton, dom } from "#common/dom.js";
import * as Icons from "#common/icon.js";
import { locateMe, removeMarker } from "./logic.js";

// AMap-style crosshair locate icon (stroke-rendered, inherits common button SVG styles).
const LOCATE_ICON = `
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="6"/>
    <circle cx="12" cy="12" r="1.8"/>
    <line x1="12" y1="1.5" x2="12" y2="5"/>
    <line x1="12" y1="19" x2="12" y2="22.5"/>
    <line x1="1.5" y1="12" x2="5" y2="12"/>
    <line x1="19" y1="12" x2="22.5" y2="12"/>
  </svg>`;

// Idle crosshair + shared foliplus spinner, toggled by the .loading button class.
const BTN_HTML = `
  <span class="locate-btn-icon">${LOCATE_ICON}</span>
  <span class="locate-btn-loading">${Icons.LOADING_ICON}</span>`;

const LocateControl = defineControl({
  config: CONFIG,
  icon: LOCATE_ICON,
  setup: () => ensureHint(map),
  buildDOM(this: any) {
    const outer = dom.el("div", { class: "leaflet-bar leaflet-control" });
    const container = dom.el("div", { class: "foliplus-ctrl-fold", parent: outer });
    this.btn = createIconButton({
      class: "foliplus-tool-btn foliplus-locate-btn",
      title: this.T("title"),
      ariaLabel: this.T("title"),
      svg: BTN_HTML,
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
  },
  destroy(this: any) {
    removeMarker(this);
  },
});

new LocateControl({ position: CONFIG.position }).addTo(map);
