// LocateControl locate logic — locate me via the browser geolocation API.
import { fromWgs84 } from "#core/geo/index.js";
import { HINT_DURATION } from "#core/hint.js";
import { createLocationMarker } from "#core/locationMarker.js";
import { guardBlocked } from "#core/mode.js";
import { DEL_ICON_MARKER_ANCHOR } from "#common/delicon.js";
import { mountDelIcon } from "#common/deliconMount.js";
import { formatCoord } from "#common/format.js";

/** Minimal ctrl interface for locate logic. `T`, `_` and `conf` come from
 *  the control instance (defineControl hands them off via ControlEnv) so
 *  this module has no module-level locale state. */
interface LocateCtrl {
  btn: HTMLButtonElement;
  marker: L.Marker | null;
  delIcon: L.Marker | null;
  T: (key: string) => string;
  _: (key: string) => string;
  conf: ComponentConfig;
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
  const conf = ctrl.conf;
  const T = ctrl.T;
  const _ = ctrl._;
  map.foliplus!.hideHint(conf.name);
  map.flyTo([lat, lng], conf.zoom || 15);
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
    conf.locale_code,
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
  const conf = ctrl.conf;
  const T = ctrl.T;
  if (guardBlocked(map, conf.name, T("blocked"))) return;
  const geo = navigator.geolocation;
  if (!geo) {
    map.foliplus!.showHint(conf.name, T("geo_error"), HINT_DURATION.LONG);
    return;
  }
  setLocating(ctrl, true);
  map.foliplus!.showHint(
    conf.name,
    T("locating"),
    HINT_DURATION.PERSIST,
    undefined,
    undefined,
    true,
  );
  geo.getCurrentPosition(
    pos => {
      setLocating(ctrl, false);
      map.foliplus!.hideHint(conf.name);
      let lng = pos.coords.longitude;
      let lat = pos.coords.latitude;
      const converted = fromWgs84(map, lng, lat);
      lng = Number(formatCoord(converted[0]));
      lat = Number(formatCoord(converted[1]));
      placeMarker(ctrl, lng, lat, `${conf.name}.popup_title_geo`);
    },
    () => {
      setLocating(ctrl, false);
      map.foliplus!.hideHint(conf.name);
      map.foliplus!.showHint(conf.name, T("geo_error"), HINT_DURATION.LONG);
    },
  );
};

export { locateMe, placeMarker, removeMarker };
