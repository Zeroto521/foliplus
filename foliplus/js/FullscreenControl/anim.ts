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
 * Fade the scrim out for a fullscreen exit — symmetric with startDim's
 * fade-in on enter.
 *
 * If the scrim is still dark (enter's auto-clear hasn't fired yet), simply
 * remove the active class and let the CSS transition carry opacity back to
 * 0 over --dim-duration.
 *
 * If enter's auto-clear already ran and the scrim is transparent, re-add the
 * active class for one frame so the browser paints the dark state, then
 * remove it on the next frame to trigger the fade-out. Without the re-flash,
 * a transparent scrim has nothing to fade from and the exit is instant.
 * The re-flash is imperceptible (one painted frame) and only happens when
 * the user lingered long enough for the enter flash to complete.
 */
const startDimExit = (container: HTMLElement): void => {
  ensureScrim(container);
  const pending = dimTimers.get(container);
  if (pending) clearTimeout(pending);
  dimTimers.delete(container);

  const isDark = container.classList.contains(CLASSES.DIM_ACTIVE);
  if (isDark) {
    // Scrim is dark — just remove active, CSS transition does the fade-out.
    container.classList.remove(CLASSES.DIM_ACTIVE);
  } else {
    // Scrim is transparent — re-flash dark for one frame, then fade out.
    container.classList.add(CLASSES.DIM_ACTIVE);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        container.classList.remove(CLASSES.DIM_ACTIVE);
      });
    });
  }
};

/**
 * Synchronous toggle of the scrim (no auto-clear). Used by the denied-request
 * catch paths in logic.ts, where the scrim must clear immediately rather than
 * fading.
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

export { removeScrim, setDim, startDim, startDimExit };
