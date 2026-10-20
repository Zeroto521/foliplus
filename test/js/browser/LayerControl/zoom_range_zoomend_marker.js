async () => {
  const ctrl = window.__layerCtrl;
  const map = ctrl.mgr.map;
  const ui = ctrl.mgr.ui;
  const api = map.foliplus.LayerAPI;

  const geo = L.geoJson({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "p1" },
        geometry: { type: "Point", coordinates: [119.3, 26.08] },
      },
    ],
  });
  api.registerLayer({ id: "zr_zoomend", name: "ZRZoomEnd", layer: geo });
  ctrl.mgr.enforceOrder();

  ui.openStylePanel("zr_zoomend");
  const row = document.querySelector(".foliplus-style-zoom-range-row");
  if (!row) {
    ui.closeStylePanel(false);
    return { error: "zoom range row not rendered" };
  }

  // The primitive rebuilds the marks when the current level moves, so every
  // read must re-query the live nodes rather than keep a stale reference.
  const readMarker = () => {
    const marker = row.querySelector(".foliplus-slider-dot-current");
    const label = row.querySelector(".foliplus-slider-value-current");
    return {
      left: marker ? marker.style.left : null,
      label: label ? label.textContent : null,
      covered: marker ? marker.classList.contains("foliplus-slider-dot-covered") : null,
    };
  };

  const before = readMarker();
  const beforeZoom = map.getZoom();

  map.setZoom(beforeZoom - 2);
  await new Promise(resolve => map.once("zoomend", resolve));

  const after = readMarker();
  const afterZoom = map.getZoom();
  ui.closeStylePanel(false);
  return {
    before: beforeZoom,
    after: afterZoom,
    beforeLeft: before.left,
    afterLeft: after.left,
    markerMoved: before.left !== after.left,
    beforeLabel: before.label,
    afterLabel: after.label,
    labelUpdated: after.label !== before.label,
    afterCovered: after.covered,
  };
};
