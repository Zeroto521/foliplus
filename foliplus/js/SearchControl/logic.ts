// SearchControl search/suggestion logic — standalone functions called with `this` as ctrl.
import { HINT_DURATION } from "#core/hint.js";
import { guardBlocked } from "#core/mode.js";
import { Cache } from "#common/cache.js";
import { fromWgs84, toWgs84 } from "#common/coord.js";
import { type Debounced, debounce } from "#common/debounce.js";
import {
  DEL_ICON_MARKER_ANCHOR,
  attachDelClick,
  bindDelIconToPopup,
  makeDelIcon,
} from "#common/delicon.js";
import { createLocationMarker, dom } from "#common/dom.js";
import { fetchWithTimeout } from "#common/fetch.js";
import { NOMINATIM, formatAddress, nominatimUrl } from "#common/geocode.js";
import { createControlEnv } from "#common/guard.js";
import * as Icons from "#common/icon.js";
import * as Storage from "#common/storage.js";
import { AUTOCOMPLETE, CLASSES, HISTORY, MODE, ZOOM } from "./const.js";
import type { AddressResult, NominatimItem, SearchHistoryEntry } from "./type.js";

const { _ } = createControlEnv(CONF);

/** Subset of SearchControl state used by the logic functions (decouples the types). */
interface SearchControlState {
  inp: HTMLInputElement;
  mode: string;
  modeBtn: HTMLElement;
  cachedSuggestions: Cache<string, NominatimItem[]>;
  searchHistory: SearchHistoryEntry[];
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

// ── Search History CRUD ──────────────────────────────────────────

const loadHistory = (): SearchHistoryEntry[] => {
  const data = Storage.load<SearchHistoryEntry[]>(HISTORY.STORAGE_KEY, CONF.name);
  return Array.isArray(data) ? data : [];
};

const saveHistory = (entries: SearchHistoryEntry[]): void => {
  Storage.save(HISTORY.STORAGE_KEY, entries, CONF.name);
};

const addHistoryEntry = (ctrl: SearchControlState, entry: SearchHistoryEntry): void => {
  const { query } = entry;
  const existing = ctrl.searchHistory.find(e => e.query === query);
  if (existing) {
    // Increment count and update displays/timestamp, move to front
    existing.count += 1;
    existing.ts = entry.ts;
    existing.coordDisplay = entry.coordDisplay || existing.coordDisplay;
    existing.addrDisplay = entry.addrDisplay || existing.addrDisplay;
    existing.lng = entry.lng;
    existing.lat = entry.lat;
    const updated = [existing, ...ctrl.searchHistory.filter(e => e.query !== query)].slice(
      0,
      HISTORY.MAX_ENTRIES,
    );
    ctrl.searchHistory = updated;
    saveHistory(updated);
    return;
  }
  const updated = [entry, ...ctrl.searchHistory].slice(0, HISTORY.MAX_ENTRIES);
  ctrl.searchHistory = updated;
  saveHistory(updated);
};

const deleteHistoryEntry = (ctrl: SearchControlState, query: string): void => {
  const updated = ctrl.searchHistory.filter(e => e.query !== query);
  ctrl.searchHistory = updated;
  saveHistory(updated);
};

const clearHistory = (ctrl: SearchControlState): void => {
  ctrl.searchHistory = [];
  saveHistory([]);
};

const recordHistorySearch = (
  ctrl: SearchControlState,
  query: string,
  type: "coord" | "addr",
  coordDisplay: string,
  addrDisplay: string,
  lng: number,
  lat: number,
): void => {
  addHistoryEntry(ctrl, {
    query,
    type,
    coordDisplay,
    addrDisplay,
    lng,
    lat,
    ts: Date.now(),
    count: 1,
  });
};

// ── Marker ───────────────────────────────────────────────────────

/**
 * Attach a floating ✕ delete icon to the search marker.
 * The ✕ shows while the popup is open; clicking it removes the pin and
 * clears the search input, mirroring MeasureControl / LocateControl UX.
 */
const attachSearchDelIcon = (ctrl: SearchControlState, latlng: L.LatLngExpression) => {
  if (ctrl.delIcon) {
    map.removeLayer(ctrl.delIcon);
    ctrl.delIcon = null;
  }
  ctrl.delIcon = makeDelIcon(latlng, {
    title: _("foliplus.close_label"),
    iconAnchor: DEL_ICON_MARKER_ANCHOR,
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
  bindDelIconToPopup(ctrl.marker, delIcon);
};

// ── Search execution ─────────────────────────────────────────────

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

  const coordDisplay = `${lng.toFixed(4)}, ${lat.toFixed(4)}`;
  recordHistorySearch(ctrl, raw, "coord", coordDisplay, "", lng, lat);
};

/**
 * Address search: fetch from Nominatim, cache result, render marker.
 * @param {Object} ctrl - SearchControl instance
 * @param {string} query - Address query string
 */
const searchAddress = (ctrl: SearchControlState, query: string) => {
  if (guardBlocked(map, CONF.name, _(`${CONF.name}.blocked`))) return;
  // foliplus.geocode handles caching (CRS-aware), timeout, and CRS conversion internally.
  map.foliplus!.showHint(
    CONF.name,
    `${Icons.LOADING} ${_(`${CONF.name}.popup_loading`)}`,
    HINT_DURATION.PERSIST,
  );

  window.foliplus
    .geocode(map, query, CONF.locale_code)
    .then(result => {
      map.foliplus!.hideHint(CONF.name);
      if (!result) {
        map.foliplus!.showHint(
          CONF.name,
          _(`${CONF.name}.addr_not_found`),
          HINT_DURATION.LONG,
        );
        ctrl.inp.value = "";
        return;
      }
      // result is already in map CRS — render directly; convert back to
      // WGS84 for history storage (history entries are stored in WGS84).
      renderAddressResult(ctrl, result);
      const wgs = toWgs84(map, result.lng, result.lat);
      const coordDisplay = `${wgs[0].toFixed(4)}, ${wgs[1].toFixed(4)}`;
      const addrDisplay = formatAddress(result.display_name, map, CONF.locale_code) || query;
      recordHistorySearch(ctrl, query, "addr", coordDisplay, addrDisplay, wgs[0], wgs[1]);
    })
    .catch(() => {
      map.foliplus!.hideHint(CONF.name);
      map.foliplus!.showHint(
        CONF.name,
        _(`${CONF.name}.addr_error`),
        HINT_DURATION.LONG,
      );
    });
};

const renderAddressResult = (
  ctrl: SearchControlState,
  result: AddressResult | { lat: number; lng: number; display_name: string },
) => {
  let displayName: string;
  let lng: number;
  let lat: number;

  if ("display_name" in result) {
    displayName = result.display_name;
    lng = result.lng;
    lat = result.lat;
  } else {
    const item = (result as AddressResult).item;
    displayName = (result as AddressResult).displayName ?? "";
    const converted = fromWgs84(map, parseFloat(item.lon), parseFloat(item.lat));
    lng = converted[0];
    lat = converted[1];
  }

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

// ── Suggestions / History Panel ──────────────────────────────────

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
    const coordDisplay = `${parseFloat(item.lon).toFixed(4)}, ${parseFloat(item.lat).toFixed(4)}`;
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
          renderAddressResult(ctrl, { item, displayName });
          recordHistorySearch(
            ctrl,
            query,
            "addr",
            coordDisplay,
            displayName,
            parseFloat(item.lon),
            parseFloat(item.lat),
          );
        },
      },
      dom.el("span", { class: CLASSES.SUGGESTION_ICON }, { html: Icons.LOCATE }),
      dom.el(
        "div",
        { class: CLASSES.RESULT_CONTENT },
        dom.el("span", { class: CLASSES.SUGGESTION_TEXT }, displayName),
        dom.el("div", { class: CLASSES.RESULT_COORD }, coordDisplay),
      ),
    );
  });
};

