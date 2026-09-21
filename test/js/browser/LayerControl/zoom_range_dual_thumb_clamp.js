() => {
  const ctrl = window.__layerCtrl;
  const map = ctrl.m.map;
  const ui = ctrl.m.ui;
  const api = map.foliplus.LayerAPI;

  // Register a GeoJSON point layer — zoomRange capability = "pane".
  const geo = L.geoJson({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { name: "p1" },
      geometry: { type: "Point", coordinates: [119.3, 26.08] },
    }],
  });
  api.registerLayer({ id: "zr_clamp", name: "ZRClamp", layer: geo });
  ctrl.m.enforceOrder();

  ui.openStylePanel("zr_clamp");
  const row = document.querySelector(".foliplus-style-zoom-range-row");
  if (!row) { ui.closeStylePanel(false); return { error: "zoom range row not rendered" }; }

  const minInput = row.querySelector(".foliplus-style-zoom-range-min");
  const maxInput = row.querySelector(".foliplus-style-zoom-range-max");
  if (!minInput || !maxInput) { ui.closeStylePanel(false); return { error: "inputs not found" }; }

  const mapMin = map.getMinZoom();
  const mapMax = map.getMaxZoom();
  const initialMin = parseInt(minInput.value, 10);
  const initialMax = parseInt(maxInput.value, 10);

  // Drag min past max — min should clamp to max (two thumbs never cross).
  const crossVal = initialMax + 1;
  minInput.value = String(crossVal);
  minInput.dispatchEvent(new Event("change", { bubbles: true }));

  const minAfterCross = parseInt(minInput.value, 10);
  const maxAfterCross = parseInt(maxInput.value, 10);

  // Reset: drag max back to full range.
  maxInput.value = String(mapMax);
  maxInput.dispatchEvent(new Event("change", { bubbles: true }));

  // Drag max below min — max should clamp to min.
  maxInput.value = String(initialMin - 1);
  maxInput.dispatchEvent(new Event("change", { bubbles: true }));

  const minAfterReverse = parseInt(minInput.value, 10);
  const maxAfterReverse = parseInt(maxInput.value, 10);

  ui.closeStylePanel(false);
  return {
    mapMin, mapMax,
    initialMin, initialMax,
    crossVal,
    minAfterCross, maxAfterCross,
    minAfterReverse, maxAfterReverse,
    clampForward: minAfterCross <= maxAfterCross,
    clampReverse: minAfterReverse <= maxAfterReverse,
    stored: ui.zoomRangeMap["zr_clamp"],
  };
};
