() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  // Create a managed layer group (like MeasureControl does)
  const layers = api.createLayers({
    id: "__test_measure__",
    name: "Test Measure",
    graphPane: "test_graph",
    labelPane: "test_label",
  });
  // Add content (triggers register)
  const mkr = L.circleMarker([26.08, 119.3]);
  mkr.isLabel = false;
  layers.mainLayer.addLayer(mkr);
  const wasRegistered = layers.registered();
  // Simulate uncheck: remove mainLayer from map (Leaflet's public Map API)
  window.map.removeLayer(layers.mainLayer);
  const onMapAfterUncheck = window.map.hasLayer(layers.mainLayer);
  // Trigger re-add via register() path (simulating tool click)
  const mkr2 = L.circleMarker([26.09, 119.31]);
  mkr2.isLabel = false;
  layers.mainLayer.addLayer(mkr2);
  const onMapAfterReadd = window.map.hasLayer(layers.mainLayer);
  // Check checkbox state in LayerControl panel
  const item = document.querySelector('[data-layer-id="__test_measure__"]');
  const cb = item ? item.querySelector('input[type="checkbox"]') : null;
  const checkboxChecked = cb ? cb.checked : "no-cb";
  return { wasRegistered, onMapAfterUncheck, onMapAfterReadd, checkboxChecked };
};
