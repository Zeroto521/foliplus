// LocateControl locate logic — locate me via the browser geolocation API.
import { HINT_DURATION } from "#core/hint.js";
import { guardBlocked } from "#core/mode.js";
import { fromWgs84 } from "#common/coord.js";
import {
  DEL_ICON_MARKER_ANCHOR,
  attachDelClick,
  bindDelIconToPopup,
  makeDelIcon,
} from "#common/delicon.js";
import { createLocationMarker } from "#common/dom.js";
import * as Icons from "#common/icon.js";
import { createTranslator } from "#common/locale.js";

const _ = createTranslator(CONF);

/** Minimal ctrl interface for locate logic. */
interface LocateCtrl {
  marker: L.Marker | null;
  delIcon: L.Marker | null;
}

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
  map.foliplus!.hideHint(CONF.name);
  map.flyTo([lat, lng], CONF.zoom || 15);
  removeMarker(ctrl);
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
    null,
    undefined,
    undefined,
  );

  // Floating ✕ next to the pin: shown while the popup is open (popupopen),
  // hidden otherwise (popupclose), matching MeasureControl's marker UX.
  ctrl.delIcon = makeDelIcon([lat, lng], {
    title: _("foliplus.close_label"),
    iconAnchor: DEL_ICON_MARKER_ANCHOR, // at the pin's bottom tip
  });
  map.addLayer(ctrl.delIcon);

  const delIcon = ctrl.delIcon;
  attachDelClick(delIcon, () => removeMarker(ctrl));
  bindDelIconToPopup(ctrl.marker, delIcon);
};

/** Locate me via the browser geolocation API. */
const locateMe = (ctrl: LocateCtrl) => {
  if (guardBlocked(map, CONF.name, _(`${CONF.name}.blocked`))) return;
  const geo = navigator.geolocation;
  if (!geo) {
    map.foliplus!.showHint(CONF.name, _(`${CONF.name}.geo_error`), HINT_DURATION.LONG);
    return;
  }
  map.foliplus!.showHint(
    CONF.name,
    `${Icons.LOADING} ${_(`${CONF.name}.locating`)}`,
    HINT_DURATION.PERSIST,
  );
  geo.getCurrentPosition(
    pos => {
      map.foliplus!.hideHint(CONF.name);
      let lng = pos.coords.longitude;
      let lat = pos.coords.latitude;
      const converted = fromWgs84(map, lng, lat);
      lng = Number(converted[0].toFixed(6));
      lat = Number(converted[1].toFixed(6));
      placeMarker(ctrl, lng, lat, `${CONF.name}.popup_title_geo`);
    },
    () => {
      map.foliplus!.hideHint(CONF.name);
      map.foliplus!.showHint(
        CONF.name,
        _(`${CONF.name}.geo_error`),
        HINT_DURATION.LONG,
      );
    },
  );
};

export { locateMe, placeMarker, removeMarker };
