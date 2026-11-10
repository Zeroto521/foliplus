// SearchControl history logic — persistence, CRUD and history rendering. Moved
// from logic.ts; search/suggestions live in ./search.ts.
import { HISTORY, MODE, RECORD_VERSION, SOURCE, ZOOM } from "../const.js";
import type { ResultItem, SearchHistoryEntry, SearchType } from "../type.js";
import { attachSearchDelIcon, removePanel, renderResults } from "./panel.js";
import { type SearchControlCtx } from "./util.js";
import { createLocationMarker, fromWgs84 } from "#core/geo/index.js";
import { guardBlocked } from "#core/lifecycle/index.js";
import * as Icons from "#platform/icon.js";
import { createPersisted, loadVersioned, saveVersioned } from "#platform/storage.js";

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
// `persistName` is set by saveHistory/flushHistory before schedule/flush so the
// closure reads the correct component name without a module-level CONFIG free variable.
let persistName = "";
const historyPersist = createPersisted({
  save: () =>
    saveVersioned(HISTORY.STORAGE_KEY, {
      data: pendingHistory,
      version: RECORD_VERSION,
      name: persistName,
      dataField: "entries",
    }),
});

let pendingHistory: SearchHistoryEntry[] = [];

const loadHistory = (ctrl: SearchControlCtx): SearchHistoryEntry[] =>
  loadHistoryRows(
    loadVersioned<StoredHistoryEntry>(HISTORY.STORAGE_KEY, {
      name: ctrl.config.name,
      dataField: "entries",
    }),
  );

/** Parse one history payload into current-format rows; [] for a corrupt,
 *  non-array, or all-legacy store. Old-version rows are dropped, not migrated. */
const loadHistoryRows = (data: StoredHistoryEntry[] | null): SearchHistoryEntry[] => {
  if (!Array.isArray(data)) return [];
  // Old-version tolerance removed: only complete current-format rows are
  // kept; partial or legacy rows (older bare-array shape, label-field rows,
  // missing fields) are dropped as old data rather than migrated. Non-object
  // rows ([null], strings, numbers) a corrupted store can produce are dropped
  // too — reading `row.type` on them would throw.
  const rows = data.filter(
    (row): row is SearchHistoryEntry =>
      row != null &&
      typeof row === "object" &&
      typeof row.query === "string" &&
      (row.type === MODE.COORD || row.type === MODE.ADDR) &&
      typeof row.coordDisplay === "string" &&
      typeof row.addrDisplay === "string" &&
      typeof row.lng === "number" &&
      typeof row.lat === "number" &&
      typeof row.ts === "number" &&
      typeof row.count === "number",
  );
  // Collapse any same-key duplicates the store still holds.
  return mergeHistoryEntries(rows);
};

const saveHistory = (ctrl: SearchControlCtx, entries: SearchHistoryEntry[]): void => {
  pendingHistory = entries;
  persistName = ctrl.config.name;
  historyPersist.schedule();
};

/** Write the current history through the binding. Idempotent no-op when
 *  nothing is pending (write-through). Called by destroy before the in-memory
 *  array is cleared, so a last search before unmount is durable. */
const flushHistory = (ctrl: SearchControlCtx): void => {
  persistName = ctrl.config.name;
  historyPersist.flush();
};

// ── Search History CRUD ──────────────────────────────────────────

const addHistoryEntry = (ctrl: SearchControlCtx, entry: SearchHistoryEntry): void => {
  const updated = mergeHistoryEntries([entry, ...ctrl.searchHistory]).slice(
    0,
    HISTORY.MAX_ENTRIES,
  );
  ctrl.searchHistory = updated;
  saveHistory(ctrl, updated);
};

const deleteHistoryEntry = (ctrl: SearchControlCtx, query: string): void => {
  const updated = ctrl.searchHistory.filter(e => e.query !== query);
  ctrl.searchHistory = updated;
  saveHistory(ctrl, updated);
};

const clearHistory = (ctrl: SearchControlCtx): void => {
  ctrl.searchHistory = [];
  saveHistory(ctrl, []);
};

const recordHistorySearch = (
  ctrl: SearchControlCtx,
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

const renderHistory = (ctrl: SearchControlCtx, mode: SearchType) => {
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
      icon: isAddr ? Icons.ICON_LOCATION_PIN : Icons.ICON_GLOBE,
      source: SOURCE.HISTORY,
      primaryText: display,
      query: reEntry,
      coordDisplay: entry.coordDisplay || null,
      onClick: () => {
        if (guardBlocked(map, ctrl.config.name, ctrl.T("blocked"))) return false;
        ctrl.inp.value = reEntry;
        const converted = fromWgs84(map, entry.lng, entry.lat);
        const lng = converted[0];
        const lat = converted[1];
        map.flyTo([lat, lng], ctrl.config.zoom ?? ZOOM.MAX);
        ctrl.marker = createLocationMarker(
          map,
          lng,
          lat,
          display,
          isAddr ? ctrl.T("popup_title_addr") : ctrl.T("popup_title_coord"),
          ctrl.T("popup_loading"),
          ctrl.T("popup_loc_label"),
          ctrl.T("popup_addr_label"),
          ctrl._("foliplus.close_label"),
          ctrl.config.locale_code,
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
