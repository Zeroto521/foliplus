// Resolve the id of the 'ZROffProbe' layer via LayerAPI so the test can
// re-inject a probe with the actual id.
() => {
  const el = document.querySelector(".leaflet-container");
  const map = (el && window[el.id]) || window.map;
  const api = map.foliplus && map.foliplus.LayerAPI;
  if (!api || !api.layers) return null;
  const layer = api.layers.find(l => l.name === "ZROffProbe");
  return layer ? layer.id : null;
};
