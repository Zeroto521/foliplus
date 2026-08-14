import {
  DEL_ICON_MARKER_ANCHOR,
  attachDelClick,
  hideDelIcons,
  makeDelIcon,
  toggleDelIcon,
} from "#common/delicon.js";
import { createLocationMarker, stopEvent } from "#common/dom.js";
import { HINT_DURATION } from "#common/hint.js";
import { createTranslator } from "#common/locale.js";
import {
  type MapEventHandlers,
  bindMapEvents,
  unbindMapEvents,
} from "#common/mapEvent.js";
import * as CONST from "./const.js";
import type { MeasureManager } from "./manager.js";
import { attachCircleUI, attachDistanceUI, attachPolygonUI } from "./ui.js";
import * as Util from "./util.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const _ = createTranslator(CONF);

/** Persisted measurement payload type. */
type Mode = { type: string };

/** Circle-mode preview layers (center, radius circle, radius line, edge node, distance label). */
interface CirclePreviews {
  center: L.Marker | null;
  circle: L.Circle | null;
  line: L.Polyline | null;
  node: L.CircleMarker | null;
  label: L.Marker | null;
}

// ==================== Mode Base Class ====================
/** Base class for all measurement modes. Handles map reference, layer group, and cleanup lifecycle. */
class MeasureMode {
  static TYPE: string = "";
  manager: MeasureManager;
  map: L.Map;
  layers: CreateLayersAPI;
  _cleanup: (() => void) | null;

  constructor(manager: MeasureManager) {
    this.manager = manager;
    this.map = manager.map;
    this.layers = manager.layers;
    this._cleanup = null;
  }

  /** Shorthand for manager */
  get m() {
    return this.manager;
  }

  /** Shorthand for mode type */
  get type(): string {
    return (this.constructor as typeof MeasureMode).TYPE;
  }

  /** Start the mode — bind events, create UI. */
  start(): void {
    console.warn(`[${CONF.name}] start not implemented for ${this.type}`);
  }

  /** Cleanup — unbind events, remove temporary elements. */
  cleanup(): void {
    if (this._cleanup) {
      this._cleanup();
      this._cleanup = null;
    }
  }

  /** Generate a unique measurement ID with type prefix. */
  nextMeasurementId(): string {
    return this.m.nextMeasurementId(this.type);
  }

  /** Rebuild a persisted measurement from data.
   *  Subclasses override this to restore their specific visual elements.
   *  @param manager - MeasureManager instance.
   *  @param data - Persisted measurement data. */
  static restore(manager: MeasureManager, data: MeasureData): void {
    console.warn(`[${CONF.name}] restore not implemented for ${this.TYPE}`);
  }
}

// ==================== Preview Mode Base Class ====================
/** Base class for modes with preview layers (distance, polygon, circle). Tracks and cleans up preview artifacts. */
class PreviewMode extends MeasureMode {
  previewLayers: L.Layer[];
  isFinished: boolean;

  constructor(manager: MeasureManager) {
    super(manager);
    this.previewLayers = [];
    this.isFinished = false;
  }

  /** Track a preview layer (adds to layer group + tracks for cleanup). */
  addPreview<T extends L.Layer>(layer: T): T {
    this.previewLayers.push(layer);
    this.layers.addLayer(layer);
    return layer;
  }

  /** Remove a specific preview layer. */
  removePreview(layer: L.Layer): void {
    const idx = this.previewLayers.indexOf(layer);
    if (idx !== -1) this.previewLayers.splice(idx, 1);
    this.layers.removeLayer(layer);
  }

  /** Remove all tracked preview layers. */
  clearPreviews(): void {
    this.previewLayers.forEach(l => this.layers.removeLayer(l));
    this.previewLayers = [];
  }
}

// ==================== Marker Mode ====================
/** Marker placement mode. Places a geocoded marker on click. */
class MarkerMode extends MeasureMode {
  static TYPE = CONST.MODE.MARKER;

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

    const deleteMarker = () => {
      manager.layers.removeLayer(marker);
      manager.layers.removeLayer(delMarker);
      manager.measurements = manager.measurements.filter(x => x.id !== data.id);
      manager.saveMeasurements();
      manager.layers.unregister();
    };
    attachDelClick(delMarker, deleteMarker);
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
    const deleteMarker = () => {
      this.layers.removeLayer(marker);
      this.layers.removeLayer(delMarker);
      this.m.measurements = this.m.measurements.filter(x => x.id !== markerId);
      this.m.saveMeasurements();
      this.layers.unregister();
    };
    attachDelClick(delMarker, deleteMarker);

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
}

