// FullscreenControl crossfade — a momentary dark scrim that flashes over the
// basemap at the instant of a fullscreen transition, then fades back to
// transparent so the fullscreen view itself stays clean.
import { CLASSES } from "./const.js";

// Cushion past the CSS transition so the scrim's auto-clear doesn't fire a few
// frames early and leave a visible half-opacity flicker. Covers both JS timer
// drift and main-thread stalls that delay the setTimeout callback.
const DIM_BUFFER_MS = 40;

const dimTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

const ensureScrim = (container: HTMLElement): HTMLElement | null => {
  const existing = container.querySelector(`.${CLASSES.DIM}`);
  if (existing) return null;
  const scrim = document.createElement("div");
  scrim.className = CLASSES.DIM;
  container.appendChild(scrim);
  return scrim;
};

/**
 * Flash the basemap dark and automatically fade it back to transparent once
 * the scrim's transition completes — momentary, never a persistent overlay.
 *
 * The scrim element is created once (ensureScrim); subsequent calls only
 * restart the flash, cancelling any in-flight auto-clear so rapid
 * enter/exit/enter toggles stay consistent. The duration is read from the
 * `--dim-duration` CSS custom property on the scrim so JS and CSS stay in
 * sync automatically (survives bundler minification like `.26s`); 260ms is the
 * fallback if the value is absent.
 */
const startDim = (container: HTMLElement): void => {
  // ensureScrim either returns the newly-created scrim, or null meaning a
  // scrim already exists in the DOM. The caller never needs the element
  // itself — the active state is a class on the container.
  ensureScrim(container);
  const pending = dimTimers.get(container);
  if (pending) clearTimeout(pending);
  container.classList.add(CLASSES.DIM_ACTIVE);
  dimTimers.set(
    container,
    setTimeout(
      () => {
        container.classList.remove(CLASSES.DIM_ACTIVE);
        dimTimers.delete(container);
      },
      readDimDuration(container) + DIM_BUFFER_MS,
    ),
  );
};

const readDimDuration = (container: HTMLElement): number => {
  const scrim = container.querySelector(`.${CLASSES.DIM}`);
  if (!scrim) return 260;
  const raw = getComputedStyle(scrim).getPropertyValue("--dim-duration").trim();
  const ms = parseFloat(raw);
  // CSS may express the duration as `260ms` (dev build) or `.26s` (minified).
  // Milliseconds are already the right unit; only bare seconds need ×1000.
  // Check "ms" before "s" — a literal endswith("s") would match "260ms" too.
  if (isNaN(ms)) return 260;
  if (raw.endsWith("ms")) return ms;
  return ms * 1000;
};

/**
 * Synchronous toggle of the scrim (no auto-clear). Used by the exit path and
 * the denied-request catch paths in logic.ts, where the scrim must clear
 * immediately rather than fading.
 */
const setDim = (container: HTMLElement, active: boolean): void => {
  ensureScrim(container);
  container.classList.toggle(CLASSES.DIM_ACTIVE, active);
};

const removeScrim = (container: HTMLElement) => {
  const pending = dimTimers.get(container);
  if (pending) {
    clearTimeout(pending);
    dimTimers.delete(container);
  }
  container.classList.remove(CLASSES.DIM_ACTIVE);
  const scrim = container.querySelector(`.${CLASSES.DIM}`);
  scrim?.remove();
};

export { removeScrim, setDim, startDim };
