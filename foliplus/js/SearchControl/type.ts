// SearchControl shared type definitions — decoupled from the entry module.
// Sub-modules (event.ts, logic.ts) import these instead of the index entry
// to avoid a type-level circular dependency (index → event → index).
import type { Debounced } from "#common/debounce.js";
import type { Cache } from "#common/cache.js";
import type { BaseControl } from "#foliplus/BaseControl.js";

/** Nominatim search result element. */
export interface NominatimItem {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
}

/** Cached address result: the raw item + its formatted display name. */
export interface AddressResult {
  item: NominatimItem;
  displayName: string;
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
  cachedSuggestions: Cache<string, NominatimItem[]>;
  cachedAddress: Record<string, AddressResult>;
  scrollTargets: Array<Element | Window>;
  repositionHandler: () => void;
  addrAbortController: AbortController | null;
  suggestAbortController: AbortController | null;
  marker: L.Marker | null;
  delIcon: L.Marker | null;
  mode: string;
  suggestionsWrap: HTMLElement | null;
  selectedSuggestionIdx: number;
  lastSuggestFetch: number;
  suggestionsThrottleTimer: ReturnType<typeof setTimeout> | null;
  suggestSeq: number;
  setMode(newMode: string): void;
}
