// SearchControl search/suggestion logic — standalone functions called with `this` as ctrl.
import { HINT_DURATION } from "#core/hint.js";
import { guardBlocked } from "#core/mode.js";
import { Cache } from "#common/cache.js";
import { COORD_BOUNDS, fromWgs84, toWgs84 } from "#common/coord.js";
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
import * as Icons from "#common/icon.js";
import { createScopedTranslator, createTranslator } from "#common/locale.js";
import { createLogger } from "#common/log.js";
import * as Storage from "#common/storage.js";
import {
  AUTOCOMPLETE,
  CLASSES,
  FORMAT,
  HISTORY,
  MODE,
  SOURCE,
  type SearchType,
  ZOOM,
} from "./const.js";
import type {
  AddressResult,
  NominatimItem,
  ResultItem,
  SearchHistoryEntry,
} from "./type.js";

const _ = createTranslator(CONF);
const T = createScopedTranslator(CONF);
const log = createLogger(CONF.name);

/** Subset of SearchControl state used by the logic functions (decouples the types). */
interface SearchControlState {
  inp: HTMLInputElement;
  mode: SearchType;
  modeBtn: HTMLElement;
  cachedSuggestions: Cache<string, NominatimItem[]>;
  searchHistory: SearchHistoryEntry[];
  panelWrap: HTMLElement | null;
  selectedIdx: number;
  currentItems: ResultItem[];
  lastSuggestFetch: number;
  throttleTimer: ReturnType<typeof setTimeout> | null;
  suggestAbortController: AbortController | null;
  suggestSeq: number;
  debouncedFetch: Debounced;
  marker: L.Marker | null;
  delIcon: L.Marker | null;
  ctrl: HTMLElement;
}

// ── Search History CRUD ──────────────────────────────────────────

/**
 * Parse raw coordinate input into a validated longitude/latitude pair.
 * Full-width commas and all whitespace are ignored, so "120,32",
 * "120, 32" and "120\uff0c32" all resolve to the same location.
 * Returns null when the input is not a valid in-range coordinate pair.
 */
const parseCoord = (raw: string): { lng: number; lat: number } | null => {
  const parts = raw
    .replace(/\uff0c/g, ",")
    .replace(/\s+/g, "")
    .split(",")
    .map(Number);

  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  const lng = parts[0];
  const lat = parts[1];
  if (
    lng < -COORD_BOUNDS.LON ||
    lng > COORD_BOUNDS.LON ||
    lat < -COORD_BOUNDS.LAT ||
    lat > COORD_BOUNDS.LAT
  )
    return null;
  return { lng, lat };
};

/** Canonicalize an entry's history key: coord entries key on the parsed
 * longitude/latitude, so "120,32" and "120, 32" resolve to one entry. Anything
 * that does not parse is returned unchanged. */
const canonicalQuery = (query: string, type: SearchType): string => {
  if (type !== MODE.COORD) return query;
  const parsed = parseCoord(query);
  return parsed ? `${parsed.lng},${parsed.lat}` : query;
};

/** Dedup key. Type is part of it: typing "120,32" in addr mode yields a
 * geocode result whose key string can collide with a coord entry's, and those
 * are two distinct searches that must both be kept. */
const historyKey = (entry: Pick<SearchHistoryEntry, "type" | "query">): string =>
  `${entry.type}:${entry.query}`;

/**
 * Merge history entries by key. Repeated searches accumulate into a single
 * entry: the most recent one wins for timestamp and coordinates, counts are
 * summed, and an empty display field falls back to an older entry's value.
 * Map re-set keeps a key's insertion slot, so the result preserves first-seen
 * order without re-sorting the caller's list.
 */
const mergeHistoryEntries = (entries: SearchHistoryEntry[]): SearchHistoryEntry[] => {
  const byKey = new Map<string, SearchHistoryEntry>();
  for (const entry of entries) {
    const key = historyKey(entry);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...entry });
      continue;
    }
    const [newer, older] =
      existing.ts >= entry.ts ? [existing, entry] : [entry, existing];
    newer.count = existing.count + entry.count;
    newer.coordDisplay = newer.coordDisplay || older.coordDisplay;
    newer.addrDisplay = newer.addrDisplay || older.addrDisplay;
    // newer may be the incoming entry (not the one in the map) when
    // existing.ts < entry.ts, so we must update the map reference.
    byKey.set(key, newer);
  }
  return Array.from(byKey.values());
};

