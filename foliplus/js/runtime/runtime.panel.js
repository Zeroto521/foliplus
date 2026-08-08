// Panel UI helpers for the foliplus runtime.
//
// Provides fold/expand controls, panel creation, and map sync utilities.
// Reads `foliplus.dom`, `foliplus.SVGs`, `foliplus.cssVar` from the global
// namespace at call time.

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
 * @param {object} opts
 * @param {HTMLElement} opts.container - Panel element
 * @param {boolean} opts.expanded - Whether the panel is being expanded
 */
const adjustPanelZIndex = ({ container, expanded }) => {
  const bar = container.closest(".leaflet-bar");
  const section = container.closest(".leaflet-top, .leaflet-bottom");
  if (!expanded) {
    if (bar) bar.style.zIndex = "";
    if (section) section.style.zIndex = "";
    return;
  }
  // Read --z-index-floating from :root (defined in CSS), then offset bar and section.
  const foliplus = window.foliplus || {};
  const base = parseInt(
    foliplus.cssVar
      ? foliplus.cssVar(document.documentElement, "--z-index-floating")
      : "500",
    10,
  );
  if (bar) bar.style.zIndex = String(base + 1);
  if (section) section.style.zIndex = String(base + 9);
};

/**
 * Bind click events to toggle a panel (expand / collapse).
 * @param {object} opts
 * @param {HTMLElement} opts.container - Panel root element
 * @param {string} opts.toggleBtn - Selector for the toggle button
 * @param {string} opts.header - Selector for the header (click to collapse)
 */
const bindPanelToggle = ({ container, toggleBtn, header }) => {
  const btn = container.querySelector(toggleBtn);
  if (btn) {
    L.DomEvent.on(btn, "click", (e) => {
      L.DomEvent.stop(e);
      container.classList.remove(CLASSES.COLLAPSED);
      container.classList.add(CLASSES.EXPANDED);
      adjustPanelZIndex({ container, expanded: true });
    });
  }
  const hdr = container.querySelector(header);
  if (hdr) {
    L.DomEvent.on(hdr, "click", (e) => {
      L.DomEvent.stop(e);
      container.classList.remove(CLASSES.EXPANDED);
      container.classList.add(CLASSES.COLLAPSED);
      adjustPanelZIndex({ container, expanded: false });
    });
  }
};

/**
 * Collapse a panel when clicking outside of it.
 * Sets up a MutationObserver to auto-cleanup when the container is removed.
 * @param {object} opts
 * @param {HTMLElement} opts.container - Panel element to watch
 * @param {Function} [opts.skipCheck] - Optional function; if returns true, collapse is skipped
 * @returns {Function} Cleanup function
 */
