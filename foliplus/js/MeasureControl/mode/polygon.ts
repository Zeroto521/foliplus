import { stopEvent } from "#common/dom.js";
import {
  type MapEventHandlers,
  bindMapEvents,
  unbindMapEvents,
} from "#common/mapEvent.js";
import * as CONST from "../const.js";
import type { MeasureManager } from "../manager.js";
import { attachPolygonUI } from "../ui.js";
import * as Util from "../util.js";
import { PreviewMode } from "./base.js";

// CONF is a free variable from the IIFE template wrapper.

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
  static toGeoFeature(data: MeasureData): GeoJSON.Feature {
    const coords = data.points?.map(p => [p.lng, p.lat]) || [];
    if (coords.length > 1) coords.push(coords[0]);
    return {
      type: "Feature",
      properties: { type: "polygon", name: "Area Measurement", area: data.area || 0 },
      geometry: { type: "Polygon", coordinates: [coords] },
    };
  }
}

export { PolygonMode };
