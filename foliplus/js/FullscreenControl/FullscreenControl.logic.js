// FullscreenControl core logic — toggleFullscreen, updateUI, event handling.
// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
import { HINT_DURATION } from "../common/hint.js";
import { createTranslator } from "../common/locale.js";
import { getFullscreenEl, isEnabled, nativeAPI } from "./FullscreenControl.api.js";
import { CLASSES, containerId } from "./FullscreenControl.const.js";
import * as SVGs from "./FullscreenControl.icon.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const foliplus = window.foliplus;
const _ = createTranslator(CONF);

// ══════════════════════════════════════════════════════════════════════════════
// updateUI (internal)  —  refresh icon, title, sibling/self visibility, hint
// ══════════════════════════════════════════════════════════════════════════════
const updateUI = (map, fsBtn, container) => {
  const isFull = !!getFullscreenEl() || map.isFullscreen;
  fsBtn.innerHTML = isFull ? SVGs.MINIMIZE : SVGs.MAXIMIZE;
  fsBtn.title = isFull ? _(`${CONF.name}.title_cancel`) : _(`${CONF.name}.title`);

  if (CONF.hide_others) {
    const controls = map
      .getContainer()
      .querySelectorAll(".leaflet-control, .foliplus-scale-wrap");
    const cid = containerId(CONF.name, CONF.position);
    for (const c of controls) {
      if (c.contains(container) || c.closest?.(`#${cid}`)) continue;
      c.classList.toggle(CLASSES.HIDDEN, isFull);
    }
  }

  if (CONF.hide_self) {
    const selfBtns = container.querySelectorAll(
      `.${CLASSES.TOGGLE}, .${CLASSES.ZOOM_IN}, .${CLASSES.ZOOM_OUT}`,
    );
    for (const btn of selfBtns) btn.classList.toggle(CLASSES.HIDDEN, isFull);
  }

  foliplus?.showHint?.(
    CONF.name,
    isFull ? _(`${CONF.name}.enter`) : _(`${CONF.name}.exit`),
    HINT_DURATION.MEDIUM,
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// toggleFullscreen  —  enter/exit fullscreen via native API or pseudo mode
// ══════════════════════════════════════════════════════════════════════════════
const toggleFullscreen = (map, fsBtn, container) => {
  if (getFullscreenEl() || map.isFullscreen) {
    if (isEnabled) {
      document[nativeAPI.exitFullscreen]()
        .then(() => {
          map.isFullscreen = false;
        })
        .catch(() => {
          map.isFullscreen = !!getFullscreenEl();
          updateUI(map, fsBtn, container);
        });
      return;
    } else {
      map._container.classList.remove(CLASSES.PSEUDO_FULLSCREEN);
      map.invalidateSize();
    }
    map.isFullscreen = false;
  } else {
    if (isEnabled) {
      map._container[nativeAPI.requestFullscreen]()
        .then(() => {
          map.isFullscreen = true;
        })
        .catch(() => {
          map.isFullscreen = !!getFullscreenEl();
          updateUI(map, fsBtn, container);
        });
      return;
    } else {
      map._container.classList.add(CLASSES.PSEUDO_FULLSCREEN);
      map.invalidateSize();
    }
    map.isFullscreen = true;
  }
  updateUI(map, fsBtn, container);
};

// ══════════════════════════════════════════════════════════════════════════════
// bindFullscreenEvents  —  wire up fullscreenchange + unload listeners
// ══════════════════════════════════════════════════════════════════════════════
const bindFullscreenEvents = (map, fsBtn, container) => {
  const handleFSChange = () => {
    map.isFullscreen = !!getFullscreenEl();
    updateUI(map, fsBtn, container);
  };

  if (isEnabled) document.addEventListener(nativeAPI.fullscreenchange, handleFSChange);
  map.on("unload", () => {
    if (isEnabled)
      document.removeEventListener(nativeAPI.fullscreenchange, handleFSChange);
  });

  return handleFSChange;
};

export { bindFullscreenEvents, toggleFullscreen, updateUI };
