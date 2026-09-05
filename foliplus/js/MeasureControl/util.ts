// MeasureControl utility functions — standalone, no manager dependency.
import { toWgs84 } from "#common/coord.js";
import { toggleDelIcon } from "#common/delicon.js";
import { buildPopupHtml, dom } from "#common/dom.js";
import { area, bearing, centroid, distance, midpoint } from "#common/geo.js";
import { createScopedTranslator } from "#common/locale.js";
import * as CONST from "./const.js";

// Edit-specific helpers (buildEditOverlay, bindNodeDrag, drag-synthetic click
// flag) live in edit.ts. Callers import them directly from there.

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

/** Resolve the label chip inside a marker's icon element, or null when the
 *  marker has no rendered element. Callers that read the chip must go through
 *  this rather than caching a reference — a setIcon during a drag replaces
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

/** A non-interactive node used for transient previews (center, centroid). */
const makePreviewNode = (
  latlng: L.LatLng,
  className: string = CONST.CLASSES.NODE_HOLLOW,
): L.CircleMarker => {
  return L.circleMarker(latlng, {
    radius: CONST.MARKER.RADIUS,
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

// ── Live coordinate readout ─────────────────────────────────────────
/** One coordinate formatted to the persisted precision. Rendering the full
 *  fixed-decimal string avoids "-0.000000" on a west/south of equator point,
 *  and keeps the chip from shifting width as the cursor moves. */
const formatCoord = (n: number): string => {
  const v = parseFloat(n.toFixed(CONST.FORMAT.LAT_LNG_PRECISION));
  return (v === 0 ? 0 : v).toFixed(CONST.FORMAT.LAT_LNG_PRECISION);
};

/** Format an lng/lat pair as the readout string. Longitude leads, matching
 *  `buildPopupHtml` and every other location display in the project. */
const formatLatLng = (lng: number, lat: number): string =>
  `${formatCoord(lng)}, ${formatCoord(lat)}`;

/** A point in the map's display CRS that should be read out. Accepts
 *  both Leaflet's `lat/lng` shape and Leaflet's plain-object `latitude/longitude`
 *  alias so callers can pass either without wrapping. */
type DisplayLatLng =
  L.LatLng | { lat: number; lng: number } | { latitude: number; longitude: number };

/** Collapse the two Leaflet coordinate shapes into a plain lat/lng pair. */
const readLatLng = (pt: DisplayLatLng): [number, number] => {
  const raw = pt as {
    lat?: number;
    lng?: number;
    latitude?: number;
    longitude?: number;
  };
  const lat = raw.lat ?? raw.latitude;
  const lng = raw.lng ?? raw.longitude;
  if (lat === undefined || lng === undefined) {
    throw new TypeError("[foliplus] MeasureControl: point has no lat/lng");
  }
  return [lat, lng];
};

/** Format `pt` (display CRS) as a WGS84 readout string. Conversion happens here
 *  so callers never have to remember it — every entry point that accepts a map
 *  coordinate goes through this one function. */
const coordText = (map: L.Map, pt: DisplayLatLng): string => {
  const [lat, lng] = readLatLng(pt);
  const [wlng, wlat] = toWgs84(map, lng, lat);
  return formatLatLng(wlng, wlat);
};

/** Build the persistent readout element, appended to the map container. */
const buildCoordReadout = (map: L.Map): HTMLElement => {
  const el = dom.el("div", {
    class: CONST.LABEL.CLASS_READOUT,
    parent: map.getContainer(),
    role: "status",
    "aria-live": "off",
    hidden: true,
  });
  el.append(
    dom.el("span", { class: CONST.LABEL.CLASS_LABEL, textContent: T("readout_label") }),
    dom.el("span", { class: CONST.LABEL.CLASS_COORD, textContent: "" }),
  );
  return el;
};

/** Update the readout chip, showing it if needed. Returning the text lets
 *  callers assert on it. Visibility lives here so no caller can forget to make
 *  the element appear — hidden-at-start is required because nothing shows until
 *  a measurement exists. */
const setCoordReadout = (el: HTMLElement | null, text: string): string => {
  if (!el) return text;
  el.hidden = false;
  el.querySelector(CONST.SEL.COORD_LABEL)?.replaceChildren(text);
  return text;
};

/** Hide the readout. Separate from `setCoordReadout`, which shows on write. */
const setCoordReadoutHidden = (el: HTMLElement | null) => {
  if (el) el.hidden = true;
};

/** Normalize the Leaflet mouse event target to a plain HTMLElement or null. */
const getEventTarget = (event: L.LeafletMouseEvent): HTMLElement | null =>
  ((event.originalEvent as MouseEvent)?.target as HTMLElement | null) ?? null;

export {
  animateDashSweep,
  area,
  bearing,
  buildCoordReadout,
  buildPopup,
  centroid,
  coordText,
  distance,
  formatArea,
  formatCoord,
  formatDistance,
  formatLatLng,
  formatSegmentLabel,
  labelChipOf,
  getEventTarget,
  geocodeAddress,
  makeLabelDivIcon,
  makeMidLabelDivIcon,
  makeNode,
  makePreviewNode,
  midpoint,
  pointsToLatLngs,
  recalculateSegments,
  roundCoord,
  setLabelText,
  setCoordReadout,
  setCoordReadoutHidden,
};
