() => {
  // List all layers registered on the LayerControl API.
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api || !api.layers) return [];
  return api.layers.map(l => ({ id: l.id, visible: l.visible, isBase: l.isBase }));
};
