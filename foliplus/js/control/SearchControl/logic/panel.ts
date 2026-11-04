// SearchControl result panel DOM helpers — pure panel show/hide/render
// utilities plus ✕ marker cleanup. No search or history business logic;
// shared by ./search.ts (suggestions) and ./history.ts (history entries
// render as panel items). Kept cycle-free: imports nothing from
// ./search.js or ./history.js.
//
// `map` is a free variable injected by the Python-side IIFE wrapper —
// same mechanism as ./search.ts; declared in type/global.d.ts.
import { DEL_ICON_MARKER_ANCHOR, mountDelIcon } from "#core/leaflet/index.js";
import { cssVar } from "#common/cssvar.js";
import { dom } from "#common/dom.js";
import { bindFloatingWheel } from "#common/floating.js";
import { computePlacement } from "#ui/placement.js";
import { CLASSES } from "../const.js";
import type { ResultItem } from "../type.js";
import { type SearchControlCtx } from "./util.js";

// listCursor lives on SearchControl but not on SearchControlState; panel.ts
// only touches it at panel-lifecycle boundaries (destroy on teardown, refresh
// after a re-render), so both methods must be present.
type CursorAware = SearchControlCtx & {
  listCursor?: { destroy: () => void; refresh: () => void } | null;
};

/**
 * Attach a floating ✕ delete icon to the search marker.
 * The ✕ shows while the popup is open; clicking it removes the pin and
 * clears the search input, mirroring MeasureControl / LocateControl UX.
 */
const attachSearchDelIcon = (ctrl: SearchControlCtx, latlng: L.LatLngExpression) => {
  if (ctrl.delIcon) {
    map.removeLayer(ctrl.delIcon);
    ctrl.delIcon = null;
  }
  const clearSearch = () => {
    if (ctrl.marker) {
      map.removeLayer(ctrl.marker);
      ctrl.marker = null;
    }
    if (ctrl.delIcon) {
      map.removeLayer(ctrl.delIcon);
      ctrl.delIcon = null;
    }
    ctrl.inp.value = "";
    ctrl.inp.focus();
  };
  // The ✕ is hidden by default and only appears while the popup is open,
  // matching MeasureControl / LocateControl marker UX.
  ctrl.delIcon = mountDelIcon(
    latlng,
    { title: ctrl._("foliplus.close_label"), iconAnchor: DEL_ICON_MARKER_ANCHOR },
    m => map.addLayer(m),
    clearSearch,
    ctrl.marker,
  );
};

const removePanel = (ctrl: SearchControlCtx) => {
  if (ctrl.throttleTimer) {
    clearTimeout(ctrl.throttleTimer);
    ctrl.throttleTimer = null;
  }
  if (ctrl.panelWrap) {
    ctrl.panelWrap.remove();
    ctrl.panelWrap = null;
  }
  ctrl.selectedIdx = -1;
  ctrl.currentItems = [];
  const withCursor = ctrl as CursorAware;
  withCursor.listCursor?.destroy();
  withCursor.listCursor = null;
};

const positionPanel = (ctrl: SearchControlCtx) => {
  if (!ctrl.panelWrap) return;
  const panel = ctrl.panelWrap;
  // The result panel is position: fixed, so rects are already viewport-relative
  // and the scroll offset must NOT be added (a fixed element is positioned
  // against the viewport, not the document).
  const anchor = ctrl.ctrl.getBoundingClientRect();
  // The map container is the final boundary: when the map is smaller than the
  // viewport the panel must not spill past the map edge (the kernel's viewport
  // clamp is only its intermediate result).
  const bounds = map.getContainer().getBoundingClientRect();
  // The engine owns the gap (--foliplus-menu-gap) and the height cap is the
  // menu-max-height token, so the kernel can flip above / clamp / cap.
  const gap = parseFloat(cssVar(panel, "--foliplus-menu-gap", "4px")) || 0;
  const maxToken =
    parseFloat(cssVar(panel, "--foliplus-menu-max-height", "240px")) || 0;
  const placement = computePlacement(
    anchor,
    { width: panel.offsetWidth, height: Math.min(panel.scrollHeight, maxToken) },
    bounds,
    { gap },
  );
  panel.style.left = `${placement.left}px`;
  panel.style.top = `${placement.top}px`;
  panel.style.maxWidth = `${placement.maxWidth}px`;
  panel.style.maxHeight = `${placement.maxHeight}px`;
  panel.classList.toggle("foliplus-search-result-panel-up", placement.side === "above");
};

