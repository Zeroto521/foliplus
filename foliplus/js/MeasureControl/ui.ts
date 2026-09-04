// MeasureControl UI — standalone functions invoked with a MeasureManager context.
import { attachDelClick, makeDelIcon, toggleDelIcon } from "#common/delicon.js";
import { stopEvent } from "#common/dom.js";
import { createScopedTranslator } from "#common/locale.js";
import * as CONST from "./const.js";
import type { MeasureManager } from "./manager.js";
import * as Util from "./util.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const T = createScopedTranslator(CONF);

/**
 * Re-order layers so they render in the correct z-order.
 * Removes and re-adds each collection in sequence.
 */
const resortLayers = (layers: CreateLayersAPI, ...collections: L.Layer[][]): void => {
  collections.forEach(c => c.forEach(l => layers.removeLayer(l)));
  collections.forEach(c => c.forEach(l => layers.addLayer(l)));
};

/**
 * Bind a click handler that opens the edit overlay, unless the click landed on
 * the layer's own ✕ handle (attachDelClick handles deletion there, so opening
 * the overlay would fight it).
 */
const bindOpenOverlay = (
  layer: L.Layer,
  openOverlay: (event: L.LeafletMouseEvent) => void,
): void => {
  layer.on("click", (event: L.LeafletMouseEvent) => {
    const t = Util.getEventTarget(event);
    if (t?.closest?.(CONST.SEL.DEL_ICON)) return;
    openOverlay(event);
  });
};

/** Handle returned by Util.bindNodeDrag — enable/disable + unbind a node drag. */
interface DragBind {
  setEnabled: (enabled: boolean) => void;
  cleanup: () => void;
}

/** Index of `target` in `points` (exact lat/lng match, with float tolerance).
 *  Nodes are created at point coordinates and moved in lockstep with them, so
 *  a tight tolerance is safe and avoids matching a nearby-but-different node. */
const findPointIndex = (points: L.LatLng[], target: L.LatLng): number => {
  return points.findIndex(
    (p: L.LatLng) =>
      Math.abs(p.lat - target.lat) < 1e-9 && Math.abs(p.lng - target.lng) < 1e-9,
  );
};

/** Options for attachDistanceUI. */
interface AttachOpts {
  layers: CreateLayersAPI;
  finalPoly: L.Polyline;
  nodeMarkers: L.CircleMarker[];
  segLabels: L.Marker[];
  onDelete: () => void;
  onUpdate: (points: L.LatLng[]) => void;
  points: L.LatLng[];
}

