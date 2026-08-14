() => {
  // Read the heatmap manager state after clearing.
  const m = window.__heatmapCtrl.manager;
  return {
    numClasses: m.numClasses,
    borderWeight: m.borderWeight,
    borderColor: m.borderColor,
    currentMethod: m.currentMethod,
    currentScheme: m.currentScheme,
  };
};
