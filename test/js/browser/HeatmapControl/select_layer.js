value => {
  // Select a layer in the heatmap dropdown and trigger change.
  const sel = window.__heatmapCtrl.layerSelect;
  sel.value = value;
  sel.dispatchEvent(new Event("change"));
};
