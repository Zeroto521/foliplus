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
  api.registerLayer({ id: "zr_label_hide", name: "ZRLabelHide", layer: geo });
  ctrl.mgr.enforceOrder();

  ui.openStylePanel("zr_label_hide");
  const row = document.querySelector(".foliplus-style-zoom-range-row");
  if (!row) {
    ui.closeStylePanel(false);
    return { error: "zoom range row not rendered" };
  }

  const marker = row.querySelector(".foliplus-style-zoom-range-current-marker");
  const currentValue = row.querySelector(
    ".foliplus-style-zoom-range-current-marker .foliplus-style-zoom-range-current-value",
  );
  if (!marker || !currentValue) {
    ui.closeStylePanel(false);
    return { error: "marker/current-value missing" };
  }

  const waitForZoomend = () =>
    new Promise(resolve => map.once("zoomend", resolve));

  // Set zoom to the map's min (0): the current marker sits at 0% of the rail,
  // within LABEL_MIN_GAP_PCT of the min end, so the label must be hidden.
  const mapMin = map.getMinZoom();
  map.setZoom(mapMin);
  await waitForZoomend();
  const atMin = {
    zoom: map.getZoom(),
    classListHidden: marker.classList.contains("foliplus-slider-label-hidden"),
    visibility: window.getComputedStyle(currentValue).visibility,
  };

  // Move to the middle: the label must be visible again.
  const mid = Math.round((map.getMinZoom() + map.getMaxZoom()) / 2);
  map.setZoom(mid);
  await waitForZoomend();
  const atMid = {
    zoom: map.getZoom(),
    classListHidden: marker.classList.contains("foliplus-slider-label-hidden"),
    visibility: window.getComputedStyle(currentValue).visibility,
  };

  ui.closeStylePanel(false);
  return { atMin, atMid, mapMin, mapMax: map.getMaxZoom() };
};
