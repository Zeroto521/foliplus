() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const li = api.layers.find(l => l.name === "TestLayer");
  if (!li) return null;
  const layer = api.findLayer(li.id);
  if (!layer) return null;
  // Find the leaf marker inside the FeatureGroup
  let leaf = null;
  layer.eachLayer(l => {
    if (!leaf) leaf = l;
  });
  if (!leaf) return null;
  return { id: li.id, paneSet: leaf.options.paneSet };
};
