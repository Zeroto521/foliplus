// Map-aware geocode provider wrapper — the single place where geocoding
// crosses the CRS boundary.
//
// Providers are pure WGS84 (URL builders + normalizers, no map knowledge).
// This wrapper adapts their input and output to the map's CRS:
//   - entry: suggest bias / reverse coordinates are map CRS coming in and are
//     converted to WGS84 before the API call (toWgs84);
//   - exit: coordinate-bearing results (normalizeSuggest / normalizeSearch)
//     are converted back to the map CRS, so callers never see provider CRS.
// All foliplus geocoding goes through this wrapper — the runtime geocoder and
// component paths (e.g. SearchControl suggestions) — so the ~4 conversion
// sites stay in one function instead of being repeated per consumer.
import { fromWgs84, toWgs84 } from "#core/geo/coord.js";
import type { GeocodeProvider } from "./type.js";

/** Wrap a WGS84 provider so its I/O coordinates adapt to the map CRS. */
const withMapCRS = (provider: GeocodeProvider, map: L.Map): GeocodeProvider => {
  const toMap = (lng: string, lat: string): { lng: string; lat: string } => {
    const [mlng, mlat] = fromWgs84(map, parseFloat(lng), parseFloat(lat));
    return { lng: String(mlng), lat: String(mlat) };
  };

  return {
    ...provider,
    suggest(q, limit, center, code) {
      if (!center) return provider.suggest(q, limit, null, code);
      const wgs = toWgs84(map, center[0], center[1]);
      return provider.suggest(q, limit, [wgs[0], wgs[1]], code);
    },
    reverse(lng, lat, code) {
      const wgs = toWgs84(map, lng, lat);
      return provider.reverse(wgs[0], wgs[1], code);
    },
    normalizeSuggest(data) {
      return provider.normalizeSuggest(data).map(item => ({
        ...item,
        ...toMap(item.lng, item.lat),
      }));
    },
    normalizeSearch(data) {
      const item = provider.normalizeSearch(data);
      if (!item) return null;
      return { ...item, ...toMap(item.lng, item.lat) };
    },
  };
};

export { withMapCRS };