// ==================== Distance Mode ====================
/** Distance measurement mode. Click to place nodes, double-click/context to finish. */
class DistanceMode extends PreviewMode {
  static TYPE = CONST.MODE.DISTANCE;

  static restore(manager: MeasureManager, data: MeasureData) {
    const points: L.LatLng[] = data.points!.map((p: { lng: number; lat: number }) =>
      L.latLng(p.lat, p.lng),
    );
    const finalPoly = manager.layers.addLayer(
      L.polyline(points, { className: CONST.CLASSES.PATH_SOLID, interactive: true }),
    ) as L.Polyline;

    const nodeMarkers: L.CircleMarker[] = [];
    points.forEach((pt: L.LatLng, i: number) => {
      const node = manager.layers.addLayer(
        Util.makeNode(pt, i === 0 ? CONST.CLASSES.NODE_SOLID : undefined),
      ) as L.CircleMarker;
      node.bringToFront();
      nodeMarkers.push(node);
    });

    const segLabels: L.Marker[] = [];
    if (data.segments) {
      let accTotal = 0;
      data.segments.forEach((seg, i: number) => {
        accTotal += seg.distance;
        const prev = points[i];
        const cur = points[i + 1] || { lat: seg.lat, lng: seg.lng };
        if (!prev || !cur) return;
        const mid = Util.midpoint(prev, cur);
        const label = manager.layers.addLayer(
          L.marker([mid.lat, mid.lng], {
            icon: Util.makeMidLabelDivIcon(
              Util.formatSegmentLabel(prev, cur, accTotal),
            ),
          }),
          true,
        ) as L.Marker;
        segLabels.push(label);
      });
    }

    attachDistanceUI(manager, {
      layers: manager.layers,
      finalPoly,
      nodeMarkers,
      segLabels,
      points: points,
      onDelete: () => {
        manager.measurements = manager.measurements.filter(x => x.id !== data.id);
        manager.saveMeasurements();
      },
      onUpdate: () => {
        const { segments, totalDistance } = Util.recalculateSegments(points);
        data.points = points.map(p => ({ lng: p.lng, lat: p.lat }));
        data.segments = segments;
        data.totalDistance = totalDistance;
        manager.saveMeasurements();
      },
    });
  }

