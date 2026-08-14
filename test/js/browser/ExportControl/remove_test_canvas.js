() => {
  // Unregister the test canvas layer from the LayerControl API.
  const api = window.foliplus && window.foliplus.LayerAPI;
  if (!api) return;
  api.unregisterLayer("__test_export_canvas__");
};
