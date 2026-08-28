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

const attachDistanceUI = (mgr: MeasureManager, opts: AttachOpts): (() => void) => {
  const { layers, finalPoly, nodeMarkers, segLabels, onDelete, onUpdate, points } =
    opts;
  const nodeDelIcons: L.Marker[] = [];
  const dragBinds: Array<{ setEnabled: (v: boolean) => void; cleanup: () => void }> =
    [];

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
    nodeDelIcons.forEach(m => toggleDelIcon(m, true));
  };
  const onEmpty = () => {
    nodeDelIcons.forEach(m => toggleDelIcon(m, false));
  };
  const overlay = Util.buildEditOverlay(mgr, { onOpen, onEmpty });
  const openOverlay = overlay.open;
  // Drag is gated by edit mode (not the overlay), so nodes are draggable as
  // soon as edit mode is on — no click-first required.
  const unregisterDragToggle = mgr.registerEditDragToggle(enabled =>
    dragBinds.forEach(db => db.setEnabled(enabled)),
  );

  const deleteMeasurement = () => {
    dragBinds.forEach(db => db.cleanup());
    overlay.cleanup();
    unregisterDragToggle();
    layers.removeLayer(finalPoly, ...nodeMarkers, ...segLabels, ...nodeDelIcons);
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
    nodeDelIcons.push(delMarker);

    if (isFirst || isLastWhenTwo) attachDelClick(delMarker, deleteMeasurement);
    else
      attachDelClick(delMarker, () => {
        const latlng = node.getLatLng();
        const ptIdx = points.findIndex(
          (p: L.LatLng) =>
            Math.abs(p.lat - latlng.lat) < 0.0001 &&
            Math.abs(p.lng - latlng.lng) < 0.0001,
        );
        if (ptIdx === -1) return;
        const lblIdx = ptIdx - 1;
        points.splice(ptIdx, 1);
        layers.removeLayer(node, delMarker);
        if (lblIdx >= 0 && lblIdx < segLabels.length) {
          layers.removeLayer(segLabels[lblIdx]);
          segLabels.splice(lblIdx, 1);
        }
        nodeMarkers.splice(ptIdx, 1);
        nodeDelIcons.splice(ptIdx, 1);
        dragBinds.splice(ptIdx, 1);

        if (points.length < 2) {
          deleteMeasurement();
          return;
        }

        if (points.length === 2 && nodeDelIcons.length === 2) {
          const lastDel = nodeDelIcons[1];
          if (lastDel) {
            lastDel.off("click");
            attachDelClick(lastDel, deleteMeasurement);
            const iconEl = lastDel.getElement();
            if (iconEl) iconEl.title = T("del_all");
          }
        }

        finalPoly.setLatLngs(points);
        relabel();
        if (onUpdate) onUpdate(points);
      });

    delMarker.on("click", (event: L.LeafletMouseEvent) => {
      const t = Util.getEventTarget(event);
      if (t?.closest?.(CONST.SEL.DEL_ICON)) return;
      openOverlay(event);
    });

    const findPtIdx = () =>
      points.findIndex(
        (p: L.LatLng) =>
          Math.abs(p.lat - node.getLatLng().lat) < 1e-9 &&
          Math.abs(p.lng - node.getLatLng().lng) < 1e-9,
      );
    const db = Util.bindNodeDrag(node, delMarker, mgr.map, {
      onDrag: (latlng: L.LatLng) => {
        const pIdx = findPtIdx();
        if (pIdx === -1) return;
        points[pIdx] = latlng;
        finalPoly.setLatLngs(points);
        relabel();
      },
      onEnd: (latlng: L.LatLng) => {
        const pIdx = findPtIdx();
        if (pIdx === -1) return;
        points[pIdx] = latlng;
        if (onUpdate) onUpdate(points);
      },
    });
    dragBinds.push(db);
  });

  finalPoly.on("click", openOverlay);
  nodeMarkers.forEach(m => m.on("click", openOverlay));
  segLabels.forEach(l => l.on("click", openOverlay));

  resortLayers(layers, nodeMarkers, nodeDelIcons, segLabels);

  return () => {
    dragBinds.forEach(db => db.cleanup());
    overlay.cleanup();
    unregisterDragToggle();
  };
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

