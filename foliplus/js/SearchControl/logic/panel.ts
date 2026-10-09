// SearchControl result panel DOM helpers — pure panel show/hide/render
// utilities plus ✕ marker cleanup. No search or history business logic;
// shared by ./search.ts (suggestions) and ./history.ts (history entries
// render as panel items). Kept cycle-free: imports nothing from
// ./search.js or ./history.js.
//
// `map` is a free variable injected by the Python-side IIFE wrapper —
// same mechanism as ./search.ts; declared in type/global.d.ts.
import { DEL_ICON_MARKER_ANCHOR, mountDelIcon } from "#core/leaflet/index.js";
import { dom } from "#common/dom.js";
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
  const rect = ctrl.ctrl.getBoundingClientRect();
  let left = rect.left + window.scrollX;
  if (left + rect.width > window.innerWidth) {
    left = window.innerWidth - rect.width + window.scrollX;
  }
  ctrl.panelWrap.style.left = `${left}px`;
  ctrl.panelWrap.style.top = `${rect.bottom + window.scrollY}px`;
};

const renderResults = (ctrl: SearchControlCtx, results: ResultItem[]) => {
  if (results.length === 0) {
    removePanel(ctrl);
    return;
  }

  ctrl.panelWrap ??= dom.el("div", {
    class: CLASSES.RESULT_PANEL,
    parent: map.getContainer(),
    onclick: (event: Event) => event.stopPropagation(),
  });

  ctrl.panelWrap.innerHTML = "";
  ctrl.selectedIdx = -1;
  positionPanel(ctrl);

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
