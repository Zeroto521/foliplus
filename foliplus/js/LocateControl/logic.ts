// LocateControl locate logic — locate me via the browser geolocation API.
import { fromWgs84 } from "#core/geo/index.js";
import { HINT_DURATION } from "#core/hint.js";
import { DEL_ICON_MARKER_ANCHOR, mountDelIcon } from "#core/leaflet/index.js";
import { createLocationMarker } from "#core/locationMarker.js";
import { guardBlocked } from "#core/mode.js";
import { formatCoord } from "#common/format.js";

/** Minimal ctrl interface for locate logic. `T`, `_` and `config` come from
 *  the control instance (defineControl hands them off via ControlEnv) so
 *  this module has no module-level locale state. */
interface LocateCtrl {
  btn: HTMLButtonElement;
  marker: L.Marker | null;
  delIcon: L.Marker | null;
  T: (key: string) => string;
  _: (key: string) => string;
  config: ComponentConfig;
}

/** Toggle the button's loading state — spinner while geolocation resolves. */
const setLocating = (ctrl: LocateCtrl, locating: boolean): void => {
  ctrl.btn.classList.toggle("loading", locating);
};

/** Remove the current location pin and its delete icon. */
const removeMarker = (ctrl: LocateCtrl) => {
  if (ctrl.delIcon) {
    map.removeLayer(ctrl.delIcon);
    ctrl.delIcon = null;
  }
  if (ctrl.marker) {
    map.removeLayer(ctrl.marker);
    ctrl.marker = null;
  }
};

/** Fly to a coordinate and place a reverse-geocoded location marker. */
const placeMarker = (ctrl: LocateCtrl, lng: number, lat: number, titleKey: string) => {
  const config = ctrl.config;
  const T = ctrl.T;
  const _ = ctrl._;
  map.foliplus!.hideHint(config.name);
  map.flyTo([lat, lng], config.zoom || 15); // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- 0 is a valid zoom
  removeMarker(ctrl);
  ctrl.marker = createLocationMarker(
    map,
    lng,
    lat,
    null,
    _(titleKey),
    T("popup_loading"),
    T("popup_loc_label"),
    T("popup_addr_label"),
    _("foliplus.close_label"),
    config.locale_code,
    null,
    undefined,
    undefined,
  );

  // Floating ✕ next to the pin: shown while the popup is open (popupopen),
  // hidden otherwise (popupclose), matching MeasureControl's marker UX.
  ctrl.delIcon = mountDelIcon(
    [lat, lng],
    {
      title: _("foliplus.close_label"),
      iconAnchor: DEL_ICON_MARKER_ANCHOR, // at the pin's bottom tip
    },
    m => map.addLayer(m),
    () => removeMarker(ctrl),
    ctrl.marker,
  );
};

/** Locate me via the browser geolocation API. */
const locateMe = (ctrl: LocateCtrl) => {
  const config = ctrl.config;
  const T = ctrl.T;
  if (guardBlocked(map, config.name, T("blocked"))) return;
  const geo = navigator.geolocation;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- navigator.geolocation may be undefined
  if (!geo) {
    map.foliplus!.showHint(config.name, T("geo_error"), HINT_DURATION.LONG);
    return;
  }
  setLocating(ctrl, true);
  map.foliplus!.showHint(
    config.name,
    T("locating"),
    HINT_DURATION.PERSIST,
    undefined,
    undefined,
    true,
  );
  geo.getCurrentPosition(
    pos => {
      setLocating(ctrl, false);
      map.foliplus!.hideHint(config.name);
      let lng = pos.coords.longitude;
      let lat = pos.coords.latitude;
      const converted = fromWgs84(map, lng, lat);
      lng = Number(formatCoord(converted[0]));
      lat = Number(formatCoord(converted[1]));
      placeMarker(ctrl, lng, lat, `${config.name}.popup_title_geo`);
    },
    () => {
      setLocating(ctrl, false);
      map.foliplus!.hideHint(config.name);
      map.foliplus!.showHint(config.name, T("geo_error"), HINT_DURATION.LONG);
    },
  );
};

export { locateMe, removeMarker };
