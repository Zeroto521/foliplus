() => {
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return null;
  const fg = L.featureGroup();
  // Register, set visible=false, re-register
  api.registerLayer({ id: "__test_vis__", layer: fg });
  const li = api.layers.find(l => l.id === "__test_vis__");
  const defaultVisible = li.visible;
  // Simulate user hiding the layer
  li.visible = false;
  api.unregisterLayer("__test_vis__");
  api.registerLayer({ id: "__test_vis__", layer: L.featureGroup() });
  const newLi = api.layers.find(l => l.id === "__test_vis__");
  const newVisible = newLi.visible;
  // Cleanup
  api.unregisterLayer("__test_vis__");
  return { defaultVisible, newVisible };
};
