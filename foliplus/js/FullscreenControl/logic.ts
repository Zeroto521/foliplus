// FullscreenControl core logic — toggleFullscreen, updateUI, event handling.
// CONFIG is a free variable from the IIFE template wrapper (see BaseControl._get_template).
import { HINT_DURATION } from "#core/hint.js";
import { createScopedTranslator } from "#common/locale.js";
import { getFullscreenEl, isEnabled } from "./api.js";
import { CLASSES, containerId } from "./const.js";
import * as SVGs from "./icon.js";

// CONFIG is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const T = createScopedTranslator(CONFIG);

// ══════════════════════════════════════════════════════════════════════════════
// updateUI (internal)  —  refresh icon, title, sibling/self visibility, hint
// ══════════════════════════════════════════════════════════════════════════════
const updateUI = (map: L.Map, fsBtn: HTMLElement, container: HTMLElement) => {
  const isFull = Boolean(getFullscreenEl()) || map.isFullscreen;
  fsBtn.innerHTML = isFull ? SVGs.MINIMIZE : SVGs.MAXIMIZE;
  fsBtn.title = isFull ? T("title_cancel") : T("title");

  if (CONFIG.hide_others) {
    const controls = map
      .getContainer()
      .querySelectorAll(".leaflet-control, .foliplus-scale-wrap");
    const cid = containerId(CONFIG.name, CONFIG.position as string);
    for (const c of controls) {
      if (c.contains(container) || c.closest?.(`#${cid}`)) continue;
      c.classList.toggle(CLASSES.HIDDEN, isFull);
    }
  }

  if (CONFIG.hide_self) {
    const selfBtns = container.querySelectorAll(
      `.${CLASSES.TOGGLE}, .${CLASSES.ZOOM_IN}, .${CLASSES.ZOOM_OUT}`,
    );
    for (const btn of selfBtns) btn.classList.toggle(CLASSES.HIDDEN, isFull);
  }

  map.foliplus!.showHint?.(
    CONFIG.name,
    isFull ? T("enter") : T("exit"),
    HINT_DURATION.MEDIUM,
  );
};

// A rejected request must not report the transition that just failed — each
// branch announces what actually happened to the user instead.
const showUnsupportedHint = (map: L.Map) => {
  map.foliplus!.showHint?.(CONFIG.name, T("unsupported"), HINT_DURATION.MEDIUM);
};

const showExitFailHint = (map: L.Map) => {
  map.foliplus!.showHint?.(CONFIG.name, T("exit_fail"), HINT_DURATION.MEDIUM);
};

// ══════════════════════════════════════════════════════════════════════════════
// toggleFullscreen  —  enter/exit fullscreen via native API or pseudo mode
// ══════════════════════════════════════════════════════════════════════════════
const toggleFullscreen = (map: L.Map, fsBtn: HTMLElement, container: HTMLElement) => {
  if (getFullscreenEl() || map.isFullscreen) {
    if (isEnabled()) {
      document
        .exitFullscreen()
        .then(() => {
          map.isFullscreen = false;
        })
        .catch(() => {
          map.isFullscreen = Boolean(getFullscreenEl());
          showExitFailHint(map);
        });
      return;
    }
    map.getContainer().classList.remove(CLASSES.PSEUDO_FULLSCREEN);
    map.invalidateSize();

    map.isFullscreen = false;
  } else {
    if (isEnabled()) {
      map
        .getContainer()
        .requestFullscreen()
        .then(() => {
          map.isFullscreen = true;
        })
        .catch(() => {
          map.isFullscreen = Boolean(getFullscreenEl());
          showUnsupportedHint(map);
        });
      return;
    }
    map.getContainer().classList.add(CLASSES.PSEUDO_FULLSCREEN);
    map.invalidateSize();

    map.isFullscreen = true;
  }
  updateUI(map, fsBtn, container);
};

// ══════════════════════════════════════════════════════════════════════════════
// makeFullscreenChangeHandler  —  the fullscreenchange handler the control
// binds on document through BaseControl.on, so removal rides the mounting's
// signal (no manual teardown, and no map.on('unload') needed: Leaflet already
// routes map.remove() → unload → control.remove() → onRemove → abort).
// ══════════════════════════════════════════════════════════════════════════════
const makeFullscreenChangeHandler =
  (map: L.Map, fsBtn: HTMLElement, container: HTMLElement) => () => {
    map.isFullscreen = Boolean(getFullscreenEl());
    updateUI(map, fsBtn, container);
  };

export { makeFullscreenChangeHandler, toggleFullscreen, updateUI };
