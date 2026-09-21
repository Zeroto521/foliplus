() => {
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
  api.registerLayer({ id: "zr_oor", name: "ZROOR", layer: geo });
  ctrl.m.enforceOrder();

  const current = map.getZoom();

  // Set a range that excludes the current zoom level.
  ui.openStylePanel("zr_oor");
  const row = document.querySelector(".foliplus-style-zoom-range-row");
  if (!row) {
    ui.closeStylePanel(false);
    return { error: "zoom range row not rendered" };
  }

  const minInput = row.querySelector(".foliplus-style-zoom-range-min");
  const maxInput = row.querySelector(".foliplus-style-zoom-range-max");

  // Range [mapMin, current-1] — current is above max, so out of range.
  maxInput.value = String(current - 1);
  maxInput.dispatchEvent(new Event("change", { bubbles: true }));

  const rowOor = row.classList.contains("foliplus-zoom-range-out-of-range");
  const rowTitle = row.title;
  const trackBg = row.querySelector(".foliplus-style-zoom-range-track");
  const fillBg = row.querySelector(".foliplus-style-zoom-range-fill");
  const marker = row.querySelector(".foliplus-style-zoom-range-dot-current");
  const markerLabel = row.querySelector(".foliplus-style-zoom-range-current-value");
  const markerRing = marker ? getComputedStyle(marker).borderColor : null;
  const markerLabelText = markerLabel ? markerLabel.textContent : null;
  const currentValueColor = markerLabel ? getComputedStyle(markerLabel).color : null;
  const minLabel = row.querySelector(
    ".foliplus-style-zoom-range-value span:nth-child(1)",
  );
  const maxLabel = row.querySelector(
    ".foliplus-style-zoom-range-value span:nth-child(2)",
  );

  ui.closeStylePanel(false);
  return {
    current,
    rowOor,
    rowTitle,
    trackComputedBg: trackBg ? getComputedStyle(trackBg).backgroundColor : null,
    fillComputedBg: fillBg ? getComputedStyle(fillBg).backgroundColor : null,
    currentValueColor,
    markerRing,
    markerLabelText,
    minLabelText: minLabel ? minLabel.textContent : null,
    maxLabelText: maxLabel ? maxLabel.textContent : null,
  };
};
