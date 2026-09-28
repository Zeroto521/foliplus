// SearchControl logic entry — re-exports ./search.ts and ./history.ts so the
// `./logic.js` import surface from logic.ts stays intact.
export {
  attachSearchDelIcon,
  buildSearchUrl,
  fetchSuggestions,
  initDebouncedFetch,
  positionPanel,
  removePanel,
  renderResults,
  renderSuggestions,
  searchAddress,
  searchCoord,
} from "./search.js";

export {
  addHistoryEntry,
  clearHistory,
  deleteHistoryEntry,
  flushHistory,
  loadHistory,
  recordHistorySearch,
  renderHistory,
  saveHistory,
} from "./history.js";
