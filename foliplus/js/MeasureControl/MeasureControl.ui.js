import { createTranslator } from "../shared/locale.js";
import * as CONST from "./MeasureControl.const.js";
import * as Util from "./MeasureControl.util.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).

const foliplus = window.foliplus;
const _ = createTranslator(CONF);

const attachDistanceUI = (mgr, opts) => {
  const { layers, finalPoly, nodeMarkers, segLabels, onDelete, onUpdate, points } =
    opts;
  let isLabelsVisible = true;
  let isXVisible = false;
  const nodeDelIcons = [];

  const toggleUI = (showX, toggleLabels) => {
    const s = Util.calcToggle(isXVisible, isLabelsVisible, showX, toggleLabels);
    isXVisible = s.isXVisible;
    isLabelsVisible = s.isLabelsVisible;
    nodeDelIcons.forEach((m) => Util.toggleDelIcon(m, isXVisible));
    Util.applyToggle(null, isXVisible, segLabels, isLabelsVisible, null);
  };

  const handleItemClick = (e) => {
    Util.stopEvent(e);
    Util.suppressHide(mgr);
    toggleUI(undefined);
  };

  finalPoly.on("click", handleItemClick);
  nodeMarkers.forEach((m) => m.on("click", handleItemClick));
  segLabels.forEach((l) => l.on("click", handleItemClick));
  toggleUI(false, CONST.TOGGLE.RESET);

  const onMapClickActive = () => {
    if (mgr.isSuppressHideDel) return;
    if (isXVisible) toggleUI(false, CONST.TOGGLE.RESET);
  };
  mgr.map.on("click", onMapClickActive);

  const deleteMeas = () => {
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
      Util.makeDelIcon(node.getLatLng(), {
        zIndexOffset: CONST.Z_INDEX.OFFSET,
        title:
          isFirst || isLastWhenTwo
            ? _(`${CONF.name}.del_all`)
            : _(`${CONF.name}.del_node`),
      }),
    );
    nodeDelIcons.push(delMarker);

    if (isFirst || isLastWhenTwo)
      // First node or last node when only 2 points → delete entire measurement
      Util.attachDelClick(delMarker, deleteMeas);
    else {
      // Other nodes X → delete this point only
      Util.attachDelClick(delMarker, () => {
        // Find the current index in the (possibly-shifted) points array
        const latlng = node.getLatLng();
        const ptIdx = points.findIndex(
          (p) =>
            Math.abs(p.lat - latlng.lat) < 0.0001 &&
            Math.abs(p.lng - latlng.lng) < 0.0001,
        );
        if (ptIdx === -1) return;
        // segLabels[i] corresponds to points[i+1]
        const lblIdx = ptIdx - 1;
        // Remove the point and its associated DOM elements
        points.splice(ptIdx, 1);
        layers.removeLayer(node, delMarker);
        if (lblIdx >= 0 && lblIdx < segLabels.length) {
          layers.removeLayer(segLabels[lblIdx]);
          segLabels.splice(lblIdx, 1);
        }

        nodeMarkers.splice(ptIdx, 1);
        nodeDelIcons.splice(ptIdx, 1);

        if (points.length < 2) {
          deleteMeas();
          return;
        }

        // When only 2 points remain, update the last node's X to delete all
        if (points.length === 2 && nodeDelIcons.length === 2) {
          const lastDel = nodeDelIcons[1];
          if (lastDel) {
            lastDel.off("click");
            lastDel.on("click", (e) => {
              const t = e.originalEvent?.target;
              if (t?.classList?.contains(CONST.DEL_ICON.CLASS)) {
                Util.stopEvent(e);
                deleteMeas();
              }
            });
            // Update title on the icon element directly
            const iconEl = lastDel._icon || lastDel.getElement();
            if (iconEl) iconEl.title = _(`${CONF.name}.del_all`);
          }
        }

        // Recalculate the polyline
        finalPoly.setLatLngs(points);

        // Reposition and update ALL remaining segment labels
        // Use cumulative total to stay consistent with initial finishDist and restoreDistance
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

        if (onUpdate) onUpdate();
      });
    }

    delMarker.on("click", (e) => {
      const t = e.originalEvent?.target;
      if (t?.classList?.contains(CONST.DEL_ICON.CLASS)) return;
      handleItemClick(e);
    });
  });

  // Re-sort to ensure correct ordering
  nodeMarkers.forEach((m) => layers.removeLayer(m));
  nodeDelIcons.forEach((m) => layers.removeLayer(m));
  segLabels.forEach((l) => layers.removeLayer(l));
  nodeMarkers.forEach((m) => layers.addLayer(m));
  nodeDelIcons.forEach((m) => layers.addLayer(m));
  segLabels.forEach((l) => layers.addLayer(l));

  return onMapClickActive;

  /**
   * Attach toggle/delete UI to a completed circle measurement.
   * Shared by finalizeCircle (CircleMode) and restoreCircle (MeasureManager).
   * @param {Object} opts
   * @param {Object} opts.layers     - createLayers API object
   * @param {Object} opts.circle     - L.Circle
   * @param {Object} opts.radiusLine - L.Polyline
   * @param {Object} opts.radiusNode - L.CircleMarker
   * @param {Object} opts.centerFinal - L.Marker (center dot)
   * @param {Object} opts.delMarker  - Delete icon L.Marker
   * @param {Object} opts.radiusLabel - Label L.Marker
   * @param {Function} opts.onDelete - Called when user deletes the measurement
   * @returns {Function} cleanup(mapClickHandler) to remove map click listener
   */
};

