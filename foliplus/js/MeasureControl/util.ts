// MeasureControl utility functions �?no manager instance, only the control's
// config/translator where a label or popup string is i18n-driven.
import { area, bearing, centroid, distance, midpoint } from "#core/geo/index.js";
import { reverseGeocode } from "#core/geocode/index.js";
import type { ControlEnv } from "#core/type.js";
import { cssVar } from "#common/cssvar.js";
import { buildPopupEl } from "#common/dom.js";
import {
  LAT_LNG_PRECISION,
  NUMBER_FORMAT,
  formatLatLng,
  formatNumber,
} from "#common/format.js";
import type { Logger } from "#common/type.js";
import * as CONST from "./const.js";

// Edit-specific helpers (buildEditOverlay, bindNodeDrag, drag-synthetic click
// flag) live in edit.ts. Callers import them directly from there.

/** Format meters to human-readable string: "999 m" under the km threshold,
 *  then "1.0 km", "1,234.5 km" �?km values keep one decimal with grouping. */
const formatDistance = (meters: number): string =>
  meters >= CONST.FORMAT.KM_THRESHOLD
    ? `${formatNumber(meters / 1000, NUMBER_FORMAT.COMMA, "en", CONST.FORMAT.KM_DECIMALS)} km`
    : `${formatNumber(meters, NUMBER_FORMAT.COMMA, "en", CONST.FORMAT.SMALL_DECIMALS)} m`;

/** Format a segment label: "45° | 1.2 km", or just "1.2 km" when show_bearing is off. */
const formatSegmentLabel = (
  ctx: ControlEnv,
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
  meters: number,
): string => {
  const dist = formatDistance(meters);
  if (!ctx.config.show_bearing) return dist;
  const bVal = Math.round(bearing(a, b));
  return `${bVal}° | ${dist}`;
};

/** Format area: "999,999 m²" below a km², then "1.23 km²", "1,234.57 km²". */
const formatArea = (sqMeters: number): string => {
  if (sqMeters >= 1_000_000) {
    return `${formatNumber(sqMeters / 1_000_000, NUMBER_FORMAT.COMMA, "en", CONST.FORMAT.KM2_DECIMALS)} km²`;
  }
  return `${formatNumber(sqMeters, NUMBER_FORMAT.COMMA, "en", CONST.FORMAT.SMALL_DECIMALS)} m²`;
};

/** Resolve the label chip inside a marker's icon element, or null when the
 *  marker has no rendered element. Callers that read the chip must go through
 *  this rather than caching a reference �?a setIcon during a drag replaces
 *  the element. */
const labelChipOf = (marker: L.Layer): HTMLElement | null => {
  const el = (marker as L.Marker).getElement();
  return el ? (el.querySelector(CONST.SEL.LABEL) ?? null) : null;
};

/** Update a label marker's text content. Always gets fresh DOM reference. */
const setLabelText = (marker: L.Layer, text: string) => {
  const labelEl = labelChipOf(marker);
  if (labelEl) labelEl.textContent = text;
};

/** Build the popup body for a marker location. Returns an element, so a
 *  reverse-geocoded address can only ever reach the DOM as a TextNode. */
const buildPopup = (
  ctx: ControlEnv,
  lng: number,
  lat: number,
  addr: string | null = null,
): HTMLElement => {
  return buildPopupEl(
    lng,
    lat,
    addr,
    ctx.T("popup_title"),
    ctx.T("popup_loading"),
    ctx.T("popup_loc_label"),
    ctx.T("popup_addr_label"),
  );
};

/** Create a divIcon for a label marker. */
const makeLabelDivIcon = (
  html: string,
  iconAnchor?: [number, number],
  className?: string,
): L.DivIcon => {
  return L.divIcon({
    className: "",
    html:
      `<div class="${CONST.LABEL.CLASS}${className ? " " + className : ""}" ` +
      `data-foliplus-export="label">${html}</div>`,
    iconSize: CONST.LABEL.SIZE as [number, number],
    iconAnchor: (iconAnchor || CONST.LABEL.DEFAULT_ANCHOR) as [number, number],
  });
};

/** Create a divIcon for a segment label centered on the line midpoint. */
const makeMidLabelDivIcon = (html: string): L.DivIcon => {
  return makeLabelDivIcon(
    html,
    CONST.LABEL.MID_ANCHOR as [number, number],
    CONST.LABEL.CLASS_MID,
  );
};

/** SVG radius for a `.foliplus-dot` node: `(--foliplus-dot-size - --foliplus-dot-stroke) / 2`.
 *  The tokens in token.css are the only definition; this just derives the
 *  circleMarker radius so both renderings share the same outer edge.
 *  Cached after the first successful read �?`moveCursorNode` rebuilds a
 *  preview marker every mousemove frame, so the two `getComputedStyle` reads
 *  must not run per frame. `resetNodeRadiusCache()` invalidates for tests. */
let nodeRadiusCache: number | undefined;
const nodeRadius = (): number => {
  if (nodeRadiusCache !== undefined) return nodeRadiusCache;
  const size = parseFloat(cssVar(document.documentElement, "--foliplus-dot-size", ""));
  const stroke = parseFloat(
    cssVar(document.documentElement, "--foliplus-dot-stroke", ""),
  );
  if (!Number.isFinite(size) || !Number.isFinite(stroke) || size <= stroke) {
    throw new Error("foliplus: --foliplus-dot-size / --foliplus-dot-stroke unreadable");
  }
  nodeRadiusCache = (size - stroke) / 2;
  return nodeRadiusCache;
};
const resetNodeRadiusCache = (): void => {
  nodeRadiusCache = undefined;
};

