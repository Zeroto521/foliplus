import { createLocationMarker } from "#core/locationMarker.js";
import { DEL_ICON_MARKER_ANCHOR, toggleDelIcon } from "#common/delicon.js";
import { createScopedTranslator, createTranslator } from "#common/locale.js";
import { throttleRaf } from "#common/throttle.js";
import * as CONST from "../const.js";
import {
  bindNodeDrag,
  buildEditOverlay,
  isDragSyntheticClick,
  markDragSyntheticClick,
} from "../edit.js";
import type { MeasureManager } from "../manager.js";
import * as Util from "../util.js";
import {
  MeasureMode,
  createDeferredDelete,
  mountDelIcon,
  wireFinalized,
} from "./base.js";

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
    // Throttle persists: live-update the coords but batch the write so
    // each mousemove doesn't do its own localStorage round-trip. Mutations
    // go through store.mutate (store as single source of truth); the
    // persist call is throttled and unchanged.
    const persist = throttleRaf(() => manager.store.persist());
    const id = measurement.id!;

    const drag = bindNodeDrag(marker, delMarker, manager.map, {
      onDrag: (latlng: L.LatLng) => {
        delMarker.setLatLng(latlng);
        manager.store.mutate(id, m => {
          m.lng = Util.roundCoord(latlng.lng);
          m.lat = Util.roundCoord(latlng.lat);
        });
        persist();
      },
      onEnd: (latlng: L.LatLng) => {
        markDragSyntheticClick();
        persist.cancel();
        const gen = ++generation;
        manager.store.mutate(id, m => {
          m.lng = Util.roundCoord(latlng.lng);
          m.lat = Util.roundCoord(latlng.lat);
        });
        const code = window.CONF?.locale_code ?? "en";
        // onEnd is a sync callback (bindNodeDrag doesn't await it), so the
        // geocode runs as a detached fire-and-forget chain. Swallow rejections
        // to keep a failed lookup from surfacing as an unhandled rejection.
        void Util.geocodeAddress(
          manager,
          measurement.lng!,
          measurement.lat!,
          code,
          measurement.address ?? null,
        )
          .then(addr => {
            if (gen !== generation) return; // a newer drag superseded us
            manager.store.update(id, { address: addr });
            if (marker.getPopup()?.isOpen()) {
              marker.setPopupContent(
                Util.buildPopup(measurement.lng!, measurement.lat!, addr),
              );
            }
          })
          .catch(() => undefined);
      },
    });
    // Drag is gated by edit mode (no popup-first required), matching
    // distance/polygon/circle nodes.
    const unregisterDragToggle = manager.registerEditDragToggle(
      enabled => drag.setEnabled(enabled),
      measurement.id,
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
      id: measurement.id,
    });

    const onPinClick = (ev: L.LeafletMouseEvent) => {
      if (!manager.isEditMode) return;
      if (isDragSyntheticClick()) return;
      overlay.open(ev);
    };
    marker.on("click", onPinClick);

    return () => {
      persist.flush();
      generation += 1; // invalidate any in-flight geocode
      drag.cleanup();
      unregisterDragToggle();
      overlay.cleanup();
      marker.off("click", onPinClick);
    };
  }

  /**
   * Wire the finalized-marker skeleton shared by `restore()` and
   * `handleMarkerClick()`: mount the ✕, bind pin-drag, registerFinalized,
   * return a delete thunk. Kept as a static private helper (like
   * `bindPinDrag`) because both callers are static methods.
   *
   * `measurement` is passed by reference so drag mutations land on the
   * store's backing entry (a copy would leave the store stale until the
   * next full reload). `onPopupOpen` is bound to the marker's popupopen
   * event so the popup content can be refreshed when the popup is opened
   * after a late geocode resolution — bound after bindPinDrag but before
   * the deferred delete thunk is set, preserving the popup-binding position relative
   * to the ✕ lifecycle in both callers.
   */
  private static finalize(
    manager: MeasureManager,
    marker: L.Marker,
    measurement: MeasureData,
    at: L.LatLngExpression,
    onPopupOpen?: () => void,
  ): () => void {
    // mountDelIcon fires before the delete thunk exists, so the click
    // callback is a deferred ref assigned after wireFinalized below.
    const { onDelete, setDelete } = createDeferredDelete();
    const delMarker = mountDelIcon(
      manager.layers,
      at,
      { title: T("del_tooltip"), iconAnchor: DEL_ICON_MARKER_ANCHOR },
      onDelete,
    );

    const cleanupPin = MarkerMode.bindPinDrag(
      manager,
      marker as L.Marker,
      delMarker as L.Marker,
      measurement,
    );
    // registerFinalized(cleanupPin) + the delete-then-teardown path live in
    // wireFinalized. teardown is cleanupPin itself: it already unbinds drag,
    // overlay, and edit-drag toggle, matching the previous hand-rolled path.
    const { delete: deleteMeasurement } = wireFinalized(manager, manager.layers, {
      id: measurement.id!,
      teardown: cleanupPin,
      removeLayers: () => {
        manager.layers.removeLayer(marker);
        manager.layers.removeLayer(delMarker);
      },
      onDelete: () => manager.store.remove(measurement.id!),
    });

    if (onPopupOpen) marker.on("popupopen", onPopupOpen);

    setDelete(deleteMeasurement);
    return deleteMeasurement;
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

    MarkerMode.finalize(manager, marker, data, L.latLng(data.lat!, data.lng!), () => {
      if (data.address !== null) {
        marker.setPopupContent(Util.buildPopup(data.lng!, data.lat!, data.address));
      }
    });
  }

  start() {
    this.onMarkerClickRef = this.handleMarkerClick.bind(this);
    this.map.on("click", this.onMarkerClickRef);
    this._cleanup = () => this.map.off("click", this.onMarkerClickRef);
  }

  /** Handle marker click. */
  handleMarkerClick(event: L.LeafletMouseEvent) {
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

    // Bind delete + popup events BEFORE async geocode so the ✕ works even
    // while the address lookup is still in flight.
    MarkerMode.finalize(this.m, marker, measurement, event.latlng, () => {
      if (measurement.address !== null) {
        marker.setPopupContent(Util.buildPopup(lngNum, latNum, measurement.address));
      }
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
