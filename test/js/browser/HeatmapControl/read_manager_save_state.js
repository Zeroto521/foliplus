() => {
  // Snapshot the heatmap state after a save / reload: layer id, class count,
  // and whether cached features are populated.
  const m = window.__heatmapCtrl.mgr;
  return {
    layerId: m.selectedLayerId,
    numClasses: m.numClasses,
    hasFeatures: m.cachedFeatures !== null,
  };
};
