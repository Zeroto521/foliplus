// Verify that the zoomRange native carrier (layer.options.minZoom/maxZoom +
// adapter _resetView) actually clears a GridLayer's tiles when the current
// zoom falls outside the range. The native branch writes options then calls
// resetGridLayerView (core/leafletAdapter) — this probe replays that exact
// sequence against a real Leaflet tile container and measures the result.
async () => {
  const spec = window.__probe;
  delete window.__probe;
  const m = window.__layerCtrl.m;
  const li = m.layers.find(l => l.id === spec.id);
  if (!li) return { error: "layer not found: " + spec.id };
  const tile = m.findLayer(li);
  if (!tile) return { error: "layer object not found" };

  const cnt = () => (tile._container || tile).querySelectorAll("img").length;

  const waitFor = async predicate => {
    const started = Date.now();
    while (Date.now() - started < 5000) {
      if (predicate()) return true;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return predicate();
  };

  if (typeof tile._resetView === "function") tile._resetView();
  if (!(await waitFor(() => cnt() > 0))) {
    return { error: "no tiles loaded — check tile server" };
  }

  const zoom = m.map.getZoom();
  const before = cnt();

  // Replay the native branch: write options then reset the level set.
  tile.options.minZoom = zoom + 1;
  tile.options.maxZoom = zoom + 5;
  // resetGridLayerView(layer) then calls layer._resetView().
  // Leaflet's own probe_tile_maxzoom.js established that without _resetView
  // the tiles stay; this call is what makes the range effective.
  if (typeof tile._resetView === "function") tile._resetView();
  await waitFor(() => cnt() === 0);
  const after = cnt();

  // Restore.
  delete tile.options.minZoom;
  delete tile.options.maxZoom;
  if (typeof tile._resetView === "function") tile._resetView();
  await waitFor(() => cnt() > 0);
  const restored = cnt();

  return {
    zoom,
    before,
    after,
    restored,
    tilesCleared: after === 0,
    restoredOk: restored > 0,
  };
};
