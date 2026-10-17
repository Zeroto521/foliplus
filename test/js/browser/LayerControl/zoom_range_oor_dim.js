() => {
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
  api.registerLayer({ id: "zr_oor", name: "ZROOR", layer: geo });
  ctrl.mgr.enforceOrder();

  const current = map.getZoom();

  // Set a range that excludes the current zoom level.
  ui.openStylePanel("zr_oor");
  const row = document.querySelector(".foliplus-style-zoom-range-row");
  if (!row) {
    ui.closeStylePanel(false);
    return { error: "zoom range row not rendered" };
  }

  const slider = row.querySelector("wa-slider");

  // Range [mapMin, current-1] — current is above max, so out of range.
  slider.maxValue = current - 1;
  slider.dispatchEvent(new Event("change", { bubbles: true }));

  const rowOor = row.classList.contains("foliplus-zoom-range-out-of-range");
  const rowTitle = row.title;
  const marker = row.querySelector(".foliplus-style-zoom-range-current-marker");
  const markerLabel = row.querySelector(
    ".foliplus-style-zoom-range-current-marker .foliplus-style-zoom-range-current-value",
  );
  const markerLabelText = markerLabel ? markerLabel.textContent : null;
  const currentValueColor = markerLabel ? getComputedStyle(markerLabel).color : null;
  const sliderComputedOpacity = slider ? getComputedStyle(slider).opacity : null;
  const limitMin = row.querySelector(".foliplus-style-zoom-range-limit-min");
  const limitMax = row.querySelector(".foliplus-style-zoom-range-limit-max");

  ui.closeStylePanel(false);
  return {
    current,
    rowOor,
    rowTitle,
    markerLabelText,
    currentValueColor,
    sliderComputedOpacity,
    limitMinText: limitMin ? limitMin.textContent : null,
    limitMaxText: limitMax ? limitMax.textContent : null,
  };
};
