() => {
  // Snapshot after deleteLayer + flush: whether the heatmap is still selected,
  // cache cleared, LayerAPI row count, and the persisted record contents.
  const m = window.__heatmapCtrl.mgr;
  const key = Object.keys(localStorage).find(x => x.startsWith("foliplus_heatmap_"));
  const rec = key ? JSON.parse(localStorage.getItem(key)) : null;
  return {
    selected: m.selectedLayerId,
    hasFeatures: m.cachedFeatures !== null,
    rows: window.map.foliplus.LayerAPI.layers.length,
    recordPresent: rec !== null,
    storedLayerId: rec ? rec.layerId : "__no_record__",
  };
};
