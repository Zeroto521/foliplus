// SearchControl constants — CSS classes, search parameters, zoom levels.

export const MODE = { COORD: "coord", ADDR: "addr" } as const;
/** Search type: coordinate pair or address keyword. */
export type SearchType = (typeof MODE)[keyof typeof MODE];
export const SOURCE = { SUGGESTION: "suggestion", HISTORY: "history" } as const;
/** Result source: live geocode hit or saved history entry. */
export type SearchSource = (typeof SOURCE)[keyof typeof SOURCE];
export const ZOOM = { MAX: 16, MIN: 12, BASE: 18, DIVISOR: 20 };
export const FORMAT = { LAT_LNG_PRECISION: 6 };
export const AUTOCOMPLETE = { DEBOUNCE_MS: 300, MIN_CHARS: 3, MAX_ITEMS: 5 };
export const PARAM = { Q: "q", LNG: "lng", LAT: "lat" };
export const CLASSES = {
  EXPANDED: "expanded",
  COLLAPSED: "collapsed",
  MAP_SEARCH: "foliplus-search",
  SEARCH_MODE_BTN: "foliplus-search-mode-btn",
  CLEAR: "clear",
  RESULT_PANEL: "foliplus-search-result-panel",
  RESULT_ITEM: "foliplus-search-result-item",
  RESULT_ICON: "foliplus-search-result-icon",
  RESULT_TEXT: "foliplus-search-result-text",
  ACTIVE: "active",
  /** Content wrapper inside a result item (address + coord display). */
  RESULT_CONTENT: "foliplus-search-result-content",
  /** Secondary coordinate display line inside a result item. */
  RESULT_COORD: "foliplus-search-result-coord",
};

/** Search history configuration. */
export const HISTORY = {
  /** Maximum number of history entries to retain in storage. */
  MAX_ENTRIES: 20,
  /** Maximum entries to display per section (matches autocomplete limit). */
  MAX_DISPLAY: AUTOCOMPLETE.MAX_ITEMS,
  /** localStorage key for search history. */
  STORAGE_KEY: "foliplus.search_history",
};