  start() {
    const points: L.LatLng[] = [];
    let total = 0;
    const poly = this.addPreview(
      L.polyline([], { className: CONST.CLASSES.PATH_DASHED, interactive: false }),
    );
    const nodeMarkers: L.CircleMarker[] = [];
    const segLabels: L.Marker[] = [];
    const previewLine = this.addPreview(
      L.polyline([], { className: CONST.CLASSES.PATH_PREVIEW, interactive: false }),
    );
    const finalPoly = this.layers.addLayer(
      L.polyline([], { className: CONST.CLASSES.PATH_SOLID, interactive: true }),
    ) as L.Polyline;
    let previewDistLabel: L.Marker | null = null;

    this._cleanup = () => {
      unbindMapEvents(this.map, distEvents);
      this.layers.removeLayer(previewLine);
      if (previewDistLabel) {
        this.layers.removeLayer(previewDistLabel);
        previewDistLabel = null;
      }
      this.layers.removeLayer(poly);
      this.layers.removeLayer(finalPoly);
      nodeMarkers.forEach(m => this.layers.removeLayer(m));
      segLabels.forEach(l => this.layers.removeLayer(l));
    };

    const finishDist = () => {
      if (this.isFinished) return;
      if (points.length < 2) {
        this.cleanup();
        this.m.clearActiveMode();
        return;
      }
      this.isFinished = true;
      this.layers.removeLayer(poly);
      finalPoly.setLatLngs(points);

      Util.animateDashSweep(finalPoly.getElement() as SVGElement);

      // Save measurement data
      const distId = this.nextMeasurementId();
      const segments = points.slice(1).map((p, i) => ({
        lng: p.lng,
        lat: p.lat,
        distance: Util.distance(points[i], points[i + 1]),
      }));
      this.m.measurements.push({
        id: distId,
        type: this.type,
        points: points.map(p => ({ lng: p.lng, lat: p.lat })),
        segments,
        totalDistance: total,
      });
      this.m.saveMeasurements();

      // Format last label
      if (segLabels.length > 0) {
        const lastPt = points[points.length - 1];
        const prevPt = points[points.length - 2];
        const mid = Util.midpoint(prevPt, lastPt);
        segLabels[segLabels.length - 1].setLatLng([mid.lat, mid.lng]);
        segLabels[segLabels.length - 1].setIcon(
          Util.makeMidLabelDivIcon(Util.formatSegmentLabel(prevPt, lastPt, total)),
        );
      }

      // Attach toggle/delete UI (shared with restoreDistance)
      const onDistMapClick = attachDistanceUI(this.m, {
        layers: this.layers,
        finalPoly,
        nodeMarkers,
        segLabels,
        points: points,
        onDelete: () => {
          this.m.measurements = this.m.measurements.filter(x => x.id !== distId);
          this.m.saveMeasurements();
        },
        onUpdate: () => {
          const m = this.m.measurements.find(x => x.id === distId);
          if (!m) return;
          const { segments, totalDistance } = Util.recalculateSegments(points);
          m.points = points.map(p => ({ lng: p.lng, lat: p.lat }));
          m.segments = segments;
          m.totalDistance = totalDistance;
          this.m.saveMeasurements();
        },
      });
      this._cleanup = () => this.m.map.off("click", onDistMapClick);

      // Cleanup drawing mode
      unbindMapEvents(this.map, distEvents);
      this.layers.removeLayer(previewLine);
      if (previewDistLabel) {
        this.layers.removeLayer(previewDistLabel);
        previewDistLabel = null;
      }
      this.m.clearActiveMode();
    };

    const onDistMove = (event: L.LeafletMouseEvent) => {
      if (points.length === 0) return;
      previewLine.setLatLngs([points[points.length - 1], event.latlng]);
      const seg = Util.distance(points[points.length - 1], event.latlng);
      const showDist = total + seg;
      const lastPt = points[points.length - 1];
      const mid = Util.midpoint(lastPt, event.latlng);
      const labelText = Util.formatSegmentLabel(lastPt, event.latlng, showDist);
      if (!previewDistLabel) {
        previewDistLabel = this.layers.addLayer(
          L.marker([mid.lat, mid.lng], {
            icon: Util.makeMidLabelDivIcon(labelText),
            interactive: false,
          }),
          true,
        ) as L.Marker;
      } else {
        previewDistLabel!.setLatLng([mid.lat, mid.lng]);
        Util.setLabelText(previewDistLabel, labelText);
      }
    };

    const onDistClick = (event: L.LeafletMouseEvent) => {
      if (this.m.currentMode !== this.type) return;
      if (
        points.some(
          (p: L.LatLng) => p.lat === event.latlng.lat && p.lng === event.latlng.lng,
        )
      )
        return;
      L.DomEvent.stopPropagation(event);
      points.push(event.latlng);
      if (previewDistLabel) {
        this.layers.removeLayer(previewDistLabel);
        previewDistLabel = null;
      }
      poly.addLatLng(event.latlng);

      const marker = this.layers.addLayer(
        Util.makeNode(
          event.latlng,
          points.length === 1 ? CONST.CLASSES.NODE_SOLID : undefined,
        ),
      ) as L.CircleMarker;
      marker.bringToFront();
      nodeMarkers.push(marker);

      marker.on("click", (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event);
        if (points.length < 2) return;
        if (marker === nodeMarkers[nodeMarkers.length - 1]) finishDist();
      });

      if (points.length > 1) {
        const seg = Util.distance(points[points.length - 2], points[points.length - 1]);
        total += seg;

        const mid = Util.midpoint(points[points.length - 2], points[points.length - 1]);

        if (segLabels.length > 0 && points.length >= 3) {
          const prevLabel = segLabels[segLabels.length - 1];
          const prevSeg = Util.distance(
            points[points.length - 3],
            points[points.length - 2],
          );
          prevLabel.setIcon(
            Util.makeMidLabelDivIcon(
              Util.formatSegmentLabel(
                points[points.length - 3],
                points[points.length - 2],
                prevSeg,
              ),
            ),
          );
        }

        const label = this.layers.addLayer(
          L.marker([mid.lat, mid.lng], {
            icon: Util.makeMidLabelDivIcon(
              Util.formatSegmentLabel(
                points[points.length - 2],
                points[points.length - 1],
                total,
              ),
            ),
          }),
          true,
        ) as L.Marker;
        segLabels.push(label);
      }
    };

    const onDistDbl = (event: L.LeafletMouseEvent) => {
      stopEvent(event);
      finishDist();
    };
    const onDistContext = (event: L.LeafletMouseEvent) => {
      stopEvent(event);
      finishDist();
    };

