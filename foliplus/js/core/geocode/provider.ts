// Geocode provider contract — map-free (WGS84 in, WGS84 out), so Nominatim
// and future providers are interchangeable behind one interface. CRS adaption,
// caching, and rate limiting live in geocoder.ts, not here.
// Fetch failures propagate to the caller: the geocoder decides the error
// boundary (locale fallback text / null).
interface GeocodeItem {
  lat: number;
  lng: number;
  display_name: string;
}

interface GeocodeProvider {
  /** Forward: resolve an address to WGS84 coordinates. */
  search(q: string, code: string): Promise<GeocodeItem[]>;
  /** Reverse: resolve WGS84 coordinates to an address. */
  reverse(lng: number, lat: number, code: string): Promise<GeocodeItem | null>;
}

export type { GeocodeItem, GeocodeProvider };
