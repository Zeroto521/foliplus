import {
  DEL_ICON_MARKER_ANCHOR,
  attachDelClick,
  hideDelIcons,
  makeDelIcon,
  toggleDelIcon,
} from "#common/delicon.js";
import { createLocationMarker } from "#common/dom.js";
import { createTranslator } from "#common/locale.js";
import * as CONST from "../const.js";
import type { MeasureManager } from "../manager.js";
import * as Util from "../util.js";
import { MeasureMode } from "./base.js";

// CONF is a free variable from the IIFE template wrapper.
const _ = createTranslator(CONF);

// ==================== Marker Mode ====================
/** Marker placement mode. Places a geocoded marker on click. */
class MarkerMode extends MeasureMode {
  static TYPE = CONST.MODE.MARKER;
  static NAME_LABEL = "Location Marker";
  static NAME_LABEL_KEY = `${CONF.name}.name_marker`;

  onMarkerClickRef!: (event: L.LeafletMouseEvent) => void;

  /** Rebuild a persisted marker measurement.
   *  @param manager - MeasureManager instance.
   *  @param data - Persisted measurement data. */
  static restore(manager: MeasureManager, data: MeasureData): void {
    const marker = createLocationMarker(
      manager.map,
      data.lng!,
      data.lat!,
      data.address ?? null,
      _(`${CONF.name}.popup_title`),
      _(`${CONF.name}.popup_loading`),
      _(`${CONF.name}.popup_loc_label`),
      _(`${CONF.name}.popup_addr_label`),
      _("foliplus.close_label"),
      CONF.locale_code,
      null,
      manager.layers.mainLayer,
      addr => {
        // A marker restored with address:null (e.g. geocode was still in
        // flight when the page was reloaded) resolves its address here and
        // persists it so the next reload shows the address immediately.
        data.address = addr;
        manager.saveMeasurements();
      },
      false, // do not auto-open popup on restore
    );
    const delMarker = manager.layers.addLayer(
      makeDelIcon(L.latLng(data.lat!, data.lng!), {
        title: _(`${CONF.name}.del_tooltip`),
        iconAnchor: DEL_ICON_MARKER_ANCHOR, // at the marker's bottom tip
      }),
    );

    marker.on("popupopen", () => {
      hideDelIcons();
      // Use the latest resolved address so a marker whose geocode finished
      // while the popup was closed still shows the real address on first open
      // (createLocationMarker only updates an open popup).
      if (data.address !== null)
        marker.setPopupContent(Util.buildPopup(data.lng!, data.lat!, data.address));
      toggleDelIcon(delMarker, true);
    });
    marker.on("popupclose", () => {
      toggleDelIcon(delMarker, false);
    });

    const deleteMeasurement = () => {
      manager.layers.removeLayer(marker);
      manager.layers.removeLayer(delMarker);
      manager.measurements = manager.measurements.filter(x => x.id !== data.id);
      manager.saveMeasurements();
      manager.layers.unregister();
    };
    attachDelClick(delMarker, deleteMeasurement);
  }

  start() {
    this.onMarkerClickRef = this.handleMarkerClick.bind(this);
    this.map.on("click", this.onMarkerClickRef);
    this._cleanup = () => this.map.off("click", this.onMarkerClickRef);
  }

  /** Handle marker click. */
  async handleMarkerClick(event: L.LeafletMouseEvent) {
    if (this.m.currentMode !== this.type) return;
    const lng = event.latlng.lng.toFixed(CONST.FORMAT.LAT_LNG_PRECISION);
    const lat = event.latlng.lat.toFixed(CONST.FORMAT.LAT_LNG_PRECISION);
    const lngNum = parseFloat(lng);
    const latNum = parseFloat(lat);

    // Save the measurement IMMEDIATELY (address resolved later) so the
    // marker survives a page reload even while geocoding is in flight.
    const markerId = this.nextMeasurementId();
    const measurement: {
      id: string;
      type: string;
      lng: number;
      lat: number;
      address: string | null;
    } = {
      id: markerId,
      type: this.type,
      lng: lngNum,
      lat: latNum,
      address: null,
    };
    this.m.measurements.push(measurement);
    this.m.saveMeasurements();

    // createLocationMarker resolves the address async (popup + onAddress
    // callback) — no separate geocode call here to avoid a duplicate request.
    const marker = createLocationMarker(
      this.map,
      lngNum,
      latNum,
      null,
      _(`${CONF.name}.popup_title`),
      _(`${CONF.name}.popup_loading`),
      _(`${CONF.name}.popup_loc_label`),
      _(`${CONF.name}.popup_addr_label`),
      _("foliplus.close_label"),
      CONF.locale_code,
      null,
      this.layers.mainLayer,
      addr => {
        measurement.address = addr;
        this.m.saveMeasurements();
      },
    );

    const delMarker = this.layers.addLayer(
      makeDelIcon(event.latlng, {
        title: _(`${CONF.name}.del_tooltip`),
        iconAnchor: DEL_ICON_MARKER_ANCHOR, // at the marker's bottom tip
      }),
    );

    // Bind delete + popup events BEFORE async geocode so the X works even
    // while the address lookup is still in flight.
    const deleteMeasurement = () => {
      this.layers.removeLayer(marker);
      this.layers.removeLayer(delMarker);
      this.m.measurements = this.m.measurements.filter(x => x.id !== markerId);
      this.m.saveMeasurements();
      this.layers.unregister();
    };
    attachDelClick(delMarker, deleteMeasurement);

    // Bind popup events BEFORE async geocode so X appears on first popup open
    marker.on("popupopen", () => {
      hideDelIcons();
      if (measurement.address !== null)
        marker.setPopupContent(Util.buildPopup(lngNum, latNum, measurement.address));
      toggleDelIcon(delMarker, true);
    });

    marker.on("popupclose", () => {
      toggleDelIcon(delMarker, false);
    });
  }

  /** GeoJSON feature for a marker — properties carry id and address. */
  static toGeoFeature(data: MeasureData): GeoJSON.Feature {
    return {
      type: CONST.GEOJSON.FEATURE,
      properties: {
        id: data.id,
        type: this.TYPE,
        name: this.NAME_LABEL,
        address: data.address,
      },
      geometry: {
        type: CONST.GEOJSON.POINT,
        coordinates: [data.lng || 0, data.lat || 0],
      },
    };
  }
}

export { MarkerMode };
