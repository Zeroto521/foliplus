// FullscreenControl core logic — toggleFullscreen, updateUI, event handling.
// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
import { HINT_DURATION } from "#core/hint.js";
import { createScopedTranslator } from "#common/locale.js";
import { createLogger } from "#common/log.js";
import { FULLSCREEN_CHANGE, getFullscreenEl, isEnabled } from "./api.js";
import { CLASSES, containerId } from "./const.js";
import * as SVGs from "./icon.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const T = createScopedTranslator(CONF);
const log = createLogger(CONF.name);

// ══════════════════════════════════════════════════════════════════════════════
// hide_selector  —  page elements outside .leaflet-control-container
// ══════════════════════════════════════════════════════════════════════════════
// A selector list from the user, so it is not trusted: an invalid selector must
// not abort the rest of updateUI (which also owns the hint message). The error
// is logged once per selector so a bad selector surfaces in the console instead
// of silently doing nothing forever.
const seenSelectorErrors = new Set<string>();

const parseSelector = (raw: string): string | null => {
  if (typeof raw !== "string") return null;
  const sel = raw.trim();
  if (!sel) return null;
  try {
    document.querySelector(sel);
    return sel;
  } catch (error) {
    if (!seenSelectorErrors.has(sel)) {
      seenSelectorErrors.add(sel);
      log.warn(`hide_selector "${sel}" is not a valid CSS selector`, error);
    }
    return null;
  }
};

// display is toggled rather than overridden: an element that is already hidden
// for another reason keeps its display value when fullscreen ends.
//
// The previous inline display is carried on the element as `data-foliplus-fs-display`.
// A dataset key would be useless here: the selector list is empty on the restore
// pass (hide_selector comes from CONF, which holds only one control's config),
// so the elements could never be re-found. Marking the element and scanning the
// whole document on exit keeps restore independent of hide_selector.
const FS_DISPLAY_ATTR = "data-foliplus-fs-display";

const hidePageElements = (selectors: string[]) => {
  for (const sel of selectors) {
    let elements: NodeListOf<HTMLElement>;
    try {
      elements = document.querySelectorAll<HTMLElement>(sel);
    } catch {
      continue;
    }
    for (const el of elements) {
      // A duplicate selector would otherwise overwrite the baseline with the
      // "none" this pass just set.
      if (el.hasAttribute(FS_DISPLAY_ATTR)) continue;
      el.setAttribute(FS_DISPLAY_ATTR, el.style.getPropertyValue("display"));
      el.style.display = "none";
    }
  }
};

const restorePageElements = () => {
  const marked = document.querySelectorAll<HTMLElement>(`[${FS_DISPLAY_ATTR}]`);
  for (const el of marked) {
    el.style.display = el.getAttribute(FS_DISPLAY_ATTR) ?? "";
    el.removeAttribute(FS_DISPLAY_ATTR);
  }
};

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

  const rawSelectors = Array.isArray(CONF.hide_selector) ? CONF.hide_selector : [];
  const pageSelectors = rawSelectors
    .map(parseSelector)
    .filter((sel): sel is string => sel !== null);
  if (isFull) hidePageElements(pageSelectors);
  else restorePageElements();

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
  if (getFullscreenEl() || map.isFullscreen) {
    if (isEnabled) {
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

  if (isEnabled) document.addEventListener(FULLSCREEN_CHANGE, handleFSChange);
  map.on("unload", () => {
    if (isEnabled) document.removeEventListener(FULLSCREEN_CHANGE, handleFSChange);
  });

  return handleFSChange;
};

export { bindFullscreenEvents, toggleFullscreen, updateUI };
