// MeasureControl UI — standalone functions invoked with a MeasureManager context.
import { attachDelClick, makeDelIcon, toggleDelIcon } from "#common/delicon.js";
import { stopEvent } from "#common/dom.js";
import { createScopedTranslator } from "#common/locale.js";
import * as CONST from "./const.js";
import { bindNodeDrag, buildEditOverlay, markDragSyntheticClick } from "./edit.js";
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

/** Handle returned by bindNodeDrag — enable/disable + unbind a node drag. */
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
  /** Measurement id — groups this measurement's edit registrations. */
  id: string;
}

/**
 * Track a mutable set of segment labels in the collision planner. `refresh()`
 * re-issues the registrations so they cover exactly the current set — a deleted
 * inner node splices the segLabels array, and a registration left over from a
 * removed marker would point at a dead chip. Returns the unregister function
 * the caller's dispose runs.
 *
 * `priority` may vary per index: distance mode's final label also carries the
 * cumulative total, which must out-rank a plain segment in a collision.
 *
 * Shared by distance and polygon: both recreate their segment labels on every
 * relabel (drag, node delete), which is what makes re-registration necessary.
 */
const bindSegmentLabels = (
  mgr: MeasureManager,
  segLabels: L.Marker[],
  priority: (index: number) => number = () => CONST.LABEL_PRIORITY.SEGMENT,
): (() => void) => {
  let unregisters: Array<() => void> = [];
  const refresh = () => {
    unregisters.forEach(f => f());
    unregisters = segLabels.map((label, i) => mgr.registerLabel(label, priority(i)));
  };
  refresh();
  return () => {
    unregisters.forEach(f => f());
    unregisters = [];
  };
};

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

  const onOpen = () => {
    nodeDelMarkers.forEach(m => toggleDelIcon(m, true));
  };
  const onEmpty = () => {
    nodeDelMarkers.forEach(m => toggleDelIcon(m, false));
  };
  const overlay = buildEditOverlay(mgr, { onOpen, onEmpty, id });
  const openOverlay = overlay.open;
  // Drag is gated by edit mode (not the overlay), so nodes are draggable as
  // soon as edit mode is on — no click-first required.
  const unregisterDragToggle = mgr.registerEditDragToggle(
    enabled => dragBinds.forEach(db => db.setEnabled(enabled)),
    id,
  );

  // Single dispose owns every binding; delete and clearAll/destroy both run it.
  const dispose = () => {
    dragBinds.forEach(db => db.cleanup());
    unregisterSegLabels();
    overlay.cleanup();
    unregisterDragToggle();
  };
  const unregisterFinalized = mgr.registerFinalized(dispose, id);

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
            // The last endpoint's ✕ previously delegated to "delete a single
            // node" + "open the overlay". After collapsing to 2 points it must
            // switch to "delete the whole distance" while keeping the overlay
            // opener — mirroring how polygon rebinds both in the 3pt case.
            lastDelMarker.off("click");
            attachDelClick(lastDelMarker, deleteMeasurement);
            bindOpenOverlay(lastDelMarker, openOverlay);
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

  const onOpen = () => {
    toggleDelIcon(delMarker, true);
  };
  const onEmpty = () => {
    toggleDelIcon(delMarker, false);
  };
  const overlay = buildEditOverlay(mgr, { onOpen, onEmpty, id });
  const openOverlay = overlay.open;

  // Single dispose owns every binding; delete and clearAll/destroy both run it.
  const dispose = () => {
    dragBinds.forEach(db => db.cleanup());
    unregisterRadiusLabel();
    overlay.cleanup();
    unregisterDragToggle();
  };
  const unregisterFinalized = mgr.registerFinalized(dispose, id);

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

  const centerDrag = bindNodeDrag(centerFinal, delMarker, mgr.map, {
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

  const onOpen = () => {
    nodeDelMarkers.forEach(m => toggleDelIcon(m, true));
    if (centroidDelMarker) toggleDelIcon(centroidDelMarker, true);
  };
  const onEmpty = () => {
    nodeDelMarkers.forEach(m => toggleDelIcon(m, false));
    if (centroidDelMarker) toggleDelIcon(centroidDelMarker, false);
  };
  const overlay = buildEditOverlay(mgr, { onOpen, onEmpty, id });
  const openOverlay = overlay.open;

  // Single dispose owns every binding; delete and clearAll/destroy both run it.
  const dispose = () => {
    dragBinds.forEach(db => db.cleanup());
    unregisterSegLabels();
    unregisterCentroid();
    overlay.cleanup();
    unregisterDragToggle();
  };
  const unregisterFinalized = mgr.registerFinalized(dispose, id);

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
    // The centroid dot shares the graph pane with the fill. It must be
    // attached before the fill so that, within the single per-pane SVG, its
    // `<path>` precedes the fill's in source order and therefore paints over
    // it. Sharing the renderer is what keeps it immune to `sortLayers`, which
    // re-sorts div-icon markers by screen Y on zoom; a marker in the node pane
    // would be in its own SVG and outside that guarantee.
    // The centroid label is isLabel → label pane, which paints above both.
    // Segment labels (also isLabel) sit at z = Y; after zoom `sortLayers`
    // re-sorts by Y, so the label's offset (2000) keeps it above its own
    // segment labels.
    centroidDot = layers.addLayer(
      Util.makeNode(centroid, CONST.CLASSES.NODE_SOLID),
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
      true,
    ) as L.Marker;
    unregisterCentroid = mgr.registerLabel(
      centroidLabel,
      CONST.LABEL_PRIORITY.CENTROID,
    );
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

export { attachCircleUI, attachDistanceUI, attachPolygonUI, resortLayers };