    const distEvents = [
      ["preclick", onDistClick],
      ["click", onDistClick],
      ["dblclick", onDistDbl],
      ["contextmenu", onDistContext],
      ["mousemove", onDistMove],
    ] as MapEventHandlers;
    bindMapEvents(this.map, distEvents);
  }
}

// ==================== Polygon Area Mode ====================
/** Polygon area measurement mode. Click to place nodes, closes on first/last node click. */
class PolygonMode extends PreviewMode {
  static TYPE = CONST.MODE.POLYGON;

  /** Rebuild a persisted polygon measurement.
   *  @param {Object} manager - MeasureManager instance.
   *  @param {Object} data - Persisted measurement data. */
  static restore(manager: MeasureManager, data: MeasureData) {
    const points: L.LatLng[] = data.points!.map((p: { lng: number; lat: number }) =>
      L.latLng(p.lat, p.lng),
    );
    const finalPoly = manager.layers.addLayer(
      L.polygon(points, {
        className: `${CONST.CLASSES.PATH_SOLID} ${CONST.CLASSES.SHAPE_FILL}`,
        interactive: true,
      }),
    ) as L.Polygon; // addLayer ret val narrowed

    const nodeMarkers: L.CircleMarker[] = [];
    points.forEach((pt: L.LatLng) => {
      const node = manager.layers.addLayer(Util.makeNode(pt)) as L.CircleMarker;
      node.bringToFront();
      nodeMarkers.push(node);
    });

    const segLabels: L.Marker[] = [];
    if (data.segments) {
      data.segments.forEach((seg, i: number) => {
        const prev = points[i];
        const cur = points[i + 1] || { lat: seg.lat, lng: seg.lng };
        if (!prev || !cur) return;
        const mid = Util.midpoint(prev, cur);
        const label = manager.layers.addLayer(
          L.marker([mid.lat, mid.lng], {
            icon: Util.makeMidLabelDivIcon(Util.formatDistance(seg.distance)),
          }),
          true,
        ) as L.Marker;
        segLabels.push(label);
      });
    }

    const onMapClickActive = attachPolygonUI(manager, {
      layers: manager.layers,
      finalPoly,
      nodeMarkers,
      segLabels,
      points: points,
      area: data.area ?? 0,
      onDelete: () => {
        manager.measurements = manager.measurements.filter(x => x.id !== data.id);
        manager.saveMeasurements();
      },
      onUpdate: () => {
        const newArea = Util.area(points);
        const { segments } = Util.recalculateSegments(points);
        segments.push({
          lng: points[0].lng,
          lat: points[0].lat,
          distance: Util.distance(points[points.length - 1], points[0]),
        });
        data.points = points.map((p: L.LatLng) => ({ lng: p.lng, lat: p.lat }));
        data.segments = segments;
        data.area = newArea;
        manager.saveMeasurements();
      },
    });
    manager.finalizedClickHandlers.push(onMapClickActive);
  }

