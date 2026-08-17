// MeasureControl UI — standalone functions invoked with a MeasureManager context.
import { attachDelClick, makeDelIcon, toggleDelIcon } from "#common/delicon.js";
import { stopEvent } from "#common/dom.js";
import { createTranslator } from "#common/locale.js";
import * as CONST from "./const.js";
import type { MeasureManager } from "./manager.js";
import * as Util from "./util.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const _ = createTranslator(CONF);

/**
 * Mutable toggle state shared between createToggleUI and setupMapClickActive.
 */
interface MeasureToggleState {
  isXVisible: boolean;
  isLabelsVisible: boolean;
}

/**
 * Create a toggle function that manages X/label visibility state via the
 * state machine, then delegates rendering to a callback. This eliminates
 * the repeated let + state-machine boilerplate in each attach*UI function.
 */
function createToggleUI(
  state: MeasureToggleState,
  render: (state: MeasureToggleState) => void,
): (showX?: boolean, toggleLabels?: boolean | string) => void {
  return (showX?: boolean, toggleLabels?: boolean | string) => {
    const s = Util.nextToggleState(
      state.isXVisible,
      state.isLabelsVisible,
      showX,
      toggleLabels,
    );
    state.isXVisible = s.isXVisible;
    state.isLabelsVisible = s.isLabelsVisible;
    render(state);
  };
}

/**
 * Wire a map-click handler that hides the X icon when the user clicks empty
 * map space, respecting suppress-hide and optional extra guards (e.g. isDeleted).
 */
function setupMapClickActive(
  mgr: MeasureManager,
  state: MeasureToggleState,
  toggleUI: (showX?: boolean, toggleLabels?: boolean | string) => void,
  extraGuard?: () => boolean,
): () => void {
  const onMapClickActive = () => {
    if (mgr.isSuppressHideDel) return;
    if (extraGuard?.()) return;
    if (state.isXVisible) {
      toggleUI(false, CONST.TOGGLE.RESET);
    }
  };
  mgr.map.on("click", onMapClickActive);
  return onMapClickActive;
}

/**
 * Re-order layers so they render in the correct z-order.
 * Removes and re-adds each collection in sequence.
 */
function resortLayers(
  layers: CreateLayersAPI,
  ...collections: L.Layer[][]
): void {
  collections.forEach(c => c.forEach(l => layers.removeLayer(l)));
  collections.forEach(c => c.forEach(l => layers.addLayer(l)));
}

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

