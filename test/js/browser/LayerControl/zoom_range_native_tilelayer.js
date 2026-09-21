// Verify that the zoomRange native carrier (layer.options.minZoom/maxZoom +
// adapter _resetView) actually clears a GridLayer's tiles when the current
// zoom falls outside the range. R7's native branch writes options then calls
// resetGridLayerView (core/leafletAdapter) — this probe replays that exact
// sequence against a real Leaflet tile container and measures the result.
() => {
  const spec = window.__probe;
  delete window.__probe;
  const m = window.__layerCtrl.m;
  const li = m.layers.find(l => l.id === spec.id);
  if (!li) return { error: "layer not found: " + spec.id };
  const tile = m.findLayer(li);
  if (!tile) return { error: "layer object not found" };

  const cnt = () => (tile._container || tile).querySelectorAll("img").length;

  const zoom = m.map.getZoom();
  const before = cnt();
  if (before === 0) return { error: "no tiles loaded — check tile server" };

  // Replay R7's native branch: write options then reset the level set.
  tile.options.minZoom = zoom + 1;
  tile.options.maxZoom = zoom + 5;
  // R7 calls resetGridLayerView(layer) which calls layer._resetView().
  // Leaflet's own probe_tile_maxzoom.js established that without _resetView
  // the tiles stay; this call is what makes the range effective.
  if (typeof tile._resetView === "function") tile._resetView();

  const after = cnt();

  // Restore.
  delete tile.options.minZoom;
  delete tile.options.maxZoom;
  if (typeof tile._resetView === "function") tile._resetView();
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
