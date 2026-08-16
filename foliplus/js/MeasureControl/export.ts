// MeasureControl export module — convert measurements to GeoJSON, CSV, and KML.
import type { MeasureData } from "#type/global.js";
import type { ExportFormat } from "./const.js";
import * as CONST from "./const.js";

// CONF is a free variable from the IIFE template wrapper.
declare const CONF: { name: string; export_format: ExportFormat };

/** GeoJSON feature property shared across all geometry types. */
interface MeasureProperties {
  id?: string;
  type: string;
  name?: string;
}

/**
 * Convert a single measurement to a GeoJSON feature.
 */
function toGeoFeature(data: MeasureData): GeoJSON.Feature {
  const base: MeasureProperties = {
    type: data.type,
    id: data.id,
  };

  switch (data.type) {
    case CONST.MODE.MARKER:
      base.name = data.address || "Location Marker";
      return {
        type: "Feature",
        properties: base,
        geometry: {
          type: "Point",
          coordinates: [data.lng || 0, data.lat || 0],
        },
      };

    case CONST.MODE.DISTANCE: {
      base.name = "Distance Measurement";
      const coords = (data.points || []).map(p => [p.lng, p.lat]);
      return {
        type: "Feature",
        properties: {
          ...base,
          totalDistance: data.totalDistance || 0,
          segments: (data.segments || []).map(s => ({
            start: [s.lng, s.lat],
            distance: s.distance,
          })),
        },
        geometry: {
          type: "LineString",
          coordinates: coords,
        },
      };
    }

    case CONST.MODE.POLYGON: {
      base.name = "Area Measurement";
      const coords = (data.points || []).map(p => [p.lng, p.lat]);
      // GeoJSON requires closed rings (first === last)
      if (coords.length > 1) coords.push(coords[0]);
      return {
        type: "Feature",
        properties: {
          ...base,
          area: data.area || 0,
          segments: (data.segments || []).map(s => ({
            start: [s.lng, s.lat],
            distance: s.distance,
          })),
        },
        geometry: {
          type: "Polygon",
          coordinates: [coords],
        },
      };
    }

    case CONST.MODE.CIRCLE: {
      base.name = "Circle";
      // Approximate circle as a polygon with 64 vertices
      const center = data.center;
      const target = data.target;
      const r = data.radius || 0;
      if (center && target && r > 0) {
        const points = circlePoints(center.lng, center.lat, r, 64);
        const coords = points.map(p => [p.lng, p.lat]);
        coords.push(coords[0]); // close
        return {
          type: "Feature",
          properties: {
            ...base,
            radius: r,
          },
          geometry: {
            type: "Polygon",
            coordinates: [coords],
          },
        };
      }
      // Fallback to center point
      return {
        type: "Feature",
        properties: {
          ...base,
          radius: r,
        },
        geometry: {
          type: "Point",
          coordinates: [center?.lng || 0, center?.lat || 0],
        },
      };
    }

    default:
      return {
        type: "Feature",
        properties: base,
        geometry: {
          type: "Point",
          coordinates: [data.lng || 0, data.lat || 0],
        },
      };
  }
}

/**
 * Approximate a circle on a sphere as N polygon points.
 * Uses simple equirectangular approximation; sufficient for small circles.
 * For large accuracy needs, turf.js circle would be better.
 */
function circlePoints(
  lon: number,
  lat: number,
  radiusMeters: number,
  n: number,
): Array<{ lng: number; lat: number }> {
  const R = 6371000; // Earth radius in meters
  const dlat = radiusMeters / R;
  const dlng = radiusMeters / (R * Math.cos((lat * Math.PI) / 180));
  const points: Array<{ lng: number; lat: number }> = [];
  for (let i = 0; i < n; i++) {
    const theta = (2 * Math.PI * i) / n;
    points.push({
      lng: lon + dlng * Math.cos(theta),
      lat: lat + dlat * Math.sin(theta),
    });
  }
  return points;
}

/**
 * Convert measurements array to a complete GeoJSON FeatureCollection.
 */
export function toGeoJSON(measurements: MeasureData[]): string {
  const features = measurements
    .filter(m => m.type)
    .map(m => toGeoFeature(m));

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
  coordinates: string;
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
    "coordinates",
  ];
  const rows: string[] = [headers.join(",")];

  for (const data of measurements) {
    if (!data.type) continue;

    const name = getNameForType(data);
    const coords = getCoordinatesForType(data);
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
      coordinates: coords.join(";"),
    };

    rows.push(headers.map(h => csvEscape(row[h as keyof CsvRow] || "")).join(","));
  }

  return rows.join("\n");
}

function getNameForType(data: MeasureData): string {
  if (data.type === CONST.MODE.MARKER) return data.address || "Location Marker";
  if (data.type === CONST.MODE.DISTANCE) return "Distance Measurement";
  if (data.type === CONST.MODE.POLYGON) return "Area Measurement";
  if (data.type === CONST.MODE.CIRCLE) return "Circle";
  return data.type;
}