const renderHistory = (ctrl: SearchControlState) => {
  const entries = ctrl.searchHistory;
  if (entries.length === 0) {
    removeSuggestions(ctrl);
    return;
  }

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

  // Sort by search count (desc), then recency (desc) as tiebreaker
  const sorted = [...entries].sort((a, b) => b.count - a.count || b.ts - a.ts);

  // Render addr section first, then coord section
  const renderSection = (type: "addr" | "coord") => {
    const sectionEntries = sorted
      .filter(e => e.type === type)
      .slice(0, HISTORY.MAX_DISPLAY);
    if (sectionEntries.length === 0) return;

    sectionEntries.forEach((entry: SearchHistoryEntry) => {
      const isAddr = entry.type === "addr";
      const primaryText = isAddr ? entry.addrDisplay : entry.coordDisplay;

      const item = dom.el(
        "div",
        {
          class: CLASSES.SUGGESTION_ITEM,
          onmousedown: (event: Event) => {
            event.stopPropagation();
            event.preventDefault();
            removeSuggestions(ctrl);
            ctrl.inp.value = primaryText;
            const converted = fromWgs84(map, entry.lng, entry.lat);
            const lng = converted[0];
            const lat = converted[1];
            map.flyTo([lat, lng], CONF.zoom || 16);
            ctrl.marker = createLocationMarker(
              map,
              lng,
              lat,
              entry.addrDisplay || entry.coordDisplay,
              isAddr
                ? _(`${CONF.name}.popup_title_addr`)
                : _(`${CONF.name}.popup_title_coord`),
              _(`${CONF.name}.popup_loading`),
              _(`${CONF.name}.popup_loc_label`),
              _(`${CONF.name}.popup_addr_label`),
              _("foliplus.close_label"),
              CONF.locale_code,
              ctrl.marker,
            );
            attachSearchDelIcon(ctrl, [lat, lng]);
          },
        },
        dom.el("span", { class: CLASSES.SUGGESTION_ICON }, { html: isAddr ? Icons.LOCATE : Icons.GLOBE }),
        dom.el(
          "div",
          { class: CLASSES.RESULT_CONTENT },
          dom.el("span", { class: CLASSES.SUGGESTION_TEXT }, primaryText),
          isAddr && entry.coordDisplay
            ? dom.el("div", { class: CLASSES.RESULT_COORD }, entry.coordDisplay)
            : null,
        ),
      );
      ctrl.suggestionsWrap!.appendChild(item);
    });
  };

  renderSection("addr");
  renderSection("coord");
};

const fetchSuggestions = (ctrl: SearchControlState, query: string) => {
  if (guardBlocked(map, CONF.name, _(`${CONF.name}.blocked`))) return;
  if (ctrl.mode !== MODE.ADDR) {
    removeSuggestions(ctrl);
    return;
  }

  if (query.length === 0) {
    if (ctrl.searchHistory.length > 0) renderHistory(ctrl);
    else removeSuggestions(ctrl);
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
      // Cache first result so searchAddress can serve it from geoCache
      const first = Array.isArray(results) ? results[0] : null;
      if (first) {
        window.foliplus.cacheSuggestion(
          map,
          query,
          parseFloat(first.lat),
          parseFloat(first.lon),
          formatAddress(first.display_name, map, CONF.locale_code) || query,
        );
      }
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
  addHistoryEntry,
  attachSearchDelIcon,
  buildSearchUrl,
  clearHistory,
  deleteHistoryEntry,
  fetchSuggestions,
  initDebouncedFetch,
  loadHistory,
  positionSuggestions,
  recordHistorySearch,
  removeSuggestions,
  renderHistory,
  renderSuggestions,
  saveHistory,
  searchAddress,
  searchCoord,
};
