() => {
  // Read + clear the name from a window global so the snippet stays a pure
  // function of the DOM + window state (callers set window.__test_layer_name).
  const name = window.__test_layer_name;
  delete window.__test_layer_name;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api || name == null) return null;
  // The display name is not a DOM attribute — resolve it through the API, then
  // click the row's checkbox by id. Base/color rows are excluded by selector.
  const li = api.layers.find(l => l.name === name);
  if (!li) return null;
  const cb = document.querySelector(
    `[data-layer-id="${li.id}"]:not([data-layer-type="base"]):not(.foliplus-color-layer-item) input[type="checkbox"]`,
  );
  if (cb) cb.click();
  return !!cb;
};
