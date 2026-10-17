() => {
  // Snapshot before deleting the heatmap's own layer: what's selected, the
  // heatmap's layer id, cache status, whether the canvas is still registered
  // with LayerAPI, and the total row count.
  const m = window.__heatmapCtrl.mgr;
  const layers = window.map.foliplus.LayerAPI.layers;
  return {
    selected: m.selectedLayerId,
    heatmapLayer: m.layerId,
    hasFeatures: m.cachedFeatures !== null,
    registered: layers.some(l => l.id === m.layerId),
    rows: layers.length,
  };
};
