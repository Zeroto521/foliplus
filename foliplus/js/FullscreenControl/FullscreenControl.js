import * as ICONS from "./FullscreenControl.icon.js";
import { CLASSES, containerId } from "./FullscreenControl.const.js";
import { toggleFullscreen, bindFullscreenEvents } from "./FullscreenControl.logic.js";
import { requireRuntime } from "../runtime/runtime.guard.js";

(function () {
  const CONF = window.foliplus.CONFIG.FullscreenControl;
  if (!requireRuntime(CONF.name)) return;

  const foliplus = window.foliplus;
  const _ = (k) => (foliplus.gt ? foliplus.gt(k) : k);
  foliplus.registerHintIcon(CONF.name, ICONS.MAXIMIZE);

  const cid = containerId(CONF.name, CONF.position);

  class FullscreenControl extends L.Control {
    onAdd() {
      if (map.zoomControl) map.removeControl(map.zoomControl);
      else {
        const zoomEl = map.getContainer().querySelector(".leaflet-control-zoom");
        if (zoomEl) zoomEl.remove();
      }

      const outer = foliplus.dom.el("div", { class: "leaflet-bar leaflet-control", id: cid });
      const container = foliplus.dom.el("div", {
        class: `${CLASSES.FULLSCREEN_BAR} foliplus-ctrl-fold`,
        parent: outer,
      });

      foliplus.dom.el("button", {
        class: `${CLASSES.TOOL_BTN} ${CLASSES.ZOOM_IN}`,
        "aria-label": _(`${CONF.name}.zoom_in`), title: _(`${CONF.name}.zoom_in`),
        parent: container,
        onclick: (e) => { L.DomEvent.stopPropagation(e); map.zoomIn(); },
      }, { html: ICONS.ZOOM_IN });

      foliplus.dom.el("button", {
        class: `${CLASSES.TOOL_BTN} ${CLASSES.ZOOM_OUT}`,
        "aria-label": _(`${CONF.name}.zoom_out`), title: _(`${CONF.name}.zoom_out`),
        parent: container,
        onclick: (e) => { L.DomEvent.stopPropagation(e); map.zoomOut(); },
      }, { html: ICONS.ZOOM_OUT });

      const fsBtn = foliplus.dom.el("button", {
        class: `${CLASSES.TOOL_BTN} ${CLASSES.FS_TOGGLE}`,
        "aria-label": _(`${CONF.name}.title`), title: _(`${CONF.name}.title`),
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
