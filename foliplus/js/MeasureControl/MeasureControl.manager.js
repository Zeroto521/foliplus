import { createTranslator } from "../shared/locale.js";
import * as CONST from "./MeasureControl.const.js";
import * as SVGs from "./MeasureControl.icon.js";
import {
  CircleMode,
  DistanceMode,
  MarkerMode,
  PolygonMode,
} from "./MeasureControl.mode.js";
import {
  attachCircleUI,
  attachDistanceUI,
  attachPolygonUI,
} from "./MeasureControl.ui.js";
import {
  area,
  attachDelClick,
  buildPopup,
  distance,
  formatDistance,
  formatSegmentLabel,
  hideDelIcons,
  makeDelIcon,
  makeLabelDivIcon,
  makeMidLabelDivIcon,
  makeNode,
  midpoint,
  recalculateSegments,
  toggleDelIcon,
} from "./MeasureControl.util.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).

const foliplus = window.foliplus;
const _ = createTranslator(CONF);

// ==================== Core Manager ====================
/** Central manager for all measurements. Handles persistence, layer management, mode switching, and UI toggle lifecycle. */
class MeasureManager {
  constructor(mapInstance) {
    this.map = mapInstance;
    this.layers = foliplus.LayerAPI.createLayers({
      id: CONST.ID,
      name: _(`${CONF.name}.tool_toggle`),
      graphPane: CONST.PANES.GRAPH,
      labelPane: CONST.PANES.LABEL,
      iconSvg: SVGs.RULER,
    });
    this.currentMode = null;
    this.modeInstance = null;
    this.isSuppressHideDel = false;
    this.toolBtns = [];
    this.finalizedClickHandlers = [];
    this.measurements = [];
    this.measurementIdCounter = 0;

    this.bindGlobalEvents();
    this.restoreMeasurements();
  }

  // ── Persistence ──

  /** Persist all measurements to localStorage. */
  saveMeasurements() {
    foliplus.storage.save(CONST.STORAGE.KEY, this.measurements, CONF.name);
  }

  /** Load measurements from localStorage.
   *  @returns {Array} Restored measurements array. */
  loadMeasurements() {
    const data = foliplus.storage.load(CONST.STORAGE.KEY, CONF.name);
    return Array.isArray(data) ? data : [];
  }

  /** Generate a unique measurement ID.
   *  @param {string} type - Measurement type.
   *  @returns {string} Unique ID. */
  nextMeasurementId(type) {
    this.measurementIdCounter += 1;
    return `${CONST.ID}_${type}_${Date.now()}_${this.measurementIdCounter}`;
  }

  /** Restore all persisted measurements from localStorage and rebuild their UI. */
  restoreMeasurements() {
    this.measurements = this.loadMeasurements();
    this.measurements.forEach((m) => {
      switch (m.type) {
        case CONST.MODE.MARKER:
          this.restoreMarker(m);
          break;
        case CONST.MODE.DISTANCE:
          this.restoreDistance(m);
          break;
        case CONST.MODE.POLYGON:
          this.restorePolygon(m);
          break;
        case CONST.MODE.CIRCLE:
          this.restoreCircle(m);
          break;
      }
    });
  }

  restoreMarker(m) {
    const marker = foliplus.createLocationMarker(
      this.map,
      m.lng,
      m.lat,
      m.address,
      _(`${CONF.name}.popup_title`),
      _(`${CONF.name}.popup_loading`),
      _(`${CONF.name}.popup_loc_label`),
      _(`${CONF.name}.popup_addr_label`),
      _("foliplus.close_label"),
      CONF.locale_code,
      null,
      this.layers.mainLayer,
      (addr) => {
        // A marker restored with address:null (e.g. geocode was still in
        // flight when the page was reloaded) resolves its address here and
        // persists it so the next reload shows the address immediately.
        m.address = addr;
        this.saveMeasurements();
      },
      false, // do not auto-open popup on restore
    );
    const delMarker = this.layers.addLayer(
      makeDelIcon(L.latLng(m.lat, m.lng), {
        zIndexOffset: CONST.Z_INDEX.OFFSET,
        iconAnchor: CONST.DEL_ICON.MARKER_ANCHOR,
        title: _(`${CONF.name}.del_tooltip`),
      }),
    );

    marker.on("popupopen", () => {
      hideDelIcons();
      // Use the latest resolved address so a marker whose geocode finished
      // while the popup was closed still shows the real address on first open
      // (createLocationMarker only updates an open popup).
      if (m.address !== null)
        marker.setPopupContent(buildPopup(m.lng, m.lat, m.address));
      toggleDelIcon(delMarker, true);
    });
    marker.on("popupclose", () => {
      toggleDelIcon(delMarker, false);
    });

    const deleteMarker = () => {
      this.layers.removeLayer(marker);
      this.layers.removeLayer(delMarker);
      this.measurements = this.measurements.filter((x) => x.id !== m.id);
      this.saveMeasurements();
      this.layers.unregister();
    };
    attachDelClick(delMarker, deleteMarker);
  }

