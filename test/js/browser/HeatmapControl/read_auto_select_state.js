() => {
  // Read the heatmap manager state on panel expand to verify auto-select.
  const m = window.__heatmapCtrl.manager;
  return {
    selectedLayerId: m.selectedLayerId,
    hasCachedFeatures: m.cachedFeatures !== null && m.cachedFeatures !== undefined,
    extraBodyHidden: window.__heatmapCtrl.extraBody
      ? window.__heatmapCtrl.extraBody.classList.contains("hidden")
      : null,
  };
};
