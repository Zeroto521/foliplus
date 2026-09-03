() => {
  const name = window.__test_layer_name;
  window.__test_layer_name = undefined;
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  for (const l of api.layers) {
    if (l.name === name) {
      const item = document.querySelector(`[data-layer-id="${l.id}"]`);
      if (item) {
        const cb = item.querySelector('input[type="checkbox"]');
        if (cb) cb.click();
        return true;
      }
    }
  }
  return null;
};
