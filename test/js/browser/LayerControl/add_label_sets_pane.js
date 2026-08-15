() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const mg = api.createLayers({
    id: "__test_label__",
    name: "LabelTest",
    graphPane: "__test_label_graph__",
    labelPane: "__test_label_pane__",
  });
  const mkr = L.marker([26.08, 119.3]);
  mkr.isLabel = true;
  mg.mainLayer.addLayer(mkr);
  return { pane: mkr.options.pane, registered: mg.registered() };
};
