() => {
  // Unregister the test canvas layer from the LayerControl API.
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return;
  api.unregisterLayer("__test_export_canvas__");
};
