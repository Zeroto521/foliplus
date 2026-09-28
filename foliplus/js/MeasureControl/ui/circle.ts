// MeasureControl circle UI — finalized circle edit bindings: center/radius drag, radius label, overlay, delete.
import { attachDelClick } from "#common/delicon.js";
import * as CONST from "../const.js";
import { bindNodeDrag, markDragSyntheticClick } from "../edit.js";
import type { MeasureManager } from "../manager.js";
import { attachDelLifecycle } from "../mode/base.js";
import type { DragBind } from "../type.js";
import * as Util from "../util.js";
import { bindOpenOverlay } from "./helper.js";

/** Options for attachCircleUI. */
interface CircleAttachOpts {
  layers: CreateLayersAPI;
  circle: L.Circle;
  radiusLine: L.Polyline | null;
  radiusNode: L.CircleMarker | null;
  centerFinal: L.CircleMarker;
  delMarker: L.Marker;
  radiusLabel: L.Marker | null;
  onDelete: () => void;
  onEnd?: (latlng: L.LatLng) => void;
  /** Measurement id — groups this measurement's edit registrations. */
  id: string;
}

const attachCircleUI = (mgr: MeasureManager, opts: CircleAttachOpts): void => {
  const {
    layers,
    circle,
    radiusLine,
    radiusNode,
    centerFinal,
    delMarker,
    radiusLabel,
    onDelete,
    onEnd,
    id,
  } = opts;

  let unregisterDragToggle: () => void = () => {};
  const dragBinds: DragBind[] = [];
  // The single radius label persists as a marker (updateLabel() only moves and
  // restyles it), so one registration survives for the measurement's life.
  const unregisterRadiusLabel = radiusLabel
    ? mgr.registerLabel(radiusLabel, CONST.LABEL_PRIORITY.RADIUS)
    : () => {};

  const lifecycle = attachDelLifecycle(mgr, layers, [delMarker], {
    id,
    dispose: () => {
      dragBinds.forEach(db => db.cleanup());
      unregisterRadiusLabel();
      unregisterDragToggle();
    },
    removeLayers: () => {
      layers.removeLayer(circle);
      if (radiusLine) layers.removeLayer(radiusLine);
      if (radiusNode) layers.removeLayer(radiusNode);
      layers.removeLayer(centerFinal);
      layers.removeLayer(delMarker);
      if (radiusLabel) layers.removeLayer(radiusLabel);
    },
    onDelete,
  });
  const deleteMeasurement = lifecycle.delete;
  const openOverlay = lifecycle.open;

  const updateLabel = () => {
    if (!radiusLabel) return;
    const r = circle.getRadius();
    const mid = Util.midpoint(circle.getLatLng(), radiusNode!.getLatLng());
    radiusLabel.setLatLng([mid.lat, mid.lng]);
    Util.setLabelText(radiusLabel, Util.formatDistance(r));
  };

  const centerDrag = bindNodeDrag(centerFinal, delMarker, mgr.map, {
    onDrag: (latlng: L.LatLng) => {
      const dx = latlng.lng - circle.getLatLng().lng;
      const dy = latlng.lat - circle.getLatLng().lat;
      circle.setLatLng(latlng);
      centerFinal.setLatLng(latlng);
      delMarker.setLatLng(latlng);
      if (radiusNode) {
        radiusNode.setLatLng({
          lat: radiusNode.getLatLng().lat + dy,
          lng: radiusNode.getLatLng().lng + dx,
        });
      }
      if (radiusLine) radiusLine.setLatLngs([latlng, radiusNode!.getLatLng()]);
      updateLabel();
    },
    onEnd: (latlng: L.LatLng) => {
      markDragSyntheticClick();
      onEnd?.(latlng);
    },
  });
  dragBinds.push(centerDrag);

  if (radiusNode) {
    const radiusDrag = bindNodeDrag(radiusNode, null, mgr.map, {
      onDrag: (latlng: L.LatLng) => {
        radiusNode.setLatLng(latlng);
        circle.setRadius(Util.distance(circle.getLatLng(), latlng));
        if (radiusLine) radiusLine.setLatLngs([circle.getLatLng(), latlng]);
        updateLabel();
      },
      onEnd: (latlng: L.LatLng) => {
        markDragSyntheticClick();
        onEnd?.(latlng);
      },
    });
    dragBinds.push(radiusDrag);
  }

  // Drag is gated by edit mode (not the overlay), so the center/radius node
  // are draggable as soon as edit mode is on — no click-first required.
  unregisterDragToggle = mgr.registerEditDragToggle(
    enabled => dragBinds.forEach(db => db.setEnabled(enabled)),
    id,
  );

  const attachInteraction = (layer: L.Layer) => bindOpenOverlay(layer, openOverlay);

  attachInteraction(circle);
  if (radiusLine) attachInteraction(radiusLine);
  if (radiusNode) attachInteraction(radiusNode);
  attachInteraction(centerFinal);
  if (radiusLabel) attachInteraction(radiusLabel);

  attachDelClick(delMarker, deleteMeasurement);
  bindOpenOverlay(delMarker, openOverlay);
};

export { attachCircleUI };