function getLat(data: MeasureData): number | null {
  if (data.type === CONST.MODE.MARKER) return data.lat ?? null;
  if (data.type === CONST.MODE.DISTANCE && data.points && data.points.length > 0)
    return data.points[0].lat;
  if (data.type === CONST.MODE.POLYGON && data.points && data.points.length > 0)
    return data.points[0].lat;
  if (data.type === CONST.MODE.CIRCLE) return data.center?.lat ?? null;
  return null;
}

function getLng(data: MeasureData): number | null {
  if (data.type === CONST.MODE.MARKER) return data.lng ?? null;
  if (data.type === CONST.MODE.DISTANCE && data.points && data.points.length > 0)
    return data.points[0].lng;
  if (data.type === CONST.MODE.POLYGON && data.points && data.points.length > 0)
    return data.points[0].lng;
  if (data.type === CONST.MODE.CIRCLE) return data.center?.lng ?? null;
  return null;
}

function getCoordinatesForType(data: MeasureData): string[] {
  if (data.type === CONST.MODE.MARKER && data.lat != null && data.lng != null) {
    return [`[${data.lng},${data.lat}]`];
  }
  if ((data.type === CONST.MODE.DISTANCE || data.type === CONST.MODE.POLYGON) && data.points) {
    return data.points.map(p => `[${p.lng},${p.lat}]`);
  }
  if (data.type === CONST.MODE.CIRCLE && data.center) {
    return [`[${data.center.lng},${data.center.lat}]`];
  }
  return [];
}

/**
 * KML coordinate format: lng,lat[,alt]
 */
function kmlCoord(pt: { lng: number; lat: number }): string {
  return `${pt.lng} ${pt.lat}`;
}

/**
 * Convert measurements array to KML string.
 */
export function toKML(measurements: MeasureData[]): string {
  const placemarks: string[] = [];

  for (const data of measurements) {
    if (!data.type) continue;

    const name = getNameForType(data);
    let geometry: string = "";

    switch (data.type) {
      case CONST.MODE.MARKER:
        if (data.lat != null && data.lng != null) {
          geometry = `<Point><coordinates>${data.lng},${data.lat}</coordinates></Point>`;
        }
        break;

      case CONST.MODE.DISTANCE:
        if (data.points && data.points.length > 0) {
          const coords = data.points.map(p => kmlCoord(p)).join(" ");
          geometry = `<LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>`;
        }
        break;

      case CONST.MODE.POLYGON: {
        if (data.points && data.points.length > 2) {
          const pts = [...data.points, data.points[0]];
          const coords = pts.map(p => kmlCoord(p)).join(" ");
          geometry = `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
        }
        break;
      }

      case CONST.MODE.CIRCLE: {
        if (data.center && data.target && data.radius && data.radius > 0) {
          const pts = circlePoints(
            data.center.lng,
            data.center.lat,
            data.radius,
            64,
          );
          const coords = pts.map(p => kmlCoord(p)).join(" ");
          geometry = `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
        }
        break;
      }
    }

    const description: string[] = [];
    if (data.totalDistance) description.push(`Total distance: ${data.totalDistance} m`);
    if (data.area) description.push(`Area: ${data.area} m²`);
    if (data.radius) description.push(`Radius: ${data.radius} m`);
    if (data.address) description.push(`Address: ${data.address}`);
    const descText = description.join("\n");

    placemarks.push(`    <Placemark>
      <name>${name}</name>${descText ? `<description>${escXml(descText)}</description>` : ""}
      ${geometry}
    </Placemark>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Measurements</name>
${placemarks.join("\n")}
  </Document>
</kml>`;
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
    case CONST.EXPORT_FORMAT.KML:
      return "kml";
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
    case CONST.EXPORT_FORMAT.KML:
      return "application/vnd.google-earth.kml+xml";
    default:
      return "application/geo+json";
  }
}

/**
 * Generate the CSV header line as the first row.
 */
const CSV_HEADERS: string[] = [];

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
  const filename = `measurements_${new Date().toISOString().slice(0, 10)}.${ext}`;

  switch (format) {
    case CONST.EXPORT_FORMAT.GEOJSON:
      content = toGeoJSON(measurements);
      break;
    case CONST.EXPORT_FORMAT.CSV:
      content = toCSV(measurements);
      break;
    case CONST.EXPORT_FORMAT.KML:
      content = toKML(measurements);
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
  if (
    fmt === CONST.EXPORT_FORMAT.GEOJSON ||
    fmt === CONST.EXPORT_FORMAT.CSV ||
    fmt === CONST.EXPORT_FORMAT.KML
  ) {
    return fmt;
  }
  return CONST.EXPORT_FORMAT.GEOJSON;
}
