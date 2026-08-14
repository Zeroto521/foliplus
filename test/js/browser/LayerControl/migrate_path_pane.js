() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  const mg = api.createLayers({
    id: "__test_path_pane__",
    name: "PathPane",
    graphPane: "__test_path_pane_graph__",
  });
  const poly = L.polyline([
    [26.08, 119.3],
    [26.09, 119.31],
  ]);
  mg.mainLayer.addLayer(poly);
  return { pane: poly.options.pane };
};
