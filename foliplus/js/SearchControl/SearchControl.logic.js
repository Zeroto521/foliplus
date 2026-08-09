// SearchControl search/suggestion logic — standalone functions called with `this` as ctrl.
import * as Icons from "../shared/icon.js";
import { AUTOCOMPLETE, CLASSES, MODE, SEARCH, ZOOM } from "./SearchControl.const.js";

const foliplus = window.foliplus;

/**
 * Coordinate search: parse raw input, validate, fly to location, place marker.
 * @param {Object} ctrl - SearchControl instance
 * @param {string} raw - User input (e.g. "121.47,31.23")
 */
const searchCoord = (ctrl, raw) => {
  const parts = raw
    .replace(/\uff0c/g, ",")
    .replace(/\s+/g, "")
    .split(",")
    .map(Number);

  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    foliplus.showHint(
      CONF.name,
      ctrl._(`${CONF.name}.coord_error`),
      foliplus.HINT_DURATION.LONG,
    );
    ctrl.inp.value = "";
    return;
  }

  const lng = parts[0];
  const lat = parts[1];
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    foliplus.showHint(
      CONF.name,
      ctrl._(`${CONF.name}.coord_error`),
      foliplus.HINT_DURATION.LONG,
    );
    ctrl.inp.value = "";
    return;
  }

  foliplus.hideHint(CONF.name);
  map.flyTo([lat, lng], CONF.zoom || 16);
  ctrl.marker = foliplus.createLocationMarker(
    map,
    lng,
    lat,
    null,
    ctrl._(`${CONF.name}.popup_title_coord`),
    ctrl._(`${CONF.name}.popup_loading`),
    ctrl._(`${CONF.name}.popup_loc_label`),
    ctrl._(`${CONF.name}.popup_addr_label`),
    ctrl._("foliplus.close_label"),
    CONF.locale_code,
    ctrl.marker,
  );
};

/**
 * Address search: fetch from Nominatim, cache result, render marker.
 * @param {Object} ctrl - SearchControl instance
 * @param {string} query - Address query string
 */
const searchAddress = (ctrl, query) => {
  if (ctrl.cachedAddress[query]) {
    renderAddressResult(ctrl, ctrl.cachedAddress[query]);
    return;
  }

  foliplus.showHint(
    CONF.name,
    `${Icons.LOADING} ${ctrl._(`${CONF.name}.popup_loading`)}`,
    foliplus.HINT_DURATION.PERSIST,
  );

  if (ctrl.addrAbortController) ctrl.addrAbortController.abort();
  ctrl.addrAbortController = new AbortController();
  const signal = ctrl.addrAbortController.signal;

  fetch(buildSearchUrl(ctrl, query, SEARCH.LIMIT), { signal })
    .then((r) => r.json())
    .then((results) => {
      foliplus.hideHint(CONF.name);
      if (!results || results.length === 0) {
        foliplus.showHint(
          CONF.name,
          ctrl._(`${CONF.name}.addr_not_found`),
          foliplus.HINT_DURATION.LONG,
        );
        ctrl.inp.value = "";
        return;
      }

      const item = results[0];
      const displayName =
        foliplus.formatAddress(item.display_name, map, CONF.locale_code) || query;
      ctrl.cachedAddress[query] = { item, displayName };
      renderAddressResult(ctrl, { item, displayName });
    })
    .catch((err) => {
      if (err.name === "AbortError") return;
      console.error(`[${CONF.name}] Address lookup failed, check network`);
      foliplus.hideHint(CONF.name);
      foliplus.showHint(
        CONF.name,
        ctrl._(`${CONF.name}.addr_error`),
        foliplus.HINT_DURATION.LONG,
      );
    });
};

/**
 * Render address result: fly to location and place marker.
 * @param {Object} ctrl - SearchControl instance
 * @param {Object} result - { item, displayName }
 */
const renderAddressResult = (ctrl, result) => {
  const { item, displayName } = result;
  let lat = parseFloat(item.lat);
  let lng = parseFloat(item.lon);

  const converted = foliplus.fromWgs84(map, lng, lat);
  lng = converted[0];
  lat = converted[1];

  const zoom = Math.min(
    ZOOM.MAX,
    Math.max(ZOOM.MIN, ZOOM.BASE - Math.floor(displayName.length / ZOOM.DIVISOR)),
  );
  map.flyTo([lat, lng], zoom);
  ctrl.marker = foliplus.createLocationMarker(
    map,
    lng,
    lat,
    displayName,
    ctrl._(`${CONF.name}.popup_title_addr`),
    ctrl._(`${CONF.name}.popup_loading`),
    ctrl._(`${CONF.name}.popup_loc_label`),
    ctrl._(`${CONF.name}.popup_addr_label`),
    ctrl._("foliplus.close_label"),
    CONF.locale_code,
    ctrl.marker,
  );
};

// ── Suggestions ──

