// Hint / toast system for the foliplus runtime.
//
// Internal state (hintIcons, hintMap) is module-scoped and exposed through
// the functions below. The runtime entry module wires these onto
// `window.foliplus.*`.
import { dom } from "#common/dom.js";
import { HINT_DURATION } from "#common/hint.js";

// ── Hint constants ──────────────────────────────────────────────
const BASE = { BOTTOM: 20, STACK_GAP: 40, ZINDEX: 10000 };
const CLASS = "foliplus-hint";

const hintIcons = {};
const hintMap = new Map(); // key -> { element, timer }

// Reposition all visible hints in a vertical stack (bottom-up).
const repositionHints = () => {
  let idx = 0;
  for (const v of hintMap.values()) {
    v.element.style.bottom = `${BASE.BOTTOM + idx * BASE.STACK_GAP}px`;
    v.element.style.zIndex = BASE.ZINDEX + idx;
    idx++;
  }
};

/**
 * Register an SVG icon for a hint type. The icon is prepended to the
 * hint text when `showHint(key, ...)` is called with a matching key.
 *
 * @param {string} key     - Unique hint type identifier (e.g. 'export', 'measure')
 * @param {string} iconSvg - SVG markup string to display before the text
 */
const registerHintIcon = (key, iconSvg) => {
  hintIcons[key] = iconSvg;
};

/**
 * Display a hint toast at the bottom-center of the viewport.
 * During native browser fullscreen, hints are mounted on the fullscreen
 * element so they remain visible.
 */
const showHint = (key, text, duration, append, subkey) => {
  // Remove existing subkey instance before creating new one
  if (subkey) hideHint(key, subkey);
  else if (!append) hideHint(key);

  const hintTarget = document.fullscreenElement || document.body;
  const cls = subkey
    ? `${CLASS} ${CLASS}-${key}-${subkey}`
    : append
      ? `${CLASS} ${CLASS}-${key}-${Date.now()}`
      : `${CLASS} ${CLASS}-${key}`;

  const icon = (hintIcons && hintIcons[key]) || "";
  const el = dom.el("div", {
    class: `${cls} ${CLASS}`,
    parent: hintTarget,
    innerHTML: icon ? `<span class="foliplus-hint-icon">${icon}</span>${text}` : text,
  });
  if (hintTarget !== document.body && hintTarget !== document.documentElement) {
    const cs = window.getComputedStyle(hintTarget);
    if (cs.position === "static") hintTarget.style.position = "relative";
  }
  const storeKey = subkey ? `${key}|${subkey}` : append ? `${key}-${Date.now()}` : key;
  hintMap.set(storeKey, { element: el, timer: null });

  repositionHints();

  if (duration !== 0) {
    hintMap.get(storeKey).timer = setTimeout(
      () => (subkey ? hideHint(key, subkey) : hideHint(storeKey)),
      duration || HINT_DURATION.MEDIUM,
    );
  }
};

/**
 * Remove a hint (and any appended instances sharing the key prefix).
 * Repositions remaining hints after removal.
 */
const hideHint = (key, subkey) => {
  if (subkey) {
    const storeKey = `${key}|${subkey}`;
    const entry = hintMap.get(storeKey);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.element) entry.element.remove();
      hintMap.delete(storeKey);
    }
    repositionHints();
    return;
  }
  // Also clear appended instances (keys start with key+'-') or subkey instances (key|subkey)
  for (const k of hintMap.keys()) {
    if (k === key || k.startsWith(`${key}-`) || k.startsWith(`${key}|`)) {
      const entry = hintMap.get(k);
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.element) entry.element.remove();
      hintMap.delete(k);
    }
  }

  repositionHints();
};

// Re-parent all live hints when fullscreen state changes so they remain
// visible regardless of whether the browser is in fullscreen or not.
const reparentHints = () => {
  if (hintMap.size === 0) return;
  const newTarget = document.fullscreenElement || document.body;
  if (newTarget !== document.body && newTarget !== document.documentElement) {
    const cs = window.getComputedStyle(newTarget);
    if (cs.position === "static") newTarget.style.position = "relative";
  }
  let idx = 0;
  for (const v of hintMap.values()) {
    if (v.element.parentNode !== newTarget) newTarget.appendChild(v.element);
    v.element.style.bottom = `${BASE.BOTTOM + idx * BASE.STACK_GAP}px`;
    v.element.style.zIndex = BASE.ZINDEX + idx;
    idx++;
  }
};
document.addEventListener("fullscreenchange", reparentHints);
document.addEventListener("webkitfullscreenchange", reparentHints);

export { HINT_DURATION, registerHintIcon, showHint, hideHint };