const attachCircleUI = (mgr, opts) => {
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
  let isLabelsVisible = true;
  let isXVisible = false;
  let isDeleted = false;

  const toggleUI = (showX, toggleLabels) => {
    const s = Util.calcToggle(isXVisible, isLabelsVisible, showX, toggleLabels);
    isXVisible = s.isXVisible;
    isLabelsVisible = s.isLabelsVisible;
    Util.applyToggle(
      delMarker,
      isXVisible,
      [radiusLabel],
      isLabelsVisible,
      null,
      (xv) => {
        if (delMarker.setZIndexOffset)
          delMarker.setZIndexOffset(
            xv ? CONST.Z_INDEX.OFFSET * 2 : CONST.Z_INDEX.OFFSET,
          );
        Util.toggleVisibility(
          [radiusLine?.getElement(), radiusNode?.getElement()],
          isLabelsVisible,
        );
      },
    );
  };
  toggleUI(false, CONST.TOGGLE.RESET);

  const toggleCircleToggle = () => {
    if (isDeleted) return;
    Util.suppressHide(mgr);
    toggleUI(undefined);
  };

  const attachInteraction = (layer) => {
    layer.on("click", (e) => {
      const t = e.originalEvent?.target;
      if (t?.classList?.contains(CONST.DEL_ICON.CLASS)) return;
      Util.stopEvent(e);
      toggleCircleToggle();
    });
  };

  attachInteraction(delMarker);
  attachInteraction(circle);
  attachInteraction(radiusLine);
  attachInteraction(radiusNode);
  attachInteraction(centerFinal);
  if (radiusLabel) attachInteraction(radiusLabel);

  const onMapClickActive = () => {
    if (mgr.isSuppressHideDel || isDeleted) return;
    if (isXVisible) toggleUI(false, CONST.TOGGLE.RESET);
  };
  mgr.map.on("click", onMapClickActive);

  const deleteCircle = () => {
    if (isDeleted) return;
    isDeleted = true;
    layers.removeLayer(
      delMarker,
      circle,
      centerFinal,
      radiusLine,
      radiusNode,
      radiusLabel,
    );
    mgr.map.off("click", onMapClickActive);
    const idx = mgr.finalizedClickHandlers.indexOf(onMapClickActive);
    if (idx !== -1) mgr.finalizedClickHandlers.splice(idx, 1);
    onDelete();
    layers.unregister();
  };
  Util.attachDelClick(delMarker, deleteCircle);

  return { onMapClickActive, deleteCircle };

  /**
   * Attach toggle/delete UI to a completed polygon measurement.
   * Shared by finishPoly (PolygonMode) and restorePolygon (MeasureManager).
   * @param {Object} opts
   * @param {Object} opts.layers     - createLayers API object
   * @param {Object} opts.finalPoly  - L.Polygon
   * @param {Array}  opts.nodeMarkers - L.CircleMarker[]
   * @param {Array}  opts.segLabels   - Label L.Marker[]
   * @param {Array}  opts.points     - LatLng array
   * @param {number} opts.area       - Area in square meters
   * @param {Function} opts.onDelete - Called when user deletes the measurement
   * @param {Function} opts.onUpdate - Called when points are modified
   */
};