const bindOutsideCollapse = ({ container, skipCheck }) => {
  const handler = (e) => {
    if (skipCheck && skipCheck()) return;
    if (
      !container.contains(e.target) &&
      container.classList.contains(CLASSES.EXPANDED)
    ) {
      container.classList.remove(CLASSES.EXPANDED);
      container.classList.add(CLASSES.COLLAPSED);
      adjustPanelZIndex({ container, expanded: false });
    }
  };
  document.addEventListener("click", handler);

  // Auto-cleanup: remove listener when container is removed from DOM
  const cleanup = () => document.removeEventListener("click", handler);
  const obs = new MutationObserver(() => {
    if (!document.body.contains(container)) {
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
 * @param {object} opts
 * @param {string} opts.cssClass - Unique CSS class, e.g. 'measure-ctrl' or 'export-ctrl'
 * @param {string} opts.toggleTitle - Tooltip for the toggle button
 * @param {string} opts.toggleSvg - SVG HTML for the toggle icon
 * @param {boolean} opts.isLeft - Whether position is left-aligned
 * @returns {object} { container, ctrl, toolBar, toggleBtn }
 */
const createFoldControl = (opts) => {
  const foliplus = window.foliplus || {};
  const container = foliplus.dom.el("div", { class: CLASSES.LEAFLET_BAR });
  const ctrl = foliplus.dom.el("div", {
    class: `${opts.cssClass} ${CLASSES.FOLD} ${CLASSES.COLLAPSED}`,
  });
  ctrl.appendChild(
    foliplus.dom.el(
      "button",
      { class: CLASSES.TOGGLE_BTN, title: opts.toggleTitle },
      { html: opts.toggleSvg },
    ),
  );
  ctrl.appendChild(foliplus.dom.el("div", { class: CLASSES.TOOL_BAR }));
  container.appendChild(ctrl);
  if (!opts.isLeft) ctrl.classList.add("foliplus-align-right");
  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);
  return {
    container: container,
    ctrl: ctrl,
    toolBar: ctrl.querySelector(`.${CLASSES.TOOL_BAR}`),
    toggleBtn: ctrl.querySelector(`.${CLASSES.TOGGLE_BTN}`),
  };
};

/**
 * Bind map events to keep a visual element in sync.
 * Caller specifies which events trigger hide, update, and show.
 * @param {object} opts
 * @param {L.Map} opts.map - Leaflet map instance
 * @param {string[]} [opts.hideEvents] - Event names that trigger hide
 * @param {string[]} [opts.updateEvents] - Event names that trigger update
 * @param {string[]} [opts.showEvents] - Event names that trigger show
 * @param {Function} [opts.onHide] - Called on hide events
 * @param {Function} [opts.onUpdate] - Called on update events
 * @param {Function} [opts.onShow] - Called on show events
 * @param {Function} [opts.onMove] - Called on move with RAF throttling
 * @returns {Function} Cleanup function
 */
const bindMapSync = (opts) => {
  const handlers = [];
  const add = (events, fn) => {
    if (!events || !fn) return;
    events.forEach((ev) => {
      opts.map.on(ev, fn);
      handlers.push([ev, fn]);
    });
  };
  add(opts.hideEvents, opts.onHide);
  add(opts.updateEvents, opts.onUpdate);
  add(opts.showEvents, opts.onShow);

  let moveRafId = null;
  if (opts.onMove) {
    const onMove = () => {
      if (moveRafId) return;
      moveRafId = requestAnimationFrame(() => {
        moveRafId = null;
        opts.onMove();
      });
    };
    opts.map.on("move", onMove);
    handlers.push(["move", onMove]);
  }

  return () => {
    handlers.forEach(([ev, fn]) => opts.map.off(ev, fn));
    if (moveRafId) {
      cancelAnimationFrame(moveRafId);
      moveRafId = null;
    }
  };
};

/**
 * Create a panel-style control with toggle button, header, and content area.
 * Used by HeatmapControl and LayerControl for consistent panel UI.
 * Automatically wires up bindPanelToggle and bindOutsideCollapse.
 * @param {object} opts
 * @param {string} opts.cssClass - Unique CSS class, e.g. 'heatmap-ctrl' or 'layer-ctrl'
 * @param {string} opts.toggleTitle - Tooltip for the toggle button
 * @param {string} opts.toggleSvg - SVG HTML for the toggle icon
 * @param {string} opts.panelTitle - Header title text
 * @param {string} opts.closeTitle - Tooltip for close button
 * @returns {object} { container, ctrl, toggleBtn, panelContent }
 */
const createPanelControl = (opts) => {
  const foliplus = window.foliplus || {};
  const container = foliplus.dom.el("div", {
    class: CLASSES.LEAFLET_BAR,
  });
  const ctrl = foliplus.dom.el("div", {
    class: `foliplus-panel ${CLASSES.FOLD} ${opts.cssClass} ${CLASSES.COLLAPSED}`,
  });
  ctrl.appendChild(
    foliplus.dom.el(
      "button",
      { class: CLASSES.TOGGLE_BTN, title: opts.toggleTitle },
      { html: opts.toggleSvg },
    ),
  );
  const panelWrap = foliplus.dom.el("div", { class: "foliplus-panel-wrap" });
  const header = foliplus.dom.el("div", { class: CLASSES.PANEL_HEADER });
  header.appendChild(
    foliplus.dom.el(
      "span",
      { class: "foliplus-header-title" },
      foliplus.dom.el(
        "span",
        { class: "foliplus-header-icon" },
        { html: opts.toggleSvg },
      ),
      opts.panelTitle,
    ),
  );
  header.appendChild(
    foliplus.dom.el(
      "button",
      { class: "foliplus-ctrl-btn foliplus-close-btn", title: opts.closeTitle },
      { html: foliplus.SVGs ? foliplus.SVGs.CLOSE : "" },
    ),
  );
  panelWrap.appendChild(header);
  const panelContent = foliplus.dom.el("div", { class: "foliplus-panel-content" });
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
    toggleBtn: ctrl.querySelector(`.${CLASSES.TOGGLE_BTN}`),
    panelContent,
  };
};

export {
  adjustPanelZIndex,
  bindPanelToggle,
  bindOutsideCollapse,
  createFoldControl,
  bindMapSync,
  createPanelControl,
};
