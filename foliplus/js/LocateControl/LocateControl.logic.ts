// LocateControl locate logic — locate me via the browser geolocation API.
import { fromWgs84 } from "#common/coord.js";
import { createLocationMarker } from "#common/dom.js";
import { HINT_DURATION } from "#common/hint.js";
import * as Icons from "#common/icon.js";
import { createTranslator } from "#common/locale.js";

const foliplus = window.foliplus;
const _ = createTranslator(CONF);

/** Minimal ctrl interface for locate logic. */
interface LocateCtrl {
  marker: L.Marker | null;
}

/** Fly to a coordinate and place a reverse-geocoded location marker. */
const placeMarker = (ctrl: LocateCtrl, lng: number, lat: number, titleKey: string) => {
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

/** Locate me via the browser geolocation API. */
const locateMe = (ctrl: LocateCtrl) => {
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
      lng = Number(converted[0].toFixed(6));
      lat = Number(converted[1].toFixed(6));
      placeMarker(ctrl, lng, lat, `${CONF.name}.popup_title_geo`);
    },
    () => {
      foliplus.hideHint(CONF.name);
      foliplus.showHint(CONF.name, _(`${CONF.name}.geo_error`), HINT_DURATION.LONG);
    },
  );
};

export { locateMe, placeMarker };
