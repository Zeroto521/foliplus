() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const mg = api.createLayers({
    id: "__test_clear__",
    name: "ClearTest",
    graphPane: "__test_clear_graph__",
  });
  mg.mainLayer.addLayer(
    L.polyline([
      [26.08, 119.3],
      [26.09, 119.31],
    ]),
  );
  const beforeRegistered = mg.registered();
  mg.clearLayers();
  const afterRegistered = mg.registered();
  return { beforeRegistered, afterRegistered };
};
