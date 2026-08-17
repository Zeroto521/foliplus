// MeasureControl export module — convert measurements to GeoJSON and CSV.
import type { ExportFormat } from "./const.js";
import * as CONST from "./const.js";
import { MODE_MAP } from "./mode/index.js";

// CONF is a free variable from the IIFE template wrapper.
declare const CONF: { name: string; filename: string; export_format: ExportFormat };

/** GeoJSON feature property shared across all geometry types. */
interface MeasureProperties {
  id?: string;
  type: string;
  name?: string;
}

/**
 * Convert a single measurement to a GeoJSON feature.
 */
export function toGeoJSON(measurements: MeasureData[]): string {
  const features = measurements
    .filter(m => m.type)
    .map(m => MODE_MAP[m.type as keyof typeof MODE_MAP]!.toGeoFeature(m));

  return JSON.stringify(
    {
      type: "FeatureCollection",
      features,
    },
    null,
    2,
  );
}

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
function csvEscape(value: string | number): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Convert measurements array to CSV string.
 */
export function toCSV(measurements: MeasureData[]): string {
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
}

function getNameForType(data: MeasureData): string {
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
}

function getLat(data: MeasureData): number | null {
  if (data.type === CONST.MODE.MARKER) {
    return data.lat ?? null;
  }
  if (data.type === CONST.MODE.DISTANCE && data.points && data.points.length > 0) {
    return data.points[0].lat;
  }
  if (data.type === CONST.MODE.POLYGON && data.points && data.points.length > 0) {
    return data.points[0].lat;
  }
  if (data.type === CONST.MODE.CIRCLE) {
    return data.center?.lat ?? null;
  }
  return null;
}

function getLng(data: MeasureData): number | null {
  if (data.type === CONST.MODE.MARKER) {
    return data.lng ?? null;
  }
  if (data.type === CONST.MODE.DISTANCE && data.points && data.points.length > 0) {
    return data.points[0].lng;
  }
  if (data.type === CONST.MODE.POLYGON && data.points && data.points.length > 0) {
    return data.points[0].lng;
  }
  if (data.type === CONST.MODE.CIRCLE) {
    return data.center?.lng ?? null;
  }
  return null;
}

function toWKT(data: MeasureData): string {
  const Feature = MODE_MAP[data.type as keyof typeof MODE_MAP];
  if (!Feature) {
    return "";
  }
  return featureToWKT(Feature.toGeoFeature(data));
}

/** Convert a GeoJSON Feature to a WKT string using turf.wkt. */
function featureToWKT(feature: GeoJSON.Feature): string {
  if (!feature.geometry) {
    return "";
  }
  return turf.wkt.toWKT(feature).replace("\n", "");
}

/**
 * Escape special XML characters.
 */
function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Map export format to filename extension.
 */
function formatToExtension(format: ExportFormat): string {
  switch (format) {
    case CONST.EXPORT_FORMAT.GEOJSON:
      return "geojson";
    case CONST.EXPORT_FORMAT.CSV:
      return "csv";
    default:
      return "geojson";
  }
}

/**
 * Map export format to MIME type.
 */
function formatToMimeType(format: ExportFormat): string {
  switch (format) {
    case CONST.EXPORT_FORMAT.GEOJSON:
      return "application/geo+json";
    case CONST.EXPORT_FORMAT.CSV:
      return "text/csv";
    default:
      return "application/geo+json";
  }
}

/**
 * Convert and download measurements.
 */
export function exportMeasurements(
  measurements: MeasureData[],
  format: ExportFormat,
): void {
  if (!measurements || measurements.length === 0) {
    return;
  }

  let content: string;
  const ext = formatToExtension(format);
  const mimeType = formatToMimeType(format);
  const base = CONF?.filename || "measurements";
  const filename = `${base}_${new Date().toISOString().slice(0, 10)}.${ext}`;

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

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Determine the default format from CONF.
 */
export function getDefaultFormat(): ExportFormat {
  const fmt = CONF?.export_format;
  if (fmt === CONST.EXPORT_FORMAT.GEOJSON || fmt === CONST.EXPORT_FORMAT.CSV) {
    return fmt;
  }
  return CONST.EXPORT_FORMAT.GEOJSON;
}
