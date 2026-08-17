// MeasureControl utility functions — standalone, no manager dependency.
import { hideDelIcons, toggleDelIcon } from "#common/delicon.js";
import { buildPopupHtml } from "#common/dom.js";
import { area, bearing, centroid, distance, midpoint } from "#common/geo.js";
import { createTranslator } from "#common/locale.js";
import * as CONST from "./const.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const _ = createTranslator(CONF);

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

/** Toggle CSS hidden class on a list of DOM elements. */
const toggleVisibility = (elements: (HTMLElement | null)[], visible: boolean) => {
  elements.forEach(el => {
    if (el) el.classList.toggle(CONST.CLASSES.HIDDEN, !visible);
  });
};

/** Temporarily suppress map click hide of delete icons. */
const suppressHide = (manager: { isSuppressHideDel: boolean }) => {
  manager.isSuppressHideDel = true;
  setTimeout(() => {
    manager.isSuppressHideDel = false;
  }, CONST.TIMING.SUPPRESS_HIDE_DELAY);
  hideDelIcons();
};

/** Calculate next toggle state for X icons and labels. */
const nextToggleState = (
  curX: boolean,
  curLabels: boolean,
  showX: boolean | undefined,
  toggleLbl: boolean | string | undefined,
): { isXVisible: boolean; isLabelsVisible: boolean } => {
  const newX = showX !== undefined ? showX : !curX;
  let newLabel = curLabels;
  if (toggleLbl === true) newLabel = !curLabels;
  else if (toggleLbl === false) newLabel = false;
  else if (toggleLbl === CONST.TOGGLE.RESET) newLabel = true;
  return { isXVisible: newX, isLabelsVisible: newLabel };
};

/** Apply toggle visibility state to del icon, labels, and optional extra label. */
const applyVisibilityToggle = (
  delMarker: L.Layer | undefined,
  isXVisible: boolean,
  labels: L.Layer[],
  isLabelsVisible: boolean,
  extraLbl?: L.Layer,
  onToggle?: (xVisible: boolean, lblVisible: boolean) => void,
) => {
  const applyDelIcon = (marker: L.Layer | undefined, show: boolean) => {
    if (!marker) return;
    toggleDelIcon(marker as L.Marker, show);
  };

  applyDelIcon(delMarker, isXVisible);
  labels.forEach(m => {
    const el = (m as L.Marker).getElement();
    if (el) {
      const label = el.querySelector(CONST.SEL.LABEL);
      if (label) label.classList.toggle(CONST.CLASSES.HIDDEN, !isLabelsVisible);
    }
  });

  if (extraLbl) {
    const sEl = (extraLbl as L.Marker).getElement();
    if (sEl) {
      const sL = sEl.querySelector(CONST.SEL.LABEL);
      if (sL) sL.classList.toggle(CONST.CLASSES.HIDDEN, !isLabelsVisible);
    }
  }

  if (onToggle) onToggle(isXVisible, isLabelsVisible);
};

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
    _(`${CONF.name}.popup_title`),
    _(`${CONF.name}.popup_loading`),
    _(`${CONF.name}.popup_loc_label`),
    _(`${CONF.name}.popup_addr_label`),
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
    html: html: `<div class="${CONST.LABEL.CLASS}${className ? " " + className : ""}" 

data-foliplus-export="label">${html}</div>`,
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

/** A single segment with distance. */
interface Segment {
  lng: number;
  lat: number;
  distance: number;
}

/** Recalculate segments and total distance from a points array. */
const recalculateSegments = (
  points: L.LatLng[],
): { segments: Segment[]; totalDistance: number } => {
  const segments: Segment[] = [];
  let totalDistance = 0;
  for (let i = 1; i < points.length; i++) {
    const d = distance(points[i - 1], points[i]);
    segments.push({ lng: points[i].lng, lat: points[i].lat, distance: d });
    totalDistance += d;
  }
  return { segments, totalDistance };
};

/** Calculate area from a closed polygon ring. */
const calcArea = (points: L.LatLng[]): number => {
  if (points.length < 3) return 0;
  const pts: { lng: number; lat: number }[] = points.map(p => ({
    lng: p.lng,
    lat: p.lat,
  }));
  return area(pts);
};

/** Calculate centroid of a closed polygon ring. */
const calcCentroid = (points: L.LatLng[]): { lng: number; lat: number } => {
  if (points.length < 3) return { lng: 0, lat: 0 };
  const pts: { lng: number; lat: number }[] = points.map(p => ({
    lng: p.lng,
    lat: p.lat,
  }));
  const c = centroid(pts);
  return { lng: c.lng, lat: c.lat };
};

/** Calculate midpoint between two coordinates. */
const calcMidpoint = (
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): { lng: number; lat: number } => {
  const pt = midpoint(a, b);
  return { lng: pt.lng, lat: pt.lat };
};

export {
  animateDashSweep,
  applyVisibilityToggle,
  area,
  buildPopup,
  calcArea,
  calcCentroid,
  calcMidpoint,
  nextToggleState,
  centroid,
  distance,
  formatArea,
  formatDistance,
  formatSegmentLabel,
  makeLabelDivIcon,
  makeMidLabelDivIcon,
  makeNode,
  midpoint,
  recalculateSegments,
  setLabelText,
  suppressHide,
  toggleVisibility,
};
