// MeasureControl utility functions — standalone, no manager dependency.
import { toggleDelIcon } from "#common/delicon.js";
import { buildPopupHtml } from "#common/dom.js";
import { area, bearing, centroid, distance, midpoint } from "#common/geo.js";
import { createScopedTranslator } from "#common/locale.js";
import * as CONST from "./const.js";

export {
  bindNodeDrag,
  buildEditOverlay,
  isDragSyntheticClick,
  markDragSyntheticClick,
} from "./edit.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const T = createScopedTranslator(CONF);

/** Format meters to human-readable string (e.g. "1.2 km", "500 m"). */
const formatDistance = (meters: number): string => {
  return meters >= CONST.FORMAT.KM_THRESHOLD
    ? `${(meters / 1000).toFixed(CONST.FORMAT.KM_DECIMALS)} km`
    : `${Math.round(meters)} m`;
};

/** Format a segment label: "45° | 1.2 km", or just "1.2 km" when show_bearing is off. */
const formatSegmentLabel = (
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
  meters: number,
): string => {
  const dist = formatDistance(meters);
  if (!CONF.show_bearing) return dist;
  const bVal = Math.round(bearing(a, b));
  return `${bVal}° | ${dist}`;
};

/** Format area: "1,234 m²" or "1.23 km²". */
const formatArea = (sqMeters: number): string => {
  if (sqMeters >= 1_000_000) return `${(sqMeters / 1_000_000).toFixed(2)} km²`;
  return `${Math.round(sqMeters).toLocaleString()} m²`;
};

// Edit-specific helpers (buildEditOverlay, bindNodeDrag, drag-synthetic click
// flag) live in edit.ts. They are re-exported below for backward compatibility
// so all existing callers (ui.ts, mode/marker.ts, util.test.ts) keep working
// through the Util namespace without a follow-up rename.

/** Update a label marker's text content. Always gets fresh DOM reference. */
const setLabelText = (marker: L.Layer, text: string) => {
  const el = (marker as L.Marker).getElement();
  if (!el) return;
  const labelEl = el.querySelector(CONST.SEL.LABEL);
  if (labelEl) labelEl.textContent = text;
};

/** Build popup HTML for a marker location. */
const buildPopup = (lng: number, lat: number, addr: string | null = null): string => {
  return buildPopupHtml(
    lng,
    lat,
    addr,
    T("popup_title"),
    T("popup_loading"),
    T("popup_loc_label"),
    T("popup_addr_label"),
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

/** Create a measure node circle marker. */
const makeNode = (
  latlng: L.LatLng,
  className: string = CONST.CLASSES.NODE_HOLLOW,
): L.CircleMarker => {
  return L.circleMarker(latlng, { radius: CONST.MARKER.RADIUS, className });
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
  const foliplus = window.foliplus;
  if (!foliplus?.reverseGeocode) return previous;
  try {
    return (await foliplus.reverseGeocode(manager.map, lng, lat, code)) ?? previous;
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
const roundCoord = (n: number): number =>
  parseFloat(n.toFixed(CONST.FORMAT.LAT_LNG_PRECISION));

/** Normalize the Leaflet mouse event target to a plain HTMLElement or null. */
const getEventTarget = (event: L.LeafletMouseEvent): HTMLElement | null =>
  ((event.originalEvent as MouseEvent)?.target as HTMLElement | null) ?? null;

export {
  animateDashSweep,
  area,
  bearing,
  buildPopup,
  centroid,
  distance,
  formatArea,
  formatDistance,
  formatSegmentLabel,
  getEventTarget,
  geocodeAddress,
  makeLabelDivIcon,
  makeMidLabelDivIcon,
  makeNode,
  midpoint,
  pointsToLatLngs,
  recalculateSegments,
  roundCoord,
  setLabelText,
};
