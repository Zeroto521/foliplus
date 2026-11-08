fixtures => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const mg = api.createLayers({
    id: "__test_pane__",
    name: "PaneTest",
    panes: [{ name: "__pane_test_graph__" }, { name: "__pane_test_label__" }],
  });
  const poly = L.polyline(fixtures.line);
  mg.mainLayer.addLayer(poly);
  return {
    pane: poly.options.pane,
    hasRenderer: !!poly._renderer,
    registered: mg.registered(),
  };
};
