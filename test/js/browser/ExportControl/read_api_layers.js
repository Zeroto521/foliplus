() => {
  // List all layers registered on the LayerControl API.
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api || !api.layers) return [];
  return api.layers.map(l => ({ id: l.id, visible: l.visible, isBase: l.isBase }));
};
