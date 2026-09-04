import {
  DEL_ICON_MARKER_ANCHOR,
  attachDelClick,
  makeDelIcon,
  toggleDelIcon,
} from "#common/delicon.js";
import { createLocationMarker } from "#common/dom.js";
import { createScopedTranslator, createTranslator } from "#common/locale.js";
import * as CONST from "../const.js";
import {
  bindNodeDrag,
  buildEditOverlay,
  isDragSyntheticClick,
  markDragSyntheticClick,
} from "../edit.js";
import type { MeasureManager } from "../manager.js";
import * as Util from "../util.js";
import { MeasureMode } from "./base.js";

// CONF is a free variable from the IIFE template wrapper.
const _ = createTranslator(CONF);
const T = createScopedTranslator(CONF);

// ==================== Marker Mode ====================
/** Marker placement mode. Places a geocoded marker on click. */
class MarkerMode extends MeasureMode {
  static TYPE = CONST.MODE.MARKER;
  static NAME_LABEL = "Location Marker";
  static NAME_LABEL_KEY = "name_marker";

  onMarkerClickRef!: (event: L.LeafletMouseEvent) => void;

  /** Bind pin drag (translate) for a finished marker. Returns cleanup. */
  private static bindPinDrag(
    manager: MeasureManager,
    marker: L.Marker,
    delMarker: L.Marker,
    measurement: MeasureData,
  ): () => void {
    // Guard against overlapping reverse-geocode races: if a new drag starts
    // before the previous geocode resolves, the stale result must not
    // overwrite the newer coordinates/address.
    let generation = 0;
    let rafId: number | null = null;

    const drag = bindNodeDrag(marker, delMarker, manager.map, {
      onDrag: (latlng: L.LatLng) => {
        delMarker.setLatLng(latlng);
        measurement.lng = Util.roundCoord(latlng.lng);
        measurement.lat = Util.roundCoord(latlng.lat);
        // Throttle persists: live-update the coords but batch the write so
        // each mousemove doesn't do its own localStorage round-trip. The
        // measurement object is the store's backing entry (passed by ref),
        // so a direct mutation + persist() is cheaper than store.update()
        // (which would re-find + re-assign the same fields).
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = null;
          manager.store.persist();
        });
      },
      onEnd: async (latlng: L.LatLng) => {
        markDragSyntheticClick();
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        const gen = ++generation;
        measurement.lng = Util.roundCoord(latlng.lng);
        measurement.lat = Util.roundCoord(latlng.lat);
        const code = window.CONF?.locale_code ?? "en";
        const addr = await Util.geocodeAddress(
          manager,
          measurement.lng!,
          measurement.lat!,
          code,
          measurement.address ?? null,
        );
        if (gen !== generation) return; // a newer drag superseded us
        measurement.address = addr;
        manager.store.persist();
        if (marker.getPopup()?.isOpen())
          marker.setPopupContent(
            Util.buildPopup(measurement.lng!, measurement.lat!, addr),
          );
      },
    });
    // Drag is gated by edit mode (no popup-first required), matching
    // distance/polygon/circle nodes.
    const unregisterDragToggle = manager.registerEditDragToggle(enabled =>
      drag.setEnabled(enabled),
    );

    // The pin shares the edit overlay: clicking it in edit mode shows its ✕
    // and closes every other open overlay (single selection). Outside edit
    // mode the marker's default popup (address) behavior is untouched.
    const overlay = buildEditOverlay(manager, {
      onOpen: () => toggleDelIcon(delMarker, true),
      onEmpty: () => {
        toggleDelIcon(delMarker, false);
        marker.closePopup();
      },
    });

    const onPinClick = (ev: L.LeafletMouseEvent) => {
      if (!manager.isEditMode) return;
      if (isDragSyntheticClick()) return;
      overlay.open(ev);
    };
    marker.on("click", onPinClick);

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      generation += 1; // invalidate any in-flight geocode
      drag.cleanup();
      unregisterDragToggle();
      overlay.cleanup();
      marker.off("click", onPinClick);
    };
  }

  /** Rebuild a persisted marker measurement.
   *  @param manager - MeasureManager instance.
   *  @param data - Persisted measurement data. */
  static restore(manager: MeasureManager, data: MeasureData): void {
    const marker = createLocationMarker(
      manager.map,
      data.lng!,
      data.lat!,
      data.address ?? null,
      T("popup_title"),
      T("popup_loading"),
      T("popup_loc_label"),
      T("popup_addr_label"),
      _("foliplus.close_label"),
      CONF.locale_code,
      null,
      manager.layers.mainLayer,
      addr => {
        // A marker restored with address:null (e.g. geocode was still in
        // flight when the page was reloaded) resolves its address here and
        // persists it so the next reload shows the address immediately.
        manager.store.update(data.id!, { address: addr });
      },
      false, // do not auto-open popup on restore
    );
    const delMarker = manager.layers.addLayer(
      makeDelIcon(L.latLng(data.lat!, data.lng!), {
        title: T("del_tooltip"),
        iconAnchor: DEL_ICON_MARKER_ANCHOR, // at the marker's bottom tip
      }),
    );

    marker.on("popupopen", () => {
      if (data.address !== null)
        marker.setPopupContent(Util.buildPopup(data.lng!, data.lat!, data.address));
    });

    // Pass `data` by reference so drag mutations land on the store's backing
    // entry — bindPinDrag mutates the object directly then calls persist()
    // (a copy would leave the store stale until the next full reload).
    const cleanupPin = MarkerMode.bindPinDrag(
      manager,
      marker as L.Marker,
      delMarker as L.Marker,
      data,
    );
    const unregisterFinalized = manager.registerFinalized(cleanupPin);

    const deleteMeasurement = () => {
      unregisterFinalized();
      cleanupPin(); // unbind drag + overlay + edit-drag toggle before removing
      manager.layers.removeLayer(marker);
      manager.layers.removeLayer(delMarker);
      manager.store.remove(data.id!);
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
    const lngNum = Util.roundCoord(event.latlng.lng);
    const latNum = Util.roundCoord(event.latlng.lat);

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
    this.m.store.add(measurement);

    // createLocationMarker resolves the address async (popup + onAddress
    // callback) — no separate geocode call here to avoid a duplicate request.
    const marker = createLocationMarker(
      this.map,
      lngNum,
      latNum,
      null,
      T("popup_title"),
      T("popup_loading"),
      T("popup_loc_label"),
      T("popup_addr_label"),
      _("foliplus.close_label"),
      CONF.locale_code,
      null,
      this.layers.mainLayer,
      addr => {
        this.m.store.update(markerId, { address: addr });
      },
    );

    const delMarker = this.layers.addLayer(
      makeDelIcon(event.latlng, {
        title: T("del_tooltip"),
        iconAnchor: DEL_ICON_MARKER_ANCHOR, // at the marker's bottom tip
      }),
    );

    // Bind delete + popup events BEFORE async geocode so the X works even
    // while the address lookup is still in flight.
    const cleanupPin = MarkerMode.bindPinDrag(
      this.m,
      marker as L.Marker,
      delMarker as L.Marker,
      measurement,
    );
    const unregisterFinalized = this.m.registerFinalized(cleanupPin);

    const deleteMeasurement = () => {
      unregisterFinalized();
      cleanupPin(); // unbind drag + overlay + edit-drag toggle before removing
      this.layers.removeLayer(marker);
      this.layers.removeLayer(delMarker);
      this.m.store.remove(markerId);
      this.layers.unregister();
    };
    attachDelClick(delMarker, deleteMeasurement);

    marker.on("popupopen", () => {
      if (measurement.address !== null)
        marker.setPopupContent(Util.buildPopup(lngNum, latNum, measurement.address));
    });
  }

  /** GeoJSON feature for a marker — properties carry id and address. */
  static toGeoFeature(data: MeasureData): GeoJSON.Feature {
    return {
      type: CONST.GEOJSON.FEATURE,
      properties: {
        id: data.id,
        type: this.TYPE,
        name: this.getNameLabel(),
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
