// MeasureControl export module — convert measurements to GeoJSON and CSV.
import type { ExportFormat } from "./const.js";
import * as CONST from "./const.js";
import { MODE_MAP } from "./mode/index.js";

// CONF is a free variable from the IIFE template wrapper.
declare const CONF: { name: string; filename: string; export_format: ExportFormat };

/**
 * Convert a single measurement to a GeoJSON feature.
 */
/** WGS 84 CRS descriptor — fallback when map.options.crs is unavailable (e.g. tests). */
const CRS_WGS84 = {
  type: "name" as const,
  properties: {
    name: "urn:ogc:def:crs:OGC:1.3:CRS84",
  },
};

/**
 * Recursively visit all coordinate pairs in a geometry and update bbox bounds.
 * Mutates the given bounds accumulator.
 */
const visitCoords = (
  coords: GeoJSON.Position[],
  bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number },
) => {
  for (const [lng, lat] of coords) {
    if (lng < bounds.minLng) bounds.minLng = lng;
    if (lat < bounds.minLat) bounds.minLat = lat;
    if (lng > bounds.maxLng) bounds.maxLng = lng;
    if (lat > bounds.maxLat) bounds.maxLat = lat;
  }
};

/**
 * Walk a GeoJSON geometry and extract the bounding box [minLng, minLat, maxLng, maxLat].
 * Returns null when the geometry has no coordinates.
 */
const geometryBBox = (
  geom: GeoJSON.Geometry | null,
): [number, number, number, number] | null => {
  if (!geom) return null;

  const bounds: {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
  } = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
  let hasPoint = false;

  const mark = () => {
    if (!hasPoint) hasPoint = true;
  };

  switch (geom.type) {
    case "Point":
      visitCoords([geom.coordinates], bounds);
      mark();
      break;
    case "LineString":
      visitCoords(geom.coordinates, bounds);
      mark();
      break;
    case "Polygon":
      for (const ring of geom.coordinates) {
        visitCoords(ring, bounds);
        mark();
      }
      break;
    default:
      return null;
  }

  return hasPoint ? [bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat] : null;
};

/**
 * Compute the combined bounding box from an array of GeoJSON features.
 * Returns null when no features contain coordinates.
 */
const featuresBBox = (
  features: GeoJSON.Feature[],
): [number, number, number, number] | null => {
  let result: [number, number, number, number] | null = null;

  for (const f of features) {
    const bbox = geometryBBox(f.geometry);
    if (!bbox) continue;
    if (!result) {
      result = bbox;
    } else {
      // Merge: expand result to include bbox
      result = [
        Math.min(result[0], bbox[0]),
        Math.min(result[1], bbox[1]),
        Math.max(result[2], bbox[2]),
        Math.max(result[3], bbox[3]),
      ];
    }
  }

  return result;
};

const toGeoJSON = (measurements: MeasureData[]): string => {
  const features = measurements
    .filter(m => m.type)
    .map(m => MODE_MAP[m.type as keyof typeof MODE_MAP]!.toGeoFeature(m));

  const collection: {
    type: "FeatureCollection";
    features: GeoJSON.Feature[];
    bbox?: [number, number, number, number];
    crs?: { type: "name"; properties: { name: string } };
  } = {
    type: "FeatureCollection",
    features,
  };

  const bbox = featuresBBox(features);
  if (bbox) collection.bbox = bbox;
  const leafletCrs = map.options?.crs as { toDefinition?: () => { type: "name"; properties: { name: string } } | undefined } | undefined;
  collection.crs = leafletCrs?.toDefinition?.() || CRS_WGS84;

  return JSON.stringify(collection, null, 2);
};

/**
 * CSV row type for flattened measurement data.
 */
interface CsvRow {
  id: string;
  type: string;
  name: string;
  latitude: string;
  longitude: string;
  totalDistance: string;
  area: string;
  radius: string;
  address: string;
  wkt: string;
}

/**
 * Escape a CSV field value.
 */
const csvEscape = (value: string | number): string => {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
};

/**
 * Convert measurements array to CSV string.
 */
