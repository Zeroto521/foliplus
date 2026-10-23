// Panel UI helpers for foliplus components.
//
// Provides fold/expand controls, panel creation, and map sync utilities.
// Statically imported by components; uses dom (dom.js) and cssVar
// (cssvar.js) directly instead of reading them from the runtime global.
import { cssVar } from "#common/cssvar.js";
import { dom } from "#common/dom.js";
import * as SVGs from "#common/icon.js";
import { throttleRaf } from "#common/throttle.js";

// ── Panel CSS classes ───────────────────────────────────────────
const CLASSES = {
  COLLAPSED: "foliplus-is-collapsed",
  EXPANDED: "foliplus-is-expanded",
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
  // Read --foliplus-z-index-floating from :root (defined in CSS), then offset bar and section.
  // Fallback matches the token default (9990) so a page that omits shared
  // token.css still stacks the expanded panel in the control band.
  const base = parseInt(
    cssVar(document.documentElement, "--foliplus-z-index-floating", "9990"),
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
    L.DomEvent.on(btn, "click", (event: Event) => {
      L.DomEvent.stop(event);
      opts.container.classList.remove(CLASSES.COLLAPSED);
      opts.container.classList.add(CLASSES.EXPANDED);
      adjustPanelZIndex({ container: opts.container, expanded: true });
    });
  }
  const hdr = opts.container.querySelector(opts.header) as HTMLElement | null;
  if (hdr) {
    L.DomEvent.on(hdr, "click", (event: Event) => {
      L.DomEvent.stop(event);
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
  L.DomEvent.on(opts.toggleBtn, "click", (event: Event) => {
    L.DomEvent.stop(event);
    const expanding = opts.container.classList.contains(CLASSES.COLLAPSED);
    opts.container.classList.toggle(CLASSES.COLLAPSED);
    opts.container.classList.toggle(CLASSES.EXPANDED);
    adjustPanelZIndex({ container: opts.container, expanded: expanding });
    if (expanding) opts.onExpand?.();
    else opts.onCollapse?.();
  });
};

/**
 * Presses already judged inside some panel, keyed by the event object.
 *
 * `bindOutsideCollapse` samples `container.contains(target)` in the capture
 * phase because LayerControl's fold click rebuilds the list and detaches the
 * pressed row before the bubble phase. The catch is that capture listeners on
 * `document` all run in one pass before any bubble handler, so with two panels
 * open, panel B's capture would still see "outside" for a press inside panel A
 * and collapse B on the way past.
 *
 * Recording the verdict on a module-level set instead of a per-binding flag
 * lets each binding consult what the earlier ones already decided, so a press
 * inside *any* registered panel is inside all of them. A WeakSet is used so the
 * entry disappears with the event and nothing accumulates.
 */
const insidePress = new WeakSet<Event>();

/**
 * Collapse a panel when clicking outside of it.
 * Sets up a MutationObserver to auto-cleanup when the container is removed.
 * @returns Cleanup function
 */
const bindOutsideCollapse = (opts: {
  container: HTMLElement;
  skipCheck?: () => boolean;
}): (() => void) => {
  const skipCheck = opts.skipCheck ?? (() => false);
  // Sample the press in the capture phase: at that point the pressed node is
  // still live, so `contains` sees it. LayerControl's fold click rebuilds the
  // list, detaching the button before the bubble phase, which makes a bubble-
  // time `contains(event.target)` read false and collapse a panel the user was
  // clicking inside.
  //
  // `skipCheck` is consulted in the capture pass too: the verdict is per press,
  // so answering it late (in the bubble handler) would record a press the
  // caller asked to ignore and swallow the next real outside click.
  const capture = (event: MouseEvent): void => {
    if (skipCheck()) return;
    if (insidePress.has(event)) return;
    if (opts.container.contains(event.target as Node)) insidePress.add(event);
  };
  const handler = (event: MouseEvent): void => {
    if (skipCheck()) return;
    if (
      !insidePress.has(event) &&
      opts.container.classList.contains(CLASSES.EXPANDED)
    ) {
      opts.container.classList.remove(CLASSES.EXPANDED);
      opts.container.classList.add(CLASSES.COLLAPSED);
      adjustPanelZIndex({ container: opts.container, expanded: false });
    }
  };
  document.addEventListener("click", capture, true);
  document.addEventListener("click", handler);

  // Auto-cleanup: remove listener when container is removed from DOM
  const cleanup = (): void => {
    document.removeEventListener("click", capture, true);
    document.removeEventListener("click", handler);
  };
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
  map: L.Map;
  hideEvents?: string[];
  updateEvents?: string[];
  showEvents?: string[];
  onHide?: () => void;
  onUpdate?: () => void;
  onShow?: () => void;
  onMove?: () => void;
}): (() => void) => {
  const handlers: Array<[string, () => void]> = [];
  const add = (events: string[] | undefined, fn: (() => void) | undefined) => {
    if (!events || !fn) return;
    events.forEach(event => {
      opts.map.on(event, fn);
      handlers.push([event, fn]);
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
    handlers.forEach(([event, fn]) => opts.map.off(event, fn));
    onMove?.cancel();
  };
};

/**
 * Build the header bar every panel shares: type logo + title on the left, the
 * close button on the right.
 *
 * `createPanelControl` calls this for the fold panels, and LayerControl's
 * floating attributes surface calls it directly — that surface is a dropdown
 * anchored to a row rather than a folded control, but its header is the same
 * affordance and must not drift into a lookalike.
 *
 * The close button carries both `title` (pointer users) and `aria-label`
 * (screen readers) because its only content is an SVG glyph. The logo is
 * marked decorative — the title text right beside it already names the panel.
 */
const createPanelHeader = (opts: {
  title: string;
  iconSvg: string;
  closeTitle: string;
  titleClass?: string;
  iconClass?: string;
}): HTMLElement => {
  const header = dom.el("div", {
    class: CLASSES.PANEL_HEADER,
    title: opts.closeTitle,
  });
  header.appendChild(
    dom.el(
      "span",
      { class: opts.titleClass ?? "foliplus-header-title" },
      dom.el(
        "span",
        {
          class: opts.iconClass ?? "foliplus-header-icon",
          "aria-hidden": "true",
        },
        { html: opts.iconSvg },
      ),
      opts.title,
    ),
  );
  header.appendChild(
    dom.el(
      "button",
      {
        class: "foliplus-ctrl-btn foliplus-close-btn",
        type: "button",
        title: opts.closeTitle,
        "aria-label": opts.closeTitle,
      },
      { html: SVGs.ICON_CLOSE },
    ),
  );
  return header;
};

/** Smallest height the row panel is allowed to compress to when the anchor has
 *  too little room on either side — below this the panel would hide more
 *  content than it shows, so the fallback is "fit the visible strip" with an
 *  internal scroll on the content. */
const ROW_PANEL_MIN_HEIGHT = 120;

/** Measure the anchor row against its map and place the row panel.
 *
 * The panel is a `position: absolute; top: 100%` child of its row, so a
 * fixed `max-height` cap can clip the panel's own content once the row sits
 * low in the map (or the map is short): the reported 1280x720 case was a
 * 400px cap on a 243px panel whose bottom-row variant still pushed the last
 * dimension below the map's `overflow: hidden` edge.
 *
 * Two moves here, both driven by the same measurement:
 *   B — the visible cap. The panel writes its own `--foliplus-row-panel-max-height`
 *       to the larger of the two available strips (below or above the anchor),
 *       so the content scrolls inside the panel instead of falling off the map.
 *   C — the flip. When the strip below is smaller than the panel needs AND the
 *       strip above is larger, the panel re-anchors upward via the
 *       upward-modifier class and the same cap is applied to the space above.
 *
 * When both strips are tighter than the content, the panel lands in the wider
 * one clamped to `ROW_PANEL_MIN_HEIGHT` — the content's own `overflow-y: auto`
 * then scrolls the excess inside the card.
 */
const measureRowPanelPlacement = (panel: HTMLElement): void => {
  const mapEl = panel.closest(".leaflet-container") as HTMLElement | null;
  const anchor = panel.parentElement;
  if (!mapEl || !anchor) return;

  const mapRect = mapEl.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  if (mapRect.width === 0 || anchorRect.height === 0) return;

  const below = mapRect.bottom - anchorRect.bottom;
  const above = anchorRect.top - mapRect.top;
  // `scrollHeight` on a max-height-capped element is the *natural* content
  // height, not the clipped one — reading it here is what lets us compare
  // against the available strip on both sides.
  const natural = panel.scrollHeight;

  const flipUp = below < natural && above > below;
  const room = flipUp ? above : below;
  const cap = Math.max(ROW_PANEL_MIN_HEIGHT, Math.min(natural, room));

  panel.style.setProperty("--foliplus-row-panel-max-height", `${cap}px`);
  panel.classList.toggle("foliplus-row-panel-up", flipUp);
};

/** Bind row-panel placement to a panel the caller will mount on a layer row.
 *
 * `createRowPanel` returns the panel before it has a parent, so the placement
 * runs from a MutationObserver that waits for the panel to enter `document` —
 * the caller's `item.appendChild(panel)`. Resize of the map itself and of the
 * viewport both trigger a remeasure; the observer releases everything on the
 * panel's next removal (which is how the style / attributes panels are closed).
 *
 * Returns the cleanup so a caller that keeps its own destroy hook (e.g. the
 * row-rebuild path that drops the whole list) can call it directly. The
 * MutationObserver disconnect is idempotent, so double-invocation is safe.
 */
const observeRowPanelPlacement = (panel: HTMLElement): (() => void) => {
  const measure = throttleRaf(() => measureRowPanelPlacement(panel));
  let active = false;
  let ro: ResizeObserver | null = null;

  const activate = (): void => {
    if (active) return;
    active = true;
    measure();
    const mapEl = panel.closest(".leaflet-container") as HTMLElement | null;
    if (mapEl && typeof ResizeObserver === "function") {
      ro = new ResizeObserver(() => measure());
      ro.observe(mapEl);
    }
    window.addEventListener("resize", measure);
  };
  const deactivate = (): void => {
    if (!active) return;
    active = false;
    measure.cancel();
    if (ro) {
      ro.disconnect();
      ro = null;
    }
    window.removeEventListener("resize", measure);
  };

  const obs = new MutationObserver(() => {
    if (panel.isConnected) activate();
    else deactivate();
  });
  obs.observe(document.body, { childList: true, subtree: true });

  return (): void => {
    deactivate();
    obs.disconnect();
  };
};

/**
 * Create the floating surface a layer row opens from its ⋮ menu: the
 * attributes panel and the per-layer style panel.
 *
 * It is a `foliplus-panel` with the fold panels' header/content vocabulary, but
 * anchored under its own row instead of folded into the control — so the caller
 * mounts the returned `panel` on the row. Anchoring, width, height cap, card
 * chrome and the `stretch` axis all come from the shared `.foliplus-row-panel`
 * recipe, and the header from {@link createPanelHeader}, so a new row panel
 * cannot drift into a lookalike of the ones already here.
 *
 * Placement runs against the map the panel is mounted in: the panel measures
 * the space above and below its anchor row, writes the visible cap to a
 * per-panel CSS variable, and flips upward when the space below is the tight
 * side — see {@link measureRowPanelPlacement}. The MutationObserver that drives
 * the placement detaches with the panel, so a caller that unmounts the panel
 * never leaks a resize listener.
 *
 * `iconClass` stays a parameter because each component's SVGs are viewBox-only
 * and need their own sizing hook inside the shared icon box.
 */
const createRowPanel = (opts: {
  cssClass: string;
  title: string;
  iconSvg: string;
  closeTitle: string;
  iconClass: string;
  /** Accessible name of the dialog. Defaults to `title`; the attributes panel
   *  names the *surface* (Layer attributes) while its header shows the layer's
   *  own display name, so the two are separate knobs. */
  ariaLabel?: string;
}): {
  panel: HTMLElement;
  header: HTMLElement;
  content: HTMLElement;
} => {
  const panel = dom.el("div", {
    class: `${opts.cssClass} foliplus-panel foliplus-row-panel`,
    role: "dialog",
    "aria-label": opts.ariaLabel ?? opts.title,
    // The panel is anchored inside the layer row, which carries a hover
    // tooltip ("6 point layer"). An empty title suppresses that inherited
    // tooltip so hovering the panel body does not echo the row's text; the
    // header's own visible title and the close button's title still apply.
    title: "",
  });
  const header = createPanelHeader({
    title: opts.title,
    iconSvg: opts.iconSvg,
    closeTitle: opts.closeTitle,
    iconClass: opts.iconClass,
  });
  const content = dom.el("div", { class: "foliplus-panel-content" });
  panel.appendChild(header);
  panel.appendChild(content);
  observeRowPanelPlacement(panel);
  return { panel, header, content };
};

/**
 * Create a panel-style control with toggle button, header, and content area.
 * Used by HeatmapControl and LayerControl for consistent panel UI.
 * Automatically wires up bindPanelToggle, plus the press-outside collapse
 * decided by `collapseOnOutside` (default on: the shell's historic behavior).
 *
 * The map's busiest gesture is drag-pan / click-select, so an outside press is
 * a poor trigger for a panel the user is actively working in — LayerControl
 * passes `false` on that ground. The header close affordance is always the
 * explicit collapse path, so no capability is lost either way. Popup-style
 * surfaces use createRowPanel, which owns its own dismiss.
 *
 * @returns `destroy` unbinds the outside-collapse listeners. `BaseControl.onRemove`
 *   calls it so a control removed while still in the DOM (detached and later
 *   re-added) does not leak a document-level capture + bubble pair; the
 *   MutationObserver only covers the plain "removed from body" case.
 */
const createPanelControl = (opts: {
  cssClass: string;
  toggleTitle: string;
  toggleSvg: string;
  panelTitle: string;
  closeTitle: string;
  ctrlId?: string;
  /** Collapse the panel on a press outside it. Defaults to `true` so a caller
   *  that omits it keeps the shell's historic behavior; LayerControl passes
   *  `false` because the panel is a working surface read alongside the map. */
  collapseOnOutside?: boolean;
}): {
  container: HTMLElement;
  ctrl: HTMLElement;
  toggleBtn: HTMLElement | null;
  panelContent: HTMLElement;
  destroy: () => void;
} => {
  const container = dom.el("div", { class: CLASSES.LEAFLET_BAR });
  const ctrl = dom.el("div", {
    class: `foliplus-panel ${CLASSES.FOLD} ${opts.cssClass} ${CLASSES.COLLAPSED}`,
    // Every panel gets a stable id so tests and the fold-state store can key
    // on it; LayerControl passes an explicit one to keep its historic name.
    id: opts.ctrlId ?? `${opts.cssClass}_ctrl`,
  });
  ctrl.appendChild(
    dom.el(
      "button",
      {
        class: CLASSES.TOGGLE_BTN,
        title: opts.toggleTitle,
        "aria-label": opts.toggleTitle,
      },
      { html: opts.toggleSvg },
    ),
  );
  const panelWrap = dom.el("div", { class: "foliplus-panel-wrap" });
  const header = createPanelHeader({
    title: opts.panelTitle,
    iconSvg: opts.toggleSvg,
    closeTitle: opts.closeTitle,
  });
  // The header is the collapse affordance for a fold panel, so name it as the
  // dialog a screen reader lands in once the panel is open.
  header.setAttribute("role", "dialog");
  header.setAttribute("aria-label", opts.panelTitle);
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
  const unbindOutside = bindOutsideCollapse({
    container: ctrl,
    // skipCheck short-circuits the capture pass too, so the panel is inert to
    // outside presses rather than collapsing.
    skipCheck: opts.collapseOnOutside === false ? () => true : undefined,
  });

  return {
    container,
    ctrl,
    toggleBtn: ctrl.querySelector(`.${CLASSES.TOGGLE_BTN}`) as HTMLElement,
    panelContent,
    destroy: unbindOutside,
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
  createPanelHeader,
  measureRowPanelPlacement,
  observeRowPanelPlacement,
  createRowPanel,
};
