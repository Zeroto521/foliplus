async () => {
  const ctrl = window.__layerCtrl;
  const map = ctrl.m.map;
  const ui = ctrl.m.ui;
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
  ctrl.m.enforceOrder();

  ui.openStylePanel("zr_zoomend");
  const row = document.querySelector(".foliplus-style-zoom-range-row");
  if (!row) {
    ui.closeStylePanel(false);
    return { error: "zoom range row not rendered" };
  }

  const marker = row.querySelector(".foliplus-style-zoom-range-current");
  const markerLabel = row.querySelector(".foliplus-style-zoom-range-current-value");
  const before = map.getZoom();
  const beforeLeft = marker ? marker.style.left : null;
  const beforeLabel = markerLabel ? markerLabel.textContent : null;

  map.setZoom(before - 2);
  await new Promise(resolve => map.once("zoomend", resolve));

  const after = map.getZoom();
  const afterLeft = marker ? marker.style.left : null;
  const afterLabel = markerLabel ? markerLabel.textContent : null;
  const afterTitle = marker ? marker.title : null;

  ui.closeStylePanel(false);
  return {
    before,
    after,
    beforeLeft,
    afterLeft,
    markerMoved: beforeLeft !== afterLeft,
    beforeLabel,
    afterLabel,
    labelUpdated: afterLabel !== beforeLabel,
    afterTitle,
  };
};
