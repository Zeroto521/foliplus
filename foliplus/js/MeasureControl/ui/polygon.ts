// MeasureControl polygon UI — finalized polygon edit bindings: nodes, segment labels, centroid, drag, overlay, delete.
import { attachDelClick, makeDelIcon, toggleDelIcon } from "#common/delicon.js";
import { stopEvent } from "#common/dom.js";
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

/** Options for attachPolygonUI. */
interface PolygonAttachOpts {
  layers: CreateLayersAPI;
  finalPoly: L.Polygon;
  nodeMarkers: L.CircleMarker[];
  segLabels: L.Marker[];
  onDelete: () => void;
  onUpdate: () => void;
  points: L.LatLng[];
  area: number;
  /** Measurement id — groups this measurement's edit registrations. */
  id: string;
}

const attachPolygonUI = (mgr: MeasureManager, opts: PolygonAttachOpts): void => {
  const {
    layers,
    finalPoly,
    nodeMarkers,
    segLabels,
    onDelete,
    onUpdate,
    points,
    area: initArea,
    id,
  } = opts;
  const nodeDelMarkers: L.Marker[] = [];
  const dragBinds: DragBind[] = [];
  let unregisterDragToggle: () => void = () => {};
  let centroidDot: L.CircleMarker | null = null;
  let centroidLabel: L.Marker | null = null;
  let centroidDelMarker: L.Marker | null = null;
  // The initial labels arrive from the drawing mode; relabel() re-issues the
  // registrations when a drag or node delete recreates the markers.
  let unregisterSegLabels = bindSegmentLabels(mgr, segLabels);
  let unregisterCentroid: () => void = () => {};

  const lifecycle = attachDelLifecycle(mgr, layers, nodeDelMarkers, {
    id,
    onOpen: () => {
      nodeDelMarkers.forEach(m => toggleDelIcon(m, true));
      if (centroidDelMarker) toggleDelIcon(centroidDelMarker, true);
    },
    onEmpty: () => {
      nodeDelMarkers.forEach(m => toggleDelIcon(m, false));
      if (centroidDelMarker) toggleDelIcon(centroidDelMarker, false);
    },
    dispose: () => {
      dragBinds.forEach(db => db.cleanup());
      unregisterSegLabels();
      unregisterCentroid();
      unregisterDragToggle();
    },
    removeLayers: () => {
      layers.removeLayer(finalPoly, ...nodeMarkers, ...segLabels, ...nodeDelMarkers);
      if (centroidDot) layers.removeLayer(centroidDot);
      if (centroidLabel) layers.removeLayer(centroidLabel);
      if (centroidDelMarker) layers.removeLayer(centroidDelMarker);
    },
    onDelete,
  });
  const deleteMeasurement = lifecycle.delete;
  const openOverlay = lifecycle.open;

  const relabel = () => {
    const area = Util.area(points);
    if (centroidLabel) Util.setLabelText(centroidLabel, Util.formatArea(area));
    segLabels.forEach(l => layers.removeLayer(l));
    segLabels.length = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const mid = Util.midpoint(points[i], points[next]);
      const label = layers.addLayer(
        L.marker([mid.lat, mid.lng], {
          icon: Util.makeMidLabelDivIcon(
            Util.formatDistance(Util.distance(points[i], points[next])),
          ),
        }),
        CONST.PANES.LABEL,
      ) as L.Marker;
      segLabels.push(label);
      label.on("click", openOverlay);
    }
    unregisterSegLabels();
    unregisterSegLabels = bindSegmentLabels(mgr, segLabels);
    const centroid = Util.centroid(points);
    if (centroidDot) centroidDot.setLatLng(centroid);
    if (centroidLabel) centroidLabel.setLatLng(centroid);
    if (centroidDelMarker) centroidDelMarker.setLatLng(centroid);
  };

  const rebuildCentroid = (currentArea?: number) => {
    const area = currentArea !== undefined ? currentArea : initArea;
    const centroid = Util.centroid(points);
    // The centroid dot is a CircleMarker (SVG path) in the node pane —
    // same approach as the circle center. The node pane paints above the
    // graph pane by pane z-index, so the dot always covers the fill.
    // The centroid label lives in the label pane (z = graph + 2), which
    // paints above the node pane. Segment labels (also in the label pane)
    // sit at z = Y; after zoom `sortLayers` re-sorts by Y, so the label's
    // offset (2000) keeps it above its own segment labels.
    centroidDot = layers.addLayer(
      Util.makeNode(centroid, CONST.CLASSES.NODE_SOLID),
      CONST.PANES.NODE,
    ) as L.CircleMarker;
    centroidLabel = layers.addLayer(
      L.marker(centroid, {
        icon: Util.makeLabelDivIcon(
          Util.formatArea(area),
          CONST.LABEL.CENTROID_ANCHOR as [number, number],
        ),
        zIndexOffset: CONST.LABEL.CENTROID_Z_OFFSET,
        interactive: false,
      }),
      CONST.PANES.LABEL,
    ) as L.Marker;
    unregisterCentroid = mgr.registerLabel(
      centroidLabel,
      CONST.LABEL_PRIORITY.CENTROID,
    );
    centroidDelMarker = layers.addLayer(
      makeDelIcon(centroid, { title: mgr.T("del_all") }),
      CONST.PANES.NODE,
    ) as L.Marker;
    attachDelClick(centroidDelMarker, deleteMeasurement);
  };

  // Drag is gated by edit mode (not the overlay), so nodes are draggable as
  // soon as edit mode is on — no click-first required.
  unregisterDragToggle = mgr.registerEditDragToggle(
    enabled => dragBinds.forEach(db => db.setEnabled(enabled)),
    id,
  );

  finalPoly.on("click", openOverlay);
  nodeMarkers.forEach(m => m.on("click", openOverlay));
  segLabels.forEach(l => l.on("click", openOverlay));

  rebuildCentroid(initArea);
  centroidDot!.on("click", openOverlay);
  (centroidDelMarker as L.Marker | null)?.on("click", openOverlay);

  nodeMarkers.forEach(node => {
    const is3pt = points.length === 3;
    const delMarker = layers.addLayer(
      makeDelIcon(node.getLatLng(), {
        title: is3pt ? mgr.T("del_all") : mgr.T("del_node"),
      }),
      CONST.PANES.NODE,
    ) as L.Marker;
    nodeDelMarkers.push(delMarker);

    if (is3pt) attachDelClick(delMarker, deleteMeasurement);
    else {
      attachDelClick(delMarker, () => {
        const latlng = node.getLatLng();
        const ptIdx = findPointIndex(points, latlng);
        if (ptIdx === -1) return;
        points.splice(ptIdx, 1);
        layers.removeLayer(node, delMarker);
        nodeMarkers.splice(ptIdx, 1);
        nodeDelMarkers.splice(ptIdx, 1);
        dragBinds.splice(ptIdx, 1)[0]?.cleanup();

        if (points.length < 3) {
          deleteMeasurement();
          return;
        }

        if (points.length === 3) {
          nodeDelMarkers.forEach(d => {
            d.off("click");
            d.on("click", (event: L.LeafletMouseEvent) => {
              const t = Util.getEventTarget(event);
              if (t?.closest?.(CONST.SEL.DEL_ICON)) {
                stopEvent(event);
                deleteMeasurement();
              } else openOverlay(event);
            });
            const iconEl = d.getElement();
            if (iconEl) iconEl.title = mgr.T("del_all");
          });
        }

        finalPoly.setLatLngs(points);
        relabel();
        if (onUpdate) {
          opts.area = Util.area(points);
          onUpdate();
        }
      });
    }

    bindOpenOverlay(delMarker, openOverlay);

    const findPtIdx = () => findPointIndex(points, node.getLatLng());
    const db = bindNodeDrag(node, delMarker, mgr.map, {
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
        if (onUpdate) {
          opts.area = Util.area(points);
          onUpdate();
        }
      },
    });
    dragBinds.push(db);
  });

  // Dragging the centroid translates the whole polygon (mirrors the circle
  // center drag). Pushed AFTER the node binds so dragBinds[i] lines up with
  // nodeMarkers[i] — the node-delete handler splices by node index.
  dragBinds.push(
    bindNodeDrag(centroidDot!, centroidDelMarker, mgr.map, {
      onDrag: (latlng: L.LatLng) => {
        const dx = latlng.lng - centroidDot!.getLatLng().lng;
        const dy = latlng.lat - centroidDot!.getLatLng().lat;
        points.forEach((p, i) => {
          p.lat += dy;
          p.lng += dx;
          nodeMarkers[i]?.setLatLng(p);
          nodeDelMarkers[i]?.setLatLng(p);
        });
        finalPoly.setLatLngs(points);
        relabel();
      },
      onEnd: (latlng: L.LatLng) => {
        markDragSyntheticClick();
        if (onUpdate) {
          opts.area = Util.area(points);
          onUpdate();
        }
      },
    }),
  );

  resortLayers(layers, nodeMarkers, nodeDelMarkers, segLabels);
};

export { attachPolygonUI };
