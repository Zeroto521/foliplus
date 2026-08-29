// SearchControl search/suggestion logic — standalone functions called with `this` as ctrl.
import { resolveProvider } from "#core/geocode/index.js";
import type { GeocodeProvider, ProviderConfig } from "#core/geocode/index.js";
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
import { formatAddress } from "#common/geocode.js";
import * as Icons from "#common/icon.js";
import { createScopedTranslator, createTranslator } from "#common/locale.js";
import * as Storage from "#common/storage.js";
import { AUTOCOMPLETE, CLASSES, FORMAT, HISTORY, MODE, SOURCE, ZOOM } from "./const.js";
import type {
  AddressResult,
  ResultItem,
  SearchHistoryEntry,
  SuggestItem,
} from "./type.js";

const _ = createTranslator(CONF);
const T = createScopedTranslator(CONF);

/** Resolve the configured geocode provider (falls back to Nominatim). */
const getProvider = (): GeocodeProvider => {
  try {
    return resolveProvider(
      CONF.provider as string | ProviderConfig | undefined,
      CONF.provider_config,
    );
  } catch {
    return resolveProvider();
  }
};

/** Subset of SearchControl state used by the logic functions (decouples the types). */
interface SearchControlState {
  inp: HTMLInputElement;
  mode: string;
  modeBtn: HTMLElement;
  cachedSuggestions: Cache<string, SuggestItem[]>;
  searchHistory: SearchHistoryEntry[];
  panelWrap: HTMLElement | null;
  selectedIdx: number;
  lastSuggestFetch: number;
  throttleTimer: ReturnType<typeof setTimeout> | null;
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
  if (!Array.isArray(data)) return [];
  // Migrate old entries (pre-refactor with `label` field) to the new format
  return data.map(e => ({
    query: e.query ?? "",
    type: (e.type === MODE.COORD || e.type === MODE.ADDR ? e.type : "addr") as
      "coord" | "addr",
    coordDisplay:
      e.coordDisplay ?? (e.type === MODE.COORD ? ((e as any).label ?? "") : ""),
    addrDisplay:
      e.addrDisplay ?? (e.type === MODE.ADDR ? ((e as any).label ?? "") : ""),
    lng: e.lng ?? 0,
    lat: e.lat ?? 0,
    ts: e.ts ?? Date.now(),
    count: e.count ?? 1,
  }));
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
    const updated = [
      existing,
      ...ctrl.searchHistory.filter(e => e.query !== query),
    ].slice(0, HISTORY.MAX_ENTRIES);
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
  if (guardBlocked(map, CONF.name, T("blocked"))) return;
  const parts = raw
    .replace(/\uff0c/g, ",")
    .replace(/\s+/g, "")
    .split(",")
    .map(Number);

  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    map.foliplus!.showHint(CONF.name, T("coord_error"), HINT_DURATION.LONG);
    ctrl.inp.value = "";
    return;
  }

  const lng = parts[0];
  const lat = parts[1];
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    map.foliplus!.showHint(CONF.name, T("coord_error"), HINT_DURATION.LONG);
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
    T("popup_title_coord"),
    T("popup_loading"),
    T("popup_loc_label"),
    T("popup_addr_label"),
    _("foliplus.close_label"),
    CONF.locale_code,
    ctrl.marker,
  );
  attachSearchDelIcon(ctrl, [lat, lng]);

  const coordDisplay = `${lng.toFixed(FORMAT.LAT_LNG_PRECISION)}, ${lat.toFixed(FORMAT.LAT_LNG_PRECISION)}`;
  // Save coord entry immediately, then update address via reverse geocode.
  // NOTE: reverse-geocode updates the existing entry in-place to avoid
  // incrementing the count (addHistoryEntry treats same-query as a repeat).
  recordHistorySearch(ctrl, raw, MODE.COORD, coordDisplay, "", lng, lat);
  window.foliplus
    .reverseGeocode(map, lng, lat, CONF.locale_code, getProvider().id)
    .then(addr => {
      if (addr) {
        const entry = ctrl.searchHistory.find(e => e.query === raw);
        if (entry) {
          entry.addrDisplay = addr;
          saveHistory(ctrl.searchHistory);
        }
      }
    })
    .catch(() => {
      // Reverse geocode failed — coord-only entry already saved above
    });
};

/**
 * Address search: fetch from Nominatim, cache result, render marker.
 * @param {Object} ctrl - SearchControl instance
 * @param {string} query - Address query string
 */
