// SearchControl constants — CSS classes, search parameters, zoom levels.

export const MODE = { COORD: "coord", ADDR: "addr" };
export const SEARCH = { LIMIT: 5 };
export const ZOOM = { MAX: 16, MIN: 12, BASE: 18, DIVISOR: 20 };
export const AUTOCOMPLETE = { DEBOUNCE_MS: 300, MIN_CHARS: 3, MAX_ITEMS: 5 };
export const PARAM = { Q: "q", LAT: "lat", LNG: "lng" };
export const CLASSES = {
  EXPANDED: "expanded",
  COLLAPSED: "collapsed",
  MAP_SEARCH: "foliplus-search",
  SEARCH_MODE_BTN: "foliplus-search-mode-btn",
  CLEAR: "clear",
  SUGGESTIONS: "foliplus-search-suggestions",
  SUGGESTION_ITEM: "foliplus-search-suggestion-item",
  SUGGESTION_ICON: "foliplus-search-suggestion-icon",
  SUGGESTION_TEXT: "foliplus-search-suggestion-text",
  ACTIVE: "active",
  HISTORY_GROUP: "foliplus-search-history-group",
  HISTORY_GROUP_HEADER: "foliplus-search-history-group-header",
  HISTORY_GROUP_TITLE: "foliplus-search-history-group-title",
  HISTORY_GROUP_CLEAR: "foliplus-search-history-group-clear",
  /** Delete button inside a history entry suggestion item. */
  HISTORY_ITEM_DEL: "foliplus-search-history-item-del",
};

/** Search history configuration. */
export const HISTORY = {
  /** Maximum number of history entries to retain. */
  MAX_ENTRIES: 20,
  /** localStorage key for search history. */
  STORAGE_KEY: "foliplus.search_history",
};