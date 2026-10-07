() => {
  // Read the heatmap manager state after clearing.
  const m = window.__heatmapCtrl.mgr;
  return {
    numClasses: m.numClasses,
    borderWeight: m.borderWeight,
    borderColor: m.borderColor,
    method: m.method,
    scheme: m.scheme,
  };
};