const toCSV = (measurements: MeasureData[]): string => {
  const headers = [
    "id",
    "type",
    "name",
    "latitude",
    "longitude",
    "totalDistance",
    "area",
    "radius",
    "address",
    "wkt",
  ];
  const rows: string[] = [headers.join(",")];

  for (const data of measurements) {
    if (!data.type) continue;

    const name = getNameForType(data);
    const wkt = toWKT(data);
    const lat = getLat(data);
    const lng = getLng(data);

    const row: CsvRow = {
      id: data.id || "",
      type: data.type,
      name,
      latitude: lat !== null ? lat.toFixed(6) : "",
      longitude: lng !== null ? lng.toFixed(6) : "",
      totalDistance: data.totalDistance !== undefined ? String(data.totalDistance) : "",
      area: data.area !== undefined ? String(data.area) : "",
      radius: data.radius !== undefined ? String(data.radius) : "",
      address: data.address || "",
      wkt,
    };

    rows.push(headers.map(h => csvEscape(row[h as keyof CsvRow] || "")).join(","));
  }

  return rows.join("\n");
};

const getNameForType = (data: MeasureData): string => {
  if (data.type === CONST.MODE.MARKER) {
    return data.address || "Location Marker";
  }
  if (data.type === CONST.MODE.DISTANCE) {
    return "Distance Measurement";
  }
  if (data.type === CONST.MODE.POLYGON) {
    return "Area Measurement";
  }
  if (data.type === CONST.MODE.CIRCLE) {
    return "Circle";
  }
  return data.type;
};

/**
 * Get the first coordinate point from any measurement type.
 * This avoids repeating the type-switch logic in getLat and getLng.
 */
const getBasePoint = (data: MeasureData): { lat: number; lng: number } | null => {
  if (data.type === CONST.MODE.MARKER) {
    return data.lat !== undefined && data.lng !== undefined
      ? { lat: data.lat, lng: data.lng }
      : null;
  }
  if (
    (data.type === CONST.MODE.DISTANCE || data.type === CONST.MODE.POLYGON) &&
    data.points &&
    data.points.length > 0
  ) {
    return data.points[0];
  }
  if (data.type === CONST.MODE.CIRCLE) {
    return data.center ?? null;
  }
  return null;
};

const getLat = (data: MeasureData): number | null => {
  return getBasePoint(data)?.lat ?? null;
};

const getLng = (data: MeasureData): number | null => {
  return getBasePoint(data)?.lng ?? null;
};

const toWKT = (data: MeasureData): string => {
  const Feature = MODE_MAP[data.type as keyof typeof MODE_MAP];
  if (!Feature) {
    return "";
  }
  return featureToWKT(Feature.toGeoFeature(data));
};

/** Convert a GeoJSON Feature to a WKT string using turf.wkt. */
const featureToWKT = (feature: GeoJSON.Feature): string => {
  if (!feature.geometry) {
    return "";
  }
  return turf.wkt.toWKT(feature).replace("\n", "");
};

/**
 * Map export format to filename extension.
 */
const formatToExtension = (format: ExportFormat): string => {
  switch (format) {
    case CONST.EXPORT_FORMAT.GEOJSON:
      return "geojson";
    case CONST.EXPORT_FORMAT.CSV:
      return "csv";
    default:
      return "geojson";
  }
};

/**
 * Map export format to MIME type.
 */
const formatToMimeType = (format: ExportFormat): string => {
  switch (format) {
    case CONST.EXPORT_FORMAT.GEOJSON:
      return "application/geo+json";
    case CONST.EXPORT_FORMAT.CSV:
      return "text/csv";
    default:
      return "application/geo+json";
  }
};

/** Convert measurements to a Blob and trigger a file download. */
const exportMeasurements = (
  measurements: MeasureData[],
  format: ExportFormat,
): void => {
  if (!measurements || measurements.length === 0) {
    return;
  }

  let content: string;
  const ext = formatToExtension(format);
  const mimeType = formatToMimeType(format);
  const base = CONF?.filename || "measurements";
  const filename = `${base}.${ext}`;

  switch (format) {
    case CONST.EXPORT_FORMAT.GEOJSON:
      content = toGeoJSON(measurements);
      break;
    case CONST.EXPORT_FORMAT.CSV:
      content = toCSV(measurements);
      break;
    default:
      content = toGeoJSON(measurements);
  }

  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
};

/**
 * Determine the default format from CONF.
 */
const getDefaultFormat = (): ExportFormat => {
  const fmt = CONF?.export_format;
  if (fmt === CONST.EXPORT_FORMAT.GEOJSON || fmt === CONST.EXPORT_FORMAT.CSV) {
    return fmt;
  }
  return CONST.EXPORT_FORMAT.GEOJSON;
};

export {
  toGeoJSON,
  toCSV,
  csvEscape,
  getNameForType,
  exportMeasurements,
  getDefaultFormat,
  getBasePoint,
  formatToExtension,
  formatToMimeType,
};
