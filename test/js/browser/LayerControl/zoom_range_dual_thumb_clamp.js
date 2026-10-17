async () => {
  const ctrl = window.__layerCtrl;
  const map = ctrl.mgr.map;
  const ui = ctrl.mgr.ui;
  const api = map.foliplus.LayerAPI;

  // Register a GeoJSON point layer — zoomRange capability = "pane".
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
  api.registerLayer({ id: "zr_clamp", name: "ZRClamp", layer: geo });
  ctrl.mgr.enforceOrder();

  ui.openStylePanel("zr_clamp");
  const row = document.querySelector(".foliplus-style-zoom-range-row");
  if (!row) {
    ui.closeStylePanel(false);
    return { error: "zoom range row not rendered" };
  }

  const slider = row.querySelector("wa-slider");
  if (!slider) {
    ui.closeStylePanel(false);
    return { error: "wa-slider not found" };
  }
  const wait = () => slider.updateComplete;

  const mapMin = map.getMinZoom();
  const mapMax = map.getMaxZoom();
  const initialMin = Number(slider.minValue);
  const initialMax = Number(slider.maxValue);

  // Drag min past max — the component clamps min back to max (the "two thumbs
  // never cross" invariant is the library's own, §4.0.2 of the design
  // contract). foliplus reads what the component reports; it no longer clamps.
  slider.minValue = initialMax + 1;
  await wait();
  const minAfterCross = Number(slider.minValue);
  const maxAfterCross = Number(slider.maxValue);

  // Reset: drag max back to full range.
  slider.maxValue = mapMax;
  await wait();

  // Drag max below min — the component clamps max back to min.
  slider.maxValue = initialMin - 1;
  await wait();
  const minAfterReverse = Number(slider.minValue);
  const maxAfterReverse = Number(slider.maxValue);

  // Commit pass — the library's reported range is what gets persisted.
  slider.dispatchEvent(new Event("change", { bubbles: true }));

  ui.closeStylePanel(false);
  return {
    mapMin,
    mapMax,
    initialMin,
    initialMax,
    minAfterCross,
    maxAfterCross,
    minAfterReverse,
    maxAfterReverse,
    clampForward: minAfterCross <= maxAfterCross,
    clampReverse: minAfterReverse <= maxAfterReverse,
    stored: ui.intentStore.get("zr_clamp", "zoomRange") ?? null,
  };
};
