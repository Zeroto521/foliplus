import { createControlEnv } from "#core/controlEnv.js";
import { ensureHint } from "#core/hint.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import { createIconButton, dom } from "#common/dom.js";
import { createScopedTranslator } from "#common/locale.js";
import { FULLSCREEN_CHANGE, isEnabled } from "./api.js";
import { CLASSES, containerId } from "./const.js";
import * as SVGs from "./icon.js";
import { makeFullscreenChangeHandler, toggleFullscreen } from "./logic.js";

createControlEnv(CONF, SVGs.MAXIMIZE);
const T = createScopedTranslator(CONF);
ensureHint(map);

class FullscreenControl extends BaseControl {
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
      title: T("zoom_in"),
      ariaLabel: T("zoom_in"),
      svg: SVGs.ZOOM_IN,
      parent: container,
      onclick: event => {
        L.DomEvent.stopPropagation(event);
        map.zoomIn();
      },
    });

    createIconButton({
      class: `${CLASSES.TOOL_BTN} ${CLASSES.ZOOM_OUT}`,
      title: T("zoom_out"),
      ariaLabel: T("zoom_out"),
      svg: SVGs.ZOOM_OUT,
      parent: container,
      onclick: event => {
        L.DomEvent.stopPropagation(event);
        map.zoomOut();
      },
    });

    const fsBtn = createIconButton({
      class: `${CLASSES.TOOL_BTN} ${CLASSES.TOGGLE}`,
      title: T("title"),
      ariaLabel: T("title"),
      svg: SVGs.MAXIMIZE,
      parent: container,
      onclick: event => {
        L.DomEvent.stopPropagation(event);
        toggleFullscreen(map, fsBtn, container);
      },
    });

    L.DomEvent.disableClickPropagation(outer);
    L.DomEvent.disableScrollPropagation(outer);

    // Document-level fullscreenchange, owned by the mounting's signal: the
    // listener drops with the control, so a map torn down while fullscreen is
    // on leaves nothing behind.
    if (isEnabled()) {
      this.on(
        document,
        FULLSCREEN_CHANGE,
        makeFullscreenChangeHandler(map, fsBtn, container),
      );
    }

    return outer;
  }
}

new FullscreenControl({ position: CONF.position }).addTo(map);
