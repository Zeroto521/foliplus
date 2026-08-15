() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  // Register a layer
  const fg = L.featureGroup();
  api.registerLayer({ id: "__test_reentry__", name: "ReEntry", layer: fg });
  // Simulate uncheck: unregister (as if user toggled the layer off)
  api.unregisterLayer("__test_reentry__");
  // Re-register (simulating MeasureControl tool re-activation)
  api.registerLayer({ id: "__test_reentry__", name: "ReEntry", layer: fg });
  const found = api.layers.some(l => l.id === "__test_reentry__");
  return { found };
};
