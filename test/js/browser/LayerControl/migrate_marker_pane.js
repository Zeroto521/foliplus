() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  const mg = api.createLayers({
    id: "__test_marker_pane__",
    name: "MarkerPane",
    graphPane: "__test_marker_pane_graph__",
  });
  const mkr = L.marker([26.08, 119.3]);
  mg.mainLayer.addLayer(mkr);
  return { pane: mkr.options.pane };
};
