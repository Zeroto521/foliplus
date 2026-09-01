// FullscreenControl crossfade — a flat black scrim that dims the basemap
// while fullscreen is active, fading in on enter and out on exit. Controls
// stay fully visible; the scrim lives at z-index 799, below them.
import { CLASSES } from "./const.js";

const ensureScrim = (container: HTMLElement): void => {
  if (container.querySelector(`.${CLASSES.DIM}`)) return;
  const scrim = document.createElement("div");
  scrim.className = CLASSES.DIM;
  container.appendChild(scrim);
};

/**
 * Fade the scrim in for a fullscreen enter. The scrim stays dimmed while
 * fullscreen is active — it is state-bound, not a flash — so the user gets a
 * quiet, persistent signal that they're in a distinct mode, matching the
 * pattern ExportControl uses while in crop mode.
 *
 * The scrim element is created once (ensureScrim); subsequent calls are
 * idempotent. CSS carries the opacity transition.
 */
const startDim = (container: HTMLElement): void => {
  ensureScrim(container);
  container.classList.add(CLASSES.DIM_ACTIVE);
};

/**
 * Fade the scrim out for a fullscreen exit — symmetric with startDim's
 * fade-in on enter. Removes the active class so the CSS transition carries
 * opacity from 1 back to 0 over --dim-duration (180ms ease-out).
 */
const startDimExit = (container: HTMLElement): void => {
  ensureScrim(container);
  container.classList.remove(CLASSES.DIM_ACTIVE);
};

/**
 * Synchronous toggle of the scrim (no fade). Used by the denied-request
 * catch paths in logic.ts, where the scrim must clear immediately rather
 * than fading.
 */
const setDim = (container: HTMLElement, active: boolean): void => {
  ensureScrim(container);
  container.classList.toggle(CLASSES.DIM_ACTIVE, active);
};

const removeScrim = (container: HTMLElement) => {
  container.classList.remove(CLASSES.DIM_ACTIVE);
  container.querySelector(`.${CLASSES.DIM}`)?.remove();
};

export { removeScrim, setDim, startDim, startDimExit };