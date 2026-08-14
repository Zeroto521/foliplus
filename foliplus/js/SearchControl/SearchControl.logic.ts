// SearchControl search/suggestion logic — standalone functions called with `this` as ctrl.
import { fromWgs84 } from "#common/coord.js";
import { debounce } from "#common/debounce.js";
import { createLocationMarker, dom } from "#common/dom.js";
import { NOMINATIM, formatAddress, nominatimUrl } from "#common/geocode.js";
import { createControlEnv } from "#common/guard.js";
import { HINT_DURATION } from "#common/hint.js";
import * as Icons from "#common/icon.js";
import { AUTOCOMPLETE, CLASSES, MODE, SEARCH, ZOOM } from "./SearchControl.const.js";

const { _, foliplus } = createControlEnv(CONF);

/**
 * Coordinate search: parse raw input, validate, fly to location, place marker.
 * @param {Object} ctrl - SearchControl instance
 * @param {string} raw - User input (e.g. "121.47,31.23")
 */
const searchCoord = (ctrl: any, raw: string) => {
  const parts = raw
    .replace(/\uff0c/g, ",")
    .replace(/\s+/g, "")
    .split(",")
    .map(Number);

  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    foliplus.showHint(CONF.name, _(`${CONF.name}.coord_error`), HINT_DURATION.LONG);
    ctrl.inp.value = "";
    return;
  }

  const lng = parts[0];
  const lat = parts[1];
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    foliplus.showHint(CONF.name, _(`${CONF.name}.coord_error`), HINT_DURATION.LONG);
    ctrl.inp.value = "";
    return;
  }

  foliplus.hideHint(CONF.name);
  map.flyTo([lat, lng], CONF.zoom || 16);
  ctrl.marker = createLocationMarker(
    map,
    lng,
    lat,
    null,
    _(`${CONF.name}.popup_title_coord`),
    _(`${CONF.name}.popup_loading`),
    _(`${CONF.name}.popup_loc_label`),
    _(`${CONF.name}.popup_addr_label`),
    _("foliplus.close_label"),
    CONF.locale_code,
    ctrl.marker,
  );
};

/**
 * Address search: fetch from Nominatim, cache result, render marker.
 * @param {Object} ctrl - SearchControl instance
 * @param {string} query - Address query string
 */
const searchAddress = (ctrl: any, query: string) => {
  if (ctrl.cachedAddress[query]) {
    renderAddressResult(ctrl, ctrl.cachedAddress[query]);
    return;
  }

  foliplus.showHint(
    CONF.name,
    `${Icons.LOADING} ${_(`${CONF.name}.popup_loading`)}`,
    HINT_DURATION.PERSIST,
  );

  if (ctrl.addrAbortController) ctrl.addrAbortController.abort();
  ctrl.addrAbortController = new AbortController();
  const signal = ctrl.addrAbortController.signal;

  fetch(buildSearchUrl(ctrl, query, SEARCH.LIMIT), { signal })
    .then(r => r.json())
    .then(results => {
      foliplus.hideHint(CONF.name);
      if (!results || results.length === 0) {
        foliplus.showHint(
          CONF.name,
          _(`${CONF.name}.addr_not_found`),
          HINT_DURATION.LONG,
        );
        ctrl.inp.value = "";
        return;
      }

      const item = results[0];
      const displayName =
        formatAddress(item.display_name, map, CONF.locale_code) || query;
      ctrl.cachedAddress[query] = { item, displayName };
      renderAddressResult(ctrl, { item, displayName });
    })
    .catch(err => {
      if (err.name === "AbortError") return;
      console.error(`[${CONF.name}] Address lookup failed, check network`);
      foliplus.hideHint(CONF.name);
      foliplus.showHint(CONF.name, _(`${CONF.name}.addr_error`), HINT_DURATION.LONG);
    });
};

/**
 * Render address result: fly to location and place marker.
 * @param {Object} ctrl - SearchControl instance
 * @param {Object} result - { item, displayName }
 */