  restoreDistance(m) {
    const points = m.points.map((p) => L.latLng(p.lat, p.lng));
    const finalPoly = this.layers.addLayer(
      L.polyline(points, {
        className: CONST.CLASSES.LINE_SOLID,
        interactive: true,
      }),
    );

    const nodeMarkers = [];
    points.forEach((pt, i) => {
      const node = this.layers.addLayer(makeNode(pt));
      node.bringToFront();
      nodeMarkers.push(node);
    });

    // Restore start label
    this.layers.addLayer(
      L.marker(points[0], {
        icon: makeLabelDivIcon(_(`${CONF.name}.dist_origin`)),
      }),
      true,
    );

    const segLabels = [];
    if (m.segments) {
      let accTotal = 0;
      m.segments.forEach((seg, i) => {
        accTotal += seg.distance;
        const prev = points[i];
        const cur = points[i + 1] || { lat: seg.lat, lng: seg.lng };
        if (!prev || !cur) return;
        const mid = midpoint(prev, cur);
        const label = this.layers.addLayer(
          L.marker([mid.lat, mid.lng], {
            icon: makeMidLabelDivIcon(formatSegmentLabel(prev, cur, accTotal)),
          }),
          true,
        );
        segLabels.push(label);
      });
    }

    // Attach toggle/delete UI (shared with finishDist)
    attachDistanceUI(this, {
      layers: this.layers,
      finalPoly,
      nodeMarkers,
      segLabels,
      points: points,
      onDelete: () => {
        this.measurements = this.measurements.filter((x) => x.id !== m.id);
        this.saveMeasurements();
      },
      onUpdate: () => {
        const { segments, totalDistance } = recalculateSegments(points);
        m.points = points.map((p) => ({ lng: p.lng, lat: p.lat }));
        m.segments = segments;
        m.totalDistance = totalDistance;
        this.saveMeasurements();
      },
    });
  }

  restorePolygon(m) {
    const points = m.points.map((p) => L.latLng(p.lat, p.lng));
    // Leaflet automatically closes the polygon
    const finalPoly = this.layers.addLayer(
      L.polygon(points, {
        className: CONST.CLASSES.POLYGON_FINAL,
        interactive: true,
      }),
    );

    const nodeMarkers = [];
    points.forEach((pt) => {
      const node = this.layers.addLayer(makeNode(pt));
      node.bringToFront();
      nodeMarkers.push(node);
    });

    const segLabels = [];
    if (m.segments) {
      m.segments.forEach((seg, i) => {
        const prev = points[i];
        const cur = points[i + 1] || { lat: seg.lat, lng: seg.lng };
        if (!prev || !cur) return;
        const mid = midpoint(prev, cur);
        const label = this.layers.addLayer(
          L.marker([mid.lat, mid.lng], {
            icon: makeMidLabelDivIcon(formatDistance(seg.distance)),
          }),
          true,
        );
        segLabels.push(label);
      });
    }

    // Attach toggle/delete UI (shared with finishPoly)
    const { onMapClickActive } = attachPolygonUI(this, {
      layers: this.layers,
      finalPoly,
      nodeMarkers,
      segLabels,
      points: points,
      area: m.area,
      onDelete: () => {
        this.measurements = this.measurements.filter((x) => x.id !== m.id);
        this.saveMeasurements();
      },
      onUpdate: () => {
        const newArea = area(points);
        const { segments } = recalculateSegments(points);
        // Add closing segment
        const n = points.length;
        segments.push({
          lng: points[0].lng,
          lat: points[0].lat,
          distance: distance(points[n - 1], points[0]),
        });
        m.points = points.map((p) => ({ lng: p.lng, lat: p.lat }));
        m.segments = segments;
        m.area = newArea;
        this.saveMeasurements();
      },
    });
    this.finalizedClickHandlers.push(onMapClickActive);
  }