type StoredHistoryEntry = Partial<SearchHistoryEntry> & { label?: string };

const loadHistory = (): SearchHistoryEntry[] => {
  const data = Storage.load<StoredHistoryEntry[]>(HISTORY.STORAGE_KEY, CONF.name);
  if (!Array.isArray(data)) return [];
  // Drop non-object rows ([null], strings, numbers) that a corrupted store
  // can produce; reading `row.type` on them would throw.
  const rows = data.filter(row => row != null && typeof row === "object");
  // Migrate stored entries to the current format, supplying the defaults that
  // older versions never wrote.
  const migrated = rows.map(e => {
    const type = e.type === MODE.COORD || e.type === MODE.ADDR ? e.type : MODE.ADDR;
    return {
      query: canonicalQuery(e.query ?? "", type),
      type,
      coordDisplay: e.coordDisplay ?? (type === MODE.COORD ? (e.label ?? "") : ""),
      addrDisplay: e.addrDisplay ?? (type === MODE.ADDR ? (e.label ?? "") : ""),
      lng: e.lng ?? 0,
      lat: e.lat ?? 0,
      ts: e.ts ?? Date.now(),
      count: e.count ?? 1,
    };
  });
  // Collapse entries a raw-input key created before this fix (e.g. "120,32" +
  // "120, 32"). No trimming here — the cap applies when an entry is added, so
  // stale rows from an older version are shown rather than dropped on load.
  return mergeHistoryEntries(migrated);
};

const saveHistory = (entries: SearchHistoryEntry[]): void => {
  Storage.save(HISTORY.STORAGE_KEY, entries, CONF.name);
};

