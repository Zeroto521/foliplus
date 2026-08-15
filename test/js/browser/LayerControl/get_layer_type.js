() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  // Register a polygon layer
  const poly = L.polygon([
    [26.08, 119.3],
    [26.09, 119.31],
    [26.07, 119.32],
  ]);
  api.registerLayer({ id: "__test_type__", layer: poly });
  const type = api.getLayerType("__test_type__");
  const layers = api.getLayersByType("polygon");
  return { type, hasPolygon: layers.some(l => l.id === "__test_type__") };
};