const attachCircleUI = (mgr: MeasureManager, opts: CircleAttachOpts): (() => void) => {
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

  const deleteMeasurement = () => {
    dragBinds.forEach(db => db.cleanup());
    unregisterDragToggle();
    layers.removeLayer(circle);
    if (radiusLine) layers.removeLayer(radiusLine);
    if (radiusNode) layers.removeLayer(radiusNode);
    if (centerFinal) layers.removeLayer(centerFinal);
    layers.removeLayer(delMarker);
    if (radiusLabel) layers.removeLayer(radiusLabel);
    onDelete();
    layers.unregister();
  };

  const dragBinds: Array<{ setEnabled: (v: boolean) => void; cleanup: () => void }> =
    [];
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

  const onOpen = () => {
    toggleDelIcon(delMarker, true);
  };
  const onEmpty = () => {
    toggleDelIcon(delMarker, false);
  };
  const overlay = Util.buildEditOverlay(mgr, { onOpen, onEmpty });
  const openOverlay = overlay.open;
  // Drag is gated by edit mode (not the overlay), so the center/radius node
  // are draggable as soon as edit mode is on — no click-first required.
  unregisterDragToggle = mgr.registerEditDragToggle(enabled =>
    dragBinds.forEach(db => db.setEnabled(enabled)),
  );

  const attachInteraction = (layer: L.Layer) => {
    layer.on("click", (event: L.LeafletMouseEvent) => {
      const t = Util.getEventTarget(event);
      if (t?.closest?.(CONST.SEL.DEL_ICON)) return;
      openOverlay(event);
    });
  };

  attachInteraction(circle);
  if (radiusLine) attachInteraction(radiusLine);
  if (radiusNode) attachInteraction(radiusNode);
  if (centerFinal) attachInteraction(centerFinal);
  if (radiusLabel) attachInteraction(radiusLabel);

  attachDelClick(delMarker, deleteMeasurement);
  delMarker.on("click", (event: L.LeafletMouseEvent) => {
    const t = Util.getEventTarget(event);
    if (t?.closest?.(CONST.SEL.DEL_ICON)) return;
    openOverlay(event);
  });

  return () => {
    dragBinds.forEach(db => db.cleanup());
    overlay.cleanup();
    unregisterDragToggle();
  };
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

const attachPolygonUI = (
  mgr: MeasureManager,
  opts: PolygonAttachOpts,
): (() => void) => {
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
  const nodeDelIcons: L.Marker[] = [];
  const dragBinds: Array<{ setEnabled: (v: boolean) => void; cleanup: () => void }> =
    [];
  let unregisterDragToggle: () => void = () => {};
  let centroidDot: L.Marker | null = null;
  let centroidLabel: L.Marker | null = null;
  let centroidDel: L.Marker | null = null;

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
    if (centroidDel) centroidDel.setLatLng(centroid);
    return area;
  };

  const rebuildCentroid = (currentArea?: number) => {
    const area = currentArea !== undefined ? currentArea : initArea;
    const centroid = Util.centroid(points);
    centroidDot = layers.addLayer(
      L.marker(centroid, {
        icon: L.divIcon({
          className: CONST.CENTER_DOT.CLASS,
          html: "",
          iconSize: CONST.CENTER_DOT.SIZE as [number, number],
          iconAnchor: CONST.CENTER_DOT.ANCHOR as [number, number],
        }),
        zIndexOffset: CONST.Z_INDEX.OFFSET,
        interactive: true,
      }),
      true,
    ) as L.Marker;
    centroidLabel = layers.addLayer(
      L.marker(centroid, {
        icon: Util.makeLabelDivIcon(
          Util.formatArea(area),
          CONST.LABEL.CENTROID_ANCHOR as [number, number],
        ),
        interactive: false,
      }),
      true,
    ) as L.Marker;
    centroidDel = layers.addLayer(
      makeDelIcon(centroid, { title: T("del_all") }),
    ) as L.Marker;
    attachDelClick(centroidDel, deleteMeasurement);
  };

  const deleteMeasurement = () => {
    dragBinds.forEach(db => db.cleanup());
    unregisterDragToggle();
    layers.removeLayer(finalPoly, ...nodeMarkers, ...segLabels, ...nodeDelIcons);
    if (centroidDot) layers.removeLayer(centroidDot);
    if (centroidLabel) layers.removeLayer(centroidLabel);
    if (centroidDel) layers.removeLayer(centroidDel);
    onDelete();
    layers.unregister();
  };

  const onOpen = () => {
    nodeDelIcons.forEach(m => toggleDelIcon(m, true));
    if (centroidDel) toggleDelIcon(centroidDel, true);
  };
  const onEmpty = () => {
    nodeDelIcons.forEach(m => toggleDelIcon(m, false));
    if (centroidDel) toggleDelIcon(centroidDel, false);
  };
  const overlay = Util.buildEditOverlay(mgr, { onOpen, onEmpty });
  const openOverlay = overlay.open;
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
  (centroidDel as L.Marker | null)?.on("click", openOverlay);

  nodeMarkers.forEach(node => {
    const is3pt = points.length === 3;
    const delMarker = layers.addLayer(
      makeDelIcon(node.getLatLng(), {
        title: is3pt ? T("del_all") : T("del_node"),
      }),
    ) as L.Marker;
    nodeDelIcons.push(delMarker);

    if (is3pt) attachDelClick(delMarker, deleteMeasurement);
    else
      attachDelClick(delMarker, () => {
        const latlng = node.getLatLng();
        const ptIdx = points.findIndex(
          (p: L.LatLng) =>
            Math.abs(p.lat - latlng.lat) < 0.0001 &&
            Math.abs(p.lng - latlng.lng) < 0.0001,
        );
        if (ptIdx === -1) return;
        points.splice(ptIdx, 1);
        layers.removeLayer(node, delMarker);
        nodeMarkers.splice(ptIdx, 1);
        nodeDelIcons.splice(ptIdx, 1);
        dragBinds.splice(ptIdx, 1);

        if (points.length < 3) {
          deleteMeasurement();
          return;
        }

        if (points.length === 3) {
          nodeDelIcons.forEach(d => {
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

    delMarker.on("click", (event: L.LeafletMouseEvent) => {
      const t = Util.getEventTarget(event);
      if (t?.closest?.(CONST.SEL.DEL_ICON)) return;
      openOverlay(event);
    });

    const findPtIdx = () =>
      points.findIndex(
        (p: L.LatLng) =>
          Math.abs(p.lat - node.getLatLng().lat) < 1e-9 &&
          Math.abs(p.lng - node.getLatLng().lng) < 1e-9,
      );
    const db = Util.bindNodeDrag(node, delMarker, mgr.map, {
      onDrag: (latlng: L.LatLng) => {
        const pIdx = findPtIdx();
        if (pIdx === -1) return;
        points[pIdx] = latlng;
        finalPoly.setLatLngs(points);
        relabel();
      },
      onEnd: (latlng: L.LatLng) => {
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

  resortLayers(layers, nodeMarkers, nodeDelIcons, segLabels);

  return () => {
    dragBinds.forEach(db => db.cleanup());
    overlay.cleanup();
    unregisterDragToggle();
  };
};

export { attachCircleUI, attachDistanceUI, attachPolygonUI, resortLayers };
