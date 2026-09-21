// R1 probe (§10.3 #8): does changing a TileLayer's options.minZoom/maxZoom
// take effect immediately, or does it need a level refresh?
//
// Measured: setting options.maxZoom below the current zoom leaves the
// already-loaded tiles in place; `_updateLevels()` alone does not remove
// them either; only `_resetView()` / `redraw()` (which rebuilds the level
// set) clears them. So the native path (R8) needs an explicit redraw after
// an options change — it is not self-applying.
() => {
  const spec = window.__probe;
  delete window.__probe;
  const m = window.__layerCtrl.m;
  const li = m.layers.find(l => l.id === spec.id);
  const tile = m.findLayer(li);
  const cnt = () => (tile._container || tile).querySelectorAll("img").length;
  const before = cnt();
  tile.options.maxZoom = 10; // below the current zoom (12)
  const afterSet = cnt();
  if (typeof tile._updateLevels === "function") tile._updateLevels();
  const afterLevels = cnt();
  tile._resetView();
  const afterReset = cnt();
  // Restore.
  tile.options.maxZoom = undefined;
  if (typeof tile._updateLevels === "function") tile._updateLevels();
  tile._resetView();
  return { before, afterSet, afterLevels, afterReset };
};
