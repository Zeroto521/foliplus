// Shared SearchControl logic scaffolding — state shape + coordinate parsing,
// called by ./search.ts and ./history.ts. Moved from logic.ts.
import { COORD_BOUNDS } from "#core/geo/index.js";
import type { SuggestItem } from "#core/geocode/index.js";
import type { Cache } from "#common/cache.js";
import type { Debounced } from "#common/debounce.js";
import { createScopedTranslator, createTranslator } from "#common/locale.js";
import { MODE, type SearchType } from "../const.js";
import type { ResultItem, SearchHistoryEntry } from "../type.js";

const _ = createTranslator(CONF);

const T = createScopedTranslator(CONF);

/** Subset of SearchControl state used by the logic functions (decouples the types). */
interface SearchControlState {
  inp: HTMLInputElement;
  mode: SearchType;
  modeBtn: HTMLElement;
  cachedSuggestions: Cache<string, SuggestItem[]>;
  searchHistory: SearchHistoryEntry[];
  panelWrap: HTMLElement | null;
  selectedIdx: number;
  currentItems: ResultItem[];
  lastSuggestFetch: number;
  throttleTimer: ReturnType<typeof setTimeout> | null;
  suggestAbortController: AbortController | null;
  suggestSeq: number;
  debouncedFetch: Debounced;
  marker: L.Marker | null;
  delIcon: L.Marker | null;
  ctrl: HTMLElement;
}

/**
 * Parse raw coordinate input into a validated longitude/latitude pair.
 * Full-width commas and all whitespace are ignored, so "120,32",
 * "120, 32" and "120\uff0c32" all resolve to the same location.
 * Returns null when the input is not a valid in-range coordinate pair.
 */
const parseCoord = (raw: string): { lng: number; lat: number } | null => {
  const parts = raw
    .replace(/\uff0c/g, ",")
    .replace(/\s+/g, "")
    .split(",")
    .map(Number);

  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  const lng = parts[0];
  const lat = parts[1];
  if (
    lng < -COORD_BOUNDS.LON ||
    lng > COORD_BOUNDS.LON ||
    lat < -COORD_BOUNDS.LAT ||
    lat > COORD_BOUNDS.LAT
  ) {
    return null;
  }
  return { lng, lat };
};

/** Canonicalize an entry's history key: coord entries key on the parsed
 * longitude/latitude, so "120,32" and "120, 32" resolve to one entry. Anything
 * that does not parse is returned unchanged. */
const canonicalQuery = (query: string, type: SearchType): string => {
  if (type !== MODE.COORD) return query;
  const parsed = parseCoord(query);
  return parsed ? `${parsed.lng},${parsed.lat}` : query;
};

export { type SearchControlState, T, _, canonicalQuery, parseCoord };
