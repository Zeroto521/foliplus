import { buildPopupHtml, stopEvent } from "../common/dom.js";
import { createTranslator } from "../common/locale.js";
import * as CONST from "./MeasureControl.const.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const _ = createTranslator(CONF);

/** Format meters to human-readable string (e.g. "1.2 km", "500 m").
 *  @param {number} meters - Distance in meters.
 *  @returns {string} Formatted distance string. */
const formatDistance = (meters) => {
  return meters >= CONST.FORMAT.KM_THRESHOLD
    ? `${(meters / 1000).toFixed(CONST.FORMAT.KM_DECIMALS)} ` +
        _(`${CONF.name}.unit_km`)
    : `${Math.round(meters)} ` + _(`${CONF.name}.unit_m`);
};

/** Distance between two points in meters (turf.js geodesic).
 *  @param {Object} a - Point with lng/lat properties.
 *  @param {Object} b - Point with lng/lat properties. */
const distance = (a, b) => {
  return turf.distance(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]), {
    units: "meters",
  });
};

/** Initial bearing (azimuth) from point a to point b, 0°–360° clockwise from north.
 *  Uses turf.js bearing. */
const bearing = (a, b) => {
  const bVal = turf.bearing(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]));
  return (bVal + 360) % 360;
};

/** Format a segment label: "45° | 1.2 km", or just "1.2 km" when show_bearing is off.
 *  @param {Object} a - Start point with lng/lat properties.
 *  @param {Object} b - End point with lng/lat properties. */
const formatSegmentLabel = (a, b, meters) => {
  const dist = formatDistance(meters);
  if (!CONF.show_bearing) return dist;
  const bVal = Math.round(bearing(a, b));
  return `${bVal}° | ${dist}`;
};

/** Geodesic midpoint between two points using turf.js.
 *  @param {Object} a - First point with lng/lat properties.
 *  @param {Object} b - Second point with lng/lat properties.
 *  @returns {L.LatLng} Midpoint LatLng. */
const midpoint = (a, b) => {
  const mid = turf.midpoint(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]));
  return L.latLng(mid.geometry.coordinates[1], mid.geometry.coordinates[0]);
};

/** Centroid (arithmetic mean of vertices) of a polygon.
 *  @param {Array<{lng:number,lat:number}>} points - Array of coordinate objects.
 *  @returns {L.LatLng} Centroid LatLng. */
const centroid = (points) => {
  const cx = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return L.latLng(cx, cy);
};

/** Geodesic area of a polygon using turf.js.
 *  @param {Array<{lng:number,lat:number}>} points - Array of coordinate objects.
 *  @returns {number} Area in square meters. */
const area = (points) => {
  if (points.length < 3) return 0;
  const coords = points.map((p) => [p.lng, p.lat]);
  // Close the ring
  coords.push(coords[0]);
  return turf.area(turf.polygon([coords]));
};

/** Format area: "1,234 m²" or "1.23 km²". */
const formatArea = (sqMeters) => {
  if (sqMeters >= 1_000_000) return `${(sqMeters / 1_000_000).toFixed(2)} km²`;
  return `${Math.round(sqMeters).toLocaleString()} m²`;
};

/** Toggle CSS hidden class on a list of DOM elements.
 *  @param {Element[]} elements - DOM elements to toggle.
 *  @param {boolean} visible - Whether elements should be visible. */
const toggleVisibility = (elements, visible) => {
  elements.forEach((el) => {
    if (el) el.classList.toggle(CONST.CLASSES.HIDDEN, !visible);
  });
};

/** Temporarily suppress map click hide of delete icons.
 *  @param {Object} manager - MeasureManager instance. */
const suppressHide = (manager) => {
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
    .forEach((el) => el.classList.remove(CONST.CLASSES.VISIBLE));
};

/** Calculate next toggle state for X icons and labels.
 *  @param {boolean} curX - Current X visibility.
 *  @param {boolean} curLabels - Current label visibility.
 *  @param {boolean|undefined} showX - Requested X state.
 *  @param {boolean|string|undefined} toggleLbl - Requested label toggle.
 *  @returns {Object} `{isXVisible:boolean, isLabelsVisible:boolean}` */
const calcToggle = (curX, curLabels, showX, toggleLbl) => {
  const newX = showX !== undefined ? showX : !curX;
  let newLabel = curLabels;
  if (toggleLbl === true) newLabel = !curLabels;
  else if (toggleLbl === false) newLabel = false;
  else if (toggleLbl === CONST.TOGGLE.RESET) newLabel = true;
  return { isXVisible: newX, isLabelsVisible: newLabel };
};

/** Apply toggle visibility state to del icon, labels, and optional extra label.
 *  @param {Object} delMarker - Delete icon marker.
 *  @param {boolean} isXVisible - Whether X icons are visible.
 *  @param {Array} labels - Label markers to toggle.
 *  @param {boolean} isLabelsVisible - Whether labels are visible.
 *  @param {Object} [extraLbl] - Extra label marker to toggle.
 *  @param {Function} [onToggle] - Callback after toggle. */
