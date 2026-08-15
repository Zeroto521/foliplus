() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  // Initial li.layer is lazily resolved (LayerControl script runs before the
  // layer scripts), so walk the live Leaflet map for the FeatureGroup instead.
  let layer = null;
  window.map.eachLayer(l => {
    if (!layer && l instanceof L.FeatureGroup) layer = l;
  });
  if (!layer) return null;
  // Find the leaf marker inside the FeatureGroup
  let leaf = null;
  layer.eachLayer(l => {
    if (!leaf) leaf = l;
  });
  if (!leaf) return null;
  return { id: "TestLayer", paneSet: leaf.options.paneSet };
};
