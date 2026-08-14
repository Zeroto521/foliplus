// SearchControl event binding — standalone functions called with `this` as ctrl.
import { createControlEnv } from "#common/guard.js";
import { adjustPanelZIndex, bindFoldToggle } from "#common/panel.js";
import { AUTOCOMPLETE, CLASSES, MODE, PARAM } from "./const.js";
import {
  fetchSuggestions,
  positionSuggestions,
  removeSuggestions,
  searchAddress,
  searchCoord,
} from "./logic.js";
import type { SearchControl } from "./type.js";

const { _, foliplus } = createControlEnv(CONF);

/**
 * Bind all DOM events for the SearchControl.
 */
const bindEvents = (ctrl: SearchControl) => {
  bindFoldToggle({
    container: ctrl.ctrl,
    toggleBtn: ctrl.toggleBtn,
    onExpand: () => ctrl.inp.focus(),
    onCollapse: () => {
      foliplus.hideHint(CONF.name);
      removeSuggestions(ctrl);
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

    if (ctrl.mode === MODE.ADDR) ctrl.debouncedFetch();
    else {
      ctrl.debouncedFetch.cancel();
      removeSuggestions(ctrl);
    }
  });

  ctrl.inp.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (ctrl.suggestionsWrap) {
        removeSuggestions(ctrl);
        return;
      }
      ctrl.ctrl.classList.remove(CLASSES.EXPANDED);
      ctrl.ctrl.classList.add(CLASSES.COLLAPSED);
      adjustPanelZIndex({ container: ctrl.ctrl, expanded: false });
      foliplus.hideHint(CONF.name);
      return;
    }
    if (event.key === "ArrowDown" && ctrl.suggestionsWrap) {
      event.preventDefault();
      const items = ctrl.suggestionsWrap.querySelectorAll(":scope > *");
      ctrl.selectedSuggestionIdx = Math.min(
        ctrl.selectedSuggestionIdx + 1,
        items.length - 1,
      );
      items.forEach((el: Element, i: number) =>
        el.classList.toggle(CLASSES.ACTIVE, i === ctrl.selectedSuggestionIdx),
      );
      if (items[ctrl.selectedSuggestionIdx])
        ctrl.inp.value =
          items[ctrl.selectedSuggestionIdx].querySelector(`.${CLASSES.SUGGESTION_TEXT}`)
            ?.textContent ?? "";
      return;
    }
    if (event.key === "ArrowUp" && ctrl.suggestionsWrap) {
      event.preventDefault();
      const items = ctrl.suggestionsWrap.querySelectorAll(":scope > *");
      ctrl.selectedSuggestionIdx = Math.max(ctrl.selectedSuggestionIdx - 1, -1);
      items.forEach((el: Element, i: number) =>
        el.classList.toggle(CLASSES.ACTIVE, i === ctrl.selectedSuggestionIdx),
      );
      if (ctrl.selectedSuggestionIdx >= 0 && items[ctrl.selectedSuggestionIdx])
        ctrl.inp.value =
          items[ctrl.selectedSuggestionIdx].querySelector(`.${CLASSES.SUGGESTION_TEXT}`)
            ?.textContent ?? "";
      return;
    }
    if (event.key === "Enter") {
      const raw = ctrl.inp.value.trim();
      removeSuggestions(ctrl);
      if (!raw) return;
      ctrl.mode === MODE.COORD ? searchCoord(ctrl, raw) : searchAddress(ctrl, raw);
    }
  });

  ctrl.inp.addEventListener("blur", () => setTimeout(() => removeSuggestions(ctrl), 0));

  ctrl.inp.addEventListener("focus", () => {
    if (ctrl.mode === MODE.ADDR) {
      const val = ctrl.inp.value.trim();
      if (val.length >= AUTOCOMPLETE.MIN_CHARS) fetchSuggestions(ctrl, val);
    }
  });

  ctrl.repositionHandler = () => positionSuggestions(ctrl);
  const leafletContainer = document.querySelector(".leaflet-container");
  ctrl.scrollTargets = leafletContainer ? [window, leafletContainer] : [window];
  ctrl.scrollTargets.forEach((t: Element | Window) =>
    t.addEventListener("scroll", ctrl.repositionHandler, true),
  );
  window.addEventListener("resize", ctrl.repositionHandler);
};

/**
 * Parse URL parameters to initialize search state.
 */
const initFromUrl = (ctrl: SearchControl) => {
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
