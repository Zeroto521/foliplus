() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  const beforeDestroy = api.isDestroyed;
  api.destroy();
  return {
    beforeDestroy,
    isDestroyed: api.isDestroyed,
    layersLength: api.layers.length,
    hasLayerAPI: !!(window.foliplus && window.foliplus.LayerAPI),
  };
};
