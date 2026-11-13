// SearchControl constants — CSS classes, search parameters, zoom levels.

const MODE = { COORD: "coord", ADDR: "addr" } as const;
const SOURCE = { SUGGESTION: "suggestion", HISTORY: "history" } as const;
/** Result source: live geocode hit or saved history entry. */
type SearchSource = (typeof SOURCE)[keyof typeof SOURCE];
const ZOOM = { MAX: 16, MIN: 12, BASE: 18, DIVISOR: 20 };
const AUTOCOMPLETE = {
  DEBOUNCE_MS: 300,
  MIN_CHARS: 3,
  MAX_ITEMS: 5,
  /** FIFO capacity of the suggestion cache. */
  CACHE_MAX: 50,
  /** TTL for cached suggestions. Suggestions depend on the map center (bias),
   *  so an entry outlives its usefulness once the map is panned; expiring it
   *  makes the next keystroke refetch against the current view. */
  CACHE_TTL_MS: 5 * 60 * 1000,
};
const PARAM = { Q: "q", LNG: "lng", LAT: "lat" };
const CLASSES = {
  MAP_SEARCH: "foliplus-search",
  SEARCH_MODE_BTN: "foliplus-search-mode-btn",
  CLEAR: "clear",
  RESULT_PANEL: "foliplus-search-result-panel",
  RESULT_ITEM: "foliplus-search-result-item",
  RESULT_ICON: "foliplus-search-result-icon",
  RESULT_TEXT: "foliplus-search-result-text",
  /** Content wrapper inside a result item (address + coord display). */
  RESULT_CONTENT: "foliplus-search-result-content",
  /** Secondary coordinate display line inside a result item. */
  RESULT_COORD: "foliplus-search-result-coord",
};

/** Search history configuration. */
const HISTORY = {
  /** Maximum number of history entries to retain in storage. */
  MAX_ENTRIES: 20,
  /** Maximum entries to display per section (matches autocomplete limit). */
  MAX_DISPLAY: AUTOCOMPLETE.MAX_ITEMS,
  /** localStorage key for search history, scoped per map container. */
  STORAGE_KEY: `foliplus_search_${map.getContainer().id}`,
};

/** Version stamp for the persisted history record (positive integer,
 * incremented only when the record shape changes). The envelope is read
 * structurally: complete current-format rows are kept, and anything else
 * (older partial rows, a legacy bare array of partial rows, corrupt shapes)
 * is dropped as old data rather than migrated in place. */
const RECORD_VERSION = 1;

export { AUTOCOMPLETE, CLASSES, HISTORY, RECORD_VERSION, MODE, PARAM, SOURCE, ZOOM };
export type { SearchSource };
