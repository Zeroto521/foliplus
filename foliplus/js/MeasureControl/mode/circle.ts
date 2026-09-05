import { HINT_DURATION } from "#core/hint.js";
import { makeDelIcon } from "#common/delicon.js";
import { stopEvent } from "#common/dom.js";
import { createScopedTranslator } from "#common/locale.js";
import {
  type MapEventHandlers,
  bindMapEvents,
  unbindMapEvents,
} from "#common/mapEvent.js";
import * as CONST from "../const.js";
import type { MeasureManager } from "../manager.js";
import { attachCircleUI } from "../ui.js";
import * as Util from "../util.js";
import { PreviewMode } from "./base.js";

// CONF is a free variable from the IIFE template wrapper.
const T = createScopedTranslator(CONF);

interface CirclePreviews {
  center: L.CircleMarker | null;
  circle: L.Circle | null;
  line: L.Polyline | null;
  node: L.CircleMarker | null;
  label: L.Marker | null;
}

// ==================== Circle Mode ====================
/** Circle radius measurement mode. Click center, then click edge. */
class CircleMode extends PreviewMode {
  static TYPE = CONST.MODE.CIRCLE;
  static NAME_LABEL = "Circle Measurement";
  static NAME_LABEL_KEY = "name_circle";

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
      Util.makeNode(centerLatLng, CONST.CLASSES.NODE_SOLID),
      false,
      true,
    ) as L.CircleMarker;
    const delMarker = manager.layers.addLayer(
      makeDelIcon(centerLatLng, { title: T("del_tooltip") }),
    ) as L.Marker;

    // The radius label re-registers with the collision planner
    // (attachCircleUI), which replans it inside a requestAnimationFrame.
    // Adding it here, ahead of the stack, lets that re-plan detach it before
    // the shapes are attached — the circle disappears while its label stays.
    // It is a marker in measure_label, a pane that already sits above
    // measure_graph, so the stack is irrelevant to it.
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

    attachCircleUI(manager, {
      layers: manager.layers,
      circle,
      radiusLine,
      radiusNode,
      centerFinal,
      delMarker,
      radiusLabel,
      id: data.id!,
      onDelete: () => manager.store.remove(data.id!),
      onEnd: () => {
        const center = circle.getLatLng();
        const target = radiusNode!.getLatLng();
        const r = circle.getRadius();
        data.center = { lng: center.lng, lat: center.lat };
        data.target = { lng: target.lng, lat: target.lat };
        data.radius = r;
        data.area = Math.PI * r * r;
        manager.store.persist();
      },
    });
  }

  start() {
    let center: L.LatLng | null = null;
    let phase = 0;
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
        (phase !== 0 && phase !== 1)
      )
        return;
      // Stop Leaflet propagation so clicking a data layer while drawing does
      // not also trigger the data layer's own click handler.
      L.DomEvent.stopPropagation(event);

      if (Date.now() - lastFinishTime < CONST.TIMING.CLICK_COOLDOWN) return;

      if (phase === 0) {
        center = event.latlng;
        // The center is placed before any shape exists, so its position in the
        // graph pane is fixed at the bottom for the whole drawing session. The
        // radius line is attached later, so it would paint over the dot. The
        // dot is routed to the node pane instead of re-attached — re-attaching
        // cannot move it, `L.SVG._initPath` re-creates the `<path>` and the new
        // node enters the renderer's layer map in the same place.
        previews.center = this.addPreview(
          Util.makePreviewNode(center, CONST.CLASSES.NODE_SOLID),
          false,
          true,
        );
        phase = 1;
        map.foliplus!.showHint(
          CONF.name,
          T("hint_circle_radius"),
          HINT_DURATION.PERSIST,
        );
      } else if (phase === 1) {
        const r = Util.distance(center!, event.latlng);
        // Ignore clicks too close to center — radius 0 creates an invisible
        // circle that cannot be interacted with and has no visual effect.
        if (r < 1) return;
        phase = 2;
        lastFinishTime = Date.now();
        const savedCenter = center;
        this.cleanup();
        this.m.clearActiveMode();
        isFinalizing = true;
        setTimeout(() => {
          finishCircle(savedCenter!, r, event.latlng);
          isFinalizing = false;
        }, CONST.TIMING.FINALIZE_DELAY);
      }
    };

    const onMouseMove = (event: L.LeafletMouseEvent) => {
      if (phase !== 1 || !center || this.m.currentMode !== this.type) return;
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

      // The node is attached after the circle and radius line, so those two
      // can never paint over it as the cursor moves.
      if (!previews.node)
        previews.node = this.addPreview(Util.makePreviewNode(event.latlng), false, true);
      else previews.node.setLatLng(event.latlng);

      // Only the label is re-anchored afterwards, so every shape is attached
      // exactly once and the stack is settled: fill → radius line → radius node.
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
        previews.label = this.addPreview(previewLabel, true);
      } else {
        previews.label.setLatLng(mid);
        Util.setLabelText(previews.label, Util.formatDistance(r));
      }
    };

    const onContext = (event: L.LeafletMouseEvent) => {
      stopEvent(event);
      this.m.clearActiveMode();
    };

    const finishCircle = (
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
      // The center also gets the node pane, matching `restore`: the preview
      // center is already in it, and swapping panes would re-add the path.
      const radiusNode = this.layers.addLayer(Util.makeNode(finalTargetLatLng));
      const centerFinal = this.layers.addLayer(
        Util.makeNode(centerLatLng, CONST.CLASSES.NODE_SOLID),
        false,
        true,
      );

      const delMarker = this.layers.addLayer(
        makeDelIcon(centerLatLng, { title: T("del_tooltip") }),
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
      this.m.store.add({
        id: circleId,
        type: this.type,
        center: { lng: centerLatLng.lng, lat: centerLatLng.lat },
        target: { lng: finalTargetLatLng.lng, lat: finalTargetLatLng.lat },
        radius: r,
        area: Math.PI * r * r,
      });

      attachCircleUI(this.m, {
        layers: this.layers,
        circle: circle as L.Circle,
        radiusLine: radiusLine as L.Polyline,
        radiusNode: radiusNode as L.CircleMarker,
        centerFinal: centerFinal as L.CircleMarker,
        delMarker: delMarker as L.Marker,
        radiusLabel: radiusLabel as L.Marker,
        id: circleId,
        onDelete: () => {
          this.m.store.remove(circleId);
        },
        onEnd: () => {
          const m = this.m.store.all().find(x => x.id === circleId);
          if (!m) return;
          const c = circle as L.Circle;
          const n = radiusNode as L.CircleMarker;
          const center = c.getLatLng();
          const target = n.getLatLng();
          const r = c.getRadius();
          m.center = { lng: center.lng, lat: center.lat };
          m.target = { lng: target.lng, lat: target.lat };
          m.radius = r;
          m.area = Math.PI * r * r;
          this.m.store.persist();
        },
      });
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
      map.foliplus!.hideHint(CONF.name);
    };
  }

  /** GeoJSON feature for a circle — properties carry id, radius and center. */
  static toGeoFeature(data: MeasureData): GeoJSON.Feature {
    const center = data.center;
    const r = data.radius || 0;
    if (!center || r <= 0) {
      return {
        type: CONST.GEOJSON.FEATURE,
        properties: { id: data.id, type: this.TYPE, radius: r },
        geometry: {
          type: CONST.GEOJSON.POINT,
          coordinates: [center?.lng || 0, center?.lat || 0],
        },
      };
    }
    const circle = turf.circle([center.lng, center.lat], r / 1000, {
      steps: 64,
      units: "kilometers",
    });
    return {
      type: CONST.GEOJSON.FEATURE,
      properties: {
        id: data.id,
        type: this.TYPE,
        name: this.getNameLabel(),
        radius: r,
        center,
        area: data.area,
      },
      geometry: {
        type: CONST.GEOJSON.POLYGON,
        coordinates: circle.geometry.coordinates,
      },
    };
  }
}

export { CircleMode };
