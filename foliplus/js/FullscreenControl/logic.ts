// FullscreenControl core logic — toggleFullscreen, updateUI, event handling.
// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
import { HINT_DURATION } from "#core/hint.js";
import { createScopedTranslator } from "#common/locale.js";
import { setDim, startDim, startDimExit } from "./anim.js";
import { FULLSCREEN_CHANGE, getFullscreenEl, isEnabled } from "./api.js";
import { CLASSES, containerId } from "./const.js";
import * as SVGs from "./icon.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const T = createScopedTranslator(CONF);

// ══════════════════════════════════════════════════════════════════════════════
// updateUI (internal)  —  refresh icon, title, sibling/self visibility, hint
// ══════════════════════════════════════════════════════════════════════════════
// Reached from the toggle, from `fullscreenchange`, and from the rejection
// paths, so it must be safe to run twice for the same fullscreen state.
const updateUI = (map: L.Map, fsBtn: HTMLElement, container: HTMLElement) => {
  const isFull = !!getFullscreenEl() || map.isFullscreen;

  fsBtn.innerHTML = isFull ? SVGs.MINIMIZE : SVGs.MAXIMIZE;
  fsBtn.title = isFull ? T("title_cancel") : T("title");
  fsBtn.setAttribute("aria-label", isFull ? T("title_cancel") : T("title"));

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
};

// ══════════════════════════════════════════════════════════════════════════════
// toggleFullscreen  —  enter/exit fullscreen via native API or pseudo mode
// ══════════════════════════════════════════════════════════════════════════════
const toggleFullscreen = (map: L.Map, fsBtn: HTMLElement, container: HTMLElement) => {
  const exiting = !!getFullscreenEl() || map.isFullscreen;

  if (exiting) {
    if (isEnabled) {
      document
        .exitFullscreen()
        .then(() => {
          map.isFullscreen = false;
          // Fade the scrim out only once the browser has fully left fullscreen.
          // Starting the transition while the fullscreen teardown is still
          // running gets it cancelled by the rendering-context change, so the
          // basemap would snap back instead of fading — on the enter side the
          // fade-in runs in normal flow ahead of requestFullscreen, which is why
          // enter animates but an eager exit never did.
          startDimExit(map.getContainer());
        })
        .catch(() => {
          map.isFullscreen = !!getFullscreenEl();
          setDim(map.getContainer(), false);
          updateUI(map, fsBtn, container);
        });
      return;
    }
    startDimExit(map.getContainer());
    map.getContainer().classList.remove(CLASSES.PSEUDO_FULLSCREEN);
    map.invalidateSize();
  } else {
    if (isEnabled) {
      startDim(map.getContainer());
      map
        .getContainer()
        .requestFullscreen()
        .then(() => {
          map.isFullscreen = true;
        })
        .catch(() => {
          setDim(map.getContainer(), false);
          map.isFullscreen = !!getFullscreenEl();
          updateUI(map, fsBtn, container);
        });
      return;
    }
    startDim(map.getContainer());
    map.getContainer().classList.add(CLASSES.PSEUDO_FULLSCREEN);
    map.invalidateSize();
  }
  map.isFullscreen = !exiting;
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
    const isFull = !!getFullscreenEl();
    map.isFullscreen = isFull;
    // The scrim is state-bound to fullscreen, so the handler must sync it
    // directly from the API. Without this, an Esc exit would leave the
    // basemap dimmed: the exit path's startDimExit runs in the
    // exitFullscreen() promise callback, but the fullscreenchange event
    // fires synchronously with the API already reporting not-fullscreen.
    setDim(map.getContainer(), isFull);
    updateUI(map, fsBtn, container);
  };

  if (isEnabled) document.addEventListener(FULLSCREEN_CHANGE, handleFSChange);
  map.on("unload", () => {
    if (isEnabled) document.removeEventListener(FULLSCREEN_CHANGE, handleFSChange);
  });

  return handleFSChange;
};

export { bindFullscreenEvents, toggleFullscreen, updateUI };
