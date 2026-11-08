fixtures => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const mg = api.createLayers({
    id: "__test_clear__",
    name: "ClearTest",
    panes: [{ name: "__test_clear_graph__" }],
  });
  mg.mainLayer.addLayer(L.polyline(fixtures.line));
  const beforeRegistered = mg.registered();
  mg.clearLayers();
  const afterRegistered = mg.registered();
  return { beforeRegistered, afterRegistered };
};