const renderAddressResult = (ctrl: any, result: any) => {
  const { item, displayName } = result;
  let lat = parseFloat(item.lat);
  let lng = parseFloat(item.lon);

  const converted = fromWgs84(map, lng, lat);
  lng = converted[0];
  lat = converted[1];

  const zoom = Math.min(
    ZOOM.MAX,
    Math.max(ZOOM.MIN, ZOOM.BASE - Math.floor(displayName.length / ZOOM.DIVISOR)),
  );
  map.flyTo([lat, lng], zoom);
  ctrl.marker = createLocationMarker(
    map,
    lng,
    lat,
    displayName,
    _(`${CONF.name}.popup_title_addr`),
    _(`${CONF.name}.popup_loading`),
    _(`${CONF.name}.popup_loc_label`),
    _(`${CONF.name}.popup_addr_label`),
    _("foliplus.close_label"),
    CONF.locale_code,
    ctrl.marker,
  );
};

// ── Suggestions ──

const removeSuggestions = (ctrl: any) => {
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

const positionSuggestions = (ctrl: any) => {
  if (!ctrl.suggestionsWrap) return;
  const rect = ctrl.ctrl.getBoundingClientRect();
  let left = rect.left + window.scrollX;
  if (left + rect.width > window.innerWidth)
    left = window.innerWidth - rect.width + window.scrollX;
  ctrl.suggestionsWrap.style.left = `${left}px`;
  ctrl.suggestionsWrap.style.top = `${rect.bottom + window.scrollY}px`;
};

const renderSuggestions = (ctrl: any, results: any[], query: string) => {
  if (!results || results.length === 0) {
    removeSuggestions(ctrl);
    return;
  }

  ctrl.cachedSuggestions[query] = results;

  if (!ctrl.suggestionsWrap) {
    ctrl.suggestionsWrap = dom.el("div", {
      class: CLASSES.SUGGESTIONS,
      parent: document.body,
      onclick: (event: MouseEvent) => event.stopPropagation(),
    });
  }

  ctrl.suggestionsWrap.innerHTML = "";
  ctrl.selectedSuggestionIdx = -1;
  positionSuggestions(ctrl);

  results.forEach((item: any, idx: number) => {
    const displayName =
      formatAddress(item.display_name, map, CONF.locale_code) || item.name || "";
    dom.el(
      "div",
      {
        class: CLASSES.SUGGESTION_ITEM,
        "data-index": String(idx),
        parent: ctrl.suggestionsWrap,
        onmousedown: (event: MouseEvent) => {
          event.stopPropagation();
          event.preventDefault();
          removeSuggestions(ctrl);
          ctrl.cachedAddress[displayName] = { item, displayName };
          renderAddressResult(ctrl, { item, displayName });
        },
      },
      dom.el("span", { class: CLASSES.SUGGESTION_ICON }, { html: Icons.LOCATE }),
      dom.el("span", { class: CLASSES.SUGGESTION_TEXT }, displayName),
    );
  });
};

const fetchSuggestions = (ctrl: any, query: string) => {
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
  if (now - ctrl.lastSuggestFetch < NOMINATIM.THROTTLE_MS) {
    if (ctrl.suggestionsThrottleTimer) clearTimeout(ctrl.suggestionsThrottleTimer);
    ctrl.suggestionsThrottleTimer = setTimeout(
      () => fetchSuggestions(ctrl, query),
      NOMINATIM.THROTTLE_MS - (now - ctrl.lastSuggestFetch),
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
    .then(r => r.json())
    .then(results => {
      if (reqSeq !== ctrl.suggestSeq) return;
      if (query !== ctrl.inp.value.trim()) return;
      renderSuggestions(ctrl, results, query);
    })
    .catch(err => {
      if (err.name === "AbortError") return;
      removeSuggestions(ctrl);
    });
};

const initDebouncedFetch = (ctrl: any) => {
  ctrl.debouncedFetch = debounce(
    () => fetchSuggestions(ctrl, ctrl.inp.value.trim()),
    AUTOCOMPLETE.DEBOUNCE_MS,
  );
};

const buildSearchUrl = (ctrl: any, q: string, limit: number) => {
  const center = map.getCenter();
  return nominatimUrl(
    "/search",
    { q, limit, lon: center.lng, lat: center.lat },
    CONF.locale_code,
  );
};

export {
  buildSearchUrl,
  fetchSuggestions,
  initDebouncedFetch,
  positionSuggestions,
  removeSuggestions,
  searchAddress,
  searchCoord,
};
