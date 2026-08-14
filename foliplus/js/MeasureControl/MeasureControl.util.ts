// MeasureControl utility functions — standalone, no manager dependency.
import { buildPopupHtml, stopEvent } from "#common/dom.js";
import { area, bearing, centroid, distance, midpoint } from "#common/geo.js";
import { createTranslator } from "#common/locale.js";
import * as CONST from "./MeasureControl.const.js";

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

/** Hide all visible delete icons on the page. */
const hideDelIcons = () => {
  document
    .querySelectorAll(`${CONST.SEL.DEL_ICON}.${CONST.CLASSES.VISIBLE}`)
    .forEach(el => el.classList.remove(CONST.CLASSES.VISIBLE));
};

/** Calculate next toggle state for X icons and labels. */
const calcToggle = (
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
const applyToggle = (
  delMarker: L.Layer | undefined,
  isXVisible: boolean,
  labels: L.Layer[],
  isLabelsVisible: boolean,
  extraLbl?: L.Layer,
  onToggle?: (xVisible: boolean, lblVisible: boolean) => void,
) => {
  const applyDelIcon = (marker: L.Layer | undefined, show: boolean, retries = 0) => {
    if (!marker) return;
    toggleDelIcon(marker as L.Marker, show, retries);
  };

  applyDelIcon(delMarker, isXVisible);
  labels.forEach(m => {
    const el = (m as any).getElement();
    if (el) {
      const label = el.querySelector(CONST.SEL.LABEL);
      if (label) label.classList.toggle(CONST.CLASSES.HIDDEN, !isLabelsVisible);
    }
  });

  if (extraLbl) {
    const sEl = (extraLbl as any).getElement();
    if (sEl) {
      const sL = sEl.querySelector(CONST.SEL.LABEL);
      if (sL) sL.classList.toggle(CONST.CLASSES.HIDDEN, !isLabelsVisible);
    }
  }

  if (onToggle) onToggle(isXVisible, isLabelsVisible);
};

/** Toggle a delete icon's visibility with retry. */
const toggleDelIcon = (marker: L.Layer, show: boolean, retries = 0) => {
  if (!marker) return;
  const el = (marker as any).getElement();
  if (el) {
    const icon = el.querySelector(CONST.SEL.DEL_ICON);
    if (icon) icon.classList.toggle(CONST.CLASSES.VISIBLE, show);
  } else if (retries < CONST.DEL_ICON.RETRY_LIMIT) {
    setTimeout(
      () => toggleDelIcon(marker, show, retries + 1),
      CONST.TIMING.DEL_ICON_RETRY_DELAY,
    );
  }
};

/** Attach a click handler to a delete icon marker via Leaflet event (survives DOM rebuild). */
const attachDelClick = (delMarker: L.Layer, callback: () => void) => {
  delMarker.on("click", (event: L.LeafletMouseEvent) => {
    const t = (event.originalEvent as MouseEvent)?.target as HTMLElement | null;
    if (t?.classList?.contains(CONST.DEL_ICON.CLASS)) {
      stopEvent(event);
      callback();
    }
  });
};

/** Update a label marker's text content. Always gets fresh DOM reference. */
const setLabelText = (marker: L.Layer, text: string) => {
  const el = (marker as any).getElement();
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
    `${CONF.name}.popup_title`,
    `${CONF.name}.popup_loading`,
    `${CONF.name}.popup_loc_label`,
    `${CONF.name}.popup_addr_label`,
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
    html: `<div class="${CONST.LABEL.CLASS}${className ? " " + className : ""}" data-foliplus-export="label">${html}</div>`,
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

/** Options for makeDelIcon. */
interface DelIconOptions {
  className?: string;
  iconAnchor?: [number, number];
  zIndexOffset?: number;
  title?: string;
}

/** Create a delete icon marker. */
const makeDelIcon = (
  latlng: L.LatLngExpression,
  opts: DelIconOptions = {},
): L.Marker => {
  const { className, iconAnchor, ...markerOpts } = opts;
  return L.marker(latlng, {
    icon: L.divIcon({
      className: CONST.DEL_ICON.WRAP_CLASS + (className ? " " + className : ""),
      html: `<span class="${CONST.DEL_ICON.CLASS}" data-foliplus-export="exclude">${CONST.DEL_ICON.CHAR}</span>`,
      iconSize: CONST.DEL_ICON.SIZE as [number, number],
      iconAnchor: (iconAnchor || CONST.DEL_ICON.DEFAULT_ANCHOR) as [number, number],
    }),
    interactive: true,
    ...markerOpts,
  });
};

/** Animate a dash-sweep effect on a finalized polyline/polygon. */
const animateDashSweep = (path: SVGElement | null) => {
  if (!path) return;
  const len = (path as SVGPathElement).getTotalLength?.() || 0;
  if (len <= 0) return;
  path.style.setProperty(CONST.STYLE.SWEEP_LENGTH, len as unknown as string);
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
  const pt = midpoint(a, b) as any;
  const coords = pt.geometry?.coordinates || [0, 0];
  return { lng: coords[0], lat: coords[1] };
};

export {
  animateDashSweep,
  applyToggle,
  area,
  attachDelClick,
  buildPopup,
  calcArea,
  calcCentroid,
  calcMidpoint,
  calcToggle,
  centroid,
  distance,
  formatArea,
  formatDistance,
  formatSegmentLabel,
  hideDelIcons,
  makeDelIcon,
  makeLabelDivIcon,
  makeMidLabelDivIcon,
  makeNode,
  midpoint,
  recalculateSegments,
  setLabelText,
  suppressHide,
  toggleDelIcon,
  toggleVisibility,
};
