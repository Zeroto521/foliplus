// SearchControl search/suggestion logic — standalone functions called with `this` as ctrl.
import { HINT_DURATION } from "#core/hint.js";
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
import { NOMINATIM, formatAddress, nominatimUrl } from "#common/geocode.js";
import { createControlEnv } from "#common/guard.js";
import * as Icons from "#common/icon.js";
import * as Storage from "#common/storage.js";
import { AUTOCOMPLETE, CLASSES, HISTORY, MODE, SEARCH, ZOOM } from "./const.js";
import type { AddressResult, NominatimItem, SearchHistoryEntry } from "./type.js";

const { _ } = createControlEnv(CONF);

/** Subset of SearchControl state used by the logic functions (decouples the types). */
interface SearchControlState {
  inp: HTMLInputElement;
  mode: string;
  modeBtn: HTMLElement;
  cachedAddress: Record<string, AddressResult>;
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
  const filtered = ctrl.searchHistory.filter(e => e.query !== query);
  const updated = [entry, ...filtered].slice(0, HISTORY.MAX_ENTRIES);
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
  label: string,
  lat: number,
  lng: number,
): void => {
  addHistoryEntry(ctrl, { query, type, label, lat, lng, ts: Date.now() });
};

// ── Marker ───────────────────────────────────────────────────────

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
  ctrl.marker?.on("popupopen", () => toggleDelIcon(delIcon, true));
  ctrl.marker?.on("popupclose", () => toggleDelIcon(delIcon, false));
};

// ── Search execution ─────────────────────────────────────────────

const searchCoord = (ctrl: SearchControlState, raw: string) => {
  if (map.foliplus?.modes?.isBlocked(CONF.name)) {
    map.foliplus!.showHint(CONF.name, _(`${CONF.name}.blocked`), HINT_DURATION.SHORT);
    return;
  }
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

  const coordLabel = `${lng.toFixed(4)}, ${lat.toFixed(4)}`;
  recordHistorySearch(ctrl, raw, "coord", coordLabel, lat, lng);
};

const searchAddress = (ctrl: SearchControlState, query: string) => {
  if (map.foliplus?.modes?.isBlocked(CONF.name)) {
    map.foliplus!.showHint(CONF.name, _(`${CONF.name}.blocked`), HINT_DURATION.SHORT);
    return;
  }
  if (ctrl.cachedAddress[query]) {
    renderAddressResult(ctrl, ctrl.cachedAddress[query]);
    const r = ctrl.cachedAddress[query];
    recordHistorySearch(
      ctrl,
      query,
      "addr",
      r.displayName,
      parseFloat(r.item.lat),
      parseFloat(r.item.lon),
    );
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

  fetch(buildSearchUrl(ctrl, query, SEARCH.LIMIT), { signal })
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
      recordHistorySearch(
        ctrl,
        query,
        "addr",
        displayName,
        parseFloat(item.lat),
        parseFloat(item.lon),
      );
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
          recordHistorySearch(
            ctrl,
            query,
            "addr",
            displayName,
            parseFloat(item.lat),
            parseFloat(item.lon),
          );
        },
      },
      dom.el("span", { class: CLASSES.SUGGESTION_ICON }, { html: Icons.LOCATE }),
      dom.el("span", { class: CLASSES.SUGGESTION_TEXT }, displayName),
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

  const groupHeader = dom.el("div", {
    class: CLASSES.HISTORY_GROUP_HEADER,
    parent: ctrl.suggestionsWrap,
  });
  dom.el(
    "span",
    { class: CLASSES.HISTORY_GROUP_TITLE, parent: groupHeader },
    { html: _(`${CONF.name}.history_title`) },
  );
  dom.el(
    "button",
    {
      class: CLASSES.HISTORY_GROUP_CLEAR,
      parent: groupHeader,
      title: _(`${CONF.name}.history_clear_all`),
      onclick: (event: Event) => {
        event.stopPropagation();
        event.preventDefault();
        clearHistory(ctrl);
        removeSuggestions(ctrl);
      },
    },
    { html: _(`${CONF.name}.history_clear_all`) },
  );

  entries.forEach((entry: SearchHistoryEntry, idx: number) => {
    // History entries reuse the same suggestion-item classes as address
    // suggestions, plus a history-specific ✕ delete button inside.
    const item = dom.el(
      "div",
      {
        class: CLASSES.SUGGESTION_ITEM,
        "data-index": String(idx),
        onmousedown: (event: Event) => {
          event.stopPropagation();
          event.preventDefault();
          removeSuggestions(ctrl);
          ctrl.inp.value = entry.label;
          const converted = fromWgs84(map, entry.lng, entry.lat);
          const lng = converted[0];
          const lat = converted[1];
          map.flyTo([lat, lng], CONF.zoom || 16);
          ctrl.marker = createLocationMarker(
            map,
            lng,
            lat,
            entry.label,
            entry.type === "coord"
              ? _(`${CONF.name}.popup_title_coord`)
              : _(`${CONF.name}.popup_title_addr`),
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
      dom.el("span", { class: CLASSES.SUGGESTION_ICON }, { html: Icons.LOCATE }),
      dom.el("span", { class: CLASSES.SUGGESTION_TEXT }, entry.label),
      dom.el(
        "span",
        {
          class: CLASSES.HISTORY_ITEM_DEL,
          title: _(`${CONF.name}.history_delete`),
          onmousedown: (event: Event) => {
            event.stopPropagation();
            event.preventDefault();
            deleteHistoryEntry(ctrl, entry.query);
            if (ctrl.searchHistory.length > 0) {
              renderHistory(ctrl);
            } else {
              removeSuggestions(ctrl);
            }
          },
        },
        { html: "\u2715" },
      ),
    );
    ctrl.suggestionsWrap!.appendChild(item);
  });
};

const fetchSuggestions = (ctrl: SearchControlState, query: string) => {
  if (map.foliplus?.modes?.isBlocked(CONF.name)) {
    map.foliplus!.showHint(CONF.name, _(`${CONF.name}.blocked`), HINT_DURATION.SHORT);
    return;
  }
  if (ctrl.mode !== MODE.ADDR) {
    removeSuggestions(ctrl);
    return;
  }

  if (query.length === 0) {
    if (ctrl.searchHistory.length > 0) {
      renderHistory(ctrl);
    } else {
      removeSuggestions(ctrl);
    }
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