  start() {
    const points: L.LatLng[] = [];
    const poly = this.addPreview(
      L.polyline([], { className: CONST.CLASSES.PATH_PREVIEW, interactive: false }),
    );
    const confirmedPoly = this.addPreview(
      L.polyline([], { className: CONST.CLASSES.PATH_DASHED, interactive: false }),
    );
    const previewPoly = this.addPreview(
      L.polygon([], {
        className: `${CONST.CLASSES.PATH_PREVIEW} ${CONST.CLASSES.SHAPE_FILL}`,
        interactive: false,
      }),
    );
    const nodeMarkers: L.CircleMarker[] = [];
    const segLabels: L.Marker[] = [];
    const finalPoly = this.layers.addLayer(
      L.polygon([], {
        className: `${CONST.CLASSES.PATH_SOLID} ${CONST.CLASSES.SHAPE_FILL}`,
        interactive: true,
      }),
    ) as L.Polygon;
    let previewDistLabel: L.Marker | null = null;
    let isFinished = false;

    this._cleanup = () => {
      unbindMapEvents(this.map, polyEvents);
      this.layers.removeLayer(previewPoly);
      this.layers.removeLayer(poly);
      this.layers.removeLayer(confirmedPoly);
      this.layers.removeLayer(finalPoly);
      if (previewDistLabel) {
        this.layers.removeLayer(previewDistLabel);
        previewDistLabel = null;
      }
      nodeMarkers.forEach(m => this.layers.removeLayer(m));
      segLabels.forEach(l => this.layers.removeLayer(l));
    };

    const finishPoly = () => {
      if (isFinished) return;
      if (points.length < 3) {
        this.cleanup();
        this.m.clearActiveMode();
        return;
      }
      isFinished = true;
      this.layers.removeLayer(poly);
      this.layers.removeLayer(previewPoly);
      finalPoly.setLatLngs(points);

      Util.animateDashSweep(finalPoly.getElement() as SVGElement);

      // Recalculate area
      const area = Util.area(points);

      // Save measurement data
      const polyId = this.nextMeasurementId();
      const segments = points.slice(1).map((p, i) => ({
        lng: p.lng,
        lat: p.lat,
        distance: Util.distance(points[i], points[i + 1]),
      }));
      // Add closing segment
      const lastSeg = {
        lng: points[0].lng,
        lat: points[0].lat,
        distance: Util.distance(points[points.length - 1], points[0]),
      };
      segments.push(lastSeg);
      this.m.measurements.push({
        id: polyId,
        type: this.type,
        points: points.map(p => ({ lng: p.lng, lat: p.lat })),
        segments,
        area,
      });
      this.m.saveMeasurements();

      // Add closing segment label
      const lastPt = points[points.length - 1];
      const firstPt = points[0];
      const closeMid = Util.midpoint(lastPt, firstPt);
      const closeLabel = this.layers.addLayer(
        L.marker([closeMid.lat, closeMid.lng], {
          icon: Util.makeMidLabelDivIcon(Util.formatDistance(lastSeg.distance)),
        }),
        true,
      );
      segLabels.push(closeLabel as L.Marker);

      // Format last open segment label (if it exists)
      if (segLabels.length > 1) {
        segLabels[segLabels.length - 2].setIcon(
          Util.makeMidLabelDivIcon(
            Util.formatDistance(segments[segments.length - 2].distance),
          ),
        );
      }

      // Attach toggle/delete UI (shared with restorePolygon)
      const onPolyMapClick = attachPolygonUI(this.m, {
        layers: this.layers,
        finalPoly,
        nodeMarkers,
        segLabels,
        points,
        area,
        onDelete: () => {
          this.m.measurements = this.m.measurements.filter(x => x.id !== polyId);
          this.m.saveMeasurements();
        },
        onUpdate: () => {
          const m = this.m.measurements.find(x => x.id === polyId);
          if (!m) return;
          const { segments } = Util.recalculateSegments(points);
          // Add closing segment
          const n = points.length;
          segments.push({
            lng: points[0].lng,
            lat: points[0].lat,
            distance: Util.distance(points[n - 1], points[0]),
          });
          m.points = points.map(p => ({ lng: p.lng, lat: p.lat }));
          m.segments = segments;
          m.area = Util.area(points);
          this.m.saveMeasurements();
        },
      });
      this._cleanup = () => this.m.map.off("click", onPolyMapClick);
      this.m.finalizedClickHandlers.push(onPolyMapClick);

      // Cleanup drawing mode
      unbindMapEvents(this.map, polyEvents);
      this.layers.removeLayer(previewPoly);
      this.layers.removeLayer(confirmedPoly);
      this.layers.removeLayer(poly);
      if (previewDistLabel) {
        this.layers.removeLayer(previewDistLabel);
        previewDistLabel = null;
      }
      this.m.clearActiveMode();
    };

    const onPolyMove = (event: L.LeafletMouseEvent) => {
      if (points.length === 0) return;
      const allPts = [...points, event.latlng];
      previewPoly.setLatLngs(allPts);
      confirmedPoly.setLatLngs(points);
      poly.setLatLngs([points[points.length - 1], event.latlng]);
      const seg = Util.distance(points[points.length - 1], event.latlng);
      const lastPt = points[points.length - 1];
      const mid = Util.midpoint(lastPt, event.latlng);
      const labelText = Util.formatDistance(seg);
      if (!previewDistLabel) {
        previewDistLabel = this.layers.addLayer(
          L.marker([mid.lat, mid.lng], {
            icon: Util.makeMidLabelDivIcon(labelText),
            interactive: false,
          }),
          true,
        ) as L.Marker;
      } else {
        previewDistLabel.setLatLng([mid.lat, mid.lng]);
        Util.setLabelText(previewDistLabel, labelText);
      }
    };

    const onPolyClick = (event: L.LeafletMouseEvent) => {
      if (this.m.currentMode !== this.type) return;
      // Skip if click is on an existing node marker — the marker's own click
      // handler (registered below) will handle finishing. Without this guard,
      // the map click fires before the marker handler and pushes a duplicate point,
      // creating an extra label at the node position with distance 0.
      if (points.some(p => p.lat === event.latlng.lat && p.lng === event.latlng.lng))
        return;
      // Stop Leaflet propagation so clicking a data layer while drawing does
      // not also trigger the data layer's own click handler.
      L.DomEvent.stopPropagation(event);
      points.push(event.latlng);
      if (previewDistLabel) {
        this.layers.removeLayer(previewDistLabel);
        previewDistLabel = null;
      }
      confirmedPoly.setLatLngs(points);
      previewPoly.setLatLngs(points);
      poly.setLatLngs([points[points.length - 1], event.latlng]);

      const marker = this.layers.addLayer(
        Util.makeNode(event.latlng),
      ) as L.CircleMarker;
      marker.bringToFront();
      nodeMarkers.push(marker);

      marker.on("click", (event: L.LeafletMouseEvent) => {
        // Clicking an existing node must not propagate to the map click
        // handler, which would push a duplicate point and create an
        // overlapping label (e.g. re-clicking the 2nd point of a 2-point
        // Polygon creates a duplicate + "0 m" label that overlaps with
        // the closing segment label).
        L.DomEvent.stopPropagation(event);
        if (points.length < 3) return;
        // Click first or last point → finish
        if (marker === nodeMarkers[0] || marker === nodeMarkers[nodeMarkers.length - 1])
          finishPoly();
      });

      if (points.length > 1) {
        const seg = Util.distance(points[points.length - 2], points[points.length - 1]);

        if (segLabels.length > 0 && points.length >= 3) {
          const prevLabel = segLabels[segLabels.length - 1];
          const prevSeg = Util.distance(
            points[points.length - 3],
            points[points.length - 2],
          );
          prevLabel.setIcon(Util.makeMidLabelDivIcon(Util.formatDistance(prevSeg)));
        }

        const mid = Util.midpoint(points[points.length - 2], points[points.length - 1]);
        const label = this.layers.addLayer(
          L.marker([mid.lat, mid.lng], {
            icon: Util.makeMidLabelDivIcon(Util.formatDistance(seg)),
          }),
          true,
        ) as L.Marker;
        segLabels.push(label);
      }
    };

    const onPolyDbl = (event: L.LeafletMouseEvent) => {
      stopEvent(event);
      finishPoly();
    };
    const onPolyContext = (event: L.LeafletMouseEvent) => {
      stopEvent(event);
      finishPoly();
    };

    const polyEvents = [
      ["preclick", onPolyClick],
      ["click", onPolyClick],
      ["dblclick", onPolyDbl],
      ["contextmenu", onPolyContext],
      ["mousemove", onPolyMove],
    ] as MapEventHandlers;
    bindMapEvents(this.map, polyEvents);
  }
}

