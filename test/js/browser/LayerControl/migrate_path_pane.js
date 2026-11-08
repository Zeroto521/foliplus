fixtures => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const mg = api.createLayers({
    id: "__test_path_pane__",
    name: "PathPane",
    panes: [{ name: "__test_path_pane_graph__" }],
  });
  const poly = L.polyline(fixtures.line);
  mg.mainLayer.addLayer(poly);
  return { pane: poly.options.pane };
};