const attachDistanceUI = (
  mgr: MeasureManager,
  opts: AttachOpts,
): ((event: L.LeafletMouseEvent) => void) => {
  const { layers, finalPoly, nodeMarkers, segLabels, onDelete, onUpdate, points } =
    opts;
  const state: MeasureToggleState = { isXVisible: false, isLabelsVisible: true };
  const nodeDelIcons: L.Marker[] = [];

  const toggleUI = createToggleUI(state, () => {
    nodeDelIcons.forEach(m => toggleDelIcon(m, state.isXVisible));
    Util.applyVisibilityToggle(
      undefined,
      state.isXVisible,
      segLabels,
      state.isLabelsVisible,
    );
  });

  const handleItemClick = (event: L.LeafletMouseEvent) => {
    stopEvent(event);
    Util.suppressHide(mgr);
    toggleUI();
  };

  finalPoly.on("click", handleItemClick);
  nodeMarkers.forEach(m => m.on("click", handleItemClick));
  segLabels.forEach(l => l.on("click", handleItemClick));
  toggleUI(false, CONST.TOGGLE.RESET);

  const onMapClickActive = setupMapClickActive(mgr, state, toggleUI);

  const deleteMeasurement = () => {
    layers.removeLayer(finalPoly, ...nodeMarkers, ...segLabels, ...nodeDelIcons);
    mgr.map.off("click", onMapClickActive);
    onDelete();
    layers.unregister();
  };

  // Create a delete icon for each node
  nodeMarkers.forEach((node, idx) => {
    const isFirst = idx === 0;
    const isLastWhenTwo = points.length === 2 && idx === 1;
    const delMarker = layers.addLayer(
      makeDelIcon(node.getLatLng(), {
        title:
          isFirst || isLastWhenTwo
            ? _(`${CONF.name}.del_all`)
            : _(`${CONF.name}.del_node`),
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

        if (points.length < 2) {
          deleteMeasurement();
          return;
        }

        if (points.length === 2 && nodeDelIcons.length === 2) {
          const lastDel = nodeDelIcons[1];
          if (lastDel) {
            // After deleting an intermediate node only two nodes remain:
            // rebind the last node's delete icon to delete the whole
            // measurement (same behavior as the first node).
            lastDel.off("click");
            attachDelClick(lastDel, deleteMeasurement);
            const iconEl = lastDel.getElement();
            if (iconEl) iconEl.title = _(`${CONF.name}.del_all`);
          }
        }

        finalPoly.setLatLngs(points);

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

        if (onUpdate) onUpdate(points);
      });

    delMarker.on("click", (event: L.LeafletMouseEvent) => {
      const t = (event.originalEvent as MouseEvent)?.target as HTMLElement | null;
      if (t?.closest?.(CONST.SEL.DEL_ICON)) return;
      handleItemClick(event);
    });
  });

  // Re-sort to ensure correct ordering
  resortLayers(layers, nodeMarkers, nodeDelIcons, segLabels);

  return onMapClickActive;
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
}

const attachCircleUI = (
  mgr: MeasureManager,
  opts: CircleAttachOpts,
): { onMapClickActive: () => void } => {
  const {
    layers,
    circle,
    radiusLine,
    radiusNode,
    centerFinal,
    delMarker,
    radiusLabel,
    onDelete,
  } = opts;
  const state: MeasureToggleState = { isXVisible: false, isLabelsVisible: true };
  let isDeleted = false;

  const toggleUI = createToggleUI(state, () => {
    Util.applyVisibilityToggle(
      delMarker,
      state.isXVisible,
      radiusLabel ? [radiusLabel] : [],
      state.isLabelsVisible,
      undefined,
      xv => {
        delMarker.setZIndexOffset(xv ? CONST.Z_INDEX.OFFSET * 2 : CONST.Z_INDEX.OFFSET);
        Util.toggleVisibility(
          [
            radiusLine?.getElement() as HTMLElement | null,
            radiusNode?.getElement() as HTMLElement | null,
          ],
          state.isLabelsVisible,
        );
      },
    );
  });
  toggleUI(false, CONST.TOGGLE.RESET);

  const toggleCircleToggle = () => {
    if (isDeleted) return;
    Util.suppressHide(mgr);
    toggleUI();
  };

  const attachInteraction = (layer: L.Layer) => {
    layer.on("click", (event: L.LeafletMouseEvent) => {
      const t = (event.originalEvent as MouseEvent)?.target as HTMLElement | null;
      if (t?.closest?.(CONST.SEL.DEL_ICON)) return;
      stopEvent(event);
      toggleCircleToggle();
    });
  };

  attachInteraction(delMarker);
  attachInteraction(circle);
  if (radiusLine) attachInteraction(radiusLine);
  if (radiusNode) attachInteraction(radiusNode);
  if (centerFinal) attachInteraction(centerFinal);
  if (radiusLabel) attachInteraction(radiusLabel);

  const onMapClickActive = setupMapClickActive(mgr, state, toggleUI, () => isDeleted);

  return { onMapClickActive };
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
  const state: MeasureToggleState = { isXVisible: false, isLabelsVisible: true };
  const nodeDelIcons: L.Marker[] = [];
  let centroidLabel: L.Marker | null = null;
  let centroidDot: L.Marker | null = null;
  let centroidDel: L.Marker | null = null;

  const rebuildCentroid = (showX?: boolean, currentArea?: number) => {
    if (centroidLabel) layers.removeLayer(centroidLabel);
    if (centroidDot) layers.removeLayer(centroidDot);
    if (centroidDel) layers.removeLayer(centroidDel);

    const centroid = Util.centroid(points);
    const area = currentArea !== undefined ? currentArea : initArea;

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
      makeDelIcon(centroid, { title: _(`${CONF.name}.del_all`) }),
    ) as L.Marker;
    attachDelClick(centroidDel, deleteMeasurement);

    if (showX !== undefined) toggleDelIcon(centroidDel, showX);
  };

  const deleteMeasurement = () => {
    layers.removeLayer(finalPoly, ...nodeMarkers, ...segLabels, ...nodeDelIcons);
    if (centroidDot) layers.removeLayer(centroidDot);
    if (centroidLabel) layers.removeLayer(centroidLabel);
    if (centroidDel) layers.removeLayer(centroidDel);
    onDelete();
    layers.unregister();
  };

  const toggleUI = createToggleUI(state, () => {
    nodeDelIcons.forEach(m => toggleDelIcon(m, state.isXVisible));
    if (centroidDel) toggleDelIcon(centroidDel, state.isXVisible);
    Util.applyVisibilityToggle(
      undefined,
      state.isXVisible,
      segLabels,
      state.isLabelsVisible,
    );
    if (centroidLabel) {
      const el = centroidLabel.getElement();
      if (el) {
        const label = el.querySelector(CONST.SEL.LABEL);
        if (label) label.classList.toggle(CONST.CLASSES.HIDDEN, !state.isLabelsVisible);
      }
    }
  });

  const handleItemClick = (event: L.LeafletMouseEvent) => {
    stopEvent(event);
    Util.suppressHide(mgr);
    toggleUI();
  };

  finalPoly.on("click", handleItemClick);
  nodeMarkers.forEach(m => m.on("click", handleItemClick));
  segLabels.forEach(l => l.on("click", handleItemClick));

  rebuildCentroid(false);
  centroidDot!.on("click", handleItemClick);
  centroidDel!.on("click", handleItemClick);

  toggleUI(false, CONST.TOGGLE.RESET);

  const onMapClickActive = setupMapClickActive(mgr, state, toggleUI);

  nodeMarkers.forEach(node => {
    const is3pt = points.length === 3;
    const delMarker = layers.addLayer(
      makeDelIcon(node.getLatLng(), {
        title: is3pt ? _(`${CONF.name}.del_all`) : _(`${CONF.name}.del_node`),
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

        segLabels.forEach(l => layers.removeLayer(l));
        segLabels.length = 0;

        if (points.length < 3) {
          deleteMeasurement();
          return;
        }

        if (points.length === 3) {
          nodeDelIcons.forEach(d => {
            d.off("click");
            d.on("click", (event: L.LeafletMouseEvent) => {
              const t = (event.originalEvent as MouseEvent)
                ?.target as HTMLElement | null;
              if (t?.closest?.(CONST.SEL.DEL_ICON)) {
                stopEvent(event);
                deleteMeasurement();
              } else handleItemClick(event);
            });
            const iconEl = d.getElement();
            if (iconEl) iconEl.title = _(`${CONF.name}.del_all`);
          });
        }

        finalPoly.setLatLngs(points);

        const area = Util.area(points);
        if (centroidLabel) Util.setLabelText(centroidLabel, Util.formatArea(area));

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
          label.on("click", handleItemClick);
        }

        rebuildCentroid(state.isXVisible, area);

        if (onUpdate) {
          opts.area = area;
          onUpdate();
        }
      });

    delMarker.on("click", (event: L.LeafletMouseEvent) => {
      const t = (event.originalEvent as MouseEvent)?.target as HTMLElement | null;
      if (t?.closest?.(CONST.SEL.DEL_ICON)) return;
      handleItemClick(event);
    });
  });

  resortLayers(layers, nodeMarkers, nodeDelIcons, segLabels);

  return onMapClickActive;
};

export { attachCircleUI, attachDistanceUI, attachPolygonUI };