// ==================== Circle Mode ====================
/** Circle radius measurement mode. Click center, then click edge. */
class CircleMode extends PreviewMode {
  static TYPE = CONST.MODE.CIRCLE;

  /** Rebuild a persisted circle measurement.
   *  @param {Object} manager - MeasureManager instance.
   *  @param {Object} data - Persisted measurement data. */
  static restore(manager: MeasureManager, data: MeasureData) {
    const centerLatLng = L.latLng(data.center!.lat, data.center!.lng);
    const targetLatLng = L.latLng(data.target!.lat, data.target!.lng);
    const r = data.radius ?? 0;

    const circle = manager.layers.addLayer(
      L.circle(centerLatLng, {
        radius: r,
        className: `${CONST.CLASSES.PATH_SOLID} ${CONST.CLASSES.SHAPE_FILL}`,
        interactive: true,
      }),
    ) as L.Circle;
    const radiusLine = manager.layers.addLayer(
      L.polyline([centerLatLng, targetLatLng], {
        className: CONST.CLASSES.PATH_DASHED,
        interactive: true,
      }),
    ) as L.Polyline;
    const radiusNode = manager.layers.addLayer(
      Util.makeNode(targetLatLng),
    ) as L.CircleMarker;
    const centerFinal = manager.layers.addLayer(
      L.marker(centerLatLng, {
        icon: L.divIcon({
          className: CONST.CENTER_DOT.CLASS,
          html: "",
          iconSize: CONST.CENTER_DOT.SIZE as [number, number],
          iconAnchor: CONST.CENTER_DOT.ANCHOR as [number, number],
        }),
        zIndexOffset: CONST.Z_INDEX.OFFSET,
        interactive: true,
      }),
    ) as L.Marker;
    const delMarker = manager.layers.addLayer(
      makeDelIcon(centerLatLng, { title: _(`${CONF.name}.del_tooltip`) }),
    ) as L.Marker;

    const mid = Util.midpoint(centerLatLng, targetLatLng);
    const radiusLabel = manager.layers.addLayer(
      L.marker([mid.lat, mid.lng], {
        icon: Util.makeLabelDivIcon(
          Util.formatDistance(r),
          CONST.LABEL.RADIUS_ANCHOR as [number, number],
          CONST.LABEL.CLASS_RADIUS,
        ),
        interactive: false,
      }),
      true,
    ) as L.Marker;

    const { onMapClickActive } = attachCircleUI(manager, {
      layers: manager.layers,
      circle,
      radiusLine,
      radiusNode,
      centerFinal,
      delMarker,
      radiusLabel,
      onDelete: () => {
        manager.measurements = manager.measurements.filter(x => x.id !== data.id);
        manager.saveMeasurements();
      },
    });
    manager.finalizedClickHandlers.push(onMapClickActive);
  }

