() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const fg = L.featureGroup();
  api.registerLayer({ id: "__test_find_id__", layer: fg });
  const found = api.findLayer("__test_find_id__");
  const isSame = found === fg;
  // Cleanup
  api.unregisterLayer("__test_find_id__");
  const afterCleanup = api.findLayer("__test_find_id__");
  return { found: !!found, isSame, afterCleanup: !!afterCleanup };
};
