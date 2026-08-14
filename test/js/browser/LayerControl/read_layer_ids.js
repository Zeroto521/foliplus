() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  const ids = api.layers.map(l => l.id);
  return { count: ids.length, ids };
};