  restoreCircle(m) {
    const centerLatLng = L.latLng(m.center.lat, m.center.lng);
    const targetLatLng = L.latLng(m.target.lat, m.target.lng);
    const r = m.radius;

    const circle = this.layers.addLayer(
      L.circle(centerLatLng, {
        radius: r,
        className: CONST.CLASSES.CIRCLE_FINAL,
        interactive: true,
      }),
    );

    const radiusLine = this.layers.addLayer(
      L.polyline([centerLatLng, targetLatLng], {
        className: CONST.CLASSES.LINE_DASHED,
        interactive: true,
      }),
    );
    const radiusNode = this.layers.addLayer(makeNode(targetLatLng));

    const centerFinal = this.layers.addLayer(
      L.marker(centerLatLng, {
        icon: L.divIcon({
          className: CONST.CENTER_DOT.CLASS_FINAL,
          html: "",
          iconSize: CONST.CENTER_DOT.SIZE,
          iconAnchor: CONST.CENTER_DOT.ANCHOR,
        }),
        zIndexOffset: CONST.Z_INDEX.OFFSET,
        interactive: true,
      }),
    );

    const delMarker = this.layers.addLayer(
      makeDelIcon(centerLatLng, {
        zIndexOffset: CONST.Z_INDEX.OFFSET,
        title: _(`${CONF.name}.del_tooltip`),
      }),
    );

    const mid = midpoint(centerLatLng, targetLatLng);
    const radiusLabel = this.layers.addLayer(
      L.marker([mid.lat, mid.lng], {
        icon: makeLabelDivIcon(
          formatDistance(r),
          CONST.LABEL.RADIUS_ANCHOR,
          CONST.LABEL.CLASS_RADIUS,
        ),
        interactive: false,
      }),
      true,
    );

    // Attach toggle/delete UI (shared with finalizeCircle)
    const { onMapClickActive } = attachCircleUI(this, {
      layers: this.layers,
      circle,
      radiusLine,
      radiusNode,
      centerFinal,
      delMarker,
      radiusLabel,
      onDelete: () => {
        this.measurements = this.measurements.filter((x) => x.id !== m.id);
        this.saveMeasurements();
      },
    });
    // Track the handler so clearAll()/destroy() can unbind it (same as
    // finalizeCircle does for freshly drawn circles).
    this.finalizedClickHandlers.push(onMapClickActive);
  }

  /** Bind global map click, keydown, and unload events. */
  bindGlobalEvents() {
    this.onMapClick = (e) => {
      if (this.isSuppressHideDel) return;
      const t = e.originalEvent?.target;
      if (t?.closest?.(CONST.SEL.DEL_ICON)) return;
      hideDelIcons();
    };
    this.map.on("click", this.onMapClick);

    this.onKeyDown = (e) => {
      if (e.key === "Escape" && this.currentMode) this.clearActiveMode();
    };
    document.addEventListener("keydown", this.onKeyDown);

    // On map unload (page refresh/close), clear transient UI state but KEEP
    // persisted measurements. clearAll() would wipe localStorage, losing all
    // saved data on every reload.
    this.onUnload = () => {
      this.clearActiveMode();
      this.layers.clearLayers();
      this.finalizedClickHandlers.forEach((h) => this.map.off("click", h));
      this.finalizedClickHandlers = [];
    };
    this.map.on("unload", this.onUnload);
  }