/** Create a measure node circle marker. */
const makeNode = (
  latlng: L.LatLng,
  className: string = CONST.CLASSES.NODE_HOLLOW,
): L.CircleMarker => {
  return L.circleMarker(latlng, { radius: nodeRadius(), className });
};

/** A non-interactive node used for transient previews (center, centroid and
 *  the live cursor dot while a shape is being drawn). */
const makePreviewNode = (
  latlng: L.LatLng,
  className: string = CONST.CLASSES.NODE_HOLLOW,
): L.CircleMarker => {
  return L.circleMarker(latlng, {
    radius: nodeRadius(),
    className,
    interactive: false,
  });
};

/** Animate a dash-sweep effect on a finalized polyline/polygon. */
const animateDashSweep = (path: SVGElement | null) => {
  if (!path) return;
  const len = (path as SVGPathElement).getTotalLength?.() || 0;
  if (len <= 0) return;
  path.style.setProperty(CONST.STYLE.SWEEP_LENGTH, String(len));
  path.classList.add(CONST.CLASSES.DASH_SWEEP);
  const onEnd = () => {
    path.removeEventListener("animationend", onEnd);
    path.classList.remove(CONST.CLASSES.DASH_SWEEP);
    path.style.removeProperty(CONST.STYLE.SWEEP_LENGTH);
  };
  path.addEventListener("animationend", onEnd);
};

/**
 * Resolve the reverse geocode address for a coordinate, returning the previous
 * address unchanged if the lookup fails so a drag never erases a good address.
 */
const geocodeAddress = async (
  manager: { map: L.Map },
  lng: number,
  lat: number,
  code: string,
  previous: string | null,
): Promise<string | null> => {
  try {
    return (await reverseGeocode(manager.map, lng, lat, code)) ?? previous;
  } catch {
    return previous;
  }
};

/** A single segment with distance and initial bearing (degrees, 0-360). */
interface Segment {
  lng: number;
  lat: number;
  distance: number;
  bearing: number;
}

/** Recalculate segments and total distance from a points array. */
const recalculateSegments = (
  points: L.LatLng[],
): { segments: Segment[]; totalDistance: number } => {
  const segments: Segment[] = [];
  let totalDistance = 0;
  for (let i = 1; i < points.length; i++) {
    const d = distance(points[i - 1], points[i]);
    const b = bearing(points[i - 1], points[i]);
    segments.push({ lng: points[i].lng, lat: points[i].lat, distance: d, bearing: b });
    totalDistance += d;
  }
  return { segments, totalDistance };
};

/** Convert persisted {lng,lat} points to Leaflet LatLng array. */
const pointsToLatLngs = (points: Array<{ lng: number; lat: number }>): L.LatLng[] =>
  points.map(p => L.latLng(p.lat, p.lng));

/** Round a coordinate to the persisted precision, so a dragged pin displays
 *  identically to a freshly placed one (which is rounded on placement). */
const roundCoord = (n: number): number => parseFloat(n.toFixed(LAT_LNG_PRECISION));

// ── Live coordinate readout ─────────────────────────────────────────

/** A point in the map's display CRS. Accepts both Leaflet's `lat/lng` shape and
 *  the plain-object `latitude/longitude` alias, so callers can pass either. */
type DisplayLatLng =
  L.LatLng | { lng: number; lat: number } | { longitude: number; latitude: number };

/** Collapse the two Leaflet coordinate shapes into a plain lng/lat pair.
 *  Longitude leads, matching `formatLatLng` and every other
 *  location display in the project. */
const readLatLng = (pt: DisplayLatLng, logger: Logger): [number, number] => {
  const raw = pt as {
    lng?: number;
    lat?: number;
    longitude?: number;
    latitude?: number;
  };
  const lng = raw.lng ?? raw.longitude;
  const lat = raw.lat ?? raw.latitude;
  if (lng === undefined || lat === undefined) {
    throw new TypeError(logger.msg("point has no lng/lat"));
  }
  return [lng, lat];
};

/** Format the pointer's coordinate as the readout string. No CRS conversion: the
 *  map is already in whatever CRS its tiles serve, so what the operator is looking
 *  at is what the readout reports �?pointing the chip at the same spot on a
 *  GCJ02 or BD09 map must not show a shifted number. */
const coordText = (map: L.Map, pt: DisplayLatLng, logger: Logger): string => {
  const [lng, lat] = readLatLng(pt, logger);
  return formatLatLng(lng, lat);
};

/** Normalize the Leaflet mouse event target to a plain HTMLElement or null. */
const getEventTarget = (event: L.LeafletMouseEvent): HTMLElement | null =>
  ((event.originalEvent as MouseEvent)?.target as HTMLElement | null) ?? null;

export {
  animateDashSweep,
  area,
  bearing,
  buildPopup,
  centroid,
  coordText,
  distance,
  formatArea,
  formatDistance,
  formatSegmentLabel,
  labelChipOf,
  midpoint,
  nodeRadius,
  pointsToLatLngs,
  recalculateSegments,
  readLatLng,
  resetNodeRadiusCache,
  roundCoord,
  setLabelText,
  getEventTarget,
  geocodeAddress,
  makeLabelDivIcon,
  makeMidLabelDivIcon,
  makeNode,
  makePreviewNode,
};