  start() {
    let center: L.LatLng | null = null;
    let state = 0;
    let lastFinishTime = 0;
    let isFinalizing = false;
    const previews: CirclePreviews = {
      center: null,
      circle: null,
      line: null,
      node: null,
      label: null,
    };

    const resetPreviews = () => {
      this.clearPreviews();
      previews.center = null;
      previews.circle = null;
      previews.line = null;
      previews.node = null;
      previews.label = null;
    };

    const onMapClick = (event: L.LeafletMouseEvent) => {
      if (
        isFinalizing ||
        this.m.currentMode !== this.type ||
        (state !== 0 && state !== 1)
      )
        return;
      // Stop Leaflet propagation so clicking a data layer while drawing does
      // not also trigger the data layer's own click handler.
      L.DomEvent.stopPropagation(event);

      if (Date.now() - lastFinishTime < CONST.TIMING.CLICK_COOLDOWN) return;

      if (state === 0) {
        center = event.latlng;
        previews.center = this.addPreview(
          L.marker(center, {
            icon: L.divIcon({
              className: CONST.CENTER_DOT.CLASS,
              html: "",
              iconSize: CONST.CENTER_DOT.SIZE as [number, number],
              iconAnchor: CONST.CENTER_DOT.ANCHOR as [number, number],
            }),
            zIndexOffset: CONST.Z_INDEX.OFFSET,
            interactive: false,
          }),
        );
        state = 1;
        foliplus.showHint(
          CONF.name,
          _(`${CONF.name}.hint_circle_radius`),
          HINT_DURATION.PERSIST,
        );
      } else if (state === 1) {
        const r = Util.distance(center!, event.latlng);
        // Ignore clicks too close to center — radius 0 creates an invisible
        // circle that cannot be interacted with and has no visual effect.
        if (r < 1) return;
        state = 2;
        lastFinishTime = Date.now();
        const savedCenter = center;
        this.cleanup();
        this.m.clearActiveMode();
        isFinalizing = true;
        setTimeout(() => {
          finalizeCircle(savedCenter!, r, event.latlng);
          isFinalizing = false;
        }, CONST.TIMING.FINALIZE_DELAY);
      }
    };

    const onMouseMove = (event: L.LeafletMouseEvent) => {
      if (state !== 1 || !center || this.m.currentMode !== this.type) return;
      const r = Util.distance(center!, event.latlng);

      if (!previews.circle) {
        previews.circle = this.addPreview(
          L.circle(center, {
            radius: r,
            className: `${CONST.CLASSES.PATH_PREVIEW} ${CONST.CLASSES.SHAPE_FILL}`,
            interactive: false,
          }),
        );
      } else previews.circle.setRadius(r);

      if (!previews.line) {
        previews.line = this.addPreview(
          L.polyline([center, event.latlng], {
            className: CONST.CLASSES.PATH_PREVIEW,
            interactive: false,
          }),
        );
      } else previews.line.setLatLngs([center, event.latlng]);

      if (!previews.node) {
        previews.node = this.addPreview(
          L.circleMarker(event.latlng, {
            radius: CONST.MARKER.RADIUS,
            className: CONST.CLASSES.NODE_HOLLOW,
            interactive: false,
          }),
        );
        previews.node.bringToFront();
      } else {
        // Keep the radius node glued to the cursor while drawing.
        previews.node.setLatLng(event.latlng);
      }
      const mid = Util.midpoint(center, event.latlng);
      if (!previews.label) {
        const previewLabel = L.marker(mid, {
          icon: Util.makeLabelDivIcon(
            Util.formatDistance(r),
            CONST.LABEL.RADIUS_ANCHOR as [number, number],
            CONST.LABEL.CLASS_RADIUS,
          ),
          interactive: false,
        });
        previews.label = this.addPreview(previewLabel);
      } else {
        previews.label.setLatLng(mid);
        Util.setLabelText(previews.label, Util.formatDistance(r));
      }
    };

    const onContext = (event: L.LeafletMouseEvent) => {
      stopEvent(event);
      this.m.clearActiveMode();
    };

    const finalizeCircle = (
      centerLatLng: L.LatLng,
      r: number,
      targetLatLng: L.LatLng,
    ) => {
      const finalTargetLatLng =
        targetLatLng || L.CRS.Earth.destination!(centerLatLng, r, 90);

      const circle = this.layers.addLayer(
        L.circle(centerLatLng, {
          radius: r,
          className: `${CONST.CLASSES.PATH_SOLID} ${CONST.CLASSES.SHAPE_FILL}`,
          interactive: true,
        }),
      );

      const ripple = this.layers.addLayer(
        L.circle(centerLatLng, {
          radius: r,
          className: CONST.CLASSES.RIPPLE,
          interactive: false,
        }),
      );
      const rippleEl = (ripple as L.Circle).getElement() as SVGElement | null;
      if (rippleEl) {
        const onEnd = () => {
          rippleEl.removeEventListener("animationend", onEnd);
          this.layers.removeLayer(ripple);
        };
        rippleEl.addEventListener("animationend", onEnd);
      }

      const radiusLine = this.layers.addLayer(
        L.polyline([centerLatLng, finalTargetLatLng], {
          className: CONST.CLASSES.PATH_DASHED,
          interactive: true,
        }),
      );
      const radiusNode = this.layers.addLayer(Util.makeNode(finalTargetLatLng));

      const centerFinal = this.layers.addLayer(
        L.marker(centerLatLng, {
          icon: L.divIcon({
            className: CONST.CENTER_DOT.CLASS,
            html: "",
            iconSize: CONST.CENTER_DOT.SIZE as [number, number],
            iconAnchor: CONST.CENTER_DOT.ANCHOR as [number, number],
          }),
          zIndexOffset: CONST.Z_INDEX.OFFSET,
          interactive: true,
        }),
      );

      const delMarker = this.layers.addLayer(
        makeDelIcon(centerLatLng, { title: _(`${CONF.name}.del_tooltip`) }),
      );

      const mid = Util.midpoint(centerLatLng, finalTargetLatLng);
      const radiusLabel = this.layers.addLayer(
        L.marker([mid.lat, mid.lng], {
          icon: Util.makeLabelDivIcon(
            Util.formatDistance(r),
            CONST.LABEL.RADIUS_ANCHOR as [number, number],
            CONST.LABEL.CLASS_RADIUS,
          ),
          interactive: false,
        }),
        true,
      );

      const circleId = this.nextMeasurementId();
      this.m.measurements.push({
        id: circleId,
        type: this.type,
        center: { lng: centerLatLng.lng, lat: centerLatLng.lat },
        target: { lng: finalTargetLatLng.lng, lat: finalTargetLatLng.lat },
        radius: r,
      });
      this.m.saveMeasurements();

      const { onMapClickActive } = attachCircleUI(this.m, {
        layers: this.layers,
        circle: circle as L.Circle,
        radiusLine: radiusLine as L.Polyline,
        radiusNode: radiusNode as L.CircleMarker,
        centerFinal: centerFinal as L.Marker,
        delMarker: delMarker as L.Marker,
        radiusLabel: radiusLabel as L.Marker,
        onDelete: () => {
          this.m.measurements = this.m.measurements.filter(x => x.id !== circleId);
          this.m.saveMeasurements();
        },
      });
      this.m.finalizedClickHandlers.push(onMapClickActive);
    };

    const circleEvents = [
      ["preclick", onMapClick],
      ["click", onMapClick],
      ["mousemove", onMouseMove],
      ["contextmenu", onContext],
    ] as MapEventHandlers;
    bindMapEvents(this.map, circleEvents);

    this._cleanup = () => {
      unbindMapEvents(this.map, circleEvents);
      resetPreviews();
      foliplus.hideHint(CONF.name);
    };
  }
}

export { CircleMode, DistanceMode, MarkerMode, MeasureMode, PolygonMode, PreviewMode };

/** Map of measurement type → mode class, used to dispatch restore. */
export const MODE_MAP = {
  [CONST.MODE.MARKER]: MarkerMode,
  [CONST.MODE.DISTANCE]: DistanceMode,
  [CONST.MODE.POLYGON]: PolygonMode,
  [CONST.MODE.CIRCLE]: CircleMode,
};
