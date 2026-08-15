// FullscreenControl core logic — toggleFullscreen, updateUI, event handling.
// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
import { HINT_DURATION } from "#core/hint.js";
import { createTranslator } from "#common/locale.js";
import { getFullscreenEl, isEnabled, nativeAPI } from "./api.js";
import { CLASSES, containerId } from "./const.js";
import * as SVGs from "./icon.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const foliplus = window.foliplus;
const _ = createTranslator(CONF);

// ══════════════════════════════════════════════════════════════════════════════
// updateUI (internal)  —  refresh icon, title, sibling/self visibility, hint
// ══════════════════════════════════════════════════════════════════════════════
const updateUI = (map: L.Map, fsBtn: HTMLElement, container: HTMLElement) => {
  const isFull = !!getFullscreenEl() || map.isFullscreen;
  fsBtn.innerHTML = isFull ? SVGs.MINIMIZE : SVGs.MAXIMIZE;
  fsBtn.title = isFull ? _(`${CONF.name}.title_cancel`) : _(`${CONF.name}.title`);

  if (CONF.hide_others) {
    const controls = map
      .getContainer()
      .querySelectorAll(".leaflet-control, .foliplus-scale-wrap");
    const cid = containerId(CONF.name, CONF.position as string);
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
const toggleFullscreen = (map: L.Map, fsBtn: HTMLElement, container: HTMLElement) => {
  if (getFullscreenEl() || map.isFullscreen) {
    if (isEnabled) {
      (document as unknown as Record<string, () => Promise<void>>)
        [nativeAPI!.exitFullscreen]()
        .then(() => {
          map.isFullscreen = false;
        })
        .catch(() => {
          map.isFullscreen = !!getFullscreenEl();
          updateUI(map, fsBtn, container);
        });
      return;
    } else {
      map.getContainer().classList.remove(CLASSES.PSEUDO_FULLSCREEN);
      map.invalidateSize();
    }
    map.isFullscreen = false;
  } else {
    if (isEnabled) {
      (map.getContainer() as unknown as Record<string, () => Promise<void>>)
        [nativeAPI!.requestFullscreen]()
        .then(() => {
          map.isFullscreen = true;
        })
        .catch(() => {
          map.isFullscreen = !!getFullscreenEl();
          updateUI(map, fsBtn, container);
        });
      return;
    } else {
      map.getContainer().classList.add(CLASSES.PSEUDO_FULLSCREEN);
      map.invalidateSize();
    }
    map.isFullscreen = true;
  }
  updateUI(map, fsBtn, container);
};

// ══════════════════════════════════════════════════════════════════════════════
// bindFullscreenEvents  —  wire up fullscreenchange + unload listeners
// ══════════════════════════════════════════════════════════════════════════════
const bindFullscreenEvents = (
  map: L.Map,
  fsBtn: HTMLElement,
  container: HTMLElement,
) => {
  const handleFSChange = () => {
    map.isFullscreen = !!getFullscreenEl();
    updateUI(map, fsBtn, container);
  };

  if (isEnabled) document.addEventListener(nativeAPI!.fullscreenchange, handleFSChange);
  map.on("unload", () => {
    if (isEnabled)
      document.removeEventListener(nativeAPI!.fullscreenchange, handleFSChange);
  });

  return handleFSChange;
};

export { bindFullscreenEvents, toggleFullscreen, updateUI };
