// FullscreenControl core logic — toggleFullscreen, updateUI, event handling.
// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
import { HINT_DURATION } from "#core/hint.js";
import { createScopedTranslator } from "#common/locale.js";
import { setDim } from "./anim.js";
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
        })
        .catch(() => {
          map.isFullscreen = !!getFullscreenEl();
          // Exit can be denied (e.g. NotAllowedError) while the scrim is
          // already fading out — re-drive the dim from the actual API state so
          // a denied exit doesn't leave the basemap stuck in the darkened state.
          setDim(map.getContainer(), !!getFullscreenEl());
          updateUI(map, fsBtn, container);
        });
      // Un-dim alongside the exit so the basemap lightens as the view recedes.
      setDim(map.getContainer(), false);
      return;
    }
    setDim(map.getContainer(), false);
    map.getContainer().classList.remove(CLASSES.PSEUDO_FULLSCREEN);
    map.invalidateSize();
  } else {
    if (isEnabled) {
      setDim(map.getContainer(), true);
      map
        .getContainer()
        .requestFullscreen()
        .then(() => {
          map.isFullscreen = true;
        })
        .catch(() => {
          // Enter can be denied (e.g. NotAllowedError) — re-drive the dim from
          // the actual API state, symmetric with the exit path, so a rejected
          // enter doesn't blindly clear the scrim when the API still reports
          // fullscreen.
          map.isFullscreen = !!getFullscreenEl();
          setDim(map.getContainer(), !!getFullscreenEl());
          updateUI(map, fsBtn, container);
        });
      return;
    }
    setDim(map.getContainer(), true);
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
    map.isFullscreen = !!getFullscreenEl();
    // Exit is also reachable from the keyboard (Esc), not just the button, so
    // the dim has to be driven from the API state here — otherwise Esc leaves
    // the basemap darkened until the next toggle.
    setDim(map.getContainer(), !!getFullscreenEl());
    updateUI(map, fsBtn, container);
  };

  if (isEnabled) document.addEventListener(FULLSCREEN_CHANGE, handleFSChange);
  map.on("unload", () => {
    if (isEnabled) document.removeEventListener(FULLSCREEN_CHANGE, handleFSChange);
  });

  return handleFSChange;
};

export { bindFullscreenEvents, toggleFullscreen, updateUI };
