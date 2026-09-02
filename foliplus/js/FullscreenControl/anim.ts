// FullscreenControl crossfade — a flat black scrim that briefly dims the
// basemap on fullscreen enter and exit, then auto-fades out so the basemap
// returns to full brightness. Controls stay fully visible; the scrim lives at
// z-index 799, below them.
import { CLASSES } from "./const.js";

const ensureScrim = (container: HTMLElement): HTMLElement => {
  let scrim = container.querySelector(`.${CLASSES.DIM}`);
  if (scrim) return scrim as HTMLElement;
  scrim = document.createElement("div");
  scrim.className = CLASSES.DIM;
  container.appendChild(scrim);
  return scrim;
};

const removeScrim = (container: HTMLElement): void => {
  container.classList.remove(CLASSES.DIM_ACTIVE);
  container.querySelector(`.${CLASSES.DIM}`)?.remove();
};

/**
 * Flash the scrim: fade in over 180ms, then auto-fade out and detach after
 * another 180ms. Used on both fullscreen enter and exit — the scrim is a
 * one-shot transition signal, not a persistent overlay.
 *
 * Each container may have at most one in-flight flash; a second call while
 * one is still running replaces the pending clear timer so the scrim is not
 * detached mid-flash.
 */
const flashScrim = (container: HTMLElement): void => {
  const scrim = ensureScrim(container);

  // Cancel a previously scheduled clear so overlapping flashes don't detach
  // the scrim while the second one is still visible.
  const prev = (scrim as { _clear?: ReturnType<typeof setTimeout> })._clear;
  if (prev) clearTimeout(prev);

  // Kick the transition: add active class so CSS carries opacity 0 → 1.
  container.classList.add(CLASSES.DIM_ACTIVE);

  // Schedule the auto-clear: after the fade-in has settled, remove the active
  // class so CSS carries opacity 1 → 0, then detach the element after the
  // fade-out completes. The two durations match --dim-duration (180ms) in
  // FullscreenControl.css; if the CSS value changes these constants must
  // follow.
  const fadeInMs = 180;
  const fadeOutMs = 180;

  const timer = setTimeout(() => {
    container.classList.remove(CLASSES.DIM_ACTIVE);
    setTimeout(() => {
      scrim.remove();
    }, fadeOutMs);
  }, fadeInMs);

  (scrim as { _clear: ReturnType<typeof setTimeout> })._clear = timer;
};

export { flashScrim, removeScrim };