  /**
   * Attach toggle/delete UI to a completed distance measurement.
   * Shared by finishDist (DistanceMode) and restoreDistance (MeasureManager).
   * @param {Object} opts
   * @param {Object} opts.layers     - createLayers API object
   * @param {Object} opts.finalPoly  - L.Polyline
   * @param {Array}  opts.nodeMarkers - L.CircleMarker[]
   * @param {Array}  opts.segLabels   - Label L.Marker[]
   * @param {Array}  opts.points     - LatLng array
   * @param {Function} opts.onDelete - Called when user deletes the measurement
   * @param {Function} opts.onUpdate - Called when points are modified (node deletion)
   * @returns {Function} cleanup(mapClickHandler) to remove map click listener
   */
  setMode(mode) {
    if (mode === CONST.MODE.CLEAR) {
      this.clearAll();
      return;
    }
    if (this.currentMode === mode) {
      this.clearActiveMode();
      return;
    }

    // Re-register the measure layer so it's visible and on top when the user
    // activates a measurement tool, even if the layer was previously
    // hidden or re-ordered in the LayerControl panel.
    this.layers.register();

    this.cleanMapEvents();
    this.currentMode = mode;

    this.toolBtns.forEach((btn) =>
      btn.classList.toggle(CONST.CLASSES.ACTIVE, btn.dataset.mode === mode),
    );

    this.map.getContainer().classList.add(CONST.CLASSES.MEASURING);

    if (mode === CONST.MODE.MARKER) {
      foliplus.showHint(
        CONF.name,
        _(`${CONF.name}.hint_marker`),
        foliplus.HINT_DURATION.PERSIST,
      );
      this.modeInstance = new MarkerMode(this);
      this.modeInstance.start();
    } else if (mode === CONST.MODE.DISTANCE) {
      foliplus.showHint(
        CONF.name,
        _(`${CONF.name}.hint_dist_start`),
        foliplus.HINT_DURATION.PERSIST,
      );
      this.modeInstance = new DistanceMode(this);
      this.modeInstance.start();
    } else if (mode === CONST.MODE.POLYGON) {
      foliplus.showHint(
        CONF.name,
        _(`${CONF.name}.hint_polygon`),
        foliplus.HINT_DURATION.PERSIST,
      );
      this.modeInstance = new PolygonMode(this);
      this.modeInstance.start();
    } else if (mode === CONST.MODE.CIRCLE) {
      foliplus.showHint(
        CONF.name,
        _(`${CONF.name}.hint_circle_start`),
        foliplus.HINT_DURATION.PERSIST,
      );
      this.modeInstance = new CircleMode(this);
      this.modeInstance.start();
    }
  }

  /** Deactivate current mode, clean up events, and hide hints. */
  clearActiveMode() {
    this.currentMode = null;
    this.toolBtns.forEach((btn) => btn.classList.remove(CONST.CLASSES.ACTIVE));
    foliplus.hideHint(CONF.name);
    this.map.getContainer().classList.remove(CONST.CLASSES.MEASURING);
    this.cleanMapEvents();
  }

  /** Clear all measurements, layers, and persisted data. */
  clearAll() {
    this.layers.clearLayers();
    this.measurements = [];
    this.saveMeasurements();
    this.clearActiveMode();
    // Unbind all finalized-circle map click handlers; clearLayers removed
    // their targets so they would otherwise dangle until destroy().
    this.finalizedClickHandlers.forEach((h) => this.map.off("click", h));
    this.finalizedClickHandlers = [];
    // Collapse the panel after clearing all measurements
    if (this.ctrl) {
      this.ctrl.classList.remove(CONST.CLASSES.EXPANDED);
      this.ctrl.classList.add(CONST.CLASSES.COLLAPSED);
      foliplus.adjustPanelZIndex({ container: this.ctrl, expanded: false });
    }
  }

  /** Full cleanup including global events. Called on control removal. */
  destroy() {
    // Unbind onUnload first to prevent theoretical recursion if clearAll triggers unload
    if (this.onUnload) {
      this.map.off("unload", this.onUnload);
      this.onUnload = null;
    }
    this.clearAll();
    if (this.onMapClick) {
      this.map.off("click", this.onMapClick);
      this.onMapClick = null;
    }
    if (this.onKeyDown) {
      document.removeEventListener("keydown", this.onKeyDown);
      this.onKeyDown = null;
    }
    this.finalizedClickHandlers.forEach((h) => this.map.off("click", h));
    this.finalizedClickHandlers = [];
  }

  /** Clean up current mode instance and hide hints. */
  cleanMapEvents() {
    if (this.modeInstance) {
      this.modeInstance.cleanup();
      this.modeInstance = null;
    }
    foliplus.hideHint(CONF.name);
  }
}

export { MeasureManager };
