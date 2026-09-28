// Location marker — a popup-attached pin for a single lng/lat.
//
// Lives in core/ (not common/) because it reaches Leaflet's private
// `_closeButton` field to title the popup close button. That reach goes
// through #core/leafletAdapter.setPopupCloseTitle; the guard test enforces
// that common/ never imports from #core/, and adapter is the one module
// allowed to hold private-field reaches. Callers in LocateControl,
// MeasureControl and SearchControl import this from #core/locationMarker.js.
import { setPopupCloseTitle } from "#core/leafletAdapter.js";
import { buildPopupEl } from "#common/dom.js";
import * as SVGs from "#common/icon.js";

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
      html: SVGs.PIN_ICON,
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
    // Lazy access to the runtime singleton geocoder (kept out of this bundle).
    const foliplus = window.foliplus;
    if (foliplus?.reverseGeocode) {
      void foliplus
        .reverseGeocode(map, lng, lat, code)
        .then((resolved: string) => {
          if (onAddress) onAddress(resolved);
          if (marker && marker.getPopup && marker.getPopup()?.isOpen()) {
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
  }
  return marker;
};

export { createLocationMarker };
