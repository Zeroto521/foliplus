() => {
  // Read the heatmap manager's initialized default values.
  const m = window.__heatmapCtrl.mgr;
  return {
    numClasses: m.numClasses,
    borderWeight: m.borderWeight,
    borderColor: m.borderColor,
    labelShow: m.labelShow,
    method: m.method,
    scheme: m.scheme,
    agg: m.agg,
  };
};
