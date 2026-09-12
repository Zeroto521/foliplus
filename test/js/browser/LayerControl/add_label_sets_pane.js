() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const mg = api.createLayers({
    id: "__test_label__",
    name: "LabelTest",
    panes: [{name:"__test_label_graph__"}, {name:"__test_label_pane__"}],
  });
  const mkr = L.marker([26.08, 119.3]);
  // Use the public API with an explicit pane name â€?the wrapper then routes
  // the marker into the sub-layer matching that pane (not the base).
  mg.addLayer(mkr, "__test_label_pane__");
  return { pane: mkr.options.pane, registered: mg.registered() };
};
