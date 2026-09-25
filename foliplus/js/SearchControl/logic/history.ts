// SearchControl history logic — persistence, CRUD and history rendering. Moved
// from logic.ts; search/suggestions live in ./search.ts.
import { fromWgs84 } from "#core/geo/index.js";
import { createLocationMarker } from "#core/locationMarker.js";
import { guardBlocked } from "#core/mode.js";
import * as Icons from "#common/icon.js";
import { makePersisted } from "#common/storage.js";
import * as Storage from "#common/storage.js";
import {
  HISTORY,
  MODE,
  RECORD_VERSION,
  SOURCE,
  type SearchType,
  ZOOM,
} from "../const.js";
import type { ResultItem, SearchHistoryEntry } from "../type.js";
import { attachSearchDelIcon, removePanel, renderResults } from "./search.js";
import { type SearchControlState, T, _, canonicalQuery } from "./util.js";

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

// Module-level write-through binding over the search history record. The save
// closure reads `pendingHistory` (set by saveHistory before scheduling), so the
// binding is stateless from the caller's point of view — saveHistory is still
// the public entry point. Load is explicit via loadHistory() below.
const historyPersist = makePersisted({
  save: () =>
    Storage.saveVersioned(HISTORY.STORAGE_KEY, {
      data: pendingHistory,
      version: RECORD_VERSION,
      name: CONF.name,
      dataField: "entries",
    }),
});

let pendingHistory: SearchHistoryEntry[] = [];

const loadHistory = (): SearchHistoryEntry[] =>
  loadHistoryRows(
    Storage.loadVersioned<StoredHistoryEntry>(HISTORY.STORAGE_KEY, {
      name: CONF.name,
      dataField: "entries",
    }),
  );

/** Parse and migrate one history payload; [] for a corrupt or non-array store. */
const loadHistoryRows = (data: StoredHistoryEntry[] | null): SearchHistoryEntry[] => {
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
  pendingHistory = entries;
  historyPersist.schedule();
};

/** Write the current history through the binding. Idempotent no-op when
 *  nothing is pending (write-through). Called by destroy before the in-memory
 *  array is cleared, so a last search before unmount is durable. */
const flushHistory = (): void => historyPersist.flush();

// ── Search History CRUD ──────────────────────────────────────────

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

// ── Suggestions / History Panel ──────────────────────────────────

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
      icon: isAddr ? Icons.LOCATE_ICON : Icons.GLOBE_ICON,
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

export {
  addHistoryEntry,
  clearHistory,
  deleteHistoryEntry,
  flushHistory,
  loadHistory,
  recordHistorySearch,
  renderHistory,
  saveHistory,
};
