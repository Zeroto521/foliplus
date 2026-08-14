() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;

  // Simulate a folium-style global var that findLayer resolves.
  window["__resolved_layer__"] = L.featureGroup().addTo(api.map);
  api.registerLayer({ id: "__resolved_layer__" });
  const li = api.layers.find(l => l.id === "__resolved_layer__");

  const out = {
    resolved: !!li.layer,
    sameAsGlobal: li.layer === window["__resolved_layer__"],
  };
  api.unregisterLayer("__resolved_layer__");
  delete window["__resolved_layer__"];
  return out;
};
