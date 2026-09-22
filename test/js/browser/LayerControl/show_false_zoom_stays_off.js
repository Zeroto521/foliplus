async () => {
  // Gate 1: the zoomend sweep path. A folium show=False layer has no
  // hiddenIds entry and (before the fix) the sweep's applyLayerState
  // would unconditionally addLayer on every zoomend — putting the layer
  // on the map while the checkbox stayed unchecked. This test verifies
  // that a zoomend sweep does not resurrect a layer the author left
  // off the map.
  const probe = window.__probe || {};
  const id = probe.id;
  if (!id) return { error: "window.__probe.id not set by Python test" };

  // The per-map global is named after the container's id, not window.map.
  const el = document.querySelector(".leaflet-container");
  const map = (el && window[el.id]) || window.map;
  if (!map) return { error: "map not found" };
  const api = map.foliplus && map.foliplus.LayerAPI;
  if (!api) return { error: "LayerAPI not found" };

  // Debug: inspect what's available.
  const debug = {
    hasFindLayer: typeof api.findLayer,
    layersCount: api.layers ? api.layers.length : null,
    layersIds: api.layers ? api.layers.map(l => l.id) : null,
    mapLayers: map._layers ? Object.keys(map._layers) : null,
  };

  // api.layers is LayerManager's getter; the lightweight stub has a frozen [].
  // findLayer exists only on the real LayerManager.
  let layer = null;
  if (api.findLayer) {
    layer = api.findLayer(id);
  }
  if (!layer) {
    return { error: `layer ${id} not found via LayerAPI.findLayer`, debug };
  }

  const beforeOnMap = map.hasLayer(layer);
  const row = document.querySelector(`[data-layer-id="${id}"]`);
  const cb = row?.querySelector('input[type="checkbox"]');
  const beforeRowChecked = cb?.checked ?? null;

  // Trigger a zoomend sweep.
  const before = map.getZoom();
  map.setZoom(Math.max(1, before - 1));
  await new Promise(resolve => map.once("zoomend", resolve));
  map.setZoom(before);
  await new Promise(resolve => map.once("zoomend", resolve));

  const afterOnMap = map.hasLayer(layer);
  const afterRowChecked = cb?.checked ?? null;

  return {
    beforeOnMap,
    afterOnMap,
    stayedOff: afterOnMap === false,
    beforeRowChecked,
    afterRowChecked,
    rowConsistent: beforeRowChecked === afterRowChecked,
  };
};
