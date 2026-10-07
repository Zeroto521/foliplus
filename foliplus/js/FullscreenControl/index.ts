import { defineControl } from "#core/defineControl.js";
import { ensureHint } from "#core/hint.js";
import { createIconButton, dom } from "#common/dom.js";
import { FULLSCREEN_CHANGE, isEnabled } from "./api.js";
import { CLASSES, containerId } from "./const.js";
import * as SVGs from "./icon.js";
import { buildFullscreenChangeHandler, toggleFullscreen } from "./logic.js";

const FullscreenControl = defineControl({
  config: CONFIG,
  icon: SVGs.ICON_MAXIMIZE,
  setup: () => ensureHint(map),
  buildDOM(this: any) {
    if (map.zoomControl) map.removeControl(map.zoomControl);
    else {
      const zoomEl = map.getContainer().querySelector(".leaflet-control-zoom");
      if (zoomEl) zoomEl.remove();
    }

    const outer = dom.el("div", {
      class: "leaflet-bar leaflet-control",
      id: containerId(this.config.name, this.config.position as string),
    });
    const container = dom.el("div", {
      class: "foliplus-ctrl-fold foliplus-fullscreen-bar",
      parent: outer,
    });

    createIconButton({
      class: `${CLASSES.TOOL_BTN} ${CLASSES.ZOOM_IN}`,
      title: this.T("zoom_in"),
      ariaLabel: this.T("zoom_in"),
      svg: SVGs.ICON_ZOOM_IN,
      parent: container,
      onclick: event => {
        L.DomEvent.stopPropagation(event);
        map.zoomIn();
      },
    });

    createIconButton({
      class: `${CLASSES.TOOL_BTN} ${CLASSES.ZOOM_OUT}`,
      title: this.T("zoom_out"),
      ariaLabel: this.T("zoom_out"),
      svg: SVGs.ICON_ZOOM_OUT,
      parent: container,
      onclick: event => {
        L.DomEvent.stopPropagation(event);
        map.zoomOut();
      },
    });

    const fsBtn = createIconButton({
      class: `${CLASSES.TOOL_BTN} ${CLASSES.TOGGLE}`,
      title: this.T("title"),
      ariaLabel: this.T("title"),
      svg: SVGs.ICON_MAXIMIZE,
      parent: container,
      onclick: event => {
        L.DomEvent.stopPropagation(event);
        toggleFullscreen(map, fsBtn, container, { config: this.config, T: this.T });
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
        buildFullscreenChangeHandler(map, fsBtn, container, {
          config: this.config,
          T: this.T,
        }),
      );
    }

    return outer;
  },
});

new FullscreenControl({ position: CONFIG.position }).addTo(map);
