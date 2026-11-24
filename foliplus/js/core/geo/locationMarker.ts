// core/geo/locationMarker — a popup-attached pin for a single lng/lat.
//
// Lives in core/ (not platform/) because it reaches Leaflet's private
// `_closeButton` field to title the popup close button. That reach goes
// through #core/leafletAdapter.setPopupCloseTitle; the guard test enforces
// that platform/ never imports from #core/, and adapter is the one module
// allowed to hold private-field reaches. Callers in LocateControl,
// MeasureControl and SearchControl import this from #core/geo/locationMarker.js.
import { reverseGeocode } from "#core/geocode/geocoder.js";
import { setPopupCloseTitle } from "#core/leafletAdapter.js";
import { buildPopupEl } from "#platform/dom.js";
import * as SVGs from "#platform/icon.js";

const PIN: {
  SIZE: [number, number];
  ANCHOR: [number, number];
  POPUP_ANCHOR: [number, number];
  Z_OFFSET: number;
} = {
  SIZE: [24, 36],
  ANCHOR: [12, 36],
  POPUP_ANCHOR: [0, -36],
  Z_OFFSET: 10000,
};
const POPUP_MAX_WIDTH = 300;

/** The liveness fact for a location pin: it is still on its map. A pin that was
 *  removed — control destroy (LocateControl's removeMarker), a replacement pin,
 *  an explicit close — has no owner left, so an async continuation must not
 *  write to it. A pin that was re-added to the same map is live again: the
 *  check is "on the map", not "never removed". Shared with MeasureControl's
 *  reverse-geocode path; do not re-derive map.hasLayer at a call site. */
const isLiveMarker = (map: L.Map, marker: L.Layer | null | undefined): boolean =>
  !!marker && map.hasLayer(marker);

/**
 * Create a location marker with a popup and add it to the map.
 */
const createLocationMarker = (
  map: L.Map,
  lng: number,
  lat: number,
  addr: string | null,
  titleText: string,
  loadingText: string,
  locLabelText: string,
  addrLabelText: string,
  closeLabelText: string,
  code?: string,
  existing?: L.Marker | null,
  layerGroup?: L.LayerGroup | L.Map,
  onAddress?: (addr: string) => void,
  openPopup = true,
): L.Marker => {
  if (existing) map.removeLayer(existing);
  const target = (layerGroup ?? map) as L.Map | L.LayerGroup;
  const marker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: "",
      html: SVGs.ICON_PIN,
      iconSize: PIN.SIZE,
      iconAnchor: PIN.ANCHOR,
      popupAnchor: PIN.POPUP_ANCHOR,
    }),
    zIndexOffset: PIN.Z_OFFSET,
  });
  target.addLayer(marker);
  marker.bindPopup(
    buildPopupEl(lng, lat, addr, titleText, loadingText, locLabelText, addrLabelText),
    { maxWidth: POPUP_MAX_WIDTH },
  );
  if (openPopup) marker.openPopup();
  // The popup close button has no public API for a hover tooltip — the reach
  // goes through the adapter, which is the one module allowed to touch
  // Leaflet's private surface. Missing button (closeButton disabled, popup
  // not yet built) is a no-op inside the adapter.
  setPopupCloseTitle(marker.getPopup(), closeLabelText || "");
  if (!addr) {
    // Reverse-geocode the location to resolve an address label. The lookup
    // outlives the call that asked for it, so the continuation re-checks the
    // pin's own liveness before writing anything: a pin removed while the
    // lookup was in flight (control destroy -> removeMarker(), a replacement
    // pin, an explicit close) has no owner left to repaint.
    void reverseGeocode(map, lng, lat, code)
      .then((resolved: string) => {
        // Liveness guard: one predicate for every async geocode continuation
        // (see `isLiveMarker`); a removed pin has no owner left to write to.
        if (!isLiveMarker(map, marker)) return;
        if (onAddress) onAddress(resolved);
        if (marker?.getPopup?.()?.isOpen()) {
          marker.setPopupContent(
            buildPopupEl(
              lng,
              lat,
              resolved,
              titleText,
              loadingText,
              locLabelText,
              addrLabelText,
            ),
          );
        }
      })
      .catch(() => undefined);
  }
  return marker;
};

export { createLocationMarker, isLiveMarker };
