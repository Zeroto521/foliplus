// MeasureControl utility functions — standalone, no manager dependency.
import { toggleDelIcon } from "#common/delicon.js";
import { buildPopupHtml } from "#common/dom.js";
import { area, bearing, centroid, distance, midpoint } from "#common/geo.js";
import { createScopedTranslator } from "#common/locale.js";
import * as CONST from "./const.js";

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

/** Minimum container-point movement (px) to count as a drag rather than a tap. */
const DRAG_THRESHOLD = 4;

/**
 * Build the shared edit overlay for a finalized distance / polygon / circle
 * measurement. The caller wires `result.open(ev)` onto each of the measure's
 * layers; clicking empty map space closes the overlay (the manager's global
 * click handler stops propagation for item clicks, so only empty-space clicks
 * reach here). Pin markers use popup coupling instead of an overlay, so they
 * don't call this.
 */
const buildEditOverlay = (
  mgr: {
    isEditMode: boolean;
    map: L.Map;
    registerEditOverlayCloser?: (close: () => void) => () => void;
    closeOtherEditOverlays?: (except: () => void) => void;
  },
  opts: { onOpen: () => void; onEmpty?: () => void },
): {
  open: (ev: L.LeafletMouseEvent) => void;
  close: () => void;
  cleanup: () => void;
} => {
  let open = false;
  const { onOpen, onEmpty } = opts;

  const close = () => {
    if (!open) return;
    open = false;
    onEmpty?.();
  };

  const onMapClick = () => {
    if (isDragSyntheticClick()) return;
    close();
  };
  mgr.map.on("click", onMapClick);
  const unregister = mgr.registerEditOverlayCloser?.(close);

  const openOverlay = (ev: L.LeafletMouseEvent) => {
    if (!mgr.isEditMode) return;
    if (open) return;
    if (isDragSyntheticClick()) return;
    // Only one measurement shows ✕ at a time: close any other open overlay.
    mgr.closeOtherEditOverlays?.(close);
    // Stop Leaflet's layer→map propagation (sets originalEvent._stopped) so
    // the map-level click handlers — including this overlay's own onMapClick
    // which closes it — don't immediately undo the open.
    L.DomEvent.stopPropagation(ev);
    open = true;
    onOpen();
  };

  return {
    open: openOverlay,
    close,
    cleanup: () => {
      mgr.map.off("click", onMapClick);
      unregister?.();
    },
  };
};

/**
 * Bind manual drag to a finalized node marker (L.CircleMarker or L.Marker).
 * Nodes have no built-in dragging, so we drive it from mousedown/move/up,
 * disabling the map's own dragging while we hold, and moving a paired ✕
 * icon along. Works for both SVG circleMarkers and div-based pin markers.
 *
 * Returns { setEnabled, cleanup }: the caller enables the binding on edit-mode
 * enter (or popup open for pins) and cleans it up on delete.
 */
const bindNodeDrag = (
  node: L.Layer,
  delIcon: L.Layer | null,
  map: L.Map,
  handlers: {
    onDrag?: (latlng: L.LatLng) => void;
    onEnd?: (latlng: L.LatLng) => void;
  },
): { setEnabled: (enabled: boolean) => void; cleanup: () => void } => {
  let enabled = false;
  let dragging = false;
  let moved = false;
  let startPt: { x: number; y: number } | null = null;

  // Query the element fresh each time: resortLayers() removes/re-adds nodes,
  // which re-creates their SVG path, so a captured element reference would go
  // stale and the `move` cursor would silently stop applying.
  const setCursor = (cursor: string) => {
    const el = ((node as L.Marker).getElement?.() as HTMLElement | null) ?? null;
    if (el) el.style.cursor = cursor;
  };

  const onDown = (ev: L.LeafletMouseEvent) => {
    if (!enabled) return;
    const raw = (ev.originalEvent as MouseEvent | undefined) ?? undefined;
    if (!raw) return;
    startPt = map.mouseEventToContainerPoint(raw);
    dragging = true;
    moved = false;
    setCursor("move");
    map.dragging.disable();
  };
  const onMove = (ev: L.LeafletMouseEvent) => {
    if (!dragging || !startPt) return;
    const raw = (ev.originalEvent as MouseEvent | undefined) ?? undefined;
    if (!raw) return;
    const pt = map.mouseEventToContainerPoint(raw);
    if (
      !moved &&
      Math.abs(pt.x - startPt.x) + Math.abs(pt.y - startPt.y) < DRAG_THRESHOLD
    )
      return;
    moved = true;
    // Notify handlers BEFORE repositioning the node so handlers that locate
    // the node by its current latlng (distance/polygon `findPtIdx`) can still
    // find the original point before it moves.
    handlers.onDrag?.(ev.latlng);
    (node as L.Marker).setLatLng(ev.latlng);
    if (delIcon) (delIcon as L.Marker).setLatLng(ev.latlng);
  };
  const onUp = (ev: L.LeafletMouseEvent) => {
    if (!dragging) return;
    dragging = false;
    setCursor(enabled ? "move" : "");
    map.dragging.enable();
    if (moved) handlers.onEnd?.(ev.latlng);
  };
  const onNodeUp = (ev: L.LeafletMouseEvent) => {
    onUp(ev);
  };

  node.on("mousedown", onDown);
  node.on("mouseup", onNodeUp);
  map.on("mousemove", onMove);
  map.on("mouseup", onUp);

  const setEnabled = (v: boolean) => {
    enabled = v;
    setCursor(v ? "move" : "");
  };
  const cleanup = () => {
    node.off("mousedown", onDown);
    node.off("mouseup", onNodeUp);
    map.off("mousemove", onMove);
    map.off("mouseup", onUp);
  };
  return { setEnabled, cleanup };
};

/**
 * Mark a click as drag-synthetic so the ensuing click (a drag ends with
 * mouseup, which also fires a click) doesn't reopen or close an overlay.
 */
const markDragSyntheticClick = () => {
  (
    window as unknown as { __foliplus_measure_drag_click: boolean }
  ).__foliplus_measure_drag_click = true;
};

const isDragSyntheticClick = (): boolean => {
  const w = window as unknown as { __foliplus_measure_drag_click: boolean };
  // Coalesce the absent flag to false so the return value matches the declared
  // boolean type even on the first read (before any drag has marked a click).
  const v = w.__foliplus_measure_drag_click ?? false;
  w.__foliplus_measure_drag_click = false;
  return v;
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

/** Normalize the Leaflet mouse event target to a plain HTMLElement or null. */
const getEventTarget = (event: L.LeafletMouseEvent): HTMLElement | null =>
  ((event.originalEvent as MouseEvent)?.target as HTMLElement | null) ?? null;

export {
  animateDashSweep,
  area,
  buildEditOverlay,
  bearing,
  bindNodeDrag,
  buildPopup,
  geocodeAddress,
  isDragSyntheticClick,
  markDragSyntheticClick,
  centroid,
  distance,
  formatArea,
  formatDistance,
  formatSegmentLabel,
  getEventTarget,
  makeLabelDivIcon,
  makeMidLabelDivIcon,
  makeNode,
  midpoint,
  pointsToLatLngs,
  recalculateSegments,
  setLabelText,
};
