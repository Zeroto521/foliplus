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
import { download } from "#common/download.js";
import { createScopedTranslator } from "#common/locale.js";
import type { ExportFormat } from "./const.js";
import * as CONST from "./const.js";
import type { MeasureManager } from "./manager.js";
import { MODE_MAP, MeasureMode } from "./mode/index.js";

// CONF is a free variable from the IIFE template wrapper (see global.d.ts).
const T = createScopedTranslator(CONF);

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

// ============================================================================
// Export formats — single source for everything format-specific.
//
// Unlike ExportControl's FORMAT table (mime/ext/lossy/geotiff — canvas codec
// semantics), measure export is pure string serialization: no toBlob, both
// formats are lossless, and there is no second download route. The axis here
// is *field layout*, not encoding — GeoJSON nests type-specific fields in
// `properties`, CSV flattens a fixed column set. So the table carries a
// `serialize` hook instead of codec flags.
//
// The table lives here rather than in const.ts because it references the
// serializers above; const.ts is evaluated first by the runtime scan, so a
// cross-import would be circular. Add a format by adding one row.
// ============================================================================

/** Per-format descriptor. */
interface ExportFormatSpec {
  /** File extension (no dot). */
  ext: string;
  /** Blob MIME type. */
  mime: string;
  /** Serialize measurements to the wire format. The caller wraps the result in
   *  a Blob with `mime`, so no encoding happens here. */
  serialize: (measurements: MeasureData[]) => string;
}

/** UTF-8 BOM — Excel needs it to detect UTF-8, or the i18n type labels come
 * back as mojibake. Written as an escape so it is visible in the source. */
const CSV_BOM = "﻿";

const EXPORT_FORMAT_META: Record<ExportFormat, ExportFormatSpec> = {
  [CONST.EXPORT_FORMAT.GEOJSON]: {
    ext: "geojson",
    mime: "application/geo+json",
    serialize: toGeoJSON,
  },
  [CONST.EXPORT_FORMAT.CSV]: {
    ext: "csv",
    mime: "text/csv",
    // BOM so Excel detects UTF-8; the serialized body itself is unchanged.
    serialize: measurements => CSV_BOM + toCSV(measurements),
  },
};

/** Resolve a runtime `CONF.export_format` to a table key. Python's
 * `MeasureControl` rejects anything outside `EXPORT_FORMAT`, so this only
 * guards misconfiguration. */
const resolveExportFormat = (raw: unknown): ExportFormat =>
  typeof raw === "string" &&
  Object.prototype.hasOwnProperty.call(EXPORT_FORMAT_META, raw)
    ? (raw as ExportFormat)
    : CONST.DEFAULT_EXPORT_FORMAT;

/** The record for `CONF.export_format` — no cast, no fallback lookup. */
const currentExportFormat = (): ExportFormatSpec =>
  EXPORT_FORMAT_META[resolveExportFormat(CONF.export_format)];

/** Filename the export writes to — shared with the success hint so
 * the two cannot drift. */
const exportFilename = (format: ExportFormat): string =>
  `${CONF?.filename || "measurements"}.${EXPORT_FORMAT_META[format].ext}`;

/**
 * Convert measurements to a Blob and trigger a file download.
 * `format` must already be resolved — callers go through
 * `resolveExportFormat` / `currentExportFormat`.
 */
const exportMeasurements = (
  measurements: MeasureData[],
  format: ExportFormat,
): void => {
  if (!measurements || measurements.length === 0) return;

  const meta = EXPORT_FORMAT_META[format];
  const base = CONF?.filename || "measurements";

  download(
    new Blob([meta.serialize(measurements)], { type: meta.mime }),
    `${base}.${meta.ext}`,
  );
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
  // Serialization and the download anchor are pure local operations, so a
  // failure is a developer error rather than a user error — but it is
  // still reported to the user, since the file was not saved.
  const format = resolveExportFormat(CONF.export_format);
  try {
    exportMeasurements(measurements, format);
  } catch (err) {
    console.warn(`[${CONF.name}] export failed:`, err);

    mgr.map.foliplus?.showHint?.(
      CONF.name,
      T("export_fail") + T("err_export"),
      HINT_DURATION.LONG,
    );
    return;
  }

  // Reported only after the download call returns: a throwing export never
  // wrote the file, so success is not claimed on that path.
  mgr.map.foliplus?.showHint?.(
    CONF.name,
    T("export_success") +
      T("export_file")
        .replace("{n}", String(measurements.length))
        .replace("{f}", exportFilename(format)),
    HINT_DURATION.LONG,
  );
};

export {
  csvEscape,
  currentExportFormat,
  exportMeasurements,
  getNameForType,
  handleExportClick,
  resolveExportFormat,
  toCSV,
  toGeoJSON,
};
