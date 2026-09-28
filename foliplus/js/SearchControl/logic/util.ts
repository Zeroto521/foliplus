// Shared SearchControl logic scaffolding — coordinate parsing, called by
// ./search.ts and ./history.ts. Moved from logic.ts.
import { COORD_BOUNDS } from "#core/geo/index.js";
import { createScopedTranslator, createTranslator } from "#common/locale.js";
import { MODE, type SearchType } from "../const.js";

const _ = createTranslator(CONF);

const T = createScopedTranslator(CONF);

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

export { T, _, canonicalQuery, parseCoord };
