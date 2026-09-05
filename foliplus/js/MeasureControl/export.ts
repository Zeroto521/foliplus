// MeasureControl export module — convert measurements to GeoJSON and CSV.
//
// Units of exported numeric fields:
//   - totalDistance, segments[].distance  -> meters (m)
//   - segments[].bearing                   -> degrees (0-360, clockwise from north)
//   - area                                 -> square meters (m²)
//   - radius                               -> meters (m)
//   - coordinates ([lng, lat])             -> longitude/latitude in degrees
// The measurement type label (properties.name / CSV name column) is i18n-
// translated via each mode's getNameLabel(), falling back to English.
import { HINT_DURATION } from "#core/hint.js";
import { createScopedTranslator } from "#common/locale.js";
import { download } from "../ExportControl/util.js";
import type { ExportFormat } from "./const.js";
import * as CONST from "./const.js";
import type { MeasureManager } from "./manager.js";
import { MODE_MAP, MeasureMode } from "./mode/index.js";

// CONF is a free variable from the IIFE template wrapper (see global.d.ts).
const T = createScopedTranslator(CONF);

/**
 * Convert a single measurement to a GeoJSON feature.
 */
/**
 * Serialize measurements as a GeoJSON FeatureCollection string.
 * Each feature carries the measurement id and type-specific fields in
 * properties (see each mode's toGeoFeature).
 */
const toGeoJSON = (measurements: MeasureData[]): string => {
  const features = measurements
    .map(m => MODE_MAP[m.type as keyof typeof MODE_MAP]?.toGeoFeature(m))
    .filter((f): f is GeoJSON.Feature => Boolean(f));

  const collection: {
    type: typeof CONST.GEOJSON.FEATURE_COLLECTION;
    features: GeoJSON.Feature[];
  } = { type: CONST.GEOJSON.FEATURE_COLLECTION, features };

  return JSON.stringify(collection, null, 2);
};

/**
 * CSV row type for flattened measurement data.
 */
interface CsvRow {
  id: string;
  type: string;
  name: string;
  center: string;
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
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
};

/**
 * Convert measurements array to CSV string.
 */
const toCSV = (measurements: MeasureData[]): string => {
  const headers = [
    "id",
    "type",
    "name",
    "center",
    "totalDistance",
    "area",
    "radius",
    "address",
    "wkt",
  ];
  const rows: string[] = [headers.join(",")];

  for (const data of measurements) {
    if (!data.type) continue;

    const row: CsvRow = {
      id: data.id || "",
      type: data.type,
      name: getNameForType(data),
      center: data.center
        ? `${data.center.lng.toFixed(6)},${data.center.lat.toFixed(6)}`
        : "",
      totalDistance: data.totalDistance !== undefined ? String(data.totalDistance) : "",
      area: data.area !== undefined ? String(data.area) : "",
      radius: data.radius !== undefined ? String(data.radius) : "",
      address: data.address || "",
      wkt: toWKT(data),
    };

    rows.push(headers.map(h => csvEscape(row[h as keyof CsvRow] || "")).join(","));
  }

  return rows.join("\n");
};

/**
 * Human-readable measurement-type label for a CSV row — delegates to the
 * mode's getNameLabel (i18n translation with English fallback), matching
 * GeoJSON properties.name.
 */
const getNameForType = (data: MeasureData): string => {
  const ModeClass = MODE_MAP[data.type as keyof typeof MODE_MAP];
  if (!ModeClass) return data.type;
  return ModeClass.getNameLabel();
};

/** Convert a single measurement to a WKT string (empty when unknown type). */
const toWKT = (data: MeasureData): string => {
  const ModeClass = MODE_MAP[data.type as keyof typeof MODE_MAP];
  if (!ModeClass) return "";
  return featureToWKT(ModeClass.toGeoFeature(data));
};

/**
 * Convert a GeoJSON Feature to a WKT string (Point/LineString/Polygon).
 * Implemented inline — @turf/turf-wkt CDN does not expose a UMD global,
 * and @turf/turf main bundle excludes wkt.
 */
const featureToWKT = (feature: GeoJSON.Feature): string => {
  const geom = feature.geometry;
  if (!geom) return "";
  switch (geom.type) {
    case CONST.GEOJSON.POINT: {
      const [lng, lat] = geom.coordinates as [number, number];
      return `POINT(${lng} ${lat})`;
    }
    case CONST.GEOJSON.LINE_STRING: {
      const pts = (geom.coordinates as number[][])
        .map(([lng, lat]) => `${lng} ${lat}`)
        .join(", ");
      return `LINESTRING(${pts})`;
    }
    case CONST.GEOJSON.POLYGON: {
      const rings = (geom.coordinates as number[][][])
        .map(ring => `(${ring.map(([lng, lat]) => `${lng} ${lat}`).join(", ")})`)
        .join(", ");
      return `POLYGON(${rings})`;
    }
    default:
      return "";
  }
};

/**
 * Per-format file metadata — single source of truth for extension + MIME type.
 */
const FORMAT_META: Record<ExportFormat, { ext: string; mime: string }> = {
  [CONST.EXPORT_FORMAT.GEOJSON]: { ext: "geojson", mime: "application/geo+json" },
  [CONST.EXPORT_FORMAT.CSV]: { ext: "csv", mime: "text/csv" },
};

const DEFAULT_FORMAT_META = FORMAT_META[CONST.EXPORT_FORMAT.GEOJSON];

/** Map export format to filename extension. */
const formatToExtension = (format: ExportFormat): string =>
  FORMAT_META[format]?.ext ?? DEFAULT_FORMAT_META.ext;

/** Map export format to MIME type. */
const formatToMimeType = (format: ExportFormat): string =>
  FORMAT_META[format]?.mime ?? DEFAULT_FORMAT_META.mime;

/** Convert measurements to a Blob and trigger a file download. */
const exportMeasurements = (
  measurements: MeasureData[],
  format: ExportFormat,
): void => {
  if (!measurements || measurements.length === 0) return;

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
      content = "\uFEFF" + toCSV(measurements);
      break;
    default:
      content = toGeoJSON(measurements);
  }

  download(new Blob([content], { type: mimeType }), filename);
};

/**
 * Click handler for the export toolbar button — orchestrates the export flow.
 * Kept in this module (alongside exportMeasurements) so index.ts stays thin.
 * @param mgr - MeasureManager instance.
 */
const handleExportClick = (mgr: MeasureManager) => (event: Event) => {
  event.stopPropagation();
  const measurements = mgr.store.all();
  if (!measurements || measurements.length === 0) {
    // foliplus is per-map — hint via the manager's map instance.
    mgr.map.foliplus?.showHint?.(CONF.name, T("export_no_data"), HINT_DURATION.LONG);
    return;
  }
  // Serialization + <a download> are pure local operations; failures here are
  // developer errors, not user-facing conditions — log instead of alerting.
  try {
    exportMeasurements(measurements, getDefaultFormat());
  } catch (err) {
    console.warn(`[${CONF.name}] export failed:`, err);
  }
};

/**
 * Determine the default format from CONF.
 */
const getDefaultFormat = (): ExportFormat => {
  const fmt = CONF?.export_format;
  if (fmt === CONST.EXPORT_FORMAT.GEOJSON || fmt === CONST.EXPORT_FORMAT.CSV)
    return fmt;

  return CONST.EXPORT_FORMAT.GEOJSON;
};

export {
  csvEscape,
  exportMeasurements,
  formatToExtension,
  formatToMimeType,
  getDefaultFormat,
  getNameForType,
  handleExportClick,
  toCSV,
  toGeoJSON,
};
