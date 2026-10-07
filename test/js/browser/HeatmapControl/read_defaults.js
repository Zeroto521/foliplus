() => {
  // Read the heatmap manager's initialised default values.
  const m = window.__heatmapCtrl.mgr;
  return {
    numClasses: m.numClasses,
    borderWeight: m.borderWeight,
    borderColor: m.borderColor,
    currentLabelShow: m.currentLabelShow,
    currentMethod: m.currentMethod,
    currentScheme: m.currentScheme,
    currentAgg: m.currentAgg,
  };
};
