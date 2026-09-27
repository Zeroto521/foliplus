() => {
  // List all layers registered on the LayerControl API. `visible` reports
  // the user's intent via `intentVisible` — the map membership is a
  // separate fact.
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api || !api.layers) return [];
  return api.layers.map(l => ({
    id: l.id,
    visible: api.intentVisible ? api.intentVisible(l.id) : null,
    isBase: l.isBase,
  }));
};
