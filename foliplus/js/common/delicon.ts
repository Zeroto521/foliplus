// Delete-icon marker utilities — shared by MeasureControl / LocateControl.
// A floating "✕" marker that can be shown/hidden and clicked to delete.
import { stopEvent } from "./dom.js";

/** Click target data-role for the delete icon span. */
const DEL_ICON_ROLE = "del-icon";
const DEL_ICON_CLASS = "foliplus-del-icon";
/** The ✕ glyph rendered inside the delete icon span. */
const DEL_ICON_CHAR = "\u2715";
/** CSS selector matching the delete icon span. */
const DEL_ICON_SELECTOR = `[data-${DEL_ICON_ROLE}]`;
/** Icon anchor for a location pin (MeasureControl marker / LocateControl pin):
 *  floats the ✕ at the pin's bottom tip. Line/area/circle nodes use the
 *  default [0, 0] anchor (icon top-left at the anchor point). */
const DEL_ICON_MARKER_ANCHOR: [number, number] = [0, 24];
/** Z-index offset so the ✕ always renders above the marker it floats on. */
const DEL_ICON_Z_OFFSET = 11000; // above the pin (PIN.Z_OFFSET = 10000)

/** Create a delete icon marker (X icon, common version). */
const makeDelIcon = (
  latlng: L.LatLngExpression,
  opts: {
    className?: string;
    iconAnchor?: [number, number];
    zIndexOffset?: number;
    title?: string;
  } = {},
): L.Marker => {
  const {
    className,
    // Default anchor [0, 0]: icon top-left sits on the anchor point, used by
    // line/area/circle nodes. Pins opt in to [0, 24] via DEL_ICON_MARKER_ANCHOR.
    iconAnchor = [0, 0],
    zIndexOffset = DEL_ICON_Z_OFFSET,
    title,
  } = opts;
  return L.marker(latlng, {
    icon: L.divIcon({
      className: (className ? className + " " : "") + DEL_ICON_CLASS,
      html: `<span data-${DEL_ICON_ROLE}="" data-foliplus-export="exclude">${DEL_ICON_CHAR}</span>`,
      iconSize: [0, 0],
      iconAnchor,
    }),
    interactive: true,
    zIndexOffset,
    title,
  });
};

/** Attach a click handler to a delete icon marker via Leaflet event. */
const attachDelClick = (delMarker: L.Layer, callback: () => void) => {
  delMarker.on("click", (event: L.LeafletMouseEvent) => {
    const t = (event.originalEvent as MouseEvent)?.target as HTMLElement | null;
    if (t?.closest?.(`[data-${DEL_ICON_ROLE}]`)) {
      stopEvent(event);

      callback();
    }
  });
};

/** Toggle a delete icon's visibility. */
const toggleDelIcon = (marker: L.Layer, show: boolean) => {
  const el = (marker as L.Marker).getElement();
  if (!el) return;
  const icon = el.querySelector(`[data-${DEL_ICON_ROLE}]`);
  if (icon) icon.classList.toggle("visible", show);
};

/** Hide all visible delete icons on the page. */
const hideDelIcons = () => {
  document
    .querySelectorAll(`[data-${DEL_ICON_ROLE}].visible`)
    .forEach(el => el.classList.remove("visible"));
};

/**
 * Bind the ✕ delete icon to a marker's popup lifecycle:
 * show on popupopen, hide on popupclose. Used by LocateControl / SearchControl.
 */
const bindDelIconToPopup = (marker: L.Marker | null, delIcon: L.Layer) => {
  if (!marker) return;

  marker.on("popupopen", () => toggleDelIcon(delIcon, true));

  marker.on("popupclose", () => toggleDelIcon(delIcon, false));
};

export {
  DEL_ICON_CHAR,
  DEL_ICON_MARKER_ANCHOR,
  DEL_ICON_SELECTOR,
  DEL_ICON_Z_OFFSET,
  attachDelClick,
  hideDelIcons,
  makeDelIcon,
  toggleDelIcon,
  bindDelIconToPopup,
};