const searchAddress = (ctrl: SearchControlState, query: string) => {
  if (guardBlocked(map, CONF.name, T("blocked"))) return;
  // foliplus.geocode handles caching (CRS-aware), timeout, and CRS conversion internally.
  map.foliplus!.showHint(
    CONF.name,
    `${Icons.LOADING} ${T("popup_loading")}`,
    HINT_DURATION.PERSIST,
  );

  window.foliplus
    .geocode(map, query, CONF.locale_code, getProvider().id)
    .then(result => {
      map.foliplus!.hideHint(CONF.name);
      if (!result) {
        map.foliplus!.showHint(CONF.name, T("addr_not_found"), HINT_DURATION.LONG);
        ctrl.inp.value = "";
        return;
      }
      // result is already in map CRS — render directly; convert back to
      // WGS84 for history storage (history entries are stored in WGS84).
      renderAddressResult(ctrl, result);
      const wgs = toWgs84(map, result.lng, result.lat);
      const coordDisplay = `${wgs[0].toFixed(FORMAT.LAT_LNG_PRECISION)}, ${wgs[1].toFixed(FORMAT.LAT_LNG_PRECISION)}`;
      const addrDisplay =
        formatAddress(result.display_name, map, CONF.locale_code) || query;
      recordHistorySearch(
        ctrl,
        query,
        "addr",
        coordDisplay,
        addrDisplay,
        wgs[0],
        wgs[1],
      );
    })
    .catch(() => {
      map.foliplus!.hideHint(CONF.name);
      map.foliplus!.showHint(CONF.name, T("addr_error"), HINT_DURATION.LONG);
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
    const converted = fromWgs84(map, parseFloat(item.lng), parseFloat(item.lat));
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
    T("popup_title_addr"),
    T("popup_loading"),
    T("popup_loc_label"),
    T("popup_addr_label"),
    _("foliplus.close_label"),
    CONF.locale_code,
    ctrl.marker,
  );
  attachSearchDelIcon(ctrl, [lat, lng]);
};

// ── Suggestions / History Panel ──────────────────────────────────

const removePanel = (ctrl: SearchControlState) => {
  if (ctrl.throttleTimer) {
    clearTimeout(ctrl.throttleTimer);
    ctrl.throttleTimer = null;
  }
  if (ctrl.panelWrap) {
    ctrl.panelWrap.remove();
    ctrl.panelWrap = null;
  }
  ctrl.selectedIdx = -1;
};

const positionPanel = (ctrl: SearchControlState) => {
  if (!ctrl.panelWrap) return;
  const rect = ctrl.ctrl.getBoundingClientRect();
  let left = rect.left + window.scrollX;
  if (left + rect.width > window.innerWidth)
    left = window.innerWidth - rect.width + window.scrollX;
  ctrl.panelWrap.style.left = `${left}px`;
  ctrl.panelWrap.style.top = `${rect.bottom + window.scrollY}px`;
};

const renderResults = (ctrl: SearchControlState, results: ResultItem[]) => {
  if (!results || results.length === 0) {
    removePanel(ctrl);
    return;
  }

  if (!ctrl.panelWrap) {
    ctrl.panelWrap = dom.el("div", {
      class: CLASSES.RESULT_PANEL,
      parent: map.getContainer(),
      onclick: (event: Event) => event.stopPropagation(),
    });
  }

  ctrl.panelWrap.innerHTML = "";
  ctrl.selectedIdx = -1;
  positionPanel(ctrl);

  results.forEach((item: ResultItem, idx: number) => {
    dom.el(
      "div",
      {
        class: CLASSES.RESULT_ITEM,
        "data-index": String(idx),
        parent: ctrl.panelWrap,
        onmousedown: (event: Event) => {
          event.stopPropagation();
          event.preventDefault();
          removePanel(ctrl);
          item.onClick();
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
};

const renderSuggestions = (
  ctrl: SearchControlState,
  results: SuggestItem[],
  query: string,
) => {
  if (!results || results.length === 0) {
    removePanel(ctrl);
    return;
  }

  ctrl.cachedSuggestions.set(query, results);

  const items: ResultItem[] = results.map((item: SuggestItem) => {
    const displayName =
      formatAddress(item.display_name, map, CONF.locale_code) || item.name || "";
    const coordDisplay = `${parseFloat(item.lng).toFixed(FORMAT.LAT_LNG_PRECISION)}, ${parseFloat(item.lat).toFixed(FORMAT.LAT_LNG_PRECISION)}`;
    return {
      icon: Icons.LOCATE,
      source: SOURCE.SUGGESTION,
      primaryText: displayName,
      coordDisplay,
      onClick: () => {
        renderAddressResult(ctrl, { item, displayName });
        recordHistorySearch(
          ctrl,
          query,
          MODE.ADDR,
          coordDisplay,
          displayName,
          parseFloat(item.lng),
          parseFloat(item.lat),
        );
      },
    };
  });

  renderResults(ctrl, items);
};

const renderHistory = (ctrl: SearchControlState, mode: string) => {
  const entries = ctrl.searchHistory;
  const targetType = mode === MODE.ADDR ? MODE.ADDR : MODE.COORD;
  if (entries.length === 0 || !entries.some(e => e.type === targetType)) {
    removePanel(ctrl);
    return;
  }

  // Sort by search count (desc), then recency (desc) as tiebreaker
  const sorted = [...entries].sort((a, b) => b.count - a.count || b.ts - a.ts);
  const sectionEntries = sorted
    .filter(e => e.type === targetType)
    .slice(0, HISTORY.MAX_DISPLAY);

  const items: ResultItem[] = sectionEntries.map((entry: SearchHistoryEntry) => {
    const isAddr = entry.type === MODE.ADDR;
    // Unified display: primary=address (fallback to coord), secondary=coord
    const primaryText = entry.addrDisplay || entry.coordDisplay || "";
    return {
      icon: isAddr ? Icons.LOCATE : Icons.GLOBE,
      source: SOURCE.HISTORY,
      primaryText,
      coordDisplay: entry.coordDisplay || null,
      onClick: () => {
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
          isAddr ? T("popup_title_addr") : T("popup_title_coord"),
          T("popup_loading"),
          T("popup_loc_label"),
          T("popup_addr_label"),
          _("foliplus.close_label"),
          CONF.locale_code,
          ctrl.marker,
        );
        attachSearchDelIcon(ctrl, [lat, lng]);
      },
    };
  });

  renderResults(ctrl, items);
};

const fetchSuggestions = (ctrl: SearchControlState, query: string) => {
  if (guardBlocked(map, CONF.name, T("blocked"))) return;

  if (query.length === 0) {
    if (ctrl.searchHistory.length > 0) renderHistory(ctrl, ctrl.mode);
    else removePanel(ctrl);
    return;
  }

  if (ctrl.mode !== MODE.ADDR) {
    removePanel(ctrl);
    return;
  }

  if (query.length < AUTOCOMPLETE.MIN_CHARS) {
    removePanel(ctrl);
    return;
  }
  const cached = ctrl.cachedSuggestions.get(query);
  if (cached) {
    renderSuggestions(ctrl, cached, query);
    return;
  }

  const provider = getProvider();
  const now = Date.now();
  if (now - ctrl.lastSuggestFetch < provider.throttleMs) {
    if (ctrl.throttleTimer) clearTimeout(ctrl.throttleTimer);
    ctrl.throttleTimer = setTimeout(
      () => fetchSuggestions(ctrl, query),
      provider.throttleMs - (now - ctrl.lastSuggestFetch),
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
    headers: provider.headers,
  })
    .then(r => r.json())
    .then((raw: unknown) => {
      // Provider normalizes raw API JSON into the shared SuggestItem shape.
      const results: SuggestItem[] = provider.normalizeSuggest(raw);
      if (reqSeq !== ctrl.suggestSeq) return;
      if (query !== ctrl.inp.value.trim()) return;
      // Cache first result so searchAddress can serve it from geoCache
      const first = Array.isArray(results) ? results[0] : null;
      if (first) {
        window.foliplus.cacheSuggestion(
          map,
          query,
          parseFloat(first.lat),
          parseFloat(first.lng),
          formatAddress(first.display_name, map, CONF.locale_code) || query,
          provider.id,
        );
      }
      renderSuggestions(ctrl, results, query);
    })
    .catch(err => {
      if (err.name === "AbortError") return;
      removePanel(ctrl);
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
  return getProvider().suggest(
    q,
    limit,
    [center.lng, center.lat],
    CONF.locale_code ?? "en",
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
  positionPanel,
  recordHistorySearch,
  removePanel,
  renderHistory,
  renderResults,
  renderSuggestions,
  saveHistory,
  searchAddress,
  searchCoord,
};
