() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const mg = api.createLayers({
    id: "__test_unreg__",
    name: "UnregTest",
    graphPane: "__test_unreg_graph__",
  });
  mg.mainLayer.addLayer(
    L.polyline([
      [26.08, 119.3],
      [26.09, 119.31],
    ]),
  );
  const before = mg.registered();
  mg.clearLayers();
  const after = mg.registered();
  return { before, after };
};
