// FullscreenControl crossfade — the dark scrim the basemap fades under when
// entering fullscreen, and back to full brightness when leaving it.
import { CLASSES } from "./const.js";

/**
 * Build (once, per map) the scrim and mount it as a direct child of the map
 * container.
 *
 * The container is the mount point because it *is* the fullscreen element in
 * native mode — while a fullscreen element exists the user agent paints only it
 * and its descendants, so the scrim must live there to paint at all. In
 * pseudo-fullscreen the container is `position: fixed` covering the viewport,
 * so `inset: 0` on the scrim still covers the whole viewport. One element,
 * correct in both modes, and one per map instead of one per page.
 *
 * Everything else — the fade, the opacity, the z-index — lives in the
 * stylesheet. The JS owns only mount, toggle and teardown.
 */
const ensureScrim = (container: HTMLElement): HTMLElement | null => {
  const existing = container.querySelector(`.${CLASSES.DIM}`);
  if (existing) return null;
  const scrim = document.createElement("div");
  scrim.className = CLASSES.DIM;
  container.appendChild(scrim);
  return scrim;
};

/**
 * Fade the basemap down (`active=true`) or back up (`active=false`).
 *
 * Pure opacity on the scrim. The container itself is resized by the Fullscreen
 * API (native) or by `position: fixed` (pseudo), and the browser snaps that
 * jump in both cases — there is nothing to tween there, so the fade is the
 * entire transition. The active class goes on the container so each map's
 * state is scoped to its own map.
 */
const setDim = (container: HTMLElement, active: boolean): void => {
  ensureScrim(container);
  container.classList.toggle(CLASSES.DIM_ACTIVE, active);
};

/**
 * Detach the scrim and drop the active class. Called from the control's destroy.
 *
 * Scoped to the caller's container — a page can carry several maps, and a
 * global sweep here would strip a sibling map's scrim out from under it.
 */
const removeScrim = (container: HTMLElement) => {
  const scrim = container.querySelector(`.${CLASSES.DIM}`);
  // Grab the parent first — `remove()` detaches the node, after which
  // `parentElement` is null and the active class would be left behind.
  const parent = scrim?.parentElement;
  scrim?.remove();
  parent?.classList.remove(CLASSES.DIM_ACTIVE);
};

export { ensureScrim, removeScrim, setDim };