const attachPolygonUI = (mgr, opts) => {
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
  let isLabelsVisible = true;
  let isXVisible = false;
  const nodeDelIcons = [];
  let centroidLabel = null;
  let centroidDot = null;
  let centroidDel = null;

  const rebuildCentroid = (showX, currentArea) => {
    // Remove old Util.centroid elements
    if (centroidLabel) layers.removeLayer(centroidLabel);
    if (centroidDot) layers.removeLayer(centroidDot);
    if (centroidDel) layers.removeLayer(centroidDel);

    // Calculate Util.centroid (arithmetic mean of vertices)
    const centroid = Util.centroid(points);
    const area = currentArea !== undefined ? currentArea : initArea;

    centroidDot = layers.addLayer(
      L.marker(centroid, {
        icon: L.divIcon({
          className: CONST.CENTER_DOT.CLASS_FINAL,
          html: "",
          iconSize: CONST.CENTER_DOT.SIZE,
          iconAnchor: CONST.CENTER_DOT.ANCHOR,
        }),
        zIndexOffset: CONST.Z_INDEX.OFFSET,
        interactive: true,
      }),
      true,
    );

    centroidLabel = layers.addLayer(
      L.marker(centroid, {
        icon: Util.makeLabelDivIcon(Util.formatArea(area), CONST.LABEL.CENTROID_ANCHOR),
        interactive: false,
      }),
      true,
    );

    centroidDel = layers.addLayer(
      Util.makeDelIcon(centroid, {
        zIndexOffset: CONST.Z_INDEX.OFFSET,
        title: _(`${CONF.name}.del_all`),
      }),
    );
    Util.attachDelClick(centroidDel, deleteMeas);

    // Toggle visibility based on current state
    if (showX !== undefined) Util.toggleDelIcon(centroidDel, showX);
  };

  const deleteMeas = () => {
    layers.removeLayer(finalPoly, ...nodeMarkers, ...segLabels, ...nodeDelIcons);
    if (centroidDot) layers.removeLayer(centroidDot);
    if (centroidLabel) layers.removeLayer(centroidLabel);
    if (centroidDel) layers.removeLayer(centroidDel);
    onDelete();
    layers.unregister();
  };

  const toggleUI = (showX, toggleLabels) => {
    const s = Util.calcToggle(isXVisible, isLabelsVisible, showX, toggleLabels);
    isXVisible = s.isXVisible;
    isLabelsVisible = s.isLabelsVisible;
    nodeDelIcons.forEach((m) => Util.toggleDelIcon(m, isXVisible));
    Util.toggleDelIcon(centroidDel, isXVisible);
    Util.applyToggle(null, isXVisible, segLabels, isLabelsVisible, null);
    // Also toggle Util.centroid label visibility
    if (centroidLabel) {
      const el = centroidLabel.getElement();
      if (el) {
        const label = el.querySelector(CONST.SEL.LABEL);
        if (label) label.classList.toggle(CONST.CLASSES.HIDDEN, !isLabelsVisible);
      }
    }
  };

  const handleItemClick = (e) => {
    Util.stopEvent(e);
    Util.suppressHide(mgr);
    toggleUI(undefined);
  };

  finalPoly.on("click", handleItemClick);
  nodeMarkers.forEach((m) => m.on("click", handleItemClick));
  segLabels.forEach((l) => l.on("click", handleItemClick));

  // Create Util.centroid
  rebuildCentroid(false);
  if (centroidDot) centroidDot.on("click", handleItemClick);
  if (centroidDel) centroidDel.on("click", handleItemClick);

  toggleUI(false, CONST.TOGGLE.RESET);

  const onMapClickActive = () => {
    if (mgr.isSuppressHideDel) return;
    if (isXVisible) toggleUI(false, CONST.TOGGLE.RESET);
  };
  mgr.map.on("click", onMapClickActive);

  // Create delete icons for each node
  nodeMarkers.forEach((node) => {
    const is3pt = points.length === 3;
    const delMarker = layers.addLayer(
      Util.makeDelIcon(node.getLatLng(), {
        zIndexOffset: CONST.Z_INDEX.OFFSET,
        title: is3pt ? _(`${CONF.name}.del_all`) : _(`${CONF.name}.del_node`),
      }),
    );
    nodeDelIcons.push(delMarker);

    if (is3pt) Util.attachDelClick(delMarker, deleteMeas);
    else
      Util.attachDelClick(delMarker, () => {
        const latlng = node.getLatLng();
        const ptIdx = points.findIndex(
          (p) =>
            Math.abs(p.lat - latlng.lat) < 0.0001 &&
            Math.abs(p.lng - latlng.lng) < 0.0001,
        );
        if (ptIdx === -1) return;
        points.splice(ptIdx, 1);
        layers.removeLayer(node, delMarker);
        nodeMarkers.splice(ptIdx, 1);
        nodeDelIcons.splice(ptIdx, 1);

        // Remove all old segLabels and rebuild from scratch
        segLabels.forEach((l) => layers.removeLayer(l));
        segLabels.length = 0;

        if (points.length < 3) {
          deleteMeas();
          return;
        }

        // When exactly 3 points remain, every node X should delete all
        if (points.length === 3) {
          nodeDelIcons.forEach((d) => {
            d.off("click");
            d.on("click", (ev) => {
              const t = ev.originalEvent?.target;
              if (t?.classList?.contains(CONST.DEL_ICON.CLASS)) {
                Util.stopEvent(ev);
                deleteMeas();
              } else handleItemClick(ev);
            });
            const iconEl = d._icon || d.getElement();
            if (iconEl) iconEl.title = _(`${CONF.name}.del_all`);
          });
        }

        // Recalculate polygon — Leaflet automatically closes
        finalPoly.setLatLngs(points);

        // Recalculate area
        const area = Util.area(points);
        if (centroidLabel) Util.setLabelText(centroidLabel, Util.formatArea(area));

        // Rebuild ALL segment labels from scratch
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
          );
          segLabels.push(label);
          label.on("click", handleItemClick);
        }

        // Rebuild centroid position
        rebuildCentroid(isXVisible, area);

        if (onUpdate) {
          opts.area = area;
          onUpdate();
        }
      });

    delMarker.on("click", (e) => {
      const t = e.originalEvent?.target;
      if (t?.classList?.contains(CONST.DEL_ICON.CLASS)) return;
      handleItemClick(e);
    });
  });

  // Re-sort layers
  nodeMarkers.forEach((m) => layers.removeLayer(m));
  nodeDelIcons.forEach((m) => layers.removeLayer(m));
  segLabels.forEach((l) => layers.removeLayer(l));
  nodeMarkers.forEach((m) => layers.addLayer(m));
  nodeDelIcons.forEach((m) => layers.addLayer(m));
  segLabels.forEach((l) => layers.addLayer(l));

  return onMapClickActive;

  /** Activate a measurement mode. Clears previous mode if active.
   *  @param {string} mode - Mode key from CONST.MODE. */
};

export { attachCircleUI, attachDistanceUI, attachPolygonUI };