const renderResults = (ctrl: SearchControlCtx, results: ResultItem[]) => {
  if (results.length === 0) {
    removePanel(ctrl);
    return;
  }

  if (!ctrl.panelWrap) {
    ctrl.panelWrap = dom.el("div", {
      class: CLASSES.RESULT_PANEL,
      parent: map.getContainer(),
      onclick: (event: Event) => event.stopPropagation(),
    });
    // A wheel over the result panel must not zoom the map. The panel is
    // mounted on the map container (not inside the control's container), so
    // the container's disableScrollPropagation does not cover it — a wheel
    // bubbles to the map container and Leaflet's scrollWheelZoom would fire.
    // The shared containment stops only a wheel that can actually scroll the
    // panel (its own overflow-y works); a wheel at a boundary or over a
    // non-scrollable panel keeps bubbling, so the map still zooms at the
    // edges.
    //
    // Bound once, right here in the creation block: the element exists only
    // once (subsequent renders reuse it, removePanel drops it), so binding
    // here means one listener per element lifecycle — no stacking per
    // renderResults, and no stale flag to reset when a new element is made.
    bindFloatingWheel(ctrl.panelWrap, "contain");
  }

  ctrl.panelWrap.innerHTML = "";
  ctrl.selectedIdx = -1;

  // Retained so Enter reuses the keyboard selection instead of re-geocoding.
  ctrl.currentItems = results;

  results.forEach((item: ResultItem, idx: number) => {
    dom.el(
      "div",
      {
        class: CLASSES.RESULT_ITEM,
        "data-index": String(idx),
        // Keyboard nav reads `data-query` to fill the input. History items
        // carry their panel display (addrDisplay / coordDisplay); suggestions
        // omit it and fall back to RESULT_TEXT in interaction.ts.
        "data-query": item.query,
        parent: ctrl.panelWrap,
        onmousedown: (event: Event) => {
          event.stopPropagation();
          event.preventDefault();
          // Panel closes only if the click actually places a marker. A
          // mode-lock refusal leaves the panel open so the user sees the
          // hint and can retry once the blocking mode clears.
          if (item.onClick()) removePanel(ctrl);
        },
      },
      dom.el("span", { class: CLASSES.RESULT_ICON }, { html: item.icon }),
      dom.el(
        "div",
        { class: CLASSES.RESULT_CONTENT },
        dom.el("span", { class: CLASSES.RESULT_TEXT }, item.primaryText),
        item.coordDisplay
          ? dom.el("div", { class: CLASSES.RESULT_COORD }, item.coordDisplay)
          : null,
      ),
    );
  });
  // Position after the items are in the DOM: the kernel's max-height is the
  // min of the surface height and the available strip, and the surface height
  // reads scrollHeight — positioning before the items land would collapse the
  // panel to max-height 0.
  positionPanel(ctrl);

  // Post-render sanity: DOM RESULT_ITEM count must equal the retained array
  // so keyboard navigation (DOM-indexed) and Enter adoption (array-indexed)
  // never drift. Cheap on a tiny panel; fails loudly if a future edit breaks
  // the lockstep that the Enter handler depends on.
  const domCount = ctrl.panelWrap.querySelectorAll(`.${CLASSES.RESULT_ITEM}`).length;
  if (domCount !== results.length) {
    throw new Error(
      ctrl.log.msg(
        `result panel drift: DOM has ${domCount} items but retained ${results.length}`,
      ),
    );
  }
  // Re-tag ARIA after the rebuild (cursor may already exist from a prior panel).
  const withCursor = ctrl as CursorAware;
  withCursor.listCursor?.refresh();
};

export { attachSearchDelIcon, positionPanel, removePanel, renderResults };
