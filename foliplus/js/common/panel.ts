// Panel UI helpers for foliplus components.
//
// Provides fold/expand controls, panel creation, and map sync utilities.
// Statically imported by components; uses dom (dom.js) and cssVar
// (cssvar.js) directly instead of reading them from the runtime global.
import { cssVar } from "./cssvar.js";
import { dom } from "./dom.js";
import * as SVGs from "./icon.js";
import { throttleRaf } from "./throttle.js";

// ── Panel CSS classes ───────────────────────────────────────────
const CLASSES = {
  COLLAPSED: "collapsed",
  EXPANDED: "expanded",
  FOLD: "foliplus-ctrl-fold",
  TOGGLE_BTN: "foliplus-toggle-btn",
  LEAFLET_BAR: "leaflet-bar leaflet-control",
  TOOL_BAR: "foliplus-tool-bar",
  PANEL_HEADER: "foliplus-panel-header",
};

/**
 * Adjust the z-index of a panel to ensure proper stacking order.
 * When expanded, sets a high z-index; when collapsed, resets to auto.
 */
const adjustPanelZIndex = (opts: {
  container: HTMLElement;
  expanded: boolean;
}): void => {
  const bar = opts.container.closest(".leaflet-bar") as HTMLElement | null;
  const section = opts.container.closest(
    ".leaflet-top, .leaflet-bottom",
  ) as HTMLElement | null;
  if (!opts.expanded) {
    if (bar) bar.style.zIndex = "";
    if (section) section.style.zIndex = "";
    return;
  }
  // Read --z-index-floating from :root (defined in CSS), then offset bar and section.
  const base = parseInt(
    cssVar(document.documentElement, "--z-index-floating", "500"),
    10,
  );
  if (bar) bar.style.zIndex = String(base + 1);
  if (section) section.style.zIndex = String(base + 9);
};

/**
 * Bind click events to toggle a panel (expand / collapse).
 */
const bindPanelToggle = (opts: {
  container: HTMLElement;
  toggleBtn: string;
  header: string;
}): void => {
  const btn = opts.container.querySelector(opts.toggleBtn) as HTMLElement | null;
  if (btn) {
    L.DomEvent.on(btn, "click", (e: any) => {
      L.DomEvent.stop(e);
      opts.container.classList.remove(CLASSES.COLLAPSED);
      opts.container.classList.add(CLASSES.EXPANDED);
      adjustPanelZIndex({ container: opts.container, expanded: true });
    });
  }
  const hdr = opts.container.querySelector(opts.header) as HTMLElement | null;
  if (hdr) {
    L.DomEvent.on(hdr, "click", (e: any) => {
      L.DomEvent.stop(e);
      opts.container.classList.remove(CLASSES.EXPANDED);
      opts.container.classList.add(CLASSES.COLLAPSED);
      adjustPanelZIndex({ container: opts.container, expanded: false });
    });
  }
};

/**
 * Bind a fold toggle button that expands AND collapses (toggle).
 * Unlike bindPanelToggle (button only expands, header collapses), this
 * toggles both ways — the behavior for fold controls without a header.
 */
const bindFoldToggle = (opts: {
  container: HTMLElement;
  toggleBtn: HTMLElement;
  onExpand?: () => void;
  onCollapse?: () => void;
}): void => {
  L.DomEvent.on(opts.toggleBtn, "click", (e: any) => {
    L.DomEvent.stop(e);
    const expanding = opts.container.classList.contains(CLASSES.COLLAPSED);
    opts.container.classList.toggle(CLASSES.COLLAPSED);
    opts.container.classList.toggle(CLASSES.EXPANDED);
    adjustPanelZIndex({ container: opts.container, expanded: expanding });
    if (expanding) opts.onExpand?.();
    else opts.onCollapse?.();
  });
};

/**
 * Collapse a panel when clicking outside of it.
 * Sets up a MutationObserver to auto-cleanup when the container is removed.
 * @returns Cleanup function
 */
