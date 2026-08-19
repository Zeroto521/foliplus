import { stopEvent } from "#common/dom.js";
import {
  type MapEventHandlers,
  bindMapEvents,
  unbindMapEvents,
} from "#common/mapEvent.js";
import * as CONST from "../const.js";
import type { MeasureManager } from "../manager.js";
import { attachDistanceUI } from "../ui.js";
import * as Util from "../util.js";
import { PreviewMode } from "./base.js";

// CONF is a free variable from the IIFE template wrapper.

// ==================== Distance Mode ====================
/** Distance measurement mode. Click to place nodes, double-click/context to finish. */
class DistanceMode extends PreviewMode {
  static TYPE = CONST.MODE.DISTANCE;
  static NAME_LABEL = "Distance Measurement";
  static NAME_LABEL_KEY = `${CONF.name}.name_distance`;

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

  static toGeoFeature(data: MeasureData): GeoJSON.Feature {
    return {
      type: "Feature",
      properties: {
        type: this.TYPE,
        name: this.NAME_LABEL,
        totalDistance: data.totalDistance || 0,
        segments: data.segments || [],
      },
      geometry: {
        type: "LineString",
        coordinates: data.points?.map(p => [p.lng, p.lat]) || [],
      },
    };
  }
}

export { DistanceMode };
