() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  // Register a layer
  const fg = L.featureGroup();
  api.registerLayer({ id: "__test_unreg_dom__", name: "UnregDOM", layer: fg });
  // Verify DOM item exists
  const item = document.querySelector('[data-layer-id="__test_unreg_dom__"]');
  const exists = !!item;
  // Unregister
  api.unregisterLayer("__test_unreg_dom__");
  const itemAfter = document.querySelector('[data-layer-id="__test_unreg_dom__"]');
  return { existsBefore: exists, existsAfter: !!itemAfter };
};
