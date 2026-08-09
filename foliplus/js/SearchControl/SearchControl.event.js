// SearchControl event binding — standalone functions called with `this` as ctrl.
import { adjustPanelZIndex } from "../common/panel.js";
import { AUTOCOMPLETE, CLASSES, MODE, PARAM } from "./SearchControl.const.js";
import {
  fetchSuggestions,
  positionSuggestions,
  removeSuggestions,
  searchAddress,
  searchCoord,
} from "./SearchControl.logic.js";

const foliplus = window.foliplus;

/**
 * Bind all DOM events for the SearchControl.
 * @param {Object} ctrl - SearchControl instance
 */
const bindEvents = (ctrl) => {
  ctrl.toggleBtn.onclick = (e) => {
    e.stopPropagation();
    if (ctrl.ctrl.classList.contains(CLASSES.EXPANDED)) {
      ctrl.ctrl.classList.remove(CLASSES.EXPANDED);
      ctrl.ctrl.classList.add(CLASSES.COLLAPSED);
      adjustPanelZIndex({ container: ctrl.ctrl, expanded: false });
      foliplus.hideHint(CONF.name);
      removeSuggestions(ctrl);
    } else {
      ctrl.ctrl.classList.remove(CLASSES.COLLAPSED);
      ctrl.ctrl.classList.add(CLASSES.EXPANDED);
      adjustPanelZIndex({ container: ctrl.ctrl, expanded: true });
      ctrl.inp.focus();
    }
  };

  ctrl.clearBtn.onclick = () => {
    ctrl.inp.value = "";
    if (ctrl.marker) {
      map.removeLayer(ctrl.marker);
      ctrl.marker = null;
    }
    ctrl.inp.focus();
  };

  ctrl.inp.addEventListener("input", () => {
    ctrl.inp.placeholder =
      ctrl.mode === MODE.COORD
        ? ctrl._(`${CONF.name}.coord_placeholder`)
        : ctrl._(`${CONF.name}.addr_placeholder`);

    if (ctrl.mode === MODE.ADDR) ctrl.debouncedFetch();
    else {
      ctrl.debouncedFetch.cancel();
      removeSuggestions(ctrl);
    }
  });

  ctrl.inp.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
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
    if (e.key === "ArrowDown" && ctrl.suggestionsWrap) {
      e.preventDefault();
      const items = ctrl.suggestionsWrap.querySelectorAll(":scope > *");
      ctrl.selectedSuggestionIdx = Math.min(
        ctrl.selectedSuggestionIdx + 1,
        items.length - 1,
      );
      items.forEach((el, i) =>
        el.classList.toggle(CLASSES.ACTIVE, i === ctrl.selectedSuggestionIdx),
      );
      if (items[ctrl.selectedSuggestionIdx])
        ctrl.inp.value = items[ctrl.selectedSuggestionIdx].querySelector(
          `.${CLASSES.SUGGESTION_TEXT}`,
        ).textContent;
      return;
    }
    if (e.key === "ArrowUp" && ctrl.suggestionsWrap) {
      e.preventDefault();
      const items = ctrl.suggestionsWrap.querySelectorAll(":scope > *");
      ctrl.selectedSuggestionIdx = Math.max(ctrl.selectedSuggestionIdx - 1, -1);
      items.forEach((el, i) =>
        el.classList.toggle(CLASSES.ACTIVE, i === ctrl.selectedSuggestionIdx),
      );
      if (ctrl.selectedSuggestionIdx >= 0 && items[ctrl.selectedSuggestionIdx])
        ctrl.inp.value = items[ctrl.selectedSuggestionIdx].querySelector(
          `.${CLASSES.SUGGESTION_TEXT}`,
        ).textContent;
      return;
    }
    if (e.key === "Enter") {
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
  ctrl.scrollTargets = [window, document.querySelector(".leaflet-container")].filter(
    Boolean,
  );
  ctrl.scrollTargets.forEach((t) =>
    t.addEventListener("scroll", ctrl.repositionHandler, true),
  );
  window.addEventListener("resize", ctrl.repositionHandler);
};

/**
 * Parse URL parameters to initialize search state.
 * @param {Object} ctrl - SearchControl instance
 */
const initFromUrl = (ctrl) => {
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
