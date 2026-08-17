// SearchControl search/suggestion logic — standalone functions called with `this` as ctrl.
import { HINT_DURATION } from "#core/hint.js";
import { guardBlocked } from "#core/mode.js";
import { Cache } from "#common/cache.js";
import { fromWgs84 } from "#common/coord.js";
import { type Debounced, debounce } from "#common/debounce.js";
import {
  DEL_ICON_MARKER_ANCHOR,
  attachDelClick,
  makeDelIcon,
  toggleDelIcon,
} from "#common/delicon.js";
import { createLocationMarker, dom } from "#common/dom.js";
import { fetchWithTimeout } from "#common/fetch.js";
import { NOMINATIM, formatAddress, nominatimUrl } from "#common/geocode.js";
import { createControlEnv } from "#common/guard.js";
import * as Icons from "#common/icon.js";
import { AUTOCOMPLETE, CLASSES, MODE, SEARCH, ZOOM } from "./const.js";
import type { AddressResult, NominatimItem } from "./type.js";

const { _ } = createControlEnv(CONF);

/** Subset of SearchControl state used by the logic functions (decouples the types). */
interface SearchControlState {
  inp: HTMLInputElement;
  mode: string;
  modeBtn: HTMLElement;
  cachedAddress: Record<string, AddressResult>;
  cachedSuggestions: Cache<string, NominatimItem[]>;
  suggestionsWrap: HTMLElement | null;
  selectedSuggestionIdx: number;
  lastSuggestFetch: number;
  suggestionsThrottleTimer: ReturnType<typeof setTimeout> | null;
  suggestAbortController: AbortController | null;
  addrAbortController: AbortController | null;
  suggestSeq: number;
  debouncedFetch: Debounced;
  marker: L.Marker | null;
  delIcon: L.Marker | null;
  ctrl: HTMLElement;
}

/**
 * Attach a floating ✕ delete icon to the search marker.
 * The ✕ shows while the popup is open; clicking it removes the pin and
 * clears the search input, mirroring MeasureControl / LocateControl UX.
 * @param {Object} ctrl - SearchControl state
 * @param {L.LatLngExpression} latlng - Marker position
 */
const attachSearchDelIcon = (ctrl: SearchControlState, latlng: L.LatLngExpression) => {
  if (ctrl.delIcon) {
    map.removeLayer(ctrl.delIcon);
    ctrl.delIcon = null;
  }
  ctrl.delIcon = makeDelIcon(latlng, {
    title: _("foliplus.close_label"),
    iconAnchor: DEL_ICON_MARKER_ANCHOR, // at the pin's bottom tip
  });
  map.addLayer(ctrl.delIcon);
  const delIcon = ctrl.delIcon;

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
  attachDelClick(delIcon, clearSearch);

  // The ✕ is hidden by default and only appears while the popup is open,
  // matching MeasureControl / LocateControl marker UX.
  ctrl.marker?.on("popupopen", () => toggleDelIcon(delIcon, true));
  ctrl.marker?.on("popupclose", () => toggleDelIcon(delIcon, false));
};

/**
 * Coordinate search: parse raw input, validate, fly to location, place marker.
 * @param {Object} ctrl - SearchControl instance
 * @param {string} raw - User input (e.g. "121.47,31.23")
 */
const searchCoord = (ctrl: SearchControlState, raw: string) => {
  if (guardBlocked(map, CONF.name, _(`${CONF.name}.blocked`))) return;
  const parts = raw
    .replace(/\uff0c/g, ",")
    .replace(/\s+/g, "")
    .split(",")
    .map(Number);

  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    map.foliplus!.showHint(
      CONF.name,
      _(`${CONF.name}.coord_error`),
      HINT_DURATION.LONG,
    );
    ctrl.inp.value = "";
    return;
  }

  const lng = parts[0];
  const lat = parts[1];
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    map.foliplus!.showHint(
      CONF.name,
      _(`${CONF.name}.coord_error`),
      HINT_DURATION.LONG,
    );
    ctrl.inp.value = "";
    return;
  }

  map.foliplus!.hideHint(CONF.name);
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
  attachSearchDelIcon(ctrl, [lat, lng]);
};

/**
 * Address search: fetch from Nominatim, cache result, render marker.
 * @param {Object} ctrl - SearchControl instance
 * @param {string} query - Address query string
 */