const addHistoryEntry = (ctrl: SearchControlState, entry: SearchHistoryEntry): void => {
  const updated = mergeHistoryEntries([entry, ...ctrl.searchHistory]).slice(
    0,
    HISTORY.MAX_ENTRIES,
  );
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
  type: SearchType,
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
  const parsed = parseCoord(raw);
  if (!parsed) {
    map.foliplus!.showHint(CONF.name, T("coord_error"), HINT_DURATION.LONG);
    ctrl.inp.value = "";
    return;
  }
  const { lng, lat } = parsed;
  // Canonical key, not the raw input: otherwise "120,32" and "120, 32"
  // would be stored as two entries that display identically.
  const key = `${lng},${lat}`;
  map.foliplus!.hideHint(CONF.name);
  map.flyTo([lat, lng], CONF.zoom ?? ZOOM.MAX);
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
  // incrementing the count (a later addHistoryEntry for the same type:query
  // key would treat it as a repeat).
  recordHistorySearch(ctrl, key, MODE.COORD, coordDisplay, "", lng, lat);
  window.foliplus
    .reverseGeocode(map, lng, lat, CONF.locale_code)
    .then(addr => {
      if (addr) {
        const entry = ctrl.searchHistory.find(e => e.query === key);
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
    .geocode(map, query, CONF.locale_code)
    .then(result => {
      map.foliplus!.hideHint(CONF.name);
      if (!result) {
        map.foliplus!.showHint(CONF.name, T("addr_not_found"), HINT_DURATION.LONG);
        ctrl.inp.value = "";
        return;
      }
      // result is already in map CRS — render directly; convert back to
      // WGS84 for history storage (history entries are stored in WGS84).
      // renderAddressResult refuses (returns false) if another control now
      // holds a mode while the geocode request was in flight; gate the
      // history write on success so we don't record a marker that was never placed.
      if (!renderAddressResult(ctrl, result)) return;
      const wgs = toWgs84(map, result.lng, result.lat);
      const coordDisplay = `${wgs[0].toFixed(FORMAT.LAT_LNG_PRECISION)}, ${wgs[1].toFixed(FORMAT.LAT_LNG_PRECISION)}`;
      const addrDisplay =
        formatAddress(result.display_name, map, CONF.locale_code) || query;
      recordHistorySearch(
        ctrl,
        query,
        MODE.ADDR,
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
): boolean => {
  // The panel can stay open while another control holds a mode, so a picked
  // suggestion must not fly the map. Suggestion picks, history entry clicks,
  // and the Enter fallback all converge here; returning false lets the caller
  // skip recording history and keep the panel open with the "blocked" hint.
  if (guardBlocked(map, CONF.name, T("blocked"))) return false;
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
  return true;
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
  ctrl.currentItems = [];
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
      log.msg(`result panel drift: DOM has ${domCount} items but retained ${results.length}`),
    );
  }
};

const renderSuggestions = (
  ctrl: SearchControlState,
  results: NominatimItem[],
  query: string,
) => {
  if (!results || results.length === 0) {
    removePanel(ctrl);
    return;
  }

  ctrl.cachedSuggestions.set(query, results);

  const items: ResultItem[] = results.map((item: NominatimItem) => {
    const displayName =
      formatAddress(item.display_name, map, CONF.locale_code) || item.name || "";
    const coordDisplay = `${parseFloat(item.lng).toFixed(FORMAT.LAT_LNG_PRECISION)}, ${parseFloat(item.lat).toFixed(FORMAT.LAT_LNG_PRECISION)}`;
    return {
      icon: Icons.LOCATE,
      source: SOURCE.SUGGESTION,
      primaryText: displayName,
      coordDisplay,
      onClick: () => {
        if (!renderAddressResult(ctrl, { item, displayName })) return false;
        recordHistorySearch(
          ctrl,
          query,
          MODE.ADDR,
          coordDisplay,
          displayName,
          parseFloat(item.lng),
          parseFloat(item.lat),
        );
        return true;
      },
    };
  });

  renderResults(ctrl, items);
};

const renderHistory = (ctrl: SearchControlState, mode: SearchType) => {
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
    // Unified panel/popup display: address first, coordinates as fallback.
    const display = entry.addrDisplay || entry.coordDisplay || "";
    // Re-entry value written into the input on click / keyboard select.
    // Type-aware: addr entries use addrDisplay, coord entries use coordDisplay,
    // so the input always gets the parseable value matching the entry's type.
    // Both are parseable — coordDisplay is the formatted coordinate string,
    // addrDisplay goes through geocode again and resolves to the same point.
    // Fall back to the stored query only if the entry's own display is missing.
    const reEntry = (isAddr ? entry.addrDisplay : entry.coordDisplay) || entry.query;
    return {
      icon: isAddr ? Icons.LOCATE : Icons.GLOBE,
      source: SOURCE.HISTORY,
      primaryText: display,
      query: reEntry,
      coordDisplay: entry.coordDisplay || null,
      onClick: () => {
        if (guardBlocked(map, CONF.name, T("blocked"))) return false;
        ctrl.inp.value = reEntry;
        const converted = fromWgs84(map, entry.lng, entry.lat);
        const lng = converted[0];
        const lat = converted[1];
        map.flyTo([lat, lng], CONF.zoom ?? ZOOM.MAX);
        ctrl.marker = createLocationMarker(
          map,
          lng,
          lat,
          display,
          isAddr ? T("popup_title_addr") : T("popup_title_coord"),
          T("popup_loading"),
          T("popup_loc_label"),
          T("popup_addr_label"),
          _("foliplus.close_label"),
          CONF.locale_code,
          ctrl.marker,
        );
        attachSearchDelIcon(ctrl, [lat, lng]);
        return true;
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

  const now = Date.now();
  if (now - ctrl.lastSuggestFetch < NOMINATIM.THROTTLE_MS) {
    if (ctrl.throttleTimer) clearTimeout(ctrl.throttleTimer);
    ctrl.throttleTimer = setTimeout(
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
    .then((raw: any[]) => {
      // Map API field names: Nominatim returns `lon`, we use `lng`
      const results: NominatimItem[] = raw.map((r: any) => ({
        lng: r.lon ?? r.lng,
        lat: r.lat,
        name: r.name,
        display_name: r.display_name,
      }));
      if (reqSeq !== ctrl.suggestSeq) return;
      if (query !== ctrl.inp.value.trim()) return;
      // Cache first result so searchAddress can serve it from geoCache.
      // results is always an array (it comes from raw.map), so index 0 is
      // either an item or undefined.
      const first = results[0];
      if (first) {
        window.foliplus.cacheSuggestion(
          map,
          query,
          parseFloat(first.lat),
          parseFloat(first.lng),
          formatAddress(first.display_name, map, CONF.locale_code) || query,
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
