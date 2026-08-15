() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const ids = api.layers.map(l => l.id);
  return { count: ids.length, ids };
};