const attachDistanceUI = (mgr: MeasureManager, opts: AttachOpts): void => {
  const { layers, finalPoly, nodeMarkers, segLabels, onDelete, onUpdate, points } =
    opts;
  const nodeDelMarkers: L.Marker[] = [];
  const dragBinds: DragBind[] = [];

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
  };

  const onOpen = () => {
    nodeDelMarkers.forEach(m => toggleDelIcon(m, true));
  };
  const onEmpty = () => {
    nodeDelMarkers.forEach(m => toggleDelIcon(m, false));
  };
  const overlay = Util.buildEditOverlay(mgr, { onOpen, onEmpty });
  const openOverlay = overlay.open;
  // Drag is gated by edit mode (not the overlay), so nodes are draggable as
  // soon as edit mode is on — no click-first required.
  const unregisterDragToggle = mgr.registerEditDragToggle(enabled =>
    dragBinds.forEach(db => db.setEnabled(enabled)),
  );

  // Single dispose owns every binding; delete and clearAll/destroy both run it.
  const dispose = () => {
    dragBinds.forEach(db => db.cleanup());
    overlay.cleanup();
    unregisterDragToggle();
  };
  const unregisterFinalized = mgr.registerFinalized(dispose);

  const deleteMeasurement = () => {
    unregisterFinalized();
    dispose();
    layers.removeLayer(finalPoly, ...nodeMarkers, ...segLabels, ...nodeDelMarkers);
    onDelete();
    layers.unregister();
  };

  nodeMarkers.forEach((node, idx) => {
    const isFirst = idx === 0;
    const isLastWhenTwo = points.length === 2 && idx === 1;
    const delMarker = layers.addLayer(
      makeDelIcon(node.getLatLng(), {
        title: isFirst || isLastWhenTwo ? T("del_all") : T("del_node"),
      }),
    ) as L.Marker;
    nodeDelMarkers.push(delMarker);

    if (isFirst || isLastWhenTwo) attachDelClick(delMarker, deleteMeasurement);
    else
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
            lastDelMarker.off("click");
            attachDelClick(lastDelMarker, deleteMeasurement);
            const iconEl = lastDelMarker.getElement();
            if (iconEl) iconEl.title = T("del_all");
          }
        }

        finalPoly.setLatLngs(points);
        relabel();
        if (onUpdate) onUpdate(points);
      });

    bindOpenOverlay(delMarker, openOverlay);

    const findPtIdx = () => findPointIndex(points, node.getLatLng());

    let db;
    if (isFirst) {
      // The solid start point translates the whole distance (like the circle
      // center / polygon centroid); hollow nodes reshape instead.
      db = Util.bindNodeDrag(node, delMarker, mgr.map, {
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
          Util.markDragSyntheticClick();
          if (onUpdate) onUpdate(points);
        },
      });
    } else {
      db = Util.bindNodeDrag(node, delMarker, mgr.map, {
        onDrag: (latlng: L.LatLng) => {
          const pIdx = findPtIdx();
          if (pIdx === -1) return;
          points[pIdx] = latlng;
          finalPoly.setLatLngs(points);
          relabel();
        },
        onEnd: (latlng: L.LatLng) => {
          Util.markDragSyntheticClick();
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

/** Options for attachCircleUI. */
interface CircleAttachOpts {
  layers: CreateLayersAPI;
  circle: L.Circle;
  radiusLine: L.Polyline | null;
  radiusNode: L.CircleMarker | null;
  centerFinal: L.Marker;
  delMarker: L.Marker;
  radiusLabel: L.Marker | null;
  onDelete: () => void;
  onEnd?: (latlng: L.LatLng) => void;
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
  } = opts;

  let unregisterDragToggle: () => void = () => {};
  const dragBinds: DragBind[] = [];

  const onOpen = () => {
    toggleDelIcon(delMarker, true);
  };
  const onEmpty = () => {
    toggleDelIcon(delMarker, false);
  };
  const overlay = Util.buildEditOverlay(mgr, { onOpen, onEmpty });
  const openOverlay = overlay.open;

  // Single dispose owns every binding; delete and clearAll/destroy both run it.
  const dispose = () => {
    dragBinds.forEach(db => db.cleanup());
    overlay.cleanup();
    unregisterDragToggle();
  };
  const unregisterFinalized = mgr.registerFinalized(dispose);

  const deleteMeasurement = () => {
    unregisterFinalized();
    dispose();
    layers.removeLayer(circle);
    if (radiusLine) layers.removeLayer(radiusLine);
    if (radiusNode) layers.removeLayer(radiusNode);
    if (centerFinal) layers.removeLayer(centerFinal);
    layers.removeLayer(delMarker);
    if (radiusLabel) layers.removeLayer(radiusLabel);
    onDelete();
    layers.unregister();
  };

  const updateLabel = () => {
    if (!radiusLabel) return;
    const r = circle.getRadius();
    const mid = Util.midpoint(circle.getLatLng(), radiusNode!.getLatLng());
    radiusLabel.setLatLng([mid.lat, mid.lng]);
    Util.setLabelText(radiusLabel, Util.formatDistance(r));
  };

  const centerDrag = Util.bindNodeDrag(centerFinal, delMarker, mgr.map, {
    onDrag: (latlng: L.LatLng) => {
      const dx = latlng.lng - circle.getLatLng().lng;
      const dy = latlng.lat - circle.getLatLng().lat;
      circle.setLatLng(latlng);
      centerFinal.setLatLng(latlng);
      delMarker.setLatLng(latlng);
      if (radiusNode)
        radiusNode.setLatLng({
          lat: radiusNode.getLatLng().lat + dy,
          lng: radiusNode.getLatLng().lng + dx,
        });
      if (radiusLine) radiusLine.setLatLngs([latlng, radiusNode!.getLatLng()]);
      updateLabel();
    },
    onEnd: (latlng: L.LatLng) => {
      Util.markDragSyntheticClick();
      onEnd?.(latlng);
    },
  });
  dragBinds.push(centerDrag);

  if (radiusNode) {
    const radiusDrag = Util.bindNodeDrag(radiusNode, null, mgr.map, {
      onDrag: (latlng: L.LatLng) => {
        radiusNode.setLatLng(latlng);
        circle.setRadius(Util.distance(circle.getLatLng(), latlng));
        if (radiusLine) radiusLine.setLatLngs([circle.getLatLng(), latlng]);
        updateLabel();
      },
      onEnd: (latlng: L.LatLng) => {
        Util.markDragSyntheticClick();
        onEnd?.(latlng);
      },
    });
    dragBinds.push(radiusDrag);
  }

  // Drag is gated by edit mode (not the overlay), so the center/radius node
  // are draggable as soon as edit mode is on — no click-first required.
  unregisterDragToggle = mgr.registerEditDragToggle(enabled =>
    dragBinds.forEach(db => db.setEnabled(enabled)),
  );

  const attachInteraction = (layer: L.Layer) => bindOpenOverlay(layer, openOverlay);

  attachInteraction(circle);
  if (radiusLine) attachInteraction(radiusLine);
  if (radiusNode) attachInteraction(radiusNode);
  if (centerFinal) attachInteraction(centerFinal);
  if (radiusLabel) attachInteraction(radiusLabel);

  attachDelClick(delMarker, deleteMeasurement);
  bindOpenOverlay(delMarker, openOverlay);
};

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
  } = opts;
  const nodeDelMarkers: L.Marker[] = [];
  const dragBinds: DragBind[] = [];
  let unregisterDragToggle: () => void = () => {};
  let centroidDot: L.Marker | null = null;
  let centroidLabel: L.Marker | null = null;
  let centroidDelMarker: L.Marker | null = null;

  const onOpen = () => {
    nodeDelMarkers.forEach(m => toggleDelIcon(m, true));
    if (centroidDelMarker) toggleDelIcon(centroidDelMarker, true);
  };
  const onEmpty = () => {
    nodeDelMarkers.forEach(m => toggleDelIcon(m, false));
    if (centroidDelMarker) toggleDelIcon(centroidDelMarker, false);
  };
  const overlay = Util.buildEditOverlay(mgr, { onOpen, onEmpty });
  const openOverlay = overlay.open;

  // Single dispose owns every binding; delete and clearAll/destroy both run it.
  const dispose = () => {
    dragBinds.forEach(db => db.cleanup());
    overlay.cleanup();
    unregisterDragToggle();
  };
  const unregisterFinalized = mgr.registerFinalized(dispose);

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
        true,
      ) as L.Marker;
      segLabels.push(label);
      label.on("click", openOverlay);
    }
    const centroid = Util.centroid(points);
    if (centroidDot) centroidDot.setLatLng(centroid);
    if (centroidLabel) centroidLabel.setLatLng(centroid);
    if (centroidDelMarker) centroidDelMarker.setLatLng(centroid);
  };

  const rebuildCentroid = (currentArea?: number) => {
    const area = currentArea !== undefined ? currentArea : initArea;
    const centroid = Util.centroid(points);
    // The centroid dot goes into the graph pane (no isLabel), same as node
    // markers — below the label pane. The centroid label is isLabel, so it
    // lands in the label pane which always paints above the graph pane. No
    // zIndexOffset needed; the pane ordering guarantees the label covers the
    // dot, matching how distance/circle handle node-vs-label separation.
    // Segment labels (also isLabel) sit at z = Y. After a zoom `sortLayers`
    // re-sorts by Y and can push a lower-Y segment label above the area label.
    // A modest zIndexOffset keeps the area label above its own segment labels.
    centroidDot = layers.addLayer(
      L.marker(centroid, {
        icon: L.divIcon({
          className: CONST.CENTER_DOT.CLASS,
          html: "",
          iconSize: CONST.CENTER_DOT.SIZE as [number, number],
          iconAnchor: CONST.CENTER_DOT.ANCHOR as [number, number],
        }),
        interactive: true,
      }),
    ) as L.Marker;
    centroidLabel = layers.addLayer(
      L.marker(centroid, {
        icon: Util.makeLabelDivIcon(
          Util.formatArea(area),
          CONST.LABEL.CENTROID_ANCHOR as [number, number],
        ),
        zIndexOffset: CONST.LABEL.CENTROID_Z_OFFSET,
        interactive: false,
      }),
      true,
    ) as L.Marker;
    centroidDelMarker = layers.addLayer(
      makeDelIcon(centroid, { title: T("del_all") }),
    ) as L.Marker;
    attachDelClick(centroidDelMarker, deleteMeasurement);
  };

  const deleteMeasurement = () => {
    unregisterFinalized();
    dispose();
    layers.removeLayer(finalPoly, ...nodeMarkers, ...segLabels, ...nodeDelMarkers);
    if (centroidDot) layers.removeLayer(centroidDot);
    if (centroidLabel) layers.removeLayer(centroidLabel);
    if (centroidDelMarker) layers.removeLayer(centroidDelMarker);
    onDelete();
    layers.unregister();
  };

  // Drag is gated by edit mode (not the overlay), so nodes are draggable as
  // soon as edit mode is on — no click-first required.
  unregisterDragToggle = mgr.registerEditDragToggle(enabled =>
    dragBinds.forEach(db => db.setEnabled(enabled)),
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
        title: is3pt ? T("del_all") : T("del_node"),
      }),
    ) as L.Marker;
    nodeDelMarkers.push(delMarker);

    if (is3pt) attachDelClick(delMarker, deleteMeasurement);
    else
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
            if (iconEl) iconEl.title = T("del_all");
          });
        }

        finalPoly.setLatLngs(points);
        relabel();
        if (onUpdate) {
          opts.area = Util.area(points);
          onUpdate();
        }
      });

    bindOpenOverlay(delMarker, openOverlay);

    const findPtIdx = () => findPointIndex(points, node.getLatLng());
    const db = Util.bindNodeDrag(node, delMarker, mgr.map, {
      onDrag: (latlng: L.LatLng) => {
        const pIdx = findPtIdx();
        if (pIdx === -1) return;
        points[pIdx] = latlng;
        finalPoly.setLatLngs(points);
        relabel();
      },
      onEnd: (latlng: L.LatLng) => {
        Util.markDragSyntheticClick();
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
    Util.bindNodeDrag(centroidDot!, centroidDelMarker, mgr.map, {
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
        Util.markDragSyntheticClick();
        if (onUpdate) {
          opts.area = Util.area(points);
          onUpdate();
        }
      },
    }),
  );

  resortLayers(layers, nodeMarkers, nodeDelMarkers, segLabels);
};

export { attachCircleUI, attachDistanceUI, attachPolygonUI, resortLayers };
