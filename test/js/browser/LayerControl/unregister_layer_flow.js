fixtures => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const mg = api.createLayers({
    id: "__test_unreg__",
    name: "UnregTest",
    panes: [{ name: "__test_unreg_graph__" }],
  });
  mg.mainLayer.addLayer(L.polyline(fixtures.line));
  const before = mg.registered();
  mg.clearLayers();
  const after = mg.registered();
  return { before, after };
};
