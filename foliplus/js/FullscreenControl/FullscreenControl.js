import { requireRuntime } from "../shared/guard.js";
import { createTranslator } from "../shared/locale.js";
import { CLASSES, containerId } from "./FullscreenControl.const.js";
import * as SVGs from "./FullscreenControl.icon.js";
import { bindFullscreenEvents, toggleFullscreen } from "./FullscreenControl.logic.js";

const CONF = window.foliplus.CONFIG.FullscreenControl;
requireRuntime(CONF.name);

const foliplus = window.foliplus;
const _ = createTranslator(CONF);
foliplus.registerHintIcon(CONF.name, SVGs.MAXIMIZE);

class FullscreenControl extends L.Control {
  onAdd() {
    if (map.zoomControl) map.removeControl(map.zoomControl);
    else {
      const zoomEl = map.getContainer().querySelector(".leaflet-control-zoom");
      if (zoomEl) zoomEl.remove();
    }

    const outer = foliplus.dom.el("div", {
      class: "leaflet-bar leaflet-control",
      id: containerId(CONF.name, CONF.position),
    });
    const container = foliplus.dom.el("div", {
      class: "foliplus-ctrl-fold foliplus-fullscreen-bar",
      parent: outer,
    });

    foliplus.dom.el(
      "button",
      {
        class: `${CLASSES.TOOL_BTN} ${CLASSES.ZOOM_IN}`,
        "aria-label": _(`${CONF.name}.zoom_in`),
        title: _(`${CONF.name}.zoom_in`),
        parent: container,
        onclick: (e) => {
          L.DomEvent.stopPropagation(e);
          map.zoomIn();
        },
      },
      { html: SVGs.ZOOM_IN },
    );

    foliplus.dom.el(
      "button",
      {
        class: `${CLASSES.TOOL_BTN} ${CLASSES.ZOOM_OUT}`,
        "aria-label": _(`${CONF.name}.zoom_out`),
        title: _(`${CONF.name}.zoom_out`),
        parent: container,
        onclick: (e) => {
          L.DomEvent.stopPropagation(e);
          map.zoomOut();
        },
      },
      { html: SVGs.ZOOM_OUT },
    );

    const fsBtn = foliplus.dom.el(
      "button",
      {
        class: `${CLASSES.TOOL_BTN} ${CLASSES.TOGGLE}`,
        "aria-label": _(`${CONF.name}.title`),
        title: _(`${CONF.name}.title`),
        parent: container,
        onclick: (e) => {
          L.DomEvent.stopPropagation(e);
          toggleFullscreen(map, fsBtn, container);
        },
      },
      { html: SVGs.MAXIMIZE },
    );

    L.DomEvent.disableClickPropagation(outer);
    L.DomEvent.disableScrollPropagation(outer);

    bindFullscreenEvents(map, fsBtn, container);

    return outer;
  }
}

new FullscreenControl({ position: CONF.position }).addTo(map);
