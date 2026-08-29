// SearchControl shared type definitions — decoupled from the entry module.
// Sub-modules (event.ts, logic.ts) import these instead of the index entry
// to avoid a type-level circular dependency (index → event → index).
import type { SuggestItem } from "#core/geocode/index.js";
import type { BaseControl } from "#foliplus/BaseControl.js";
import type { Cache } from "#common/cache.js";
import type { Debounced } from "#common/debounce.js";

// Re-export the shared provider result shape so SearchControl sub-modules
// (logic.ts, index.ts) import it from one place.
export type { SuggestItem };

/** Cached address result: the raw item + its formatted display name. */
export interface AddressResult {
  item: SuggestItem;
  displayName: string;
}

/** A single entry in the user's search history, persisted to localStorage. */
export interface SearchHistoryEntry {
  /** The raw query text the user typed (coord "121.47,31.23" or addr keyword). */
  query: string;
  /** Search type: "coord" for coordinate, "addr" for address keyword. */
  type: "coord" | "addr";
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
export interface ResultItem {
  /** Source: "suggestion" for live Nominatim results, "history" for saved entries. */
  source: "suggestion" | "history";
  /** Icon SVG to display. */
  icon: string;
  /** Primary display text (shown in RESULT_TEXT). */
  primaryText: string;
  /** Secondary coordinate display (shown in RESULT_COORD, null to hide). */
  coordDisplay: string | null;
  /** Click handler — called after the panel is removed. */
  onClick: () => void;
}

/** Public shape of the SearchControl instance, shared across sub-modules. */
export interface SearchControl extends BaseControl {
  container: HTMLElement;
  ctrl: HTMLElement;
  toggleBtn: HTMLElement;
  toolBar: HTMLElement;
  modeBtn: HTMLElement;
  inp: HTMLInputElement;
  clearBtn: HTMLElement;
  debouncedFetch: Debounced;
  cachedSuggestions: Cache<string, SuggestItem[]>;
  searchHistory: SearchHistoryEntry[];
  scrollTargets: Array<Element | Window>;
  repositionHandler: () => void;
  addrAbortController: AbortController | null;
  suggestAbortController: AbortController | null;
  marker: L.Marker | null;
  delIcon: L.Marker | null;
  mode: string;
  panelWrap: HTMLElement | null;
  selectedIdx: number;
  lastSuggestFetch: number;
  throttleTimer: ReturnType<typeof setTimeout> | null;
  suggestSeq: number;
  setMode(newMode: string): void;
}
