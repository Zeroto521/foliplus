import { BaseControl } from "#foliplus/BaseControl.js";
import { createIconButton, dom } from "#common/dom.js";
import { createControlEnv } from "#common/guard.js";
import { isEnabled, nativeAPI } from "./api.js";
import { CLASSES, containerId } from "./const.js";
import * as SVGs from "./icon.js";
import { bindFullscreenEvents, toggleFullscreen } from "./logic.js";

const { _ } = createControlEnv(CONF, SVGs.MAXIMIZE);

class FullscreenControl extends BaseControl {
  declare fsHandler: () => void;

  buildDOM() {
    if (map.zoomControl) map.removeControl(map.zoomControl);
    else {
      const zoomEl = map.getContainer().querySelector(".leaflet-control-zoom");
      if (zoomEl) zoomEl.remove();
    }

    const outer = dom.el("div", {
      class: "leaflet-bar leaflet-control",
      id: containerId(CONF.name, CONF.position as string),
    });
    const container = dom.el("div", {
      class: "foliplus-ctrl-fold foliplus-fullscreen-bar",
      parent: outer,
    });

    createIconButton({
      class: `${CLASSES.TOOL_BTN} ${CLASSES.ZOOM_IN}`,
      title: _(`${CONF.name}.zoom_in`),
      ariaLabel: _(`${CONF.name}.zoom_in`),
      svg: SVGs.ZOOM_IN,
      parent: container,
      onclick: event => {
        L.DomEvent.stopPropagation(event);
        map.zoomIn();
      },
    });

    createIconButton({
      class: `${CLASSES.TOOL_BTN} ${CLASSES.ZOOM_OUT}`,
      title: _(`${CONF.name}.zoom_out`),
      ariaLabel: _(`${CONF.name}.zoom_out`),
      svg: SVGs.ZOOM_OUT,
      parent: container,
      onclick: event => {
        L.DomEvent.stopPropagation(event);
        map.zoomOut();
      },
    });

    const fsBtn = createIconButton({
      class: `${CLASSES.TOOL_BTN} ${CLASSES.TOGGLE}`,
      title: _(`${CONF.name}.title`),
      ariaLabel: _(`${CONF.name}.title`),
      svg: SVGs.MAXIMIZE,
      parent: container,
      onclick: event => {
        L.DomEvent.stopPropagation(event);
        toggleFullscreen(map, fsBtn, container);
      },
    });

    L.DomEvent.disableClickPropagation(outer);
    L.DomEvent.disableScrollPropagation(outer);
    this.fsHandler = bindFullscreenEvents(map, fsBtn, container);

    return outer;
  }

  destroy() {
    if (this.fsHandler && isEnabled) {
      document.removeEventListener(nativeAPI!.fullscreenchange, this.fsHandler);
    }
  }
}

new FullscreenControl({ position: CONF.position }).addTo(map);
