// MeasureControl distance UI — finalized distance edit bindings: node ✕ handles, segment labels, drag, overlay, delete.
import { attachDelClick, makeDelIcon } from "#common/delicon.js";
import * as CONST from "../const.js";
import { bindNodeDrag, markDragSyntheticClick } from "../edit.js";
import type { MeasureManager } from "../manager.js";
import { attachDelLifecycle } from "../mode/base.js";
import * as Util from "../util.js";
import {
  type DragBind,
  bindOpenOverlay,
  bindSegmentLabels,
  findPointIndex,
  resortLayers,
} from "./helpers.js";

/** Options for attachDistanceUI. */
interface AttachOpts {
  layers: CreateLayersAPI;
  finalPoly: L.Polyline;
  nodeMarkers: L.CircleMarker[];
  segLabels: L.Marker[];
  onDelete: () => void;
  onUpdate: (points: L.LatLng[]) => void;
  points: L.LatLng[];
  /** Measurement id — groups this measurement's edit registrations. */
  id: string;
}

const attachDistanceUI = (mgr: MeasureManager, opts: AttachOpts): void => {
  const { layers, finalPoly, nodeMarkers, segLabels, onDelete, onUpdate, points, id } =
    opts;
  // The last label ends with the cumulative total, so it wins a collision
  // against any per-segment label — losing it would drop the line's length.
  const totalPriority = (i: number): number =>
    i === segLabels.length - 1
      ? CONST.LABEL_PRIORITY.TOTAL
      : CONST.LABEL_PRIORITY.SEGMENT;
  const nodeDelMarkers: L.Marker[] = [];
  const dragBinds: DragBind[] = [];
  let unregisterSegLabels = bindSegmentLabels(mgr, segLabels, totalPriority);
  let unregisterDragToggle: () => void = () => {};

  const relabel = () => {
    let cumulative = 0;
    segLabels.forEach((label, i) => {
      cumulative += Util.distance(points[i], points[i + 1]);
      const mid = Util.midpoint(points[i], points[i + 1]);
      label.setLatLng([mid.lat, mid.lng]);
      label.setIcon(
        Util.makeMidLabelDivIcon(
          Util.formatSegmentLabel(points[i], points[i + 1], cumulative),
        ),
      );
    });
    // Unregister the previous registrations before re-binding, otherwise the
    // old entries leak into collidableLabels and the planner hides the
    // duplicates — labels vanish after the first node drag.
    unregisterSegLabels();
    unregisterSegLabels = bindSegmentLabels(mgr, segLabels, totalPriority);
  };

  const lifecycle = attachDelLifecycle(mgr, layers, nodeDelMarkers, {
    id,
    dispose: () => {
      dragBinds.forEach(db => db.cleanup());
      unregisterSegLabels();
      unregisterDragToggle();
    },
    removeLayers: () => {
      layers.removeLayer(finalPoly, ...nodeMarkers, ...segLabels, ...nodeDelMarkers);
    },
    onDelete,
  });
  const deleteMeasurement = lifecycle.delete;
  const openOverlay = lifecycle.open;
  // Drag is gated by edit mode (not the overlay), so nodes are draggable as
  // soon as edit mode is on — no click-first required.
  unregisterDragToggle = mgr.registerEditDragToggle(
    enabled => dragBinds.forEach(db => db.setEnabled(enabled)),
    id,
  );

  nodeMarkers.forEach((node, idx) => {
    const isFirst = idx === 0;
    const isLastWhenTwo = points.length === 2 && idx === 1;
    const delMarker = layers.addLayer(
      makeDelIcon(node.getLatLng(), {
        title: isFirst || isLastWhenTwo ? mgr.T("del_all") : mgr.T("del_node"),
      }),
      CONST.PANES.NODE,
    ) as L.Marker;
    nodeDelMarkers.push(delMarker);

    if (isFirst || isLastWhenTwo) attachDelClick(delMarker, deleteMeasurement);
    else {
      attachDelClick(delMarker, () => {
        const latlng = node.getLatLng();
        const ptIdx = findPointIndex(points, latlng);
        if (ptIdx === -1) return;
        const lblIdx = ptIdx - 1;
        points.splice(ptIdx, 1);
        layers.removeLayer(node, delMarker);
        if (lblIdx >= 0 && lblIdx < segLabels.length) {
          layers.removeLayer(segLabels[lblIdx]);
          segLabels.splice(lblIdx, 1);
        }
        nodeMarkers.splice(ptIdx, 1);
        nodeDelMarkers.splice(ptIdx, 1);
        dragBinds.splice(ptIdx, 1)[0]?.cleanup();

        if (points.length < 2) {
          deleteMeasurement();
          return;
        }

        if (points.length === 2 && nodeDelMarkers.length === 2) {
          const lastDelMarker = nodeDelMarkers[1];
          if (lastDelMarker) {
            // The last endpoint's ✕ previously delegated to "delete a single
            // node" + "open the overlay". After collapsing to 2 points it must
            // switch to "delete the whole distance" while keeping the overlay
            // opener — mirroring how polygon rebinds both in the 3pt case.
            lastDelMarker.off("click");
            attachDelClick(lastDelMarker, deleteMeasurement);
            bindOpenOverlay(lastDelMarker, openOverlay);
            const iconEl = lastDelMarker.getElement();
            if (iconEl) iconEl.title = mgr.T("del_all");
          }
        }

        finalPoly.setLatLngs(points);
        relabel();
        if (onUpdate) onUpdate(points);
      });
    }

    bindOpenOverlay(delMarker, openOverlay);

    const findPtIdx = () => findPointIndex(points, node.getLatLng());

    let db;
    if (isFirst) {
      // The solid start point translates the whole distance (like the circle
      // center / polygon centroid); hollow nodes reshape instead.
      db = bindNodeDrag(node, delMarker, mgr.map, {
        onDrag: (latlng: L.LatLng) => {
          const origin = node.getLatLng(); // still the old pos (onDrag runs first)
          const dLat = latlng.lat - origin.lat;
          const dLng = latlng.lng - origin.lng;
          for (let i = 0; i < points.length; i++) {
            points[i] = L.latLng(points[i].lat + dLat, points[i].lng + dLng);
          }
          finalPoly.setLatLngs(points);
          nodeMarkers.forEach((m, i) => m.setLatLng(points[i]));
          nodeDelMarkers.forEach((d, i) => d.setLatLng(points[i]));
          relabel();
        },
        onEnd: () => {
          markDragSyntheticClick();
          if (onUpdate) onUpdate(points);
        },
      });
    } else {
      db = bindNodeDrag(node, delMarker, mgr.map, {
        onDrag: (latlng: L.LatLng) => {
          const pIdx = findPtIdx();
          if (pIdx === -1) return;
          points[pIdx] = latlng;
          finalPoly.setLatLngs(points);
          relabel();
        },
        onEnd: (latlng: L.LatLng) => {
          markDragSyntheticClick();
          const pIdx = findPtIdx();
          if (pIdx === -1) return;
          points[pIdx] = latlng;
          if (onUpdate) onUpdate(points);
        },
      });
    }
    dragBinds.push(db);
  });

  finalPoly.on("click", openOverlay);
  nodeMarkers.forEach(m => m.on("click", openOverlay));
  segLabels.forEach(l => l.on("click", openOverlay));

  resortLayers(layers, nodeMarkers, nodeDelMarkers, segLabels);
};

export { attachDistanceUI };
