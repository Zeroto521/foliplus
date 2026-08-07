import * as ICONS from "./FullscreenControl.icon.js";
import { CONST, containerId } from "./FullscreenControl.const.js";
import { toggleFullscreen, bindFullscreenEvents } from "./FullscreenControl.logic.js";

(function () {
  const foliplus = window.foliplus || {};
  if (!foliplus || !foliplus.SVGs) {
    console.error(`[${CONST.name}] foliplus runtime not found, plugin disabled.`);
    return;
  }

  const CONF = window.foliplus.CONFIG.FullscreenControl;
  const cid = containerId(CONF.position);

  const _ = (k) => (foliplus.gt ? foliplus.gt(k) : k);
  foliplus.registerHintIcon(CONST.name, ICONS.MAXIMIZE);

  class FullscreenControl extends L.Control {
    onAdd() {
      if (map.zoomControl) map.removeControl(map.zoomControl);
      else {
        const zoomEl = map.getContainer().querySelector(".leaflet-control-zoom");
        if (zoomEl) zoomEl.remove();
      }

      const outer = foliplus.dom.el("div", { class: "leaflet-bar leaflet-control", id: cid });
      const container = foliplus.dom.el("div", {
        class: `${CONST.CLASSES.FULLSCREEN_BAR} foliplus-ctrl-fold`,
        parent: outer,
      });

      foliplus.dom.el("button", {
        class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.ZOOM_IN}`,
        "aria-label": _(`${CONST.name}.zoom_in`), title: _(`${CONST.name}.zoom_in`),
        parent: container,
        onclick: (e) => { L.DomEvent.stopPropagation(e); map.zoomIn(); },
      }, { html: ICONS.ZOOM_IN });

      foliplus.dom.el("button", {
        class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.ZOOM_OUT}`,
        "aria-label": _(`${CONST.name}.zoom_out`), title: _(`${CONST.name}.zoom_out`),
        parent: container,
        onclick: (e) => { L.DomEvent.stopPropagation(e); map.zoomOut(); },
      }, { html: ICONS.ZOOM_OUT });

      const fsBtn = foliplus.dom.el("button", {
        class: `${CONST.CLASSES.TOOL_BTN} ${CONST.CLASSES.FS_TOGGLE}`,
        "aria-label": _(`${CONST.name}.title`), title: _(`${CONST.name}.title`),
        parent: container,
        onclick: (e) => { L.DomEvent.stopPropagation(e); toggleFullscreen(map, fsBtn, container); },
      }, { html: ICONS.MAXIMIZE });

      L.DomEvent.disableClickPropagation(outer);
      L.DomEvent.disableScrollPropagation(outer);

      bindFullscreenEvents(map, fsBtn, container);

      return outer;
    }
  }

  new FullscreenControl({ position: CONF.position }).addTo(map);
})();
