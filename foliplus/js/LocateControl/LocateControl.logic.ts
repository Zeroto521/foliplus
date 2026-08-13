// LocateControl locate logic — locate me via the browser geolocation API.
import { fromWgs84 } from "#common/coord.js";
import { createLocationMarker } from "#common/dom.js";
import { createControlEnv } from "#common/guard.js";
import { HINT_DURATION } from "#common/hint.js";
import * as Icons from "#common/icon.js";
import { GEO } from "./LocateControl.const.js";

const { _, foliplus } = createControlEnv(CONF);

/** Fly to a coordinate and place a reverse-geocoded location marker. */
const placeMarker = (ctrl: any, lng: number, lat: number, titleKey: string) => {
  foliplus.hideHint(CONF.name);
  map.flyTo([lat, lng], CONF.zoom || 15);
  ctrl.marker = createLocationMarker(
    map,
    lng,
    lat,
    null,
    _(titleKey),
    _(`${CONF.name}.popup_loading`),
    _(`${CONF.name}.popup_loc_label`),
    _(`${CONF.name}.popup_addr_label`),
    _("foliplus.close_label"),
    CONF.locale_code,
    ctrl.marker,
  );
};

/**
 * Locate via the browser geolocation API (navigator.geolocation).
 * The browser returns WGS-84 coordinates, which are converted to the map's
 * display CRS before flying and placing the marker.
 * @param ctrl - LocateControl instance
 */
const locateMe = (ctrl: any) => {
  const geo = navigator.geolocation;
  if (!geo) {
    foliplus.showHint(CONF.name, _(`${CONF.name}.geo_error`), HINT_DURATION.LONG);
    return;
  }
  foliplus.showHint(
    CONF.name,
    `${Icons.LOADING} ${_(`${CONF.name}.locating`)}`,
    HINT_DURATION.PERSIST,
  );
  geo.getCurrentPosition(
    pos => {
      foliplus.hideHint(CONF.name);
      let lng = pos.coords.longitude;
      let lat = pos.coords.latitude;
      const converted = fromWgs84(map, lng, lat);
      lng = converted[0];
      lat = converted[1];
      placeMarker(ctrl, lng, lat, `${CONF.name}.popup_title_geo`);
    },
    () => {
      foliplus.hideHint(CONF.name);
      foliplus.showHint(CONF.name, _(`${CONF.name}.geo_error`), HINT_DURATION.LONG);
    },
    { timeout: GEO.TIMEOUT_MS, maximumAge: GEO.MAX_AGE_MS },
  );
};

export { locateMe };
