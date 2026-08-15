() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const beforeDestroy = api.isDestroyed;
  api.destroy();
  return {
    beforeDestroy,
    isDestroyed: api.isDestroyed,
    layersLength: api.layers.length,
    hasLayerAPI: !!(window.map.foliplus && window.map.foliplus.LayerAPI),
  };
};
