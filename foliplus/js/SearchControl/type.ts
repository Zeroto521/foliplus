// SearchControl shared type definitions — decoupled from the entry module.
// Sub-modules (event.ts, logic.ts) import these instead of the index entry
// to avoid a type-level circular dependency (index → event → index).
import type { BaseControl } from "#foliplus/BaseControl.js";
import type { Cache } from "#common/cache.js";
import type { Debounced } from "#common/debounce.js";
import type { SearchSource, SearchType } from "./const.js";

/**
 * Nominatim search result element.
 * The API returns `lon`; we map to `lng` at the fetch boundary.
 */
interface NominatimItem {
  lng: string;
  lat: string;
  name?: string;
  display_name: string;
}

/** Cached address result: the raw item + its formatted display name. */
interface AddressResult {
  item: NominatimItem;
  displayName: string;
}

/** A single entry in the user's search history, persisted to localStorage. */
interface SearchHistoryEntry {
  /**
   * Dedup key: the user's address keyword, or a canonical "<lng>,<lat>" for
   * coordinates (whitespace and full-width commas normalized away, so variant
   * inputs for the same location share one entry).
   */
  query: string;
  /** Search type: coordinate pair or address keyword. */
  type: SearchType;
  /** Formatted coordinate display, e.g. "121.4700, 31.2300". */
  coordDisplay: string;
  /** Formatted address display, e.g. "Paris, France". */
  addrDisplay: string;
  /** Result longitude (WGS84). */
  lng: number;
  /** Result latitude (WGS84). */
  lat: number;
  /** Timestamp when this search was completed. */
  ts: number;
  /** Number of times this query has been searched (for popularity sorting). */
  count: number;
}

/** A rendered result item in the suggestions/history panel, shared by both sources. */
interface ResultItem {
  /** Source: live geocode result or saved history entry. */
  source: SearchSource;
  /** Icon SVG to display. */
  icon: string;
  /** Primary display text (shown in RESULT_TEXT). */
  primaryText: string;
  /**
   * Value written into the input on click / keyboard select, also exposed
   * via the item's `data-query` attribute. For history entries this is the
   * panel display (`addrDisplay` for address, `coordDisplay` for coordinate)
   * so the input matches what the user clicked; for suggestions it is
   * absent, and the display text (`primaryText`) is used instead.
   */
  query?: string;
  /** Secondary coordinate display (shown in RESULT_COORD, null to hide). */
  coordDisplay: string | null;
  /** Click handler — returns true on success (panel should close), false if
   * blocked by an active mode (panel stays open, hint shown). */
  onClick: () => boolean;
}

/** Public shape of the SearchControl instance, shared across sub-modules. */
interface SearchControl extends BaseControl {
  container: HTMLElement;
  ctrl: HTMLElement;
  toggleBtn: HTMLElement;
  toolBar: HTMLElement;
  modeBtn: HTMLElement;
  inp: HTMLInputElement;
  clearBtn: HTMLElement;
  debouncedFetch: Debounced;
  cachedSuggestions: Cache<string, NominatimItem[]>;
  searchHistory: SearchHistoryEntry[];
  scrollTargets: Array<Element | Window>;
  repositionHandler: () => void;
  addrAbortController: AbortController | null;
  suggestAbortController: AbortController | null;
  marker: L.Marker | null;
  delIcon: L.Marker | null;
  mode: SearchType;
  panelWrap: HTMLElement | null;
  selectedIdx: number;
  lastSuggestFetch: number;
  throttleTimer: ReturnType<typeof setTimeout> | null;
  suggestSeq: number;
  currentItems: ResultItem[];
  setMode(newMode: string): void;
}

export type {
  AddressResult,
  NominatimItem,
  ResultItem,
  SearchControl,
  SearchHistoryEntry,
};
