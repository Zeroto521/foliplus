() => {
  // Delete the heatmap's own layer via LayerAPI and report how many rows
  // were actually removed.
  const m = window.__heatmapCtrl.mgr;
  const before = window.map.foliplus.LayerAPI.layers.length;
  window.map.foliplus.LayerAPI.deleteLayer(m.layerId);
  return before - window.map.foliplus.LayerAPI.layers.length;
};
