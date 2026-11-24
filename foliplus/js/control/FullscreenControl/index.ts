import { FULLSCREEN_CHANGE } from "./api.js";
import { CLASSES, containerId } from "./const.js";
import * as SVGs from "./icon.js";
import {
  buildFullscreenChangeHandler,
  releasePseudo,
  toggleFullscreen,
} from "./logic.js";
import { defineControl } from "#core/lifecycle/index.js";
import { ensureHint } from "#core/overlay/index.js";
import { createIconButton, dom } from "#platform/dom.js";
import { PANEL_CLASS } from "#ui/index.js";

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
      class: `${PANEL_CLASS.FOLD} ${CLASSES.FULLSCREEN_BAR}`,
      parent: outer,
    });

    createIconButton({
      class: `${PANEL_CLASS.TOOL_BTN} ${CLASSES.ZOOM_IN}`,
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
      class: `${PANEL_CLASS.TOOL_BTN} ${CLASSES.ZOOM_OUT}`,
      title: this.T("zoom_out"),
      ariaLabel: this.T("zoom_out"),
      svg: SVGs.ICON_ZOOM_OUT,
      parent: container,
      onclick: event => {
        L.DomEvent.stopPropagation(event);
        map.zoomOut();
      },
    });

    // Captured once here rather than read inside the handler: the mounting's
    // signal getter throws after removal, and the button's own onclick is a raw
    // DOM listener with nothing to unbind it.
    const signal = this.signal;

    const fsBtn = createIconButton({
      class: `${PANEL_CLASS.TOOL_BTN} ${CLASSES.TOGGLE}`,
      title: this.T("title"),
      ariaLabel: this.T("title"),
      svg: SVGs.ICON_MAXIMIZE,
      parent: container,
      onclick: event => {
        L.DomEvent.stopPropagation(event);
        toggleFullscreen(map, fsBtn, container, {
          config: this.config,
          T: this.T,
          signal,
        });
      },
    });

    L.DomEvent.disableClickPropagation(outer);
    L.DomEvent.disableScrollPropagation(outer);

    // Document-level fullscreenchange, owned by the mounting's signal: the
    // listener drops with the control, so a map torn down while fullscreen is
    // on leaves nothing behind. Bound unconditionally — permission can appear
    // after mount (embedder relaxes its iframe policy), and this handler is
    // the only thing that re-syncs the UI on native transitions.
    this.on(
      document,
      FULLSCREEN_CHANGE,
      buildFullscreenChangeHandler(map, fsBtn, container, {
        config: this.config,
        T: this.T,
      }),
    );

    // The pseudo session is this mounting's resource: the toggle is the only
    // user gesture that can end it, and the mounting can go away mid-session
    // (map.removeControl()). Nothing else strips the class — a stale
    // leaflet-pseudo-fullscreen makes fullscreenSurface() resolve every
    // body-level overlay's host to a container that no longer exists. Cleanups
    // run while the mounting's signal is still live, so the in-flight native
    // paths see a release, not a torn-down map.
    this.effect(() => () => releasePseudo(map));

    return outer;
  },
});

new FullscreenControl({ position: CONFIG.position }).addTo(map);
