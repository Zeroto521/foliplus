// Shared SearchControl logic scaffolding — coordinate parsing, called by
// ./search.ts and ./history.ts. Moved from logic.ts.
import { COORD_BOUNDS } from "#core/geo/index.js";
import type { Logger } from "#common/log.js";
import { MODE, type SearchType } from "../const.js";
import type { SearchControlState } from "../type.js";

/** Control context — the subset of the control instance the logic layer reads.
 *  Carried on the control object (via defineControl + initState) instead of
 *  module-level free variables, so every logic function is unit-testable. */
type ControlCtx = {
  conf: ComponentConfig;
  T: (key: string) => string;
  _: (key: string) => string;
  log: Logger;
};

/** Full context for logic functions — state + control ctx. */
type SearchControlCtx = SearchControlState & ControlCtx;

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

export { canonicalQuery, parseCoord };
export type { ControlCtx, SearchControlCtx };
