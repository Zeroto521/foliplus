// Removes the heatmap control from its map while the scheme list is open.
() => {
  window.map.removeControl(window.__heatmapCtrl);
  return true;
};
