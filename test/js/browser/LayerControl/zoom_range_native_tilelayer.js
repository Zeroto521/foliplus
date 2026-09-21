// Verify that the zoomRange native carrier (layer.options.minZoom/maxZoom)
// actually hides a GridLayer's tiles when the current zoom falls outside the
// range. R7's native branch writes options directly — this probe measures
// whether Leaflet honours that at runtime (tiles removed from the container)
// or leaves them in place (visible but stale).
() => {
  const spec = window.__probe;
  delete window.__probe;
  const m = window.__layerCtrl.m;
  const li = m.layers.find(l => l.id === spec.id);
  if (!li) return { error: "layer not found: " + spec.id };
  const tile = m.findLayer(li);
  if (!tile) return { error: "layer object not found" };

  const cnt = () =>
    (tile._container || tile).querySelectorAll("img").length;

  const zoom = m.map.getZoom();
  const before = cnt();

  // Set a range that excludes the current zoom.
  tile.options.minZoom = zoom + 1;
  tile.options.maxZoom = zoom + 5;

  // Leaflet does not self-apply options changes — an explicit level rebuild
  // is required (see probe_tile_maxzoom.js). R7's native branch does not
  // call _resetView, so measure what actually happens.
  const afterSet = cnt();

  // Now test whether _resetView clears them (the native contract).
  if (typeof tile._resetView === "function") tile._resetView();
  const afterReset = cnt();

  // Restore.
  delete tile.options.minZoom;
  delete tile.options.maxZoom;
  if (typeof tile._resetView === "function") tile._resetView();

  return {
    zoom,
    before,
    afterSet,
    afterReset,
    hideOnSet: afterSet === 0,
    hideOnReset: afterReset === 0,
  };
};
