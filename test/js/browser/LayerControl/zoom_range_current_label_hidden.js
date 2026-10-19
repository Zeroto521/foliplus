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
    Promise.race([
      new Promise(resolve => map.once("zoomend", resolve)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("zoomend timeout")), 5000),
      ),
    ]);

  let atMin, atMid;
  try {
    // Register the zoomend listener BEFORE setZoom() because Leaflet fires
    // zoomend synchronously when there is no animation duration.
    const mapMin = map.getMinZoom() ?? 0;
    const mapMax = map.getMaxZoom() ?? 20;
    const mid = Math.round((mapMin + mapMax) / 2);

    const minPromise = waitForZoomend();
    map.setZoom(mapMin);
    await minPromise;
    atMin = {
      zoom: map.getZoom(),
      classListHidden: marker.classList.contains("foliplus-slider-label-hidden"),
      visibility: window.getComputedStyle(currentValue).visibility,
    };

    const midPromise = waitForZoomend();
    map.setZoom(mid);
    await midPromise;
    atMid = {
      zoom: map.getZoom(),
      classListHidden: marker.classList.contains("foliplus-slider-label-hidden"),
      visibility: window.getComputedStyle(currentValue).visibility,
    };
  } catch (e) {
    ui.closeStylePanel(false);
    return { error: `zoom change failed: ${e.message}` };
  }

  ui.closeStylePanel(false);
  return { atMin, atMid };
};
