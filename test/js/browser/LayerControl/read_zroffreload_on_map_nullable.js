// Whether the 'ZROffReload' Leaflet layer is currently on the map — returns
// null if any prerequisite is missing so the caller can distinguish "not
// set up" from "removed".
() => {
  const el = document.querySelector(".leaflet-container");
  const map = (el && window[el.id]) || window.map;
  if (!map) return null;
  const api = map.foliplus && map.foliplus.LayerAPI;
  if (!api) return null;
  const layer = api.layers.find(l => l.name === "ZROffReload");
  if (!layer) return null;
  const leafletLayer = api.findLayer(layer.id);
  if (!leafletLayer) return null;
  return map.hasLayer(leafletLayer);
};