const applyToggle = (
  delMarker,
  isXVisible,
  labels,
  isLabelsVisible,
  extraLbl,
  onToggle,
) => {
  const applyDelIcon = (marker, show, retries = 0) => {
    if (!marker) return;
    toggleDelIcon(marker, show, retries);
  };

  applyDelIcon(delMarker, isXVisible);
  labels.forEach((m) => {
    const el = m.getElement();
    if (el) {
      const label = el.querySelector(CONST.SEL.LABEL);
      if (label) label.classList.toggle(CONST.CLASSES.HIDDEN, !isLabelsVisible);
    }
  });

  if (extraLbl) {
    const sEl = extraLbl.getElement();
    if (sEl) {
      const sL = sEl.querySelector(CONST.SEL.LABEL);
      if (sL) sL.classList.toggle(CONST.CLASSES.HIDDEN, !isLabelsVisible);
    }
  }

  if (onToggle) onToggle(isXVisible, isLabelsVisible);
};

/** Toggle a delete icon's visibility with retry. */
const toggleDelIcon = (marker, show, retries = 0) => {
  if (!marker) return;
  const el = marker.getElement();
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
const attachDelClick = (delMarker, callback) => {
  delMarker.on("click", (ev) => {
    const t = ev.originalEvent?.target;
    if (t?.classList?.contains(CONST.DEL_ICON.CLASS)) {
      stopEvent(ev);
      callback();
    }
  });
};

/** Update a label marker's text content. Always gets fresh DOM reference. */
const setLabelText = (marker, text) => {
  const el = marker.getElement();
  if (!el) return;
  const labelEl = el.querySelector(CONST.SEL.LABEL);
  if (labelEl) labelEl.textContent = text;
};

/** Build popup HTML for a marker location. */
const buildPopup = (lng, lat, addr) => {
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

/** Create a divIcon for a label marker.
 * @param {string} html - Text content for the label.
 * @param {number[]} [iconAnchor] - Override default LABEL_ANCHOR.
 * @param {string} [className] - Extra CSS class for the label div. */
const makeLabelDivIcon = (html, iconAnchor, className) => {
  return L.divIcon({
    className: "",
    html: `<div class="${CONST.LABEL.CLASS}${className ? " " + className : ""}" data-foliplus-export="label">${html}</div>`,
    iconSize: CONST.LABEL.SIZE,
    iconAnchor: iconAnchor || CONST.LABEL.DEFAULT_ANCHOR,
  });
};

/** Create a divIcon for a segment label centered on the line midpoint.
 *  @param {string} html - Text content for the label. */
const makeMidLabelDivIcon = (html) => {
  return makeLabelDivIcon(html, CONST.LABEL.MID_ANCHOR, CONST.LABEL.CLASS_MID);
};

/** Create a measure node circle marker. */
const makeNode = (latlng, className = CONST.CLASSES.NODE_FINAL) => {
  return L.circleMarker(latlng, { radius: CONST.MARKER.RADIUS, className });
};

/** Create a delete icon marker.
 * @param {Object} [opts] - Extra options. className appended to del-icon-wrap
 *   for CSS targeting; iconAnchor overrides the default [0, 0];
 *   remaining opts passed to L.marker (e.g. zIndexOffset).
 */
const makeDelIcon = (latlng, opts = {}) => {
  const { className, iconAnchor, ...markerOpts } = opts;
  return L.marker(latlng, {
    icon: L.divIcon({
      className: CONST.DEL_ICON.WRAP_CLASS + (className ? " " + className : ""),
      html: `<span class="${CONST.DEL_ICON.CLASS}" data-foliplus-export="exclude">${CONST.DEL_ICON.CHAR}</span>`,
      iconSize: CONST.DEL_ICON.SIZE,
      iconAnchor: iconAnchor || CONST.DEL_ICON.DEFAULT_ANCHOR,
    }),
    interactive: true,
    ...markerOpts,
  });
};

/** Animate a dash-sweep effect on a finalized polyline/polygon. */
const animateDashSweep = (path) => {
  if (!path) return;
  const len = path.getTotalLength?.() || 0;
  if (len <= 0) return;
  path.style.setProperty(CONST.STYLE.SWEEP_LENGTH, len);
  path.classList.add(CONST.CLASSES.DASH_SWEEP);
  const onEnd = () => {
    path.removeEventListener("animationend", onEnd);
    path.classList.remove(CONST.CLASSES.DASH_SWEEP);
    path.style.removeProperty(CONST.STYLE.SWEEP_LENGTH);
  };
  path.addEventListener("animationend", onEnd);
};

/** Recalculate segments and total distance from a points array.
 * @param {Array} points - Array of L.LatLng
 * @returns {Object} { segments: Array, totalDistance: number }
 */
const recalculateSegments = (points) => {
  const segments = [];
  let totalDistance = 0;
  for (let i = 1; i < points.length; i++) {
    const d = distance(points[i - 1], points[i]);
    segments.push({ lng: points[i].lng, lat: points[i].lat, distance: d });
    totalDistance += d;
  }
  return { segments, totalDistance };
};

export {
  animateDashSweep,
  applyToggle,
  area,
  attachDelClick,
  buildPopup,
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
  stopEvent,
  suppressHide,
  toggleDelIcon,
  toggleVisibility,
};
