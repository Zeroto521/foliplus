() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const mg = api.createLayers({
    id: "__test_pane__",
    name: "PaneTest",
    graphPane: "__pane_test_graph__",
    labelPane: "__pane_test_label__",
  });
  const poly = L.polyline([
    [26.08, 119.3],
    [26.09, 119.31],
  ]);
  mg.mainLayer.addLayer(poly);
  return {
    pane: poly.options.pane,
    hasRenderer: !!poly._renderer,
    registered: mg.registered(),
  };
};