const removeSuggestions = (ctrl) => {
  if (ctrl.suggestionsThrottleTimer) {
    clearTimeout(ctrl.suggestionsThrottleTimer);
    ctrl.suggestionsThrottleTimer = null;
  }
  if (ctrl.suggestionsWrap) {
    ctrl.suggestionsWrap.remove();
    ctrl.suggestionsWrap = null;
  }
  ctrl.selectedSuggestionIdx = -1;
};

const positionSuggestions = (ctrl) => {
  if (!ctrl.suggestionsWrap) return;
  const rect = ctrl.ctrl.getBoundingClientRect();
  let left = rect.left + window.scrollX;
  if (left + rect.width > window.innerWidth)
    left = window.innerWidth - rect.width + window.scrollX;
  ctrl.suggestionsWrap.style.left = `${left}px`;
  ctrl.suggestionsWrap.style.top = `${rect.bottom + window.scrollY}px`;
};

const renderSuggestions = (ctrl, results, query) => {
  if (!results || results.length === 0) {
    removeSuggestions(ctrl);
    return;
  }

  ctrl.cachedSuggestions[query] = results;

  if (!ctrl.suggestionsWrap) {
    ctrl.suggestionsWrap = foliplus.dom.el("div", {
      class: CLASSES.SUGGESTIONS,
      parent: document.body,
      onclick: (e) => e.stopPropagation(),
    });
  }

  ctrl.suggestionsWrap.innerHTML = "";
  ctrl.selectedSuggestionIdx = -1;
  positionSuggestions(ctrl);

  results.forEach((item, idx) => {
    const displayName =
      foliplus.formatAddress(item.display_name, map) || item.name || "";
    foliplus.dom.el(
      "div",
      {
        class: CLASSES.SUGGESTION_ITEM,
        "data-index": String(idx),
        parent: ctrl.suggestionsWrap,
        onmousedown: (e) => {
          e.stopPropagation();
          e.preventDefault();
          removeSuggestions(ctrl);
          ctrl.cachedAddress[displayName] = { item, displayName };
          renderAddressResult(ctrl, { item, displayName });
        },
      },
      foliplus.dom.el(
        "span",
        { class: CLASSES.SUGGESTION_ICON },
        { html: Icons.LOCATE },
      ),
      foliplus.dom.el("span", { class: CLASSES.SUGGESTION_TEXT }, displayName),
    );
  });
};

const fetchSuggestions = (ctrl, query) => {
  if (ctrl.mode !== MODE.ADDR) {
    removeSuggestions(ctrl);
    return;
  }
  if (query.length < AUTOCOMPLETE.MIN_CHARS) {
    removeSuggestions(ctrl);
    return;
  }
  if (ctrl.cachedSuggestions[query]) {
    renderSuggestions(ctrl, ctrl.cachedSuggestions[query], query);
    return;
  }

  const now = Date.now();
  if (now - ctrl.lastSuggestFetch < foliplus.NOMINATIM.THROTTLE_MS) {
    if (ctrl.suggestionsThrottleTimer) clearTimeout(ctrl.suggestionsThrottleTimer);
    ctrl.suggestionsThrottleTimer = setTimeout(
      () => fetchSuggestions(ctrl, query),
      foliplus.NOMINATIM.THROTTLE_MS - (now - ctrl.lastSuggestFetch),
    );
    return;
  }
  ctrl.lastSuggestFetch = Date.now();
  if (ctrl.suggestAbortController) ctrl.suggestAbortController.abort();
  ctrl.suggestAbortController = new AbortController();
  ctrl.suggestSeq += 1;
  const reqSeq = ctrl.suggestSeq;

  fetch(buildSearchUrl(ctrl, query, AUTOCOMPLETE.MAX_ITEMS), {
    signal: ctrl.suggestAbortController.signal,
  })
    .then((r) => r.json())
    .then((results) => {
      if (reqSeq !== ctrl.suggestSeq) return;
      if (query !== ctrl.inp.value.trim()) return;
      renderSuggestions(ctrl, results, query);
    })
    .catch((err) => {
      if (err.name === "AbortError") return;
      removeSuggestions(ctrl);
    });
};

const initDebouncedFetch = (ctrl) => {
  ctrl.debouncedFetch = foliplus.debounce(
    () => fetchSuggestions(ctrl, ctrl.inp.value.trim()),
    AUTOCOMPLETE.DEBOUNCE_MS,
  );
};

const buildSearchUrl = (ctrl, query, limit) => {
  const center = map.getCenter();
  return foliplus.nominatimUrl("/search", {
    q: query,
    limit,
    lon: center.lng,
    lat: center.lat,
  });
};

export {
  buildSearchUrl,
  fetchSuggestions,
  initDebouncedFetch,
  positionSuggestions,
  removeSuggestions,
  renderAddressResult,
  renderSuggestions,
  searchAddress,
  searchCoord,
};
