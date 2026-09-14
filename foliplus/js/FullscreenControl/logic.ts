// FullscreenControl core logic — toggleFullscreen, updateUI, event handling.
// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
import { HINT_DURATION } from "#core/hint.js";
import { createScopedTranslator } from "#common/locale.js";
import { FULLSCREEN_CHANGE, getFullscreenEl, isEnabled } from "./api.js";
import { CLASSES, containerId } from "./const.js";
import * as SVGs from "./icon.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const T = createScopedTranslator(CONF);

// ══════════════════════════════════════════════════════════════════════════════
// updateUI (internal)  —  refresh icon, title, sibling/self visibility, hint
// ══════════════════════════════════════════════════════════════════════════════
const updateUI = (map: L.Map, fsBtn: HTMLElement, container: HTMLElement) => {
  const isFull = Boolean(getFullscreenEl()) || map.isFullscreen;
  fsBtn.innerHTML = isFull ? SVGs.MINIMIZE : SVGs.MAXIMIZE;
  fsBtn.title = isFull ? T("title_cancel") : T("title");

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

  map.foliplus!.showHint?.(
    CONF.name,
    isFull ? T("enter") : T("exit"),
    HINT_DURATION.MEDIUM,
  );

  updateRotateHint(map);
};

// ══════════════════════════════════════════════════════════════════════════════
// rotate hint  —  portrait-while-fullscreen "rotate to landscape" toast
//
// Screen orientation alone decides (no touch/UA sniffing): a portrait laptop in
// fullscreen is just as cramped, and a sniff stays testable in jsdom. The hint
// is PERSIST with a subkey, so it coexists with the enter/exit toast instead of
// evicting it, and it dismisses on rotation or on fullscreen exit.
// ══════════════════════════════════════════════════════════════════════════════
const ORIENTATION_CHANGE = "orientationchange";

const isPortrait = (): boolean => {
  const orientation = window.screen?.orientation;
  return Boolean(orientation) && orientation.type.startsWith("portrait");
};

const showRotateHint = (map: L.Map) => {
  if (!isPortrait()) return;
  map.foliplus!.showHint(
    CONF.name,
    T("rotate_landscape"),
    HINT_DURATION.PERSIST,
    false,
    "rotate",
  );
};

const hideRotateHint = (map: L.Map) => {
  map.foliplus!.hideHint(CONF.name, "rotate");
};

// Runs on every fullscreenchange, portrait or not — hiding when landscape means
// the same listener covers "rotated while fullscreen" with no extra check.
const updateRotateHint = (map: L.Map) => {
  if (getFullscreenEl() || map.isFullscreen) showRotateHint(map);
  else hideRotateHint(map);
};

// ══════════════════════════════════════════════════════════════════════════════
// toggleFullscreen  —  enter/exit fullscreen via native API or pseudo mode
// ══════════════════════════════════════════════════════════════════════════════
const toggleFullscreen = (map: L.Map, fsBtn: HTMLElement, container: HTMLElement) => {
  if (getFullscreenEl() || map.isFullscreen) {
    if (isEnabled) {
      // Only the reject path calls updateUI. Success is driven by
      // fullscreenchange; a second updateUI here would double-fire the toasts.
      document
        .exitFullscreen()
        .then(() => {
          map.isFullscreen = false;
        })
        .catch(() => {
          map.isFullscreen = Boolean(getFullscreenEl());
          updateUI(map, fsBtn, container);
        });
      return;
    }
    map.getContainer().classList.remove(CLASSES.PSEUDO_FULLSCREEN);
    map.invalidateSize();

    map.isFullscreen = false;
  } else {
    if (isEnabled) {
      // Same rule as the exit branch: only reject calls updateUI.
      map
        .getContainer()
        .requestFullscreen()
        .then(() => {
          map.isFullscreen = true;
        })
        .catch(() => {
          map.isFullscreen = Boolean(getFullscreenEl());
          updateUI(map, fsBtn, container);
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
// bindFullscreenEvents  —  wire up fullscreenchange + unload listeners
// ══════════════════════════════════════════════════════════════════════════════
const bindFullscreenEvents = (
  map: L.Map,
  fsBtn: HTMLElement,
  container: HTMLElement,
) => {
  const handleFSChange = () => {
    map.isFullscreen = Boolean(getFullscreenEl());
    updateUI(map, fsBtn, container);
  };

  // Native mode: a rotation re-dispatches fullscreenchange, so fullscreenchange
  // alone keeps the hint in sync. Pseudo mode never dispatches it, so it gets
  // its own orientationchange listener to clear the hint on rotate.
  const type = isEnabled ? FULLSCREEN_CHANGE : ORIENTATION_CHANGE;

  document.addEventListener(type, handleFSChange);

  map.on("unload", () => {
    document.removeEventListener(type, handleFSChange);
  });

  // Returned for destroy(): the caller must remove whichever event is bound,
  // since it differs between native and pseudo mode.
  return { type, handler: handleFSChange };
};

export { bindFullscreenEvents, toggleFullscreen, updateUI };
