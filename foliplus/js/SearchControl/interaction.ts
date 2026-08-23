// SearchControl event binding — standalone functions called with `this` as ctrl.
import { ensureInteraction } from "#core/interaction.js";
import { createControlEnv } from "#common/guard.js";
import { adjustPanelZIndex, bindFoldToggle } from "#common/panel.js";
import { CLASSES, MODE, PARAM } from "./const.js";
import {
  fetchSuggestions,
  positionPanel,
  removePanel,
  searchAddress,
  searchCoord,
} from "./logic.js";
import type { SearchControl } from "./type.js";

const { _ } = createControlEnv(CONF);

/**
 * Bind all DOM events for the SearchControl.
 */
const bindEvents = (ctrl: SearchControl): (() => void) => {
  bindFoldToggle({
    container: ctrl.ctrl,
    toggleBtn: ctrl.toggleBtn,
    onExpand: () => ctrl.inp.focus(),
    onCollapse: () => {
      map.foliplus!.hideHint(CONF.name);
      removePanel(ctrl);
    },
  });

  ctrl.clearBtn.onclick = () => {
    ctrl.inp.value = "";
    if (ctrl.marker) {
      map.removeLayer(ctrl.marker);
      ctrl.marker = null;
    }
    if (ctrl.delIcon) {
      map.removeLayer(ctrl.delIcon);
      ctrl.delIcon = null;
    }
    ctrl.inp.focus();
  };

  ctrl.inp.addEventListener("input", () => {
    ctrl.inp.placeholder =
      ctrl.mode === MODE.COORD
        ? _(`${CONF.name}.coord_placeholder`)
        : _(`${CONF.name}.addr_placeholder`);

    if (ctrl.inp.value.trim().length === 0) {
      // Input cleared — show history immediately
      ctrl.debouncedFetch.cancel();
      fetchSuggestions(ctrl, "");
    } else if (ctrl.mode === MODE.ADDR) {
      ctrl.debouncedFetch();
    } else {
      ctrl.debouncedFetch.cancel();
      removePanel(ctrl);
    }
  });

  ensureInteraction(map).register(CONF.name, [
    {
      key: "Escape",
      element: ctrl.inp,
      handler: () => {
        if (ctrl.panelWrap) {
          removePanel(ctrl);
          return;
        }
        ctrl.ctrl.classList.remove(CLASSES.EXPANDED);
        ctrl.ctrl.classList.add(CLASSES.COLLAPSED);
        adjustPanelZIndex({ container: ctrl.ctrl, expanded: false });
        map.foliplus!.hideHint(CONF.name);
      },
    },
    {
      key: "ArrowDown",
      element: ctrl.inp,
      handler: () => {
        if (!ctrl.panelWrap) return;
        const items = ctrl.panelWrap.querySelectorAll(`.${CLASSES.RESULT_ITEM}`);
        if (items.length === 0) return;
        ctrl.selectedIdx = Math.min(ctrl.selectedIdx + 1, items.length - 1);
        items.forEach((el: Element, i: number) =>
          el.classList.toggle(CLASSES.ACTIVE, i === ctrl.selectedIdx),
        );
        ctrl.inp.value =
          items[ctrl.selectedIdx].querySelector(`.${CLASSES.RESULT_TEXT}`)
            ?.textContent ?? "";
      },
    },
    {
      key: "ArrowUp",
      element: ctrl.inp,
      handler: () => {
        if (!ctrl.panelWrap) return;
        const items = ctrl.panelWrap.querySelectorAll(`.${CLASSES.RESULT_ITEM}`);
        if (items.length === 0) return;
        ctrl.selectedIdx = Math.max(ctrl.selectedIdx - 1, -1);
        items.forEach((el: Element, i: number) =>
          el.classList.toggle(CLASSES.ACTIVE, i === ctrl.selectedIdx),
        );
        if (ctrl.selectedIdx >= 0)
          ctrl.inp.value =
            items[ctrl.selectedIdx].querySelector(`.${CLASSES.RESULT_TEXT}`)
              ?.textContent ?? "";
      },
    },
    {
      key: "Enter",
      element: ctrl.inp,
      handler: () => {
        const raw = ctrl.inp.value.trim();
        removePanel(ctrl);
        if (!raw) return;
        ctrl.mode === MODE.COORD ? searchCoord(ctrl, raw) : searchAddress(ctrl, raw);
      },
    },
  ]);

  ctrl.inp.addEventListener("focus", () => {
    const val = ctrl.inp.value.trim();
    // Empty input → show search history for current mode;
    // non-empty → fetch suggestions (addr mode only)
    if (val.length === 0) fetchSuggestions(ctrl, "");
    else if (ctrl.mode === MODE.ADDR) fetchSuggestions(ctrl, val);
  });

  // Watch for collapse state changes (via toggle, Escape, or outside click)
  // to remove the floating history/suggestions panel.
  const collapseObserver = new MutationObserver(() => {
    if (ctrl.ctrl.classList.contains(CLASSES.COLLAPSED)) removePanel(ctrl);
  });
  collapseObserver.observe(ctrl.ctrl, { attributes: true, attributeFilter: ["class"] });

  ctrl.repositionHandler = () => positionPanel(ctrl);
  const leafletContainer = document.querySelector(".leaflet-container");
  ctrl.scrollTargets = leafletContainer ? [window, leafletContainer] : [window];
  ctrl.scrollTargets.forEach((t: Element | Window) =>
    t.addEventListener("scroll", ctrl.repositionHandler, true),
  );
  window.addEventListener("resize", ctrl.repositionHandler);

  return () => {
    collapseObserver.disconnect();
    ensureInteraction(map).unregister(CONF.name);
  };
};

/**
 * Parse URL parameters to initialize search state.
 */
const initFromUrl = (ctrl: SearchControl): void => {
  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get(PARAM.Q);
    const latParam = params.get(PARAM.LAT);
    const lngParam = params.get(PARAM.LNG);

    if (q) {
      const parts = q
        .replace(/\uff0c/g, ",")
        .replace(/\s+/g, "")
        .split(",")
        .map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        ctrl.setMode(MODE.COORD);
        searchCoord(ctrl, q);
      } else {
        ctrl.setMode(MODE.ADDR);
        ctrl.inp.value = q;
        searchAddress(ctrl, q);
      }
    } else if (latParam && lngParam) {
      const lng = parseFloat(lngParam);
      const lat = parseFloat(latParam);
      if (!isNaN(lng) && !isNaN(lat)) {
        ctrl.setMode(MODE.COORD);
        searchCoord(ctrl, `${lng},${lat}`);
      }
    }
  } catch (e) {
    // Silently ignore URL parsing errors
  }
};

export { bindEvents, initFromUrl };
