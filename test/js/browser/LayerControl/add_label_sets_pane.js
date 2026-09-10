() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const mg = api.createLayers({
    id: "__test_label__",
    name: "LabelTest",
    panes: ["__test_label_graph__", "__test_label_pane__"],
  });
  const mkr = L.marker([26.08, 119.3]);
  mkr.options.pane = "__test_label_pane__";
  mg.mainLayer.addLayer(mkr);
  return { pane: mkr.options.pane, registered: mg.registered() };
};
