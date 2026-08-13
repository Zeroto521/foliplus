import { BaseControl } from "#common/BaseControl.js";
import { createIconButton, createLocationMarker, dom } from "#common/dom.js";
import { createControlEnv } from "#common/guard.js";
import { fromWgs84 } from "#common/coord.js";
import { HINT_DURATION } from "#common/hint.js";
import * as Icons from "#common/icon.js";

// ── SVG Icons ──
// AMap-style crosshair locate icon (stroke-rendered, inherits common button SVG styles).
const LOCATE = `
  <svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="6"/>
    <circle cx="12" cy="12" r="1.8"/>
    <line x1="12" y1="1.5" x2="12" y2="5"/>
    <line x1="12" y1="19" x2="12" y2="22.5"/>
    <line x1="1.5" y1="12" x2="5" y2="12"/>
    <line x1="19" y1="12" x2="22.5" y2="12"/>
  </svg>`;

// ── Constants ──
const GEO = { TIMEOUT_MS: 10000, MAX_AGE_MS: 60000 };

const { _, foliplus } = createControlEnv(CONF, LOCATE);

// ── Locate Logic ──
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

/** Locate me via the browser geolocation API. */
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

// ==================== Control Definition ====================
class LocateControl extends BaseControl {
  declare container: HTMLElement;
  declare marker: L.Marker | null;

  buildDOM() {
    const outer = dom.el("div", { class: "leaflet-bar leaflet-control" });
    const container = dom.el("div", { class: "foliplus-ctrl-fold", parent: outer });
    createIconButton({
      class: "foliplus-tool-btn foliplus-locate-btn",
      title: _(`${CONF.name}.title`),
      ariaLabel: _(`${CONF.name}.title`),
      svg: LOCATE,
      parent: container,
      onclick: e => {
        L.DomEvent.stopPropagation(e);
        locateMe(this);
      },
    });
    L.DomEvent.disableClickPropagation(outer);
    L.DomEvent.disableScrollPropagation(outer);
    this.container = outer;
    return outer;
  }

  destroy() {
    if (this.marker) map.removeLayer(this.marker);
    this.marker = null;
  }
}

new LocateControl({ position: CONF.position }).addTo(map);
