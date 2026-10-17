// Same lookup as read_zroffreload_on_map_nullable but returns { error } when
// a prerequisite is missing so the caller can assert the failure mode.
() => {
  const el = document.querySelector(".leaflet-container");
  const map = (el && window[el.id]) || window.map;
  if (!map) return { error: "map not found" };
  const api = map.foliplus && map.foliplus.LayerAPI;
  if (!api) return { error: "LayerAPI not found" };
  const layer = api.layers.find(l => l.name === "ZROffReload");
  if (!layer) return { error: "ZROffReload not in registry" };
  const leafletLayer = api.findLayer(layer.id);
  if (!leafletLayer) return { error: "no Leaflet layer" };
  return {
    onMap: map.hasLayer(leafletLayer),
  };
};
