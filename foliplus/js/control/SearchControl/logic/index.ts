// SearchControl logic entry — re-exports ./search.ts, ./history.ts and
// ./lifecycle.ts so the `./logic.js` import surface stays intact.
export {
  attachSearchDelIcon,
  buildSearchUrl,
  fetchSuggestions,
  initDebouncedFetch,
  positionPanel,
  removePanel,
  renderResults,
  searchAddress,
  searchCoord,
} from "./search.js";

export { destroyControl } from "./lifecycle.js";
export { releaseMarkerLayers } from "./owned.js";

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
