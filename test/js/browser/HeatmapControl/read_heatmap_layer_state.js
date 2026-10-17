() => {
  // Snapshot selected layer + cache status + LayerAPI row count.
  const m = window.__heatmapCtrl.mgr;
  return {
    selected: m.selectedLayerId,
    hasFeatures: m.cachedFeatures !== null,
    rows: window.map.foliplus.LayerAPI.layers.length,
  };
};