const bindOutsideCollapse = (opts: {
  container: HTMLElement;
  skipCheck?: () => boolean;
}): (() => void) => {
  const skipCheck = opts.skipCheck || (() => false);
  const handler = (e: MouseEvent) => {
    if (skipCheck()) return;
    if (
      !opts.container.contains(e.target as Node) &&
      opts.container.classList.contains(CLASSES.EXPANDED)
    ) {
      opts.container.classList.remove(CLASSES.EXPANDED);
      opts.container.classList.add(CLASSES.COLLAPSED);
      adjustPanelZIndex({ container: opts.container, expanded: false });
    }
  };
  document.addEventListener("click", handler);

  // Auto-cleanup: remove listener when container is removed from DOM
  const cleanup = () => document.removeEventListener("click", handler);
  const obs = new MutationObserver(() => {
    if (!document.body.contains(opts.container)) {
      cleanup();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  return cleanup;
};

/**
 * Create a fold (expand/collapse) control container with toggle button and toolbar.
 * Shared by MeasureControl and ExportControl for consistent UI.
 */
const createFoldControl = (opts: {
  cssClass: string;
  toggleTitle: string;
  toggleSvg: string;
  isLeft?: boolean;
  position?: string;
}): {
  container: HTMLElement;
  ctrl: HTMLElement;
  toolBar: HTMLElement;
  toggleBtn: HTMLElement;
} => {
  const isLeft =
    opts.position !== undefined ? opts.position.indexOf("left") >= 0 : opts.isLeft;
  const container = dom.el("div", { class: CLASSES.LEAFLET_BAR });
  const ctrl = dom.el("div", {
    class: `${opts.cssClass} ${CLASSES.FOLD} ${CLASSES.COLLAPSED}`,
  });
  ctrl.appendChild(
    dom.el(
      "button",
      { class: CLASSES.TOGGLE_BTN, title: opts.toggleTitle },
      { html: opts.toggleSvg },
    ),
  );
  ctrl.appendChild(dom.el("div", { class: CLASSES.TOOL_BAR }));
  container.appendChild(ctrl);
  if (!isLeft) ctrl.classList.add("foliplus-align-right");
  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);
  return {
    container,
    ctrl,
    toolBar: ctrl.querySelector(`.${CLASSES.TOOL_BAR}`) as HTMLElement,
    toggleBtn: ctrl.querySelector(`.${CLASSES.TOGGLE_BTN}`) as HTMLElement,
  };
};

/**
 * Bind map events to keep a visual element in sync.
 * Caller specifies which events trigger hide, update, and show.
 * @returns Cleanup function
 */
const bindMapSync = (opts: {
  map: any;
  hideEvents?: string[];
  updateEvents?: string[];
  showEvents?: string[];
  onHide?: () => void;
  onUpdate?: () => void;
  onShow?: () => void;
  onMove?: () => void;
}): (() => void) => {
  const handlers: Array<[string, any]> = [];
  const add = (events: string[] | undefined, fn: (() => void) | undefined) => {
    if (!events || !fn) return;
    events.forEach(ev => {
      opts.map.on(ev, fn);
      handlers.push([ev, fn]);
    });
  };
  add(opts.hideEvents, opts.onHide);
  add(opts.updateEvents, opts.onUpdate);
  add(opts.showEvents, opts.onShow);

  let onMove: ((() => void) & { cancel: () => void }) | null = null;
  if (opts.onMove) {
    onMove = throttleRaf(opts.onMove);
    opts.map.on("move", onMove);
    handlers.push(["move", onMove]);
  }

  return () => {
    handlers.forEach(([ev, fn]) => opts.map.off(ev, fn));
    onMove?.cancel();
  };
};

/**
 * Create a panel-style control with toggle button, header, and content area.
 * Used by HeatmapControl and LayerControl for consistent panel UI.
 * Automatically wires up bindPanelToggle and bindOutsideCollapse.
 */
const createPanelControl = (opts: {
  cssClass: string;
  toggleTitle: string;
  toggleSvg: string;
  panelTitle: string;
  closeTitle: string;
}): {
  container: HTMLElement;
  ctrl: HTMLElement;
  toggleBtn: HTMLElement | null;
  panelContent: HTMLElement;
} => {
  const container = dom.el("div", { class: CLASSES.LEAFLET_BAR });
  const ctrl = dom.el("div", {
    class: `foliplus-panel ${CLASSES.FOLD} ${opts.cssClass} ${CLASSES.COLLAPSED}`,
  });
  ctrl.appendChild(
    dom.el(
      "button",
      { class: CLASSES.TOGGLE_BTN, title: opts.toggleTitle },
      { html: opts.toggleSvg },
    ),
  );
  const panelWrap = dom.el("div", { class: "foliplus-panel-wrap" });
  const header = dom.el("div", { class: CLASSES.PANEL_HEADER });
  header.appendChild(
    dom.el(
      "span",
      { class: "foliplus-header-title" },
      dom.el("span", { class: "foliplus-header-icon" }, { html: opts.toggleSvg }),
      opts.panelTitle,
    ),
  );
  header.appendChild(
    dom.el(
      "button",
      { class: "foliplus-ctrl-btn foliplus-close-btn", title: opts.closeTitle },
      { html: SVGs.CLOSE },
    ),
  );
  panelWrap.appendChild(header);
  const panelContent = dom.el("div", { class: "foliplus-panel-content" });
  panelWrap.appendChild(panelContent);
  ctrl.appendChild(panelWrap);
  container.appendChild(ctrl);

  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);

  bindPanelToggle({
    container: ctrl,
    toggleBtn: `.${CLASSES.TOGGLE_BTN}`,
    header: `.${CLASSES.PANEL_HEADER}`,
  });
  bindOutsideCollapse({ container: ctrl });

  return {
    container,
    ctrl,
    toggleBtn: ctrl.querySelector(`.${CLASSES.TOGGLE_BTN}`) as HTMLElement,
    panelContent,
  };
};

export {
  adjustPanelZIndex,
  bindFoldToggle,
  bindMapSync,
  bindOutsideCollapse,
  bindPanelToggle,
  createFoldControl,
  createPanelControl,
};