const searchAddress = (ctrl: SearchControlState, query: string) => {
  if (guardBlocked(map, CONF.name, _(`${CONF.name}.blocked`))) return;
  if (ctrl.cachedAddress[query]) {
    renderAddressResult(ctrl, ctrl.cachedAddress[query]);
    return;
  }

  map.foliplus!.showHint(
    CONF.name,
    `${Icons.LOADING} ${_(`${CONF.name}.popup_loading`)}`,
    HINT_DURATION.PERSIST,
  );

  if (ctrl.addrAbortController) ctrl.addrAbortController.abort();
  ctrl.addrAbortController = new AbortController();
  const signal = ctrl.addrAbortController.signal;

  fetchWithTimeout(buildSearchUrl(ctrl, query, SEARCH.LIMIT), { signal })
    .then(r => r.json())
    .then(results => {
      map.foliplus!.hideHint(CONF.name);
      if (!results || results.length === 0) {
        map.foliplus!.showHint(
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
      map.foliplus!.hideHint(CONF.name);
      map.foliplus!.showHint(
        CONF.name,
        _(`${CONF.name}.addr_error`),
        HINT_DURATION.LONG,
      );
    });
};

/**
 * Render address result: fly to location and place marker.
 * @param {Object} ctrl - SearchControl instance
 * @param {Object} result - { item, displayName }
 */
const renderAddressResult = (ctrl: SearchControlState, result: AddressResult) => {
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
  attachSearchDelIcon(ctrl, [lat, lng]);
};

// ── Suggestions ──

const removeSuggestions = (ctrl: SearchControlState) => {
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

const positionSuggestions = (ctrl: SearchControlState) => {
  if (!ctrl.suggestionsWrap) return;
  const rect = ctrl.ctrl.getBoundingClientRect();
  let left = rect.left + window.scrollX;
  if (left + rect.width > window.innerWidth)
    left = window.innerWidth - rect.width + window.scrollX;
  ctrl.suggestionsWrap.style.left = `${left}px`;
  ctrl.suggestionsWrap.style.top = `${rect.bottom + window.scrollY}px`;
};

const renderSuggestions = (
  ctrl: SearchControlState,
  results: NominatimItem[],
  query: string,
) => {
  if (!results || results.length === 0) {
    removeSuggestions(ctrl);
    return;
  }

  ctrl.cachedSuggestions.set(query, results);

  if (!ctrl.suggestionsWrap) {
    ctrl.suggestionsWrap = dom.el("div", {
      class: CLASSES.SUGGESTIONS,
      parent: document.body,
      onclick: (event: Event) => event.stopPropagation(),
    });
  }

  ctrl.suggestionsWrap.innerHTML = "";
  ctrl.selectedSuggestionIdx = -1;
  positionSuggestions(ctrl);

  results.forEach((item: NominatimItem, idx: number) => {
    const displayName =
      formatAddress(item.display_name, map, CONF.locale_code) || item.name || "";
    dom.el(
      "div",
      {
        class: CLASSES.SUGGESTION_ITEM,
        "data-index": String(idx),
        parent: ctrl.suggestionsWrap,
        onmousedown: (event: Event) => {
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

const fetchSuggestions = (ctrl: SearchControlState, query: string) => {
  if (guardBlocked(map, CONF.name, _(`${CONF.name}.blocked`))) return;
  if (ctrl.mode !== MODE.ADDR) {
    removeSuggestions(ctrl);
    return;
  }
  if (query.length < AUTOCOMPLETE.MIN_CHARS) {
    removeSuggestions(ctrl);
    return;
  }
  const cached = ctrl.cachedSuggestions.get(query);
  if (cached) {
    renderSuggestions(ctrl, cached, query);
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

  fetchWithTimeout(buildSearchUrl(ctrl, query, AUTOCOMPLETE.MAX_ITEMS), {
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

const initDebouncedFetch = (ctrl: SearchControlState) => {
  ctrl.debouncedFetch = debounce(
    () => fetchSuggestions(ctrl, ctrl.inp.value.trim()),
    AUTOCOMPLETE.DEBOUNCE_MS,
  );
};

const buildSearchUrl = (ctrl: SearchControlState, q: string, limit: number) => {
  const center = map.getCenter();
  return nominatimUrl(
    "/search",
    { q, limit, lon: center.lng, lat: center.lat },
    CONF.locale_code,
  );
};

export {
  attachSearchDelIcon,
  buildSearchUrl,
  fetchSuggestions,
  initDebouncedFetch,
  positionSuggestions,
  removeSuggestions,
  searchAddress,
  searchCoord,
};
