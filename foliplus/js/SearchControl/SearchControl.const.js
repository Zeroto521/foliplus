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
};
