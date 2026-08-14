() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  const li = api.layers.find(l => l.name === "TestLayer");
  if (!li) return null;
  const layer = api.findLayer(li.id);
  if (!layer) return null;
  let leaf = null;
  layer.eachLayer(l => {
    if (!leaf) leaf = l;
  });
  if (!leaf) return null;
  return leaf.options.paneSet;
};
